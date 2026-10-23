/**
 * Plain JavaScript spend-ledger file operations.
 *
 * Scripts import this module directly so they do not need
 * `--experimental-transform-types` (Node >= 22.7). The TypeScript store calls
 * the same functions, so the process and the reconcile script share one lock
 * and one reconciliation path. This file does not contact a provider.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, fstatSync, openSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { link, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export const OPEN_ANALYSIS_STORE_VERSION = 1;
export const STORE_FILE_NAME = "open-analysis.json";
export const PROVISION_MARKER_NAME = "open-analysis.provisioned";
export const AUDIT_LOG_NAME = "open-analysis-audit.log";
/**
 * A lock may be removed only when it is older than this and its pid is not
 * alive on this host (`kill(pid, 0)`). A live pid is never taken, and a fresh
 * lock is held even when its pid is already dead. Token is read again before
 * any unlink. The lock file is never renamed. This is still one host.
 */
export const LOCK_STALE_MS = 60_000;
/** Same default as the open-analysis job deadline. A reserved paid hold older than this has no live job. */
export const DEFAULT_JOB_DEADLINE_MS = 55_000;
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
 * Converts paid reservations that are still `reserved` and have no confirmed
 * settlement into `unknown`. Does not change held micros and does not delete
 * the record. Unknown and reconciled rows are left as they are.
 *
 * `convertAllReserved` is the process-start pass: no job from the previous
 * process is still running, so every unsettled paid hold is past its deadline.
 * Later passes convert only a hold older than `jobDeadlineMs`.
 * A second call converts nothing more. Throws instead of writing when a paid
 * reserved hold cannot be classified.
 */
export function recoverExpiredPaidReservations(document, now, jobDeadlineMs, options = {}) {
  if (!document || typeof document !== "object" || Array.isArray(document.spendByDay) || !document.spendByDay || typeof document.spendByDay !== "object") {
    throw new OpenAnalysisStoreError("open_analysis_recovery_failed");
  }
  const deadline = Number(jobDeadlineMs);
  if (!Number.isFinite(deadline) || deadline < 0) throw new OpenAnalysisStoreError("open_analysis_recovery_failed");
  const at = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(at)) throw new OpenAnalysisStoreError("open_analysis_recovery_failed");
  const convertAllReserved = options?.convertAllReserved === true;
  const cutoff = at - deadline;
  const pending = [];
  for (const day of Object.values(document.spendByDay)) {
    if (!day || typeof day !== "object" || Array.isArray(day.reservations) || !day.reservations || typeof day.reservations !== "object") {
      throw new OpenAnalysisStoreError("open_analysis_recovery_failed");
    }
    for (const [id, reservation] of Object.entries(day.reservations)) {
      if (!reservation || typeof reservation !== "object" || Array.isArray(reservation)) {
        throw new OpenAnalysisStoreError("open_analysis_recovery_failed");
      }
      const state = reservation.costState;
      if (state === "unknown" || state === "reconciled") continue;
      if (state !== undefined && state !== "reserved") throw new OpenAnalysisStoreError("open_analysis_recovery_failed");
      if (typeof reservation.micros !== "number" || !Number.isFinite(reservation.micros) || reservation.micros < 0) {
        throw new OpenAnalysisStoreError("open_analysis_recovery_failed");
      }
      if (reservation.micros === 0) continue;
      if (typeof reservation.actualMicros === "number" || typeof reservation.reconciledAt === "string") {
        throw new OpenAnalysisStoreError("open_analysis_recovery_failed");
      }
      const created = typeof reservation.createdAt === "string" ? Date.parse(reservation.createdAt) : NaN;
      if (!Number.isFinite(created)) throw new OpenAnalysisStoreError("open_analysis_recovery_failed");
      if (!convertAllReserved && created > cutoff) continue;
      pending.push({ id, reservation });
    }
  }
  for (const entry of pending) entry.reservation.costState = "unknown";
  return pending.map((entry) => entry.id).sort();
}

function isUnsettledPaidReservation(reservation) {
  if (!reservation || typeof reservation !== "object") return false;
  if (reservation.costState !== undefined && reservation.costState !== "reserved") return false;
  if (typeof reservation.micros !== "number" || !Number.isFinite(reservation.micros) || reservation.micros <= 0) return false;
  if (typeof reservation.actualMicros === "number" || typeof reservation.reconciledAt === "string") return false;
  return typeof reservation.createdAt === "string" && Number.isFinite(Date.parse(reservation.createdAt));
}

