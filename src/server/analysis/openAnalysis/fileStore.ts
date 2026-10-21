import { randomBytes } from "node:crypto";
import { open, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export const OPEN_ANALYSIS_STORE_VERSION = 1 as const;
export const STORE_FILE_NAME = "open-analysis.json";
const LOCK_STALE_MS = 60_000;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface SpendReservationRecord {
  micros: number;
  createdAt: string;
  /** UTC day the reservation was made. Reconciliation always adjusts this day. */
  dayKey: string;
  /** Resolution+analysis cycle this charge belongs to. */
  cycleId: string;
}

export interface DaySpend {
  micros: number;
  reservations: Record<string, SpendReservationRecord>;
  analysisCount: number;
  paidOperationCount: number;
}

export interface CycleSpend {
  /** UTC day of the first reservation in the cycle. Later calls may fall on another day. */
  dayKey: string;
  micros: number;
}

export interface ClientWindow {
  hourKey: string;
  hourAnalyses: number;
  dayKey: string;
  dayAnalyses: number;
  inFlightAnalysisId: string | null;
  inFlightSince: string | null;
}

export interface StoreDocument {
  version: typeof OPEN_ANALYSIS_STORE_VERSION;
  spendByDay: Record<string, DaySpend>;
  cycles: Record<string, CycleSpend>;
  resolveCountByDay: Record<string, number>;
  clients: Record<string, ClientWindow>;
  resolutions: Record<string, unknown>;
  identityByQuery: Record<string, { resolutionId: string; expiresAt: string }>;
  specsByIdentity: Record<string, { expiresAt: string; value: unknown }>;
  priceByIdentity: Record<string, { expiresAt: string; observedAt: string; amount: number | null }>;
  resultsByIdentity: Record<string, { expiresAt: string; value: unknown }>;
  jobs: Record<string, { status: "pending" | "settled"; createdAt: string; response?: unknown; clientHash?: string }>;
}

export function emptyStoreDocument(): StoreDocument {
  return {
    version: OPEN_ANALYSIS_STORE_VERSION,
    spendByDay: {},
    cycles: {},
    resolveCountByDay: {},
    clients: {},
    resolutions: {},
    identityByQuery: {},
    specsByIdentity: {},
    priceByIdentity: {},
    resultsByIdentity: {},
    jobs: {},
  };
}

function normalizeDocument(document: StoreDocument): StoreDocument {
  if (!document.cycles) document.cycles = {};
  return document;
}

function isDocument(value: unknown): value is StoreDocument {
  if (!value || typeof value !== "object") return false;
  const record = value as StoreDocument;
  return record.version === OPEN_ANALYSIS_STORE_VERSION &&
    !!record.spendByDay &&
    !!record.clients &&
    !!record.jobs;
}

export class OpenAnalysisFileStore {
  private chain: Promise<unknown> = Promise.resolve();
  private document: StoreDocument = emptyStoreDocument();

  constructor(
    private readonly directory: string,
    private readonly options: { now?: () => Date; jobDeadlineMs?: number } = {}
  ) {}

  get filePath(): string {
    return path.join(this.directory, STORE_FILE_NAME);
  }

  async update<T>(mutator: (document: StoreDocument) => T | Promise<T>): Promise<T> {
    const run = this.chain.then(() => this.updateLocked(mutator));
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  async read(): Promise<StoreDocument> {
    return this.update((document) => structuredClone(document));
  }

  private async updateLocked<T>(mutator: (document: StoreDocument) => T | Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true });
    const lock = await acquireLock(path.join(this.directory, `${STORE_FILE_NAME}.lock`));
    try {
      this.document = await loadDocument(this.directory);
      recoverInFlight(this.document, this.options.now?.() ?? new Date(), this.options.jobDeadlineMs ?? 55_000);
      prune(this.document, this.options.now?.() ?? new Date());
      const result = await mutator(this.document);
      prune(this.document, this.options.now?.() ?? new Date());
      await atomicWriteJson(this.filePath, this.document);
      return result;
    } finally {
      await releaseLock(lock);
    }
  }
}

function recoverInFlight(document: StoreDocument, now: Date, jobDeadlineMs: number): void {
  const cutoff = now.getTime() - jobDeadlineMs;
  for (const client of Object.values(document.clients)) {
    if (!client.inFlightSince || !client.inFlightAnalysisId) continue;
    const started = Date.parse(client.inFlightSince);
    if (Number.isFinite(started) && started > cutoff) continue;
    const job = document.jobs[client.inFlightAnalysisId];
    if (job && job.status === "pending") {
      job.status = "settled";
      job.response = { status: "error", reason: "analysis_failed" };
    }
    client.inFlightAnalysisId = null;
    client.inFlightSince = null;
  }
  // Reservations stay in place after a crash or deadline. The reserved amount
  // remains on its original UTC day until that same reservation is reconciled.
}

