import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../../../../app/lib/data/search/client";
import { DATAFORSEO_GOOGLE_ADS_SEARCH_VOLUME_PATH } from "../../../../app/lib/data/search/client";
import type { AnalysisEvidenceCollector } from "../../productionEvidenceCollector";
import { OPEN_PRODUCT_BATTERY } from "../../fixtures/openProductBattery/v1/battery";
import {
  OPEN_ANALYSIS_DAILY_MAX_MICROS,
  OPEN_ANALYSIS_MAX_MICROS,
  createAnalysisSpendTracker,
  type AnalysisSpendLedger,
} from "../costAccounting";
import { LOCK_STALE_MS, OpenAnalysisFileStore, STORE_FILE_NAME, provisionOpenAnalysisStore } from "../fileStore";
import { FileSpendLedger, OpenAnalysisService } from "../openAnalysisService";
import { isProhibitedQuery, queryHash, readShoppingCandidates, sanitizeProductQuery } from "../productResolver";
import { searchShoppingIdentity } from "../shoppingIdentitySearch";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "trendiq-open-limits-"));
  tempDirs.push(dir);
  return dir;
}

async function readyDir(): Promise<string> {
  const dir = await tempDir();
  await provisionOpenAnalysisStore(dir);
  return dir;
}

function jsonResponse(body: unknown, ok = true) {
  const text = JSON.stringify(body);
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => text,
  };
}

function memoryLedger(): AnalysisSpendLedger & { micros: number; calls: number } {
  const reservations = new Map<string, number>();
  const unknown = new Set<string>();
  const ledger = {
    micros: 0,
    calls: 0,
    async reserve(micros: number) {
      ledger.calls += 1;
      if (unknown.size > 0) return { ok: false as const, micros: 0, reason: "unknown_cost" as const };
      if (ledger.micros + micros > OPEN_ANALYSIS_DAILY_MAX_MICROS) return { ok: false as const, micros: 0, reason: "daily" as const };
      const id = `r${ledger.calls}`;
      ledger.micros += micros;
      reservations.set(id, micros);
      return { ok: true as const, id, micros };
    },
    async reconcile(id: string, actualMicros: number) {
      if (unknown.has(id)) return;
      const reserved = reservations.get(id);
      if (reserved === undefined) return;
      ledger.micros += actualMicros - reserved;
      if (ledger.micros < 0) ledger.micros = 0;
      reservations.delete(id);
    },
    async markUnknown(id: string) {
      if (!reservations.has(id)) throw new Error("open_analysis_reservation_missing");
      unknown.add(id);
    },
    async reconcileVerified(id: string, actualMicros: number) {
      if (!unknown.has(id)) throw new Error("open_analysis_reconciliation_unverified");
      unknown.delete(id);
      await ledger.reconcile(id, actualMicros);
    },
  };
  return ledger;
}

function clearProduct(id: string) {
  const product = OPEN_PRODUCT_BATTERY.products.find((entry) => entry.id === id);
  if (!product) throw new Error(id);
  return product;
}