/**
 * Marks one unknown hold reconciled. Does not delete the reservation.
 * A paid hold left `reserved` by a crash is converted to `unknown` in this
 * same locked write, then reconciled. A repeat with the same evidence ref and
 * the same micros does not apply twice.
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
    const prior = findReservation(document, input.holdId);
    const priorState = prior?.reservation?.costState ?? (prior ? "reserved" : undefined);
    const deadline = Number.isFinite(input.jobDeadlineMs) && input.jobDeadlineMs >= 0
      ? input.jobDeadlineMs
      : DEFAULT_JOB_DEADLINE_MS;
    const expired = recoverExpiredPaidReservations(document, now, deadline);
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
        priorState: priorState ?? "reconciled",
        expiredHoldIds: expired.filter((id) => id !== input.holdId),
      };
    }
    if (reservation.costState === "reserved" || reservation.costState === undefined) {
      if (!isUnsettledPaidReservation(reservation)) throw new Error("open_analysis_reconciliation_unverified");
      reservation.costState = "unknown";
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
      priorState: priorState ?? "unknown",
      expiredHoldIds: expired.filter((id) => id !== input.holdId),
    };
  }, async (result) => {
    if (result.expiredHoldIds?.length) {
      await appendAudit(directory, {
        at: now.toISOString(),
        action: "expire_reserved_to_unknown",
        holdIds: result.expiredHoldIds,
        reason: "job_deadline_exceeded",
      });
    }
    await appendAudit(directory, {
      at: now.toISOString(),
      action: "reconcile_verified",
      holdId: input.holdId,
      providerCostUsd: input.providerCostUsd,
      actualMicros: result.actualMicros,
      evidenceRef: result.evidenceRef,
      idempotent: result.idempotent,
      dayKey: result.dayKey,
      priorState: result.priorState,
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

export async function appendStoreAudit(directory, record) {
  await appendAudit(directory, record);
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
  // Test seam only. A set value fails the ledger write before any rename.
  // The caller must not start a paid call. Leave this unset in production.
  if (process.env.TRENDIQ_OPEN_ANALYSIS_LEDGER_WRITE_FAIL === "1") {
    throw new OpenAnalysisStoreError("open_analysis_ledger_write_failed");
  }
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
 * with EEXIST instead of replacing an existing lock. The caller then holds an
 * exclusive kernel flock on that inode until release. The lock file is never
 * renamed, so a third process cannot create a second lock in a gap.
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
        const owned = await ownLock(lockPath, token, Math.max(0, waitMs - (Date.now() - started)));
        if (owned) return owned;
        if (Date.now() - started > waitMs) throw new Error("open_analysis_store_lock_timeout");
        await delay(20);
        continue;
      } catch (error) {
        if (error instanceof OpenAnalysisStoreError && error.message === "open_analysis_flock_missing") {
          // flock never ran, so this process does not hold the inode. Drop
          // only the lock file this attempt just created.
          releaseOwnUnflockedLock(lockPath, token);
          throw error;
        }
        if (error?.message === "open_analysis_store_lock_timeout") {
          // The helper gave up while waiting. Do not unlink: another process
          // may hold this inode, and releasing it would open a spend gap.
          throw error;
        }
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

async function ownLock(lockPath, token, waitMs) {
  let fd;
  try {
    fd = openSync(lockPath, "r");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let held;
  try {
    held = await holdFdLock(fd, false, waitMs);
  } catch (error) {
    closeQuiet(fd);
    throw error;
  }
  if (!held) {
    closeQuiet(fd);
    return null;
  }
  const snap = snapshot(fd, lockPath);
  if (!snap || snap === "unreadable" || snap.parsed.token !== token || snap.parsed.pid !== process.pid) {
    await held.release();
    return null;
  }
  return {
    path: lockPath,
    token,
    pid: process.pid,
    fd,
    release: held.release,
  };
}

async function maybeStealLock(lockPath) {
  const observed = await readLockIdentity(lockPath);
  if (observed === "absent") return true;
  if (observed === "held") return false;
  return commitStaleSteal(lockPath, observed);
}

/**
 * Removes a stale lock whose owner pid is dead. Reads the token before taking
 * the kernel lock and again before unlink. Does not rename or unlink a lock
 * that is live, fresh, unreadable, or no longer the observed identity.
 */
export async function commitStaleSteal(lockPath, observed) {
  const current = await readLockIdentity(lockPath);
  if (current === "absent") return true;
  if (current === "held") return false;
  if (!sameIdentity(current, observed) || !isStaleDead(current)) return false;
  let fd;
  try {
    fd = openSync(lockPath, "r");
  } catch (error) {
    if (error.code === "ENOENT") return true;
    return false;
  }
  let held;
  try {
    held = await holdFdLock(fd, true);
  } catch (error) {
    closeQuiet(fd);
    throw error;
  }
  if (!held) {
    closeQuiet(fd);
    return false;
  }
  try {
    const snap = snapshot(fd, lockPath);
    if (!snap || snap === "unreadable") return false;
    if (!sameIdentity(snap.parsed, observed) || !isStaleDead(snap.parsed)) return false;
    unlinkSync(lockPath);
    return true;
  } finally {
    await held.release();
  }
}

