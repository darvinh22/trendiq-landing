import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderExecutionError } from "../../../../app/lib/data/capabilities/types";
import type { FetchLike } from "../../../../app/lib/data/search/client";
import { DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH } from "../../../../app/lib/data/reviews/client";
import { ProviderRequestBudget } from "../../providerRequestBudget";
import { createProductAnalysisRuntime } from "../../../runtime/productAnalysisRuntime";
import { readPrivateAlphaRuntimeConfig } from "../../../runtime/runtimeConfig";
import {
  createAnalysisSpendTracker,
  reconcileUnknownFromProviderBody,
} from "../costAccounting";
import {
  LOCK_STALE_MS,
  OpenAnalysisFileStore,
  PROVISION_MARKER_NAME,
  STORE_FILE_NAME,
  provisionOpenAnalysisStore,
} from "../fileStore";
import { FileSpendLedger, OpenAnalysisService } from "../openAnalysisService";

const tempDirs: string[] = [];
const paidUrl = `https://fixture.invalid${DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH}`;

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "trendiq-fail-closed-"));
  tempDirs.push(dir);
  return dir;
}

async function readyDir(): Promise<string> {
  const dir = await tempDir();
  expect(await provisionOpenAnalysisStore(dir)).toBe("created");
  return dir;
}

function jsonResponse(body: unknown) {
  const text = JSON.stringify(body);
  return { ok: true, status: 200, json: async () => body, text: async () => text };
}

function dayReservations(document: Awaited<ReturnType<OpenAnalysisFileStore["read"]>>, day: string) {
  return document.spendByDay[day]?.reservations ?? {};
}