describe("open analysis spend caps", () => {
  it("stops a second paid call that would pass $0.15 and counts a thrown call", async () => {
    const ledger = memoryLedger();
    const tracker = createAnalysisSpendTracker({
      maxMicros: OPEN_ANALYSIS_MAX_MICROS,
      ledger,
      now: () => new Date("2026-10-21T00:00:00.000Z"),
      cycleId: "cycle_tracker",
    });
    const urls: string[] = [];
    const fetchImpl = tracker.wrap(async (url) => {
      urls.push(url);
      return jsonResponse({ cost: 0.09, tasks: [{ cost: 0.09 }] });
    });
    const ads = `https://fixture.invalid${DATAFORSEO_GOOGLE_ADS_SEARCH_VOLUME_PATH}`;
    await fetchImpl(ads, { method: "POST" });
    await expect(fetchImpl(ads, { method: "POST" })).rejects.toThrow("controlled_spend_cap_exceeded");
    expect(urls).toHaveLength(1);
    expect(tracker.spentMicros).toBe(90_000);
    expect(tracker.exceeded).toBe(true);

    const failing = memoryLedger();
    const errorTracker = createAnalysisSpendTracker({
      maxMicros: OPEN_ANALYSIS_MAX_MICROS,
      ledger: failing,
      now: () => new Date("2026-10-21T00:00:00.000Z"),
      cycleId: "cycle_error",
    });
    const wrapped = errorTracker.wrap(async () => {
      throw new Error("socket_reset");
    });
    await expect(wrapped(ads, { method: "POST" })).rejects.toThrow("socket_reset");
    expect(failing.micros).toBe(90_000);
    expect(errorTracker.exceeded).toBe(true);
    const blocked = await failing.reserve(2_000, new Date("2026-10-22T00:00:00.000Z"), { cycleId: "cycle_next" });
    expect(blocked).toEqual({ ok: false, micros: 0, reason: "unknown_cost" });
  });

  it("blocks a resolve when the daily file counter is already $3", async () => {
    const dataDir = await readyDir();
    const now = new Date("2026-10-21T12:00:00.000Z");
    const store = new OpenAnalysisFileStore(dataDir, { now: () => now });
    await store.update((document) => {
      document.spendByDay["2026-10-21"] = {
        micros: OPEN_ANALYSIS_DAILY_MAX_MICROS,
        reservations: {},
        analysisCount: 0,
        paidOperationCount: 0,
      };
    });
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error("must_not_fetch");
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
    const result = await service.resolveOpenProduct({ query: "Sony WH-1000XM5" });
    expect(result).toEqual({ statusCode: 503, body: { status: "unavailable", reason: "daily_capacity_reached" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps a failed call's estimate after a new store instance reads the file", async () => {
    const dataDir = await readyDir();
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error("provider_down");
    });
    const service = new OpenAnalysisService({
      enabled: true,
      analysisEnabled: true,
      dataDir,
      now: () => new Date("2026-10-21T12:00:00.000Z"),
      fetchImpl,
      apiBaseUrl: "https://fixture.invalid",
      login: "fixture-login",
      password: "fixture-password",
      liveConfigured: true,
    });
    const failed = await service.resolveOpenProduct({ query: "Sony WH-1000XM5" });
    expect(failed.statusCode).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("fixture.invalid");
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain("api.dataforseo.com");

    const restarted = new OpenAnalysisFileStore(dataDir);
    const document = await restarted.read();
    expect(document.spendByDay["2026-10-21"]?.micros).toBe(2_000);
    const held = Object.values(document.spendByDay["2026-10-21"]?.reservations ?? {});
    expect(held).toHaveLength(1);
    expect(held[0]?.costState).toBe("unknown");
    const nextDay = await new FileSpendLedger(restarted).reserve(2_000, new Date("2026-10-22T01:00:00.000Z"), {
      cycleId: "cycle_after_restart",
    });
    expect(nextDay).toEqual({ ok: false, micros: 0, reason: "unknown_cost" });
  });
});

describe("open analysis file store", () => {
  it("does not lose parallel increments and does not steal a fresh dead lock", async () => {
    const dataDir = await readyDir();
    const first = new OpenAnalysisFileStore(dataDir);
    const second = new OpenAnalysisFileStore(dataDir);
    await Promise.all(Array.from({ length: 20 }, (_, index) => {
      const store = index % 2 === 0 ? first : second;
      return store.update((document) => {
        document.resolveCountByDay["2026-10-21"] = (document.resolveCountByDay["2026-10-21"] ?? 0) + 1;
      });
    }));
    const after = await first.read();
    expect(after.resolveCountByDay["2026-10-21"]).toBe(20);

    const lockPath = join(dataDir, `${STORE_FILE_NAME}.lock`);
    const freshDead = JSON.stringify({
      pid: 2_147_483_646,
      createdAt: new Date().toISOString(),
      token: "fresh-dead",
    });
    await writeFile(lockPath, freshDead);
    const waiting = new OpenAnalysisFileStore(dataDir, { lockWaitMs: 80 });
    await expect(waiting.update((document) => {
      document.resolveCountByDay["2026-10-21"] = (document.resolveCountByDay["2026-10-21"] ?? 0) + 1;
    })).rejects.toThrow("open_analysis_store_lock_timeout");
    expect(await readFile(lockPath, "utf8")).toBe(freshDead);
    const whileHeld = JSON.parse(await readFile(join(dataDir, STORE_FILE_NAME), "utf8")) as {
      resolveCountByDay?: Record<string, number>;
    };
    expect(whileHeld.resolveCountByDay?.["2026-10-21"]).toBe(20);

    await writeFile(lockPath, JSON.stringify({
      pid: 2_147_483_646,
      createdAt: new Date(Date.now() - LOCK_STALE_MS - 1_000).toISOString(),
      token: "stale-dead",
    }));
    await second.update((document) => {
      document.resolveCountByDay["2026-10-21"] = (document.resolveCountByDay["2026-10-21"] ?? 0) + 1;
    });
    expect((await first.read()).resolveCountByDay["2026-10-21"]).toBe(21);
    await expect(stat(lockPath)).rejects.toThrow();
  });

  it("promotes a valid temp file and refuses to zero a corrupt store", async () => {
    const recoveredDir = await tempDir();
    const recovered = {
      version: 1,
      spendByDay: { "2026-10-21": { micros: 123_000, reservations: {}, analysisCount: 0, paidOperationCount: 1 } },
      resolveCountByDay: {},
      clients: {},
      resolutions: {},
      identityByQuery: {},
      specsByIdentity: {},
      priceByIdentity: {},
      resultsByIdentity: {},
      jobs: {},
    };
    await writeFile(join(recoveredDir, `${STORE_FILE_NAME}.4242.abcd.tmp`), JSON.stringify(recovered));
    const store = new OpenAnalysisFileStore(recoveredDir);
    expect((await store.read()).spendByDay["2026-10-21"]?.micros).toBe(123_000);
    expect((await readdir(recoveredDir)).some((name) => name.endsWith(".tmp"))).toBe(false);

    const corruptDir = await tempDir();
    const corruptPath = join(corruptDir, STORE_FILE_NAME);
    await writeFile(corruptPath, "{");
    const corrupt = new OpenAnalysisFileStore(corruptDir);
    await expect(corrupt.read()).rejects.toThrow();
    expect(await readFile(corruptPath, "utf8")).toBe("{");
  });
});

describe("identity cache, price ttl, and analysis abstention", () => {
  it("reuses identity for 30 days, marks price stale after 24 hours, and spends nothing on a cached analysis", async () => {
    const dataDir = await readyDir();
    let now = new Date("2026-10-01T00:00:00.000Z");
    const searches: string[] = [];
    let releaseCollect: (() => void) | undefined;
    const collect = vi.fn(async (profile: { productId: string }) => {
      if (releaseCollect) await new Promise<void>((resolve) => { releaseCollect = resolve; });
      return {
        productId: profile.productId,
        searchStatus: "unavailable" as const,
        reviewStatus: "unavailable" as const,
        signals: [],
        usage: { httpRequestCount: 0, paidOperationCount: 0, taskPostCount: 0 },
      };
    });
    let sequence = 0;
    const service = new OpenAnalysisService({
      enabled: true,
      analysisEnabled: true,
      dataDir,
      now: () => now,
      jobDeadlineMs: 2_000,
      idFactory: () => `analysis_${String(++sequence).padStart(8, "0")}`,
      evidenceCollector: { collect } as unknown as AnalysisEvidenceCollector,
      searchCandidates: async (query) => {
        searches.push(query);
        const product = OPEN_PRODUCT_BATTERY.products.find((entry) => entry.query === query);
        if (!product) throw new Error(query);
        return readShoppingCandidates(product.providerResponse);
      },
    });

    const sony = clearProduct("sony-wh-1000xm5");
    const first = await service.resolveOpenProduct({ query: sony.query, clientKey: "client-a" });
    expect(first.body.status).toBe("resolved");
    if (first.body.status !== "resolved") throw new Error("expected resolved");
    expect(first.body.priceStatus).toBe("fresh");
    expect(first.body.evidenceDate).toContain("2026-10-01");
    const second = await service.resolveOpenProduct({ query: sony.query, clientKey: "client-a" });
    expect(second.body.status).toBe("resolved");
    if (second.body.status === "resolved") expect(second.body.cached).toBe(true);
    expect(searches).toHaveLength(1);

    now = new Date("2026-10-02T00:00:01.000Z");
    const stale = await service.resolveOpenProduct({ query: sony.query, clientKey: "client-a" });
    expect(stale.body.status).toBe("resolved");
    if (stale.body.status !== "resolved") throw new Error("expected resolved");
    expect(stale.body.priceStatus).toBe("stale");
    expect(stale.body.cached).toBe(true);
    expect(searches).toHaveLength(1);

    const started = await service.analyzeResolution({ resolutionId: first.body.resolutionId, clientKey: "client-a" });
    expect(started.status).toBe("pending");
    if (started.status !== "pending") throw new Error("expected pending");
    const settled = await waitFor(service, started.analysisId);
    expect(settled.status).toBe("completed");
    if (settled.status === "completed") {
      expect(settled.result.decision.recommendation).toBe("NO_RECOMMENDATION");
      expect(settled.result.decision.summary.toLowerCase()).not.toContain("provider");
      expect(JSON.stringify(settled.result.explanation.watchOuts)).toContain("Identity and specs evidence date");
    }
    expect(collect).toHaveBeenCalledTimes(1);

    const cachedAnalysis = await service.analyzeResolution({ resolutionId: first.body.resolutionId, clientKey: "client-a" });
    expect(cachedAnalysis.status).toBe("completed");
    expect(collect).toHaveBeenCalledTimes(1);

    now = new Date("2026-10-31T00:00:01.000Z");
    await service.resolveOpenProduct({ query: sony.query, clientKey: "client-b" });
    expect(searches).toHaveLength(2);
  });

  it("enforces hourly, daily, and in-flight analysis limits without a second live run", async () => {
    const dataDir = await readyDir();
    let now = new Date("2026-10-01T00:00:00.000Z");
    let gate: Promise<void> = Promise.resolve();
    let openGate = () => {};
    const collect = vi.fn(async (profile: { productId: string }) => {
      await gate;
      return {
        productId: profile.productId,
        searchStatus: "unavailable" as const,
        reviewStatus: "unavailable" as const,
        signals: [],
        usage: { httpRequestCount: 0, paidOperationCount: 0, taskPostCount: 0 },
      };
    });
    let sequence = 0;
    const service = new OpenAnalysisService({
      enabled: true,
      analysisEnabled: true,
      dataDir,
      now: () => now,
      idFactory: () => `analysis_${String(++sequence).padStart(8, "0")}`,
      evidenceCollector: { collect } as unknown as AnalysisEvidenceCollector,
      searchCandidates: async (query) => {
        const product = OPEN_PRODUCT_BATTERY.products.find((entry) => entry.query === query);
        if (!product) throw new Error(query);
        return readShoppingCandidates(product.providerResponse);
      },
    });
    const samsung = clearProduct("samsung-galaxy-s24");
    const ambiguous = await service.resolveOpenProduct({ query: samsung.query, clientKey: "client-a" });
    expect(ambiguous.body.status).toBe("ambiguous");
    if (ambiguous.body.status !== "ambiguous") throw new Error("expected ambiguous");
    const sony = await service.resolveOpenProduct({ query: clearProduct("sony-wh-1000xm5").query, clientKey: "client-a" });
    const bose = await service.resolveOpenProduct({ query: clearProduct("bose-qc-ultra").query, clientKey: "client-a" });
    if (sony.body.status !== "resolved" || bose.body.status !== "resolved") throw new Error("expected resolved");

    gate = new Promise<void>((resolve) => { openGate = resolve; });
    const first = await service.analyzeResolution({ resolutionId: sony.body.resolutionId, clientKey: "client-a" });
    expect(first.status).toBe("pending");
    const blocked = await service.analyzeResolution({ resolutionId: bose.body.resolutionId, clientKey: "client-a" });
    expect(blocked).toEqual({ status: "unavailable", reason: "rate_limited" });
    expect(collect).toHaveBeenCalledTimes(1);
    openGate();
    if (first.status === "pending") await waitFor(service, first.analysisId);

    gate = Promise.resolve();
    for (let hour = 0; hour < 4; hour += 1) {
      now = new Date(Date.parse("2026-10-01T00:30:00.000Z") + hour * 60 * 60 * 1000);
      for (let slot = 0; slot < 5; slot += 1) {
        if (hour === 0 && slot === 0) continue;
        const again = await service.analyzeResolution({ resolutionId: sony.body.resolutionId, clientKey: "client-a" });
        expect(again.status).toBe("completed");
      }
    }
    now = new Date("2026-10-01T04:30:00.000Z");
    const overDay = await service.analyzeResolution({ resolutionId: sony.body.resolutionId, clientKey: "client-a" });
    expect(overDay).toEqual({ status: "unavailable", reason: "rate_limited" });
    expect(collect).toHaveBeenCalledTimes(1);

    const picked = await service.analyzeResolution({
      resolutionId: ambiguous.body.resolutionId,
      candidateId: ambiguous.body.candidates[0]?.candidateId,
      clientKey: "client-b",
    });
    expect(picked.status === "pending" || picked.status === "completed" || picked.status === "unavailable").toBe(true);
    if (picked.status === "pending") await waitFor(service, picked.analysisId);
  });

  it("stops name checks at 100 per day and does not treat ordinary product words as prohibited", async () => {
    const dataDir = await readyDir();
    const searches = vi.fn(async () => {
      throw new Error("must_not_search");
    });
    const service = new OpenAnalysisService({
      enabled: true,
      analysisEnabled: true,
      dataDir,
      now: () => new Date("2026-10-21T00:00:00.000Z"),
      searchCandidates: searches,
    });
    for (let index = 0; index < 100; index += 1) {
      const result = await service.resolveOpenProduct({ query: "oxycodone tablets", clientKey: "client-a" });
      expect(result.statusCode).toBe(200);
      expect(result.body.status).toBe("abstain");
    }
    const blocked = await service.resolveOpenProduct({ query: "oxycodone tablets", clientKey: "client-a" });
    expect(blocked).toEqual({ statusCode: 503, body: { status: "unavailable", reason: "daily_capacity_reached" } });
    expect(searches).not.toHaveBeenCalled();
    expect(isProhibitedQuery("prescription glasses")).toBe(false);
    expect(isProhibitedQuery("glue gun")).toBe(false);
    expect(sanitizeProductQuery("ab").ok).toBe(false);
  });
});

describe("shopping identity request shape", () => {
  it("posts one depth-40 priority-1 task to the injected host", async () => {
    const calls: Array<{ url: string; init?: { method?: string; body?: string } }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init });
      if (init?.method === "POST") {
        return jsonResponse({ cost: 0, tasks: [{ id: "task_fixture_1", status_code: 20100, cost: 0 }] });
      }
      const payload = structuredClone(clearProduct("kindle-paperwhite").providerResponse) as {
        status_code?: number;
        tasks: Array<{ id?: string; status_code: number; cost: 0; result: unknown }>;
      };
      payload.status_code = 20000;
      payload.tasks[0].id = "task_fixture_1";
      return jsonResponse(payload);
    };
    const ledger = memoryLedger();
    const candidates = await searchShoppingIdentity({
      query: "Kindle Paperwhite",
      apiBaseUrl: "https://fixture.invalid",
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl,
      ledger,
      now: () => new Date("2026-10-21T00:00:00.000Z"),
      cycleId: "cycle_kindle",
      allowPaidCall: true,
      pollIntervalMs: 0,
    });
    expect(candidates.length).toBeGreaterThan(0);
    const posts = calls.filter((call) => call.init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url.startsWith("https://fixture.invalid/")).toBe(true);
    expect(posts[0]?.url).not.toContain("api.dataforseo.com");
    const body = JSON.parse(String(posts[0]?.init?.body)) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ keyword: "Kindle Paperwhite", depth: 40, priority: 1 });
    expect(ledger.micros).toBe(0);
  });
});

