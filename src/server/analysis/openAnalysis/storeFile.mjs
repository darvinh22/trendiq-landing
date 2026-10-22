/**
 * Plain JavaScript spend-ledger file operations.
 *
 * Scripts import this module directly so they do not need
 * `--experimental-transform-types` (Node >= 22.7). The TypeScript store calls
 * the same functions, so the process and the reconcile script share one lock
 * and one reconciliation path. This file does not contact a provider.
 */
import { randomBytes } from "node:crypto";
import { link, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export const OPEN_ANALYSIS_STORE_VERSION = 1;
export const STORE_FILE_NAME = "open-analysis.json";
export const PROVISION_MARKER_NAME = "open-analysis.provisioned";
export const AUDIT_LOG_NAME = "open-analysis-audit.log";
/**
 * A lock older than this may be taken only after its pid, createdAt, and token
 * are checked again. A fresh lock is held even when its pid is already dead.
 * This is still one host: another machine does not share this pid table.
 */
export const LOCK_STALE_MS = 60_000;
const USD_MICROS = 1_000_000;

export class OpenAnalysisStoreError extends Error {
  constructor(message) {
    super(message);
    this.name = "OpenAnalysisStoreError";
  }
}

function emptyStoreDocument() {
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

function normalizeDocument(document) {
  if (!document.cycles) document.cycles = {};
  return document;
}

function isDocument(value) {
  if (!value || typeof value !== "object") return false;
  return value.version === OPEN_ANALYSIS_STORE_VERSION &&
    !!value.spendByDay &&
    !!value.clients &&
    !!value.jobs;
}

export function usdToMicros(usd) {
  if (!Number.isFinite(usd) || usd < 0) return 0;
  return Math.round(usd * USD_MICROS);
}

export function isEvidenceRef(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 &&
    trimmed.length <= 512 &&
    trimmed === value &&
    !/[\r\n]/.test(value);
}

function lockFilePath(directory) {
  return path.join(directory, `${STORE_FILE_NAME}.lock`);
}

export async function readStoreDocument(directory) {
  return loadDocument(directory);
}

export async function provisionStore(directory, now = new Date()) {
  await requireDirectory(directory);
  const lock = await acquireStoreLock(lockFilePath(directory), 10_000);
  try {
    const ledgerPath = path.join(directory, STORE_FILE_NAME);
    let ledgerPresent = true;
    try {
      await stat(ledgerPath);
    } catch (error) {
      if (error.code === "ENOENT") ledgerPresent = false;
      else throw error;
    }
    const marked = await markerExists(directory);
    if (!ledgerPresent) {
      const recovered = await recoverTemp(directory, ledgerPath);
      if (recovered) {
        if (!marked) await writeMarker(directory, now);
        return "unchanged";
      }
      if (marked) throw new OpenAnalysisStoreError("open_analysis_spend_ledger_missing");
      const document = emptyStoreDocument();
      document.provisionedAt = now.toISOString();
      await atomicWriteJson(ledgerPath, document);
      await writeMarker(directory, now);
      return "created";
    }
    await loadDocument(directory);
    if (!marked) await writeMarker(directory, now);
    return "unchanged";
  } finally {
    await releaseStoreLock(lock);
  }
}

/**
 * Holds the ledger lock around `mutator`, then fsyncs the document.
 * `afterWrite` runs after that fsync and before the lock is released.
 */
export async function withStoreFile(directory, options, mutator, afterWrite) {
  await requireDirectory(directory);
  const lock = await acquireStoreLock(lockFilePath(directory), options.lockWaitMs ?? 10_000);
  try {
    const document = await loadDocument(directory);
    const result = await mutator(document);
    await atomicWriteJson(path.join(directory, STORE_FILE_NAME), document);
    if (afterWrite) await afterWrite(result);
    return result;
  } finally {
    await releaseStoreLock(lock);
  }
}

/**
 * Marks one unknown hold reconciled. Does not delete the reservation.
 * A repeat with the same evidence ref and the same micros does not apply twice.
 * Appends one JSON line to the audit log after the ledger fsync, still under the lock.
 */
export async function reconcileVerifiedHold(directory, input) {
  if (typeof input.holdId !== "string" || !isEvidenceRef(input.holdId)) {
    throw new Error("open_analysis_reconciliation_unverified");
  }
  if (!isEvidenceRef(input.evidenceRef)) throw new Error("open_analysis_reconciliation_unverified");
  if (typeof input.providerCostUsd !== "number" || !Number.isFinite(input.providerCostUsd) || input.providerCostUsd < 0) {
    throw new Error("open_analysis_reconciliation_unverified");
  }
  const actualMicros = usdToMicros(input.providerCostUsd);
  const now = input.now instanceof Date ? input.now : new Date();
  return withStoreFile(directory, { lockWaitMs: input.lockWaitMs ?? 10_000 }, (document) => {
    const found = findReservation(document, input.holdId);
    if (!found) throw new Error("open_analysis_reconciliation_unverified");
    const reservation = found.reservation;
    if (
      reservation.costState === "reconciled" &&
      reservation.evidenceRef === input.evidenceRef &&
      reservation.actualMicros === actualMicros
    ) {
      return {
        idempotent: true,
        actualMicros,
        dayKey: reservation.dayKey,
        evidenceRef: input.evidenceRef,
      };
    }
    if (reservation.costState !== "unknown") throw new Error("open_analysis_reconciliation_unverified");
    const held = reservation.micros;
    applyMicrosDelta(document, found, actualMicros - held);
    reservation.heldMicros = held;
    reservation.actualMicros = actualMicros;
    reservation.micros = actualMicros;
    reservation.costState = "reconciled";
    reservation.evidenceRef = input.evidenceRef;
    reservation.reconciledAt = now.toISOString();
    return {
      idempotent: false,
      actualMicros,
      dayKey: reservation.dayKey,
      evidenceRef: input.evidenceRef,
    };
  }, async (result) => {
    await appendAudit(directory, {
      at: now.toISOString(),
      action: "reconcile_verified",
      holdId: input.holdId,
      providerCostUsd: input.providerCostUsd,
      actualMicros: result.actualMicros,
      evidenceRef: result.evidenceRef,
      idempotent: result.idempotent,
      dayKey: result.dayKey,
    });
  });
}

function findReservation(document, id) {
  for (const day of Object.values(document.spendByDay ?? {})) {
    const reservation = day?.reservations?.[id];
    if (reservation) return { day, reservation };
  }
  return null;
}

function applyMicrosDelta(document, found, delta) {
  found.day.micros += delta;
  if (found.day.micros < 0) found.day.micros = 0;
  const cycle = document.cycles?.[found.reservation.cycleId];
  if (cycle) {
    cycle.micros += delta;
    if (cycle.micros < 0) cycle.micros = 0;
  }
}

async function appendAudit(directory, record) {
  const handle = await open(path.join(directory, AUDIT_LOG_NAME), "a", 0o600);
  try {
    await handle.write(`${JSON.stringify(record)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function loadDocument(directory) {
  await requireDirectory(directory);
  const finalPath = path.join(directory, STORE_FILE_NAME);
  const recovered = await recoverTemp(directory, finalPath);
  if (recovered) return recovered;
  try {
    const raw = await readFile(finalPath, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new OpenAnalysisStoreError("open_analysis_store_corrupt");
    }
    if (!isDocument(parsed)) throw new OpenAnalysisStoreError("open_analysis_store_corrupt");
    return normalizeDocument(parsed);
  } catch (error) {
    if (error instanceof OpenAnalysisStoreError) throw error;
    if (error.code === "ENOENT") {
      if (await markerExists(directory)) throw new OpenAnalysisStoreError("open_analysis_spend_ledger_missing");
      throw new OpenAnalysisStoreError("open_analysis_store_not_provisioned");
    }
    throw error;
  }
}

async function requireDirectory(directory) {
  if (!directory || !String(directory).trim()) throw new OpenAnalysisStoreError("open_analysis_data_dir_missing");
  try {
    const info = await stat(directory);
    if (!info.isDirectory()) throw new OpenAnalysisStoreError("open_analysis_data_dir_missing");
  } catch (error) {
    if (error instanceof OpenAnalysisStoreError) throw error;
    if (error.code === "ENOENT") throw new OpenAnalysisStoreError("open_analysis_data_dir_missing");
    throw error;
  }
}

async function markerExists(directory) {
  try {
    const info = await stat(path.join(directory, PROVISION_MARKER_NAME));
    return info.isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function writeMarker(directory, now) {
  const markerPath = path.join(directory, PROVISION_MARKER_NAME);
  const tmp = `${markerPath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeSynced(tmp, JSON.stringify({
    version: OPEN_ANALYSIS_STORE_VERSION,
    provisionedAt: now.toISOString(),
    ledger: STORE_FILE_NAME,
  }));
  await rename(tmp, markerPath);
}

async function recoverTemp(directory, finalPath) {
  let names = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const temps = names.filter((name) => name.startsWith(`${STORE_FILE_NAME}.`) && name.endsWith(".tmp"));
  const parsedTemps = [];
  for (const name of temps) {
    const full = path.join(directory, name);
    try {
      const parsed = JSON.parse(await readFile(full, "utf8"));
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
    if (error.code === "ENOENT") mainExists = false;
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

async function atomicWriteJson(filePath, document) {
  const tmp = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeSynced(tmp, JSON.stringify(document));
  await rename(tmp, filePath);
}

async function writeSynced(filePath, contents) {
  const handle = await open(filePath, "w", 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Creates the lock by linking a temp file onto the lock path. `link` fails
 * with EEXIST instead of replacing an existing lock. Rename would overwrite.
 */
export async function acquireStoreLock(lockPath, waitMs = 10_000) {
  const token = randomBytes(16).toString("hex");
  const tmp = `${lockPath}.${process.pid}.${token}.tmp`;
  const started = Date.now();
  const body = () => JSON.stringify({
    pid: process.pid,
    createdAt: new Date().toISOString(),
    token,
  });
  await writeSynced(tmp, body());
  try {
    for (;;) {
      try {
        await link(tmp, lockPath);
        return { path: lockPath, token, pid: process.pid };
      } catch (error) {
        if (error.code === "ENOENT") {
          await writeSynced(tmp, body());
        } else if (error.code !== "EEXIST") {
          throw error;
        } else if (await maybeStealLock(lockPath)) {
          continue;
        }
        if (Date.now() - started > waitMs) throw new Error("open_analysis_store_lock_timeout");
        await delay(20);
      }
    }
  } finally {
    await rm(tmp, { force: true });
  }
}

async function maybeStealLock(lockPath) {
  let raw;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return true;
    return false;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object") return false;
  const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : "";
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  if (Date.now() - created <= LOCK_STALE_MS) return false;
  return commitStaleSteal(lockPath, {
    pid: parsed.pid,
    createdAt,
    token: typeof parsed.token === "string" ? parsed.token : undefined,
  });
}

/**
 * Moves the lock aside and deletes it only when pid, createdAt, and token still
 * match the stale identity. A replacement is linked back.
 */
export async function commitStaleSteal(lockPath, observed) {
  const grave = `${lockPath}.${process.pid}.${randomBytes(8).toString("hex")}.grave`;
  try {
    await rename(lockPath, grave);
  } catch (error) {
    if (error.code === "ENOENT") return true;
    return false;
  }
  let matches = false;
  try {
    const parsed = JSON.parse(await readFile(grave, "utf8"));
    const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : "";
    const created = Date.parse(createdAt);
    const token = typeof parsed.token === "string" ? parsed.token : undefined;
    matches = Number.isFinite(created) &&
      Date.now() - created > LOCK_STALE_MS &&
      parsed.pid === observed.pid &&
      createdAt === observed.createdAt &&
      token === observed.token;
  } catch {
    matches = false;
  }
  if (matches) {
    await rm(grave, { force: true });
    return true;
  }
  await restoreFile(grave, lockPath);
  return false;
}

export async function releaseStoreLock(lock) {
  if (!lock?.path || typeof lock.token !== "string") return;
  let current;
  try {
    current = JSON.parse(await readFile(lock.path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    return;
  }
  if (!current || current.token !== lock.token || current.pid !== lock.pid) return;
  const grave = `${lock.path}.${process.pid}.${lock.token}.release`;
  try {
    await rename(lock.path, grave);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  let owned = false;
  try {
    const parsed = JSON.parse(await readFile(grave, "utf8"));
    owned = parsed.token === lock.token && parsed.pid === lock.pid;
  } catch {
    owned = false;
  }
  if (owned) {
    await rm(grave, { force: true });
    return;
  }
  await restoreFile(grave, lock.path);
}

async function restoreFile(grave, lockPath) {
  try {
    await link(grave, lockPath);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await rm(grave, { force: true });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