export async function releaseStoreLock(lock) {
  if (!lock?.path || typeof lock.token !== "string") {
    await lock?.release?.();
    return;
  }
  const current = await readLockIdentity(lock.path);
  if (current === "absent" || current === "held" || current.token !== lock.token || current.pid !== lock.pid) {
    await lock?.release?.();
    return;
  }
  if (lock.release) {
    try {
      const snap = typeof lock.fd === "number" ? snapshot(lock.fd, lock.path) : null;
      if (snap && snap !== "unreadable" && snap.parsed.token === lock.token && snap.parsed.pid === lock.pid) {
        unlinkSync(lock.path);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    } finally {
      await lock.release();
    }
    return;
  }
  let fd;
  try {
    fd = openSync(lock.path, "r");
  } catch (error) {
    if (error.code === "ENOENT") return;
    return;
  }
  let held;
  try {
    held = await holdFdLock(fd, true);
  } catch (error) {
    closeQuiet(fd);
    throw error;
  }
  if (!held) {
    closeQuiet(fd);
    return;
  }
  try {
    const snap = snapshot(fd, lock.path);
    if (snap && snap !== "unreadable" && snap.parsed.token === lock.token && snap.parsed.pid === lock.pid) {
      unlinkSync(lock.path);
    }
  } finally {
    await held.release();
  }
}

async function readLockIdentity(lockPath) {
  let raw;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "absent";
    return "held";
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "held";
  }
  if (!parsed || typeof parsed !== "object") return "held";
  return {
    pid: parsed.pid,
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
    token: typeof parsed.token === "string" ? parsed.token : undefined,
  };
}

function sameIdentity(parsed, observed) {
  const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : "";
  const token = typeof parsed.token === "string" ? parsed.token : undefined;
  return parsed.pid === observed.pid && createdAt === observed.createdAt && token === observed.token;
}

function isStaleDead(parsed) {
  if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return false;
  const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : "";
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created) || Date.now() - created <= LOCK_STALE_MS) return false;
  return !pidAlive(parsed.pid);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function snapshot(fd, lockPath) {
  let fdStat;
  try {
    fdStat = fstatSync(fd);
  } catch {
    return null;
  }
  let pathStat;
  try {
    pathStat = statSync(lockPath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (pathStat.ino !== fdStat.ino || pathStat.dev !== fdStat.dev) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return "unreadable";
  }
  let after;
  try {
    after = statSync(lockPath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (after.ino !== fdStat.ino || after.dev !== fdStat.dev) return null;
  if (!parsed || typeof parsed !== "object") return "unreadable";
  return { parsed };
}

/**
 * Removes a lock this process just created when `flock` is not installed.
 * The binary never ran, so this process does not hold the inode. Unlink only
 * if the path still names that inode and the pid and token are still ours.
 * A different identity is left alone.
 */
function releaseOwnUnflockedLock(lockPath, token) {
  let fd;
  try {
    fd = openSync(lockPath, "r");
  } catch (error) {
    if (error.code === "ENOENT") return;
    return;
  }
  try {
    const first = snapshot(fd, lockPath);
    const second = snapshot(fd, lockPath);
    if (!ownsUnflocked(first, token) || !ownsUnflocked(second, token)) return;
    if (first.parsed.token !== second.parsed.token || first.parsed.createdAt !== second.parsed.createdAt) return;
    unlinkSync(lockPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  } finally {
    closeQuiet(fd);
  }
}

function ownsUnflocked(snap, token) {
  if (!snap || snap === "unreadable") return false;
  return snap.parsed.pid === process.pid
    && snap.parsed.token === token
    && typeof snap.parsed.createdAt === "string"
    && snap.parsed.createdAt.length > 0;
}

/**
 * Exclusive kernel lock on an already-open inode. The helper is
 * `flock -x 3` on the inherited descriptor, not a path named `3`, so it does
 * not create a file. On success the helper exits and this process keeps the
 * lock until `release` closes the descriptor. Non-blocking failure means a
 * live holder owns the inode; the caller must not unlink it. The blocking
 * helper gives up after `timeoutMs` (`flock -w`) and rejects. That path does
 * not acquire the lock and does not close the caller's descriptor, so a hold
 * another process already has is left in place.
 */
export function holdFdLock(fd, nonblock, timeoutMs = 10_000) {
  const args = [];
  if (nonblock) args.push("-n");
  else args.push("-w", String(Math.max(1, timeoutMs) / 1000));
  args.push("-x", "3");
  const child = spawn("flock", args, { stdio: ["ignore", "ignore", "ignore", fd] });
  return new Promise((resolve, reject) => {
    let settled = false;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      if (error?.code === "ENOENT") {
        reject(new OpenAnalysisStoreError("open_analysis_flock_missing"));
        return;
      }
      reject(error);
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve({
          async release() {
            closeQuiet(fd);
          },
        });
        return;
      }
      if (!nonblock) {
        reject(new Error("open_analysis_store_lock_timeout"));
        return;
      }
      resolve(null);
    });
  });
}

function closeQuiet(fd) {
  try {
    closeSync(fd);
  } catch {
    // Already closed with the kernel lock.
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