describe("query identity and shopping polls", () => {
  it("keeps distinct unicode queries distinct and folds compatibility characters", () => {
    expect(queryHash("ヘッドホン")).not.toBe(queryHash("耳机"));
    expect(queryHash("ソニー WH-1000XM5")).not.toBe(queryHash("ヘッドホン"));
    expect(queryHash("Sony WH-1000XM5")).toBe(queryHash("sony  wh-1000xm５"));
    expect(queryHash("Ray-Ban")).not.toBe(queryHash("Ray-B\u0430n"));
  });

  it("waits out a pending shopping task and does not report it as empty", async () => {
    vi.useFakeTimers();
    const methods: string[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      methods.push(init?.method ?? "GET");
      if (init?.method === "POST") {
        return jsonResponse({
          status_code: 20000,
          cost: 0,
          tasks: [{ id: "task_pending_1", status_code: 20100, cost: 0 }],
        });
      }
      return jsonResponse({
        status_code: 20000,
        cost: 0,
        tasks: [{ id: "task_pending_1", status_code: 40602, status_message: "Task In Queue.", cost: 0 }],
      });
    };
    const pending = searchShoppingIdentity({
      query: "Kindle Paperwhite",
      apiBaseUrl: "https://fixture.invalid",
      login: "fixture-login",
      password: "fixture-password",
      fetchImpl,
      ledger: memoryLedger(),
      now: () => new Date("2026-10-21T00:00:00.000Z"),
      cycleId: "cycle_pending",
      allowPaidCall: true,
      pollAttempts: 3,
      pollIntervalMs: 1_000,
    });
    const settled = expect(pending).rejects.toThrow("shopping_identity_pending");
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await settled;
    expect(methods.filter((method) => method === "POST")).toEqual(["POST"]);
    expect(methods.filter((method) => method === "GET")).toHaveLength(3);
    vi.useRealTimers();
  });

  it("reconciles a reservation onto the UTC day it was made", async () => {
    const dataDir = await readyDir();
    let now = new Date("2026-10-21T23:59:00.000Z");
    const fetchImpl: FetchLike = async (_url, init) => {
      if (init?.method === "POST") {
        now = new Date("2026-10-22T00:01:00.000Z");
        throw new Error("provider_down");
      }
      throw new Error("must_not_poll");
    };
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
    const failed = await service.resolveOpenProduct({ query: "Sony WH-1000XM5" });
    expect(failed.statusCode).toBe(503);
    const document = await new OpenAnalysisFileStore(dataDir, { now: () => now }).read();
    expect(document.spendByDay["2026-10-21"]?.micros).toBe(2_000);
    expect(document.spendByDay["2026-10-22"]?.micros ?? 0).toBe(0);
    const held = Object.values(document.spendByDay["2026-10-21"]?.reservations ?? {});
    expect(held[0]?.costState).toBe("unknown");
  });

  it("lets only one of two concurrent resolves reserve the last daily dollar", async () => {
    const dataDir = await readyDir();
    const now = new Date("2026-10-21T12:00:00.000Z");
    const seeded = new OpenAnalysisFileStore(dataDir, { now: () => now });
    await seeded.update((document) => {
      document.spendByDay["2026-10-21"] = {
        micros: OPEN_ANALYSIS_DAILY_MAX_MICROS - 2_000,
        reservations: {},
        analysisCount: 0,
        paidOperationCount: 0,
      };
    });
    const posts: string[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      if (init?.method === "POST") {
        posts.push("POST");
        return jsonResponse({
          status_code: 20000,
          cost: 0.002,
          tasks: [{ id: "task_race_1", status_code: 20100, cost: 0.002 }],
        });
      }
      return jsonResponse({
        status_code: 20000,
        cost: 0,
        tasks: [{ id: "task_race_1", status_code: 20000, cost: 0, result: [{ items: [] }] }],
      });
    };
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
      pollIntervalMs: 0,
      pollAttempts: 1,
    });
    const results = await Promise.all([
      service.resolveOpenProduct({ query: "Sony WH-1000XM5", clientKey: "a" }),
      service.resolveOpenProduct({ query: "Bose QuietComfort Ultra", clientKey: "b" }),
    ]);
    expect(posts).toEqual(["POST"]);
    const blocked = results.filter((result) => result.body.status === "unavailable");
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    const document = await seeded.read();
    expect(document.spendByDay["2026-10-21"]?.micros).toBeLessThanOrEqual(OPEN_ANALYSIS_DAILY_MAX_MICROS);
  });
});