function prune(document: StoreDocument, now: Date): void {
  const cutoff = now.getTime() - RETENTION_MS;
  for (const [day, spend] of Object.entries(document.spendByDay)) {
    const stamp = Date.parse(`${day}T00:00:00.000Z`);
    if (Number.isFinite(stamp) && stamp < cutoff) delete document.spendByDay[day];
    else void spend;
  }
  for (const [day, stamp] of Object.entries(document.resolveCountByDay)) {
    void stamp;
    const parsed = Date.parse(`${day}T00:00:00.000Z`);
    if (Number.isFinite(parsed) && parsed < cutoff) delete document.resolveCountByDay[day];
  }
  dropExpired(document.identityByQuery, now);
  dropExpired(document.specsByIdentity, now);
  dropExpired(document.priceByIdentity, now);
  dropExpired(document.resultsByIdentity, now);
  for (const [id, resolution] of Object.entries(document.resolutions)) {
    const expiresAt = resolution && typeof resolution === "object"
      ? (resolution as { expiresAt?: unknown }).expiresAt
      : undefined;
    if (typeof expiresAt === "string" && Date.parse(expiresAt) <= now.getTime()) {
      delete document.resolutions[id];
    }
  }
  for (const [id, job] of Object.entries(document.jobs)) {
    const created = Date.parse(job.createdAt);
    if (Number.isFinite(created) && created < cutoff) delete document.jobs[id];
  }
}

function dropExpired(records: Record<string, { expiresAt: string }>, now: Date): void {
  for (const [key, record] of Object.entries(records)) {
    if (Date.parse(record.expiresAt) <= now.getTime()) delete records[key];
  }
}

async function loadDocument(directory: string): Promise<StoreDocument> {
  const finalPath = path.join(directory, STORE_FILE_NAME);
  const recovered = await recoverTemp(directory, finalPath);
  if (recovered) return recovered;
  try {
    const parsed = JSON.parse(await readFile(finalPath, "utf8")) as unknown;
    if (!isDocument(parsed)) throw new Error("open_analysis_store_unreadable");
    return normalizeDocument(parsed);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyStoreDocument();
    throw error;
  }
}

async function recoverTemp(directory: string, finalPath: string): Promise<StoreDocument | null> {
  let names: string[] = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const temps = names.filter((name) => name.startsWith(`${STORE_FILE_NAME}.`) && name.endsWith(".tmp"));
  const parsedTemps: Array<{ name: string; mtimeMs: number; document: StoreDocument }> = [];
  for (const name of temps) {
    const full = path.join(directory, name);
    try {
      const parsed = JSON.parse(await readFile(full, "utf8")) as unknown;
      if (!isDocument(parsed)) {
        await rm(full, { force: true });
        continue;
      }
      const info = await stat(full);
      parsedTemps.push({ name, mtimeMs: info.mtimeMs, document: normalizeDocument(parsed) });
    } catch {
      await rm(full, { force: true });
    }
  }
  parsedTemps.sort((a, b) => b.mtimeMs - a.mtimeMs);
  let mainExists = true;
  try {
    await stat(finalPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") mainExists = false;
    else throw error;
  }
  if (!mainExists && parsedTemps[0]) {
    await rename(path.join(directory, parsedTemps[0].name), finalPath);
    for (const extra of parsedTemps.slice(1)) await rm(path.join(directory, extra.name), { force: true });
    return parsedTemps[0].document;
  }
  for (const extra of parsedTemps) await rm(path.join(directory, extra.name), { force: true });
  return null;
}

async function atomicWriteJson(filePath: string, document: StoreDocument): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const handle = await open(tmp, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(document));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, filePath);
}

async function acquireLock(lockPath: string): Promise<{ path: string }> {
  const started = Date.now();
  for (;;) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      } finally {
        await handle.close();
      }
      return { path: lockPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await maybeStealLock(lockPath);
      if (Date.now() - started > 10_000) throw new Error("open_analysis_store_lock_timeout");
      await delay(20);
    }
  }
}

async function maybeStealLock(lockPath: string): Promise<void> {
  try {
    const raw = await readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as { pid?: number; createdAt?: string };
    const created = parsed.createdAt ? Date.parse(parsed.createdAt) : 0;
    const stale = !Number.isFinite(created) || Date.now() - created > LOCK_STALE_MS;
    const alive = typeof parsed.pid === "number" && pidAlive(parsed.pid);
    if (!alive || stale) await rm(lockPath, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    await rm(lockPath, { force: true });
  }
}

async function releaseLock(lock: { path: string }): Promise<void> {
  await rm(lock.path, { force: true });
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