describe("spend ledger fail-closed", () => {
  it("keeps counters across a restart and does not provision again", async () => {
    const dataDir = await readyDir();
    const now = new Date("2026-10-21T12:00:00.000Z");
    const store = new OpenAnalysisFileStore(dataDir, { now: () => now });
    await store.update((document) => {
      document.spendByDay["2026-10-21"] = {
        micros: 123_000,
        reservations: {},
        analysisCount: 2,
        paidOperationCount: 1,
      };
    });

    const restarted = new OpenAnalysisFileStore(dataDir, { now: () => now });
    const document = await restarted.read();
    expect(document.spendByDay["2026-10-21"]?.micros).toBe(123_000);
    expect(document.spendByDay["2026-10-21"]?.paidOperationCount).toBe(1);
    expect(await provisionOpenAnalysisStore(dataDir, now)).toBe("unchanged");
    expect((await restarted.read()).spendByDay["2026-10-21"]?.micros).toBe(123_000);
    expect((await readdir(dataDir)).filter((name) => name === STORE_FILE_NAME)).toHaveLength(1);
  });

  it("refuses a missing configured directory without creating cwd/.trendiq or resetting caps", async () => {
    const missing = join(tmpdir(), `trendiq-missing-dir-${process.pid}-${Date.now()}`);
    const cwdLedger = join(process.cwd(), ".trendiq", STORE_FILE_NAME);
    let cwdExisted = true;
    try {
      await stat(cwdLedger);
    } catch (error) {
      cwdExisted = (error as NodeJS.ErrnoException).code !== "ENOENT";
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error("provider_must_not_be_called");
    });
    await expect(provisionOpenAnalysisStore(missing)).rejects.toThrow("open_analysis_data_dir_missing");
    await expect(new OpenAnalysisFileStore(missing).read()).rejects.toThrow("open_analysis_data_dir_missing");
    await expect(stat(missing)).rejects.toMatchObject({ code: "ENOENT" });

    const service = new OpenAnalysisService({
      enabled: true,
      analysisEnabled: true,
      dataDir: missing,
      now: () => new Date("2026-10-21T12:00:00.000Z"),
      fetchImpl,
      apiBaseUrl: "https://fixture.invalid",
      login: "fixture-login",
      password: "fixture-password",
      liveConfigured: true,
    });
    const refused = await service.resolveOpenProduct({ query: "Sony WH-1000XM5" });
    expect(refused).toEqual({ statusCode: 503, body: { status: "unavailable", reason: "runtime_not_ready" } });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(stat(missing)).rejects.toMatchObject({ code: "ENOENT" });
    if (!cwdExisted) await expect(stat(cwdLedger)).rejects.toMatchObject({ code: "ENOENT" });

    const config = readPrivateAlphaRuntimeConfig({
      TRENDIQ_ANALYSIS_ENABLED: "true",
      TRENDIQ_OPEN_ANALYSIS_ENABLED: "true",
      TRENDIQ_DATA_DIR: "   ",
      TRENDIQ_PROCESS_MAX_PAID_OPERATIONS: "3",
      TRENDIQ_ANALYSIS_JOB_DEADLINE_MS: "55000",
      TRENDIQ_SEARCH_MODE: "live",
      TRENDIQ_SEARCH_PROVIDER: "dataforseo",
      TRENDIQ_REVIEWS_MODE: "mock",
      TRENDIQ_REVIEWS_PROVIDER: "dataforseo",
      DATAFORSEO_LOGIN: "fixture-login",
      DATAFORSEO_PASSWORD: "fixture-password",
      DATAFORSEO_API_BASE_URL: "https://api.dataforseo.com",
    });
    expect(config.openAnalysisDataDir).toBe("");
    expect(config.openAnalysisEnabled).toBe(true);
  });

  it("refuses a missing previously initialized ledger and does not write a zeroed replacement", async () => {
    const dataDir = await readyDir();
    const now = new Date("2026-10-21T12:00:00.000Z");
    const store = new OpenAnalysisFileStore(dataDir, { now: () => now });
    await store.update((document) => {
      document.spendByDay["2026-10-21"] = {
        micros: 250_000,
        reservations: {},
        analysisCount: 1,
        paidOperationCount: 1,
      };
    });
    const ledgerPath = join(dataDir, STORE_FILE_NAME);
    const preserved = await readFile(ledgerPath, "utf8");
    expect(preserved).toContain("250000");
    await rm(ledgerPath);

    await expect(new OpenAnalysisFileStore(dataDir).read()).rejects.toThrow("open_analysis_spend_ledger_missing");
    await expect(provisionOpenAnalysisStore(dataDir)).rejects.toThrow("open_analysis_spend_ledger_missing");
    await expect(stat(ledgerPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(dataDir)).toContain(PROVISION_MARKER_NAME);
    expect((await readdir(dataDir)).some((name) => name === STORE_FILE_NAME)).toBe(false);

    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error("provider_must_not_be_called");
    });
    const service = new OpenAnalysisService({
      enabled: true,
      analysisEnabled: true,
      dataDir,
      now: () => now,
      fetchImpl,
      apiBaseUrl: "https://fixture.invalid",
      login: "fixture-login",
      password: "fixture-password",
      liveConfigured: true,
    });
    const refused = await service.resolveOpenProduct({ query: "Sony WH-1000XM5" });
    expect(refused).toEqual({ statusCode: 503, body: { status: "unavailable", reason: "runtime_not_ready" } });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(stat(ledgerPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a corrupt ledger and leaves the bytes in place", async () => {
    const dataDir = await readyDir();
    const ledgerPath = join(dataDir, STORE_FILE_NAME);
    const corrupt = "{\"version\":1,\"spendByDay\":{\"2026-10-21\":{\"micros\":999}}}";
    await writeFile(ledgerPath, corrupt);
    const store = new OpenAnalysisFileStore(dataDir);
    await expect(store.read()).rejects.toThrow("open_analysis_store_corrupt");
    await expect(store.update(() => undefined)).rejects.toThrow("open_analysis_store_corrupt");
    await expect(provisionOpenAnalysisStore(dataDir)).rejects.toThrow("open_analysis_store_corrupt");
    expect(await readFile(ledgerPath, "utf8")).toBe(corrupt);

    const truncatedDir = await tempDir();
    const truncatedPath = join(truncatedDir, STORE_FILE_NAME);
    await writeFile(truncatedPath, "{");
    await expect(new OpenAnalysisFileStore(truncatedDir).read()).rejects.toThrow("open_analysis_store_corrupt");
    expect(await readFile(truncatedPath, "utf8")).toBe("{");
    expect(await readdir(truncatedDir)).toEqual([STORE_FILE_NAME]);
  });

  it("does not create a store on an unprovisioned directory during restart", async () => {
    const dataDir = await tempDir();
    await expect(new OpenAnalysisFileStore(dataDir).read()).rejects.toThrow("open_analysis_store_not_provisioned");
    expect(await readdir(dataDir)).toEqual([]);
  });
});