describe("shared resolution and analysis cycle", () => {
  it("does not give analysis a fresh $0.15 after identity spend", async () => {
    const dataDir = await readyDir();
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      urls.push(String(url));
      if (init?.method === "POST" && String(url).includes("products/task_post")) {
        return jsonResponse({
          status_code: 20000,
          cost: 0.149,
          tasks: [{ id: "task_cycle_1", status_code: 20100, cost: 0.149 }],
        });
      }
      if (init?.method === "GET") {
        const payload = structuredClone(clearProduct("sony-wh-1000xm5").providerResponse) as {
          status_code?: number;
          cost: number;
          tasks: Array<{ id?: string }>;
        };
        payload.status_code = 20000;
        payload.cost = 0;
        payload.tasks[0].id = "task_cycle_1";
        return jsonResponse(payload);
      }
      throw new Error(`analysis_provider_must_not_start ${url}`);
    };
    const service = new OpenAnalysisService({
      enabled: true,
      analysisEnabled: true,
      dataDir,
      now: () => new Date("2026-10-21T00:00:00.000Z"),
      idFactory: () => "analysis_sharedcycle01",
      fetchImpl,
      apiBaseUrl: "https://fixture.invalid",
      login: "fixture-login",
      password: "fixture-password",
      liveConfigured: true,
      pollAttempts: 1,
      pollIntervalMs: 0,
      env: {
        TRENDIQ_SEARCH_MODE: "live",
        TRENDIQ_SEARCH_PROVIDER: "dataforseo",
        TRENDIQ_REVIEWS_MODE: "mock",
        TRENDIQ_REVIEWS_PROVIDER: "dataforseo",
        DATAFORSEO_LOGIN: "fixture-login",
        DATAFORSEO_PASSWORD: "fixture-password",
        DATAFORSEO_API_BASE_URL: "https://fixture.invalid",
      },
    });
    const resolved = await service.resolveOpenProduct({ query: clearProduct("sony-wh-1000xm5").query, clientKey: "client-a" });
    expect(resolved.body.status).toBe("resolved");
    if (resolved.body.status !== "resolved") throw new Error("expected resolved");
    const started = await service.analyzeResolution({ resolutionId: resolved.body.resolutionId, clientKey: "client-a" });
    expect(started.status).toBe("pending");
    if (started.status !== "pending") throw new Error("expected pending");
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = service.getAnalysisStatus(started.analysisId);
      if (status && status.status !== "pending") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(urls.some((url) => url.includes("dataforseo_trends") || url.includes("google_ads"))).toBe(false);
    const document = await new OpenAnalysisFileStore(dataDir).read();
    const cycle = Object.values(document.cycles)[0];
    expect(cycle?.micros).toBe(149_000);
    expect(cycle?.micros).toBeLessThanOrEqual(OPEN_ANALYSIS_MAX_MICROS);
  });
});

describe("disabled live validation script", () => {
  it("exits before any provider call when it is not authorized", () => {
    const result = spawnSync(process.execPath, ["scripts/open-analysis-capped-live-validation.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        TRENDIQ_OPEN_ANALYSIS_LIVE_VALIDATION: "",
        TRENDIQ_OPEN_ANALYSIS_LIVE_VALIDATION_BUDGET_USD: "",
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/disabled/i);
    expect(result.stdout).toMatch(/No provider call/i);
  });
});

async function waitFor(service: OpenAnalysisService, analysisId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const status = service.getAnalysisStatus(analysisId);
    if (status && status.status !== "pending") return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`analysis ${analysisId} did not settle`);
}
