import path from "node:path";
import {
  DEFAULT_JOB_DEADLINE_MS,
  STORE_FILE_NAME,
  appendStoreAudit,
  provisionStore,
  readStoreDocument,
  recoverExpiredPaidReservations,
  withStoreFile,
} from "./storeFile.mjs";

export {
  AUDIT_LOG_NAME,
  DEFAULT_JOB_DEADLINE_MS,
  LOCK_STALE_MS,
  OpenAnalysisStoreError,
  PROVISION_MARKER_NAME,
  STORE_FILE_NAME,
  appendStoreAudit,
  commitStaleSteal,
  recoverExpiredPaidReservations,
  releaseStoreLock,
} from "./storeFile.mjs";

export const OPEN_ANALYSIS_STORE_VERSION = 1 as const;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export type OpenAnalysisStoreFailure =
  | "open_analysis_data_dir_missing"
  | "open_analysis_spend_ledger_missing"
  | "open_analysis_store_not_provisioned"
  | "open_analysis_store_corrupt";

export interface SpendReservationRecord {
  micros: number;
  createdAt: string;
  /** UTC day the reservation was made. Reconciliation always adjusts this day. */
  dayKey: string;
  /** Resolution+analysis cycle this charge belongs to. */
  cycleId: string;
  /**
   * `reserved` is a hold. `unknown` means a paid request was sent and no
   * verifiable cost came back. `reconciled` keeps the record after an explicit
   * proof. Unknown records are never deleted.
   */
  costState?: "reserved" | "unknown" | "reconciled";
  heldMicros?: number;
  actualMicros?: number;
  evidenceRef?: string;
  reconciledAt?: string;
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
  /** Set by explicit provisioning. Absent on ledgers created before that step existed. */
  provisionedAt?: string;
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

export class OpenAnalysisFileStore {
  private chain: Promise<unknown> = Promise.resolve();
  private document: StoreDocument = emptyStoreDocument();
  /** First locked operation of this process converts every unsettled paid hold. */
  private startupRecoveryDone = false;

  constructor(
    private readonly directory: string,
    private readonly options: { now?: () => Date; jobDeadlineMs?: number; lockWaitMs?: number } = {}
  ) {}

  get filePath(): string {
    return path.join(this.directory, STORE_FILE_NAME);
  }

  get directoryPath(): string {
    return this.directory;
  }

  get lockWaitMs(): number {
    return this.options.lockWaitMs ?? 10_000;
  }

  get jobDeadlineMs(): number {
    return this.options.jobDeadlineMs ?? DEFAULT_JOB_DEADLINE_MS;
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
    const startup = !this.startupRecoveryDone;
    let converted: string[] = [];
    let convertedAt = "";
    const result = await withStoreFile(
      this.directory,
      { lockWaitMs: this.lockWaitMs },
      async (document: StoreDocument) => {
        this.document = document;
        const now = this.options.now?.() ?? new Date();
        converted = recoverExpiredPaidReservations(document, now, this.jobDeadlineMs, {
          convertAllReserved: startup,
        });
        convertedAt = now.toISOString();
        recoverInFlight(this.document, now, this.jobDeadlineMs);
        prune(this.document, now);
        const value = await mutator(this.document);
        prune(this.document, now);
        return value;
      },
      async () => {
        if (converted.length === 0) return;
        await appendStoreAudit(this.directory, {
          at: convertedAt,
          action: "expire_reserved_to_unknown",
          holdIds: converted,
          reason: startup ? "process_startup" : "job_deadline_exceeded",
        });
      }
    );
    this.startupRecoveryDone = true;
    return result;
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
}

function prune(document: StoreDocument, now: Date): void {
  const cutoff = now.getTime() - RETENTION_MS;
  for (const [day, spend] of Object.entries(document.spendByDay)) {
    const stamp = Date.parse(`${day}T00:00:00.000Z`);
    const unknown = Object.values(spend.reservations).some((reservation) => reservation.costState === "unknown");
    if (!unknown && Number.isFinite(stamp) && stamp < cutoff) delete document.spendByDay[day];
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

export async function assertOpenAnalysisStoreReady(directory: string): Promise<void> {
  await readStoreDocument(directory);
}

/**
 * Deliberate first-time provisioning. This is the only path that may create a
 * zeroed ledger. Restart and recovery never call it. A missing directory is not
 * created. A previously initialized ledger that is missing or corrupt is not
 * replaced.
 */
export async function provisionOpenAnalysisStore(
  directory: string,
  now = new Date()
): Promise<"created" | "unchanged"> {
  return provisionStore(directory, now);
}