describe("unknown cost after a paid timeout", () => {
  it("keeps an unknown hold, blocks the period, and ignores an estimate reconciliation", async () => {
    const dataDir = await readyDir();
    const now = new Date("2026-10-21T12:00:00.000Z");
    const ledger = new FileSpendLedger(new OpenAnalysisFileStore(dataDir, { now: () => now }));
    const tracker = createAnalysisSpendTracker({
      maxMicros: 150_000,
      ledger,
      now: () => now,
      cycleId: "cycle_timeout",
    });
    let releaseLate: (body: unknown) => void = () => undefined;
    const late = new Promise<unknown>((resolve) => {
      releaseLate = resolve;
    });
    const fetchImpl = vi.fn<FetchLike>(() => late.then((body) => jsonResponse(body)));
    const budget = new ProviderRequestBudget(fetchImpl, 8, 1, 30);
    const wrapped = tracker.wrap(budget.fetch);
    await expect(wrapped(paidUrl, { method: "POST" })).rejects.toThrow("controlled_provider_request_timeout");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const held = await new OpenAnalysisFileStore(dataDir, { now: () => now }).read();
    const reservations = dayReservations(held, "2026-10-21");
    const [id, reservation] = Object.entries(reservations)[0] ?? [];
    if (!id || !reservation) throw new Error("expected unknown hold");
    expect(reservation.costState).toBe("unknown");
    expect(reservation.micros).toBe(2_000);
    expect(held.spendByDay["2026-10-21"]?.micros).toBe(2_000);

    await ledger.reconcile(id, 2_000, now);
    const afterEstimate = await new OpenAnalysisFileStore(dataDir, { now: () => now }).read();
    expect(dayReservations(afterEstimate, "2026-10-21")[id]?.costState).toBe("unknown");
    expect(afterEstimate.spendByDay["2026-10-21"]?.micros).toBe(2_000);

    const blocked = await ledger.reserve(2_000, now, { cycleId: "cycle_other" });
    expect(blocked).toEqual({ ok: false, micros: 0, reason: "unknown_cost" });
    const nextDay = await ledger.reserve(2_000, new Date("2026-10-22T00:10:00.000Z"), { cycleId: "cycle_next_day" });
    expect(nextDay.ok).toBe(true);
    const restarted = new FileSpendLedger(new OpenAnalysisFileStore(dataDir));
    const stillBlocked = await restarted.reserve(2_000, now, { cycleId: "cycle_restart" });
    expect(stillBlocked).toEqual({ ok: false, micros: 0, reason: "unknown_cost" });

    releaseLate({ tasks: [{ id: "task_late_no_cost", status_code: 20000 }] });
    await late;
    expect(await reconcileUnknownFromProviderBody(ledger, id, { tasks: [{ id: "task_late_no_cost" }] }, now)).toBe(false);
    expect((await new OpenAnalysisFileStore(dataDir).read()).spendByDay["2026-10-21"]?.reservations[id]?.costState).toBe("unknown");

    const lateBody = { cost: 0.05, tasks: [{ id: "task_late_1", cost: 0.05 }] };
    releaseLate(lateBody);
    expect(await reconcileUnknownFromProviderBody(ledger, id, lateBody, now)).toBe(true);
    const settled = await new OpenAnalysisFileStore(dataDir, { now: () => now }).read();
    expect(settled.spendByDay["2026-10-21"]?.reservations[id]).toBeUndefined();
    expect(settled.spendByDay["2026-10-21"]?.micros).toBe(50_000);
    expect(settled.spendByDay["2026-10-21"]?.micros).not.toBe(2_000);
    const resumed = await ledger.reserve(2_000, now, { cycleId: "cycle_after" });
    expect(resumed.ok).toBe(true);
    expect(resumed.micros).toBe(2_000);
  });

  it("blocks a later resolve after a sent request times out until the late cost is reconciled", async () => {
    const dataDir = await readyDir();
    const now = new Date("2026-10-21T15:00:00.000Z");
    let releaseLate: ((body: unknown) => void) | undefined;
    const fetchImpl = vi.fn<FetchLike>(() => new Promise((resolve) => {
      releaseLate = (body) => resolve(jsonResponse(body));
    }));
    const service = new OpenAnalysisService({
      enabled: true,
      analysisEnabled: true,
      dataDir,
      now: () => now,
      fetchImpl,
      apiBaseUrl: "https://fixture.invalid",
      login: "fixture-login",
      password: "fixture-password",
      liveConfigured: true,
      requestTimeoutMs: 40,
    });
    const timedOut = await service.resolveOpenProduct({ query: "Sony WH-1000XM5" });
    expect(timedOut.statusCode).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("fixture.invalid");
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain("api.dataforseo.com");

    const held = await new OpenAnalysisFileStore(dataDir, { now: () => now }).read();
    const reservationId = Object.keys(dayReservations(held, "2026-10-21"))[0];
    if (!reservationId) throw new Error("expected held reservation");
    expect(held.spendByDay["2026-10-21"]?.reservations[reservationId]?.costState).toBe("unknown");
    expect(held.spendByDay["2026-10-21"]?.micros).toBe(2_000);

    const lateBody = {
      status_code: 20000,
      cost: 0.01,
      tasks: [{ id: "task_late_service", status_code: 20000, cost: 0.004, result: [{ items: [] }] }],
    };
    releaseLate?.(lateBody);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const afterLate = await new OpenAnalysisFileStore(dataDir, { now: () => now }).read();
    expect(afterLate.spendByDay["2026-10-21"]?.reservations[reservationId]?.costState).toBe("unknown");
    expect(afterLate.spendByDay["2026-10-21"]?.micros).toBe(2_000);

    const blockedFetch = vi.fn<FetchLike>(async () => {
      throw new Error("provider_must_not_be_called");
    });
    const blockedService = new OpenAnalysisService({
      enabled: true,
      analysisEnabled: true,
      dataDir,
      now: () => now,
      fetchImpl: blockedFetch,
      apiBaseUrl: "https://fixture.invalid",
      login: "fixture-login",
      password: "fixture-password",
      liveConfigured: true,
    });
    const blocked = await blockedService.resolveOpenProduct({ query: "Bose QuietComfort Ultra" });
    expect(blocked).toEqual({ statusCode: 503, body: { status: "unavailable", reason: "daily_capacity_reached" } });
    expect(blockedFetch).not.toHaveBeenCalled();

    const ledger = new FileSpendLedger(new OpenAnalysisFileStore(dataDir, { now: () => now }));
    expect(await reconcileUnknownFromProviderBody(ledger, reservationId, lateBody, now)).toBe(true);
    const settled = await new OpenAnalysisFileStore(dataDir, { now: () => now }).read();
    expect(settled.spendByDay["2026-10-21"]?.reservations[reservationId]).toBeUndefined();
    expect(settled.spendByDay["2026-10-21"]?.micros).toBe(10_000);
  });

  it("does not mark a provider timeout that was not a paid request as unknown", async () => {
    const dataDir = await readyDir();
    const now = new Date("2026-10-21T12:00:00.000Z");
    const ledger = new FileSpendLedger(new OpenAnalysisFileStore(dataDir, { now: () => now }));
    const tracker = createAnalysisSpendTracker({
      maxMicros: 150_000,
      ledger,
      now: () => now,
      cycleId: "cycle_get",
    });
    const wrapped = tracker.wrap(async () => {
      throw new ProviderExecutionError("controlled_provider_request_timeout", "provider_timeout");
    });
    await expect(wrapped("https://fixture.invalid/v3/merchant/google/products/task_get/advanced/task_1", { method: "GET" }))
      .rejects.toThrow("controlled_provider_request_timeout");
    const document = await new OpenAnalysisFileStore(dataDir).read();
    expect(document.spendByDay["2026-10-21"]?.micros ?? 0).toBe(0);
    expect(dayReservations(document, "2026-10-21")).toEqual({});
  });
});

