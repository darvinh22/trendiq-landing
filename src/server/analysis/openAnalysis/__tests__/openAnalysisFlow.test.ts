import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../../../../app/lib/data/search/client";
import {
  DATAFORSEO_GOOGLE_ADS_SEARCH_VOLUME_PATH,
  DATAFORSEO_TRENDS_EXPLORE_PATH,
} from "../../../../app/lib/data/search/client";
import { DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH } from "../../../../app/lib/data/reviews/client";
import { dispatchProductAnalysisApi } from "../../productAnalysisApi";
import { OPEN_PRODUCT_BATTERY, type OpenProductBatteryCase } from "../../fixtures/openProductBattery/v1/battery";
import { OpenAnalysisFileStore } from "../fileStore";
import { createProductAnalysisRuntime } from "../../../runtime/productAnalysisRuntime";
import { APPROVED_DATAFORSEO_ORIGIN } from "../../../runtime/runtimeConfig";
import { ProcessPaidOperationGuard } from "../../../runtime/processPaidOperationGuard";

const dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function product(id: string): OpenProductBatteryCase {
  const found = OPEN_PRODUCT_BATTERY.products.find((entry) => entry.id === id);
  if (!found) throw new Error(id);
  return found;
}

function readyEnv(dataDir: string, overrides: Record<string, string> = {}) {
  return {
    TRENDIQ_ANALYSIS_ENABLED: "true",
    TRENDIQ_OPEN_ANALYSIS_ENABLED: "true",
    TRENDIQ_DATA_DIR: dataDir,
    TRENDIQ_PROCESS_MAX_PAID_OPERATIONS: "6",
    TRENDIQ_ANALYSIS_JOB_DEADLINE_MS: "55000",
    TRENDIQ_SEARCH_MODE: "live",
    TRENDIQ_SEARCH_PROVIDER: "dataforseo",
    TRENDIQ_REVIEWS_MODE: "mock",
    TRENDIQ_REVIEWS_PROVIDER: "dataforseo",
    DATAFORSEO_LOGIN: "fixture-login",
    DATAFORSEO_PASSWORD: "fixture-password",
    DATAFORSEO_API_BASE_URL: APPROVED_DATAFORSEO_ORIGIN,
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true) {
  const text = JSON.stringify(body);
  return { ok, status: ok ? 200 : 500, json: async () => body, text: async () => text };
}

function trendSeries(keyword: string, rich: boolean) {
  const end = Date.parse("2026-10-20T00:00:00.000Z");
  const data = rich
    ? Array.from({ length: 21 }, (_, index) => {
        const stamp = end - (20 - index) * 24 * 60 * 60 * 1000;
        const day = new Date(stamp).toISOString().slice(0, 10);
        return { date_from: day, date_to: day, timestamp: Math.floor(stamp / 1000), values: [40 + index] };
      })
    : [];
  return {
    status_code: 20000,
    status_message: "Ok.",
    cost: 0,
    tasks: [{
      status_code: 20000,
      cost: 0,
      result: [{
        keywords: [keyword],
        location_code: 2840,
        items: [{ type: "dataforseo_trends_graph", keywords: [keyword], averages: [40], data }],
      }],
    }],
  };
}

function router(mode: "rich" | "thin"): FetchLike {
  const tasks = new Map<string, OpenProductBatteryCase>();
  let sequence = 0;
  return async (url, init) => {
    const path = new URL(url).pathname;
    const method = init?.method ?? "GET";
    if (url.includes("api.dataforseo.com") && init?.headers && JSON.stringify(init.headers).includes("fixture-password")) {
      // Credentials stay on the injected call. The global fetch spy is the network guard.
    }
    if (method === "POST" && path.includes(DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH)) {
      const body = JSON.parse(String(init?.body)) as Array<{ keyword?: string }>;
      const match = OPEN_PRODUCT_BATTERY.products.find((entry) => entry.query === body[0]?.keyword);
      if (!match || match.doNotCallProvider) throw new Error("fixture_payload_not_allowed");
      sequence += 1;
      const id = `task_flow_${sequence}`;
      tasks.set(id, match);
      return jsonResponse({ status_code: 20000, cost: 0, tasks: [{ id, status_code: 20100, cost: 0 }] });
    }
    if (method === "GET" && path.includes("/task_get/advanced/")) {
      const id = decodeURIComponent(path.split("/").pop() ?? "");
      const match = tasks.get(id);
      if (!match) return jsonResponse({ status_code: 20000, cost: 0, tasks: [{ id, status_code: 40602, cost: 0 }] });
      const payload = structuredClone(match.providerResponse) as {
        cost: number;
        status_code?: number;
        tasks: Array<{ id?: string; status_code: number; cost: number; result: unknown }>;
      };
      payload.status_code = 20000;
      payload.tasks[0].id = id;
      return jsonResponse(payload);
    }
    if (path.includes(DATAFORSEO_TRENDS_EXPLORE_PATH)) {
      const body = JSON.parse(String(init?.body)) as Array<{ keywords?: string[] }>;
      const keyword = body[0]?.keywords?.[0] ?? "product";
      return jsonResponse(trendSeries(keyword, mode === "rich"));
    }
    if (path.includes(DATAFORSEO_GOOGLE_ADS_SEARCH_VOLUME_PATH)) {
      const body = JSON.parse(String(init?.body)) as Array<{ keywords?: string[] }>;
      const keyword = body[0]?.keywords?.[0] ?? "product";
      return jsonResponse({
        status_code: 20000,
        cost: 0,
        tasks: [{
          status_code: 20000,
          cost: 0,
          result: [{ keyword, location_code: 2840, language_code: "en", search_volume: mode === "rich" ? 1000 : 0, monthly_searches: [] }],
        }],
      });
    }
    throw new Error(`unexpected_fixture_url ${path}`);
  };
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "trendiq-open-flow-"));
  dirs.push(dir);
  return dir;
}