describe("open analysis file lock", () => {
  it("takes over a stale lock held by a live pid", async () => {
    const dataDir = await readyDir();
    const lockPath = join(dataDir, `${STORE_FILE_NAME}.lock`);
    await writeFile(lockPath, JSON.stringify({
      pid: process.pid,
      createdAt: new Date(Date.now() - LOCK_STALE_MS - 1_000).toISOString(),
    }));
    const store = new OpenAnalysisFileStore(dataDir);
    await store.update((document) => {
      document.resolveCountByDay["2026-10-21"] = 4;
    });
    expect((await store.read()).resolveCountByDay["2026-10-21"]).toBe(4);
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("takes over an unreadable lock and a lock with an unparseable timestamp", async () => {
    const corruptDir = await readyDir();
    const corruptLock = join(corruptDir, `${STORE_FILE_NAME}.lock`);
    await writeFile(corruptLock, "{not-json");
    const corruptStore = new OpenAnalysisFileStore(corruptDir);
    await corruptStore.update((document) => {
      document.resolveCountByDay["2026-10-21"] = 1;
    });
    expect((await corruptStore.read()).resolveCountByDay["2026-10-21"]).toBe(1);

    const staleStampDir = await readyDir();
    const staleLock = join(staleStampDir, `${STORE_FILE_NAME}.lock`);
    await writeFile(staleLock, JSON.stringify({ pid: process.pid, createdAt: "not-a-date" }));
    const staleStore = new OpenAnalysisFileStore(staleStampDir);
    await staleStore.update((document) => {
      document.resolveCountByDay["2026-10-21"] = 2;
    });
    expect((await staleStore.read()).resolveCountByDay["2026-10-21"]).toBe(2);
    await expect(stat(staleLock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not take over a fresh lock held by a live pid", async () => {
    const dataDir = await readyDir();
    const lockPath = join(dataDir, `${STORE_FILE_NAME}.lock`);
    const fresh = JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() });
    await writeFile(lockPath, fresh);
    const store = new OpenAnalysisFileStore(dataDir, { lockWaitMs: 60 });
    await expect(store.update((document) => {
      document.resolveCountByDay["2026-10-21"] = 9;
    })).rejects.toThrow("open_analysis_store_lock_timeout");
    expect(await readFile(lockPath, "utf8")).toBe(fresh);
    expect((await readdir(dataDir)).filter((name) => name.endsWith(".lock"))).toEqual([`${STORE_FILE_NAME}.lock`]);
  });
});

describe("explicit spend-ledger provisioning script", () => {
  it("creates a ledger only for an existing directory and refuses to reset it", async () => {
    const cwdLedger = join(process.cwd(), ".trendiq", STORE_FILE_NAME);
    let cwdExisted = true;
    try {
      await stat(cwdLedger);
    } catch (error) {
      cwdExisted = (error as NodeJS.ErrnoException).code !== "ENOENT";
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const unset = spawnSync(process.execPath, ["--experimental-transform-types", "scripts/provision-open-analysis-store.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, TRENDIQ_DATA_DIR: "" },
    });
    expect(unset.status).toBe(1);
    expect(unset.stderr).toMatch(/TRENDIQ_DATA_DIR is required/);
    if (!cwdExisted) await expect(stat(cwdLedger)).rejects.toMatchObject({ code: "ENOENT" });

    const missing = join(tmpdir(), `trendiq-script-missing-${process.pid}-${Date.now()}`);
    const missingRun = spawnSync(process.execPath, ["--experimental-transform-types", "scripts/provision-open-analysis-store.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, TRENDIQ_DATA_DIR: missing },
    });
    expect(missingRun.status).toBe(1);
    expect(missingRun.stderr).toMatch(/open_analysis_data_dir_missing/);
    await expect(stat(missing)).rejects.toMatchObject({ code: "ENOENT" });

    const dataDir = await tempDir();
    const created = spawnSync(process.execPath, ["--experimental-transform-types", "scripts/provision-open-analysis-store.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, TRENDIQ_DATA_DIR: dataDir },
    });
    expect(created.status).toBe(0);
    expect(created.stdout).toMatch(/provisioned empty spend ledger/);
    const store = new OpenAnalysisFileStore(dataDir);
    await store.update((document) => {
      document.spendByDay["2026-10-21"] = {
        micros: 80_000,
        reservations: {},
        analysisCount: 0,
        paidOperationCount: 1,
      };
    });
    const again = spawnSync(process.execPath, ["--experimental-transform-types", "scripts/provision-open-analysis-store.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, TRENDIQ_DATA_DIR: dataDir },
    });
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/counters unchanged/);
    expect((await store.read()).spendByDay["2026-10-21"]?.micros).toBe(80_000);
  });
});

describe("ray-ban meta stays available when the open-analysis directory is unset", () => {
  it("analyzes ray-ban-meta and refuses open resolution without creating a ledger", async () => {
    const collect = vi.fn(async () => ({
      productId: "ray-ban-meta",
      searchStatus: "unavailable" as const,
      reviewStatus: "unavailable" as const,
      signals: [],
      usage: { httpRequestCount: 0, paidOperationCount: 0, taskPostCount: 0 },
    }));
    const fetchImpl = vi.fn(async () => {
      throw new Error("provider_must_not_be_called");
    });
    const cwdLedger = join(process.cwd(), ".trendiq", STORE_FILE_NAME);
    let cwdExisted = true;
    try {
      await stat(cwdLedger);
    } catch (error) {
      cwdExisted = (error as NodeJS.ErrnoException).code !== "ENOENT";
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const runtime = createProductAnalysisRuntime({
      env: {
        TRENDIQ_ANALYSIS_ENABLED: "true",
        TRENDIQ_OPEN_ANALYSIS_ENABLED: "true",
        TRENDIQ_PROCESS_MAX_PAID_OPERATIONS: "3",
        TRENDIQ_ANALYSIS_JOB_DEADLINE_MS: "55000",
        TRENDIQ_SEARCH_MODE: "live",
        TRENDIQ_SEARCH_PROVIDER: "dataforseo",
        TRENDIQ_REVIEWS_MODE: "mock",
        TRENDIQ_REVIEWS_PROVIDER: "dataforseo",
        DATAFORSEO_LOGIN: "fixture-login",
        DATAFORSEO_PASSWORD: "fixture-password",
        DATAFORSEO_API_BASE_URL: "https://api.dataforseo.com",
      },
      assetsReady: () => true,
      evidenceCollector: { collect } as never,
      fetchImpl,
      idFactory: () => "analysis_rayban_nodir_01",
      now: () => new Date("2026-10-21T00:00:00.000Z"),
    });
    expect(runtime.analyzeProduct("ray-ban-meta")).toEqual({
      status: "pending",
      analysisId: "analysis_rayban_nodir_01",
    });
    expect(collect).toHaveBeenCalledTimes(1);
    const resolved = await runtime.resolveOpenProduct({ query: "Sony WH-1000XM5" });
    expect(resolved).toEqual({ statusCode: 503, body: { status: "unavailable", reason: "runtime_not_ready" } });
    expect(fetchImpl).not.toHaveBeenCalled();
    if (!cwdExisted) await expect(stat(cwdLedger)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