async function settle(runtime: ReturnType<typeof createProductAnalysisRuntime>, analysisId: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = runtime.getAnalysisStatus(analysisId);
    if (status.status !== "pending") return status;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`analysis ${analysisId} did not settle`);
}

describe("open analysis offline flow", () => {
  it("keeps one open product id from a clear resolve through analysis", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("live_network_forbidden");
    });
    const dataDir = await tempDir();
    const runtime = createProductAnalysisRuntime({
      env: readyEnv(dataDir),
      assetsReady: () => true,
      fetchImpl: router("rich"),
      idFactory: () => "analysis_opene2eclear01",
      now: () => new Date("2026-10-21T00:00:00.000Z"),
    });
    const sony = product("sony-wh-1000xm5");
    const resolved = await dispatchProductAnalysisApi({
      method: "POST",
      pathname: "/api/product-resolve",
      body: { query: sony.query },
      clientKey: "client-a",
    }, runtime);
    expect(resolved.statusCode).toBe(200);
    if (!("status" in resolved.body) || resolved.body.status !== "resolved") throw new Error("expected resolved");
    const started = await dispatchProductAnalysisApi({
      method: "POST",
      pathname: "/api/product-analysis",
      body: { resolutionId: resolved.body.resolutionId },
      clientKey: "client-a",
    }, runtime);
    expect(started.statusCode).toBe(202);
    if (!("status" in started.body) || started.body.status !== "pending") throw new Error("expected pending");
    const settled = await settle(runtime, started.body.analysisId);
    expect(settled.status).toBe("completed");
    const stored = await new OpenAnalysisFileStore(dataDir).read();
    const record = stored.resolutions[resolved.body.resolutionId] as { profile?: { productId: string } };
    const productId = record.profile?.productId ?? "";
    expect(productId).toMatch(/^open-[a-f0-9]{20}$/);
    if (settled.status === "completed") expect(settled.result.product.id).toBe(productId);
    expect(JSON.stringify(settled)).not.toContain("user-search-");
    expect(JSON.stringify(stored)).not.toContain("user-search-");
    expect(network).not.toHaveBeenCalled();
  });

  it("does not analyze an ambiguous name until a candidate is chosen", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("live_network_forbidden");
    });
    const dataDir = await tempDir();
    const calls: string[] = [];
    const inner = router("rich");
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
      return inner(url, init);
    };
    const runtime = createProductAnalysisRuntime({
      env: readyEnv(dataDir),
      assetsReady: () => true,
      fetchImpl,
      idFactory: () => "analysis_opene2eambig01",
      now: () => new Date("2026-10-21T00:00:00.000Z"),
    });
    const samsung = product("samsung-galaxy-s24");
    const resolved = await runtime.resolveOpenProduct({ query: samsung.query, clientKey: "client-a" });
    expect(resolved.body.status).toBe("ambiguous");
    if (resolved.body.status !== "ambiguous") throw new Error("expected ambiguous");
    const blocked = await runtime.analyzeResolution({ resolutionId: resolved.body.resolutionId, clientKey: "client-a" });
    expect(blocked).toEqual({ status: "error", reason: "invalid_request" });
    expect(calls.some((call) => call.includes(DATAFORSEO_TRENDS_EXPLORE_PATH))).toBe(false);
    const chosen = resolved.body.candidates[0];
    if (!chosen) throw new Error("missing candidate");
    const started = await runtime.analyzeResolution({
      resolutionId: resolved.body.resolutionId,
      candidateId: chosen.candidateId,
      clientKey: "client-b",
    });
    expect(started.status).toBe("pending");
    if (started.status !== "pending") throw new Error("expected pending");
    const settled = await settle(runtime, started.analysisId);
    const stored = await new OpenAnalysisFileStore(dataDir).read();
    const record = stored.resolutions[resolved.body.resolutionId] as {
      options?: Array<{ candidateId: string; profile: { productId: string } }>;
    };
    const option = record.options?.find((entry) => entry.candidateId === chosen.candidateId);
    expect(option?.profile.productId).toMatch(/^open-[a-f0-9]{20}$/);
    if (settled.status === "completed") expect(settled.result.product.id).toBe(option?.profile.productId);
    expect(calls.some((call) => call.includes(DATAFORSEO_TRENDS_EXPLORE_PATH))).toBe(true);
    expect(calls.some((call) => call.includes(DATAFORSEO_GOOGLE_ADS_SEARCH_VOLUME_PATH))).toBe(true);
    expect(JSON.stringify(settled)).not.toContain("user-search-");
  });

  it("runs the three thin fixtures through collection into NO_RECOMMENDATION", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("live_network_forbidden");
    });
    for (const id of ["anker-soundcore-q45", "framework-laptop-13", "teenage-engineering-op1"]) {
      const dataDir = await tempDir();
      const runtime = createProductAnalysisRuntime({
        env: readyEnv(dataDir),
        assetsReady: () => true,
        fetchImpl: router("thin"),
        idFactory: () => `analysis_${id.replace(/[^a-z0-9]/g, "").slice(0, 24)}`,
        now: () => new Date("2026-10-21T00:00:00.000Z"),
      });
      const fixture = product(id);
      const resolved = await runtime.resolveOpenProduct({ query: fixture.query, clientKey: "client-a" });
      expect(resolved.body.status).toBe("resolved");
      if (resolved.body.status !== "resolved") throw new Error(id);
      const started = await runtime.analyzeResolution({ resolutionId: resolved.body.resolutionId, clientKey: "client-a" });
      expect(started.status).toBe("pending");
      if (started.status !== "pending") throw new Error(id);
      const settled = await settle(runtime, started.analysisId);
      expect(settled.status).toBe("completed");
      if (settled.status === "completed") {
        expect(settled.result.decision.recommendation).toBe("NO_RECOMMENDATION");
        expect(settled.result.product.id).toMatch(/^open-[a-f0-9]{20}$/);
      }
    }
  });

  it("blocks resolution before any provider call when either switch is off or the guard is exhausted", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("live_network_forbidden");
    });
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error("provider_must_not_be_called");
    });
    const analysisOff = await tempDir();
    const analysisRuntime = createProductAnalysisRuntime({
      env: readyEnv(analysisOff, { TRENDIQ_ANALYSIS_ENABLED: "false" }),
      assetsReady: () => true,
      fetchImpl,
      now: () => new Date("2026-10-21T00:00:00.000Z"),
    });
    const analysisBlocked = await analysisRuntime.resolveOpenProduct({ query: "Sony WH-1000XM5" });
    expect(analysisBlocked.body).toEqual({ status: "unavailable", reason: "analysis_disabled" });
    const analysisStart = analysisRuntime.analyzeProduct("ray-ban-meta");
    expect(analysisStart).toEqual({ status: "unavailable", reason: "analysis_disabled" });
    expect(await readdir(analysisOff)).toEqual([]);

    const openOff = await tempDir();
    const openRuntime = createProductAnalysisRuntime({
      env: readyEnv(openOff, { TRENDIQ_OPEN_ANALYSIS_ENABLED: "false" }),
      assetsReady: () => true,
      fetchImpl,
      now: () => new Date("2026-10-21T00:00:00.000Z"),
    });
    const openBlocked = await openRuntime.resolveOpenProduct({ query: "Sony WH-1000XM5" });
    expect(openBlocked.body).toEqual({ status: "unavailable", reason: "open_analysis_disabled" });
    expect(await readdir(openOff)).toEqual([]);
    expect(openRuntime.analyzeProduct("oura-ring")).toEqual({
      status: "unavailable",
      reason: "product_not_supported",
    });

    const exhaustedDir = await tempDir();
    const exhausted = createProductAnalysisRuntime({
      env: readyEnv(exhaustedDir, { TRENDIQ_PROCESS_MAX_PAID_OPERATIONS: "1" }),
      assetsReady: () => true,
      fetchImpl,
      now: () => new Date("2026-10-21T00:00:00.000Z"),
    });
    exhausted.paidOperationGuard.reserve();
    expect(exhausted.paidOperationGuard.isExhausted()).toBe(true);
    const guardBlocked = await exhausted.resolveOpenProduct({ query: "Sony WH-1000XM5" });
    expect(guardBlocked.body).toEqual({ status: "unavailable", reason: "process_paid_operation_ceiling_exhausted" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(new ProcessPaidOperationGuard(1).isExhausted()).toBe(false);
  });
});
