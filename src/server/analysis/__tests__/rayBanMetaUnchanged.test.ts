import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleProductAnalysisApiRequest } from "../productAnalysisApi";
import { getControlledProductCatalog } from "../controlledProductCatalog";
import type { AnalysisEvidenceCollector } from "../productionEvidenceCollector";
import { createProductAnalysisRuntime } from "../../runtime/productAnalysisRuntime";
import { APPROVED_DATAFORSEO_ORIGIN } from "../../runtime/runtimeConfig";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function readyEnv(dataDir: string, open: boolean) {
  return {
    TRENDIQ_ANALYSIS_ENABLED: "true",
    TRENDIQ_OPEN_ANALYSIS_ENABLED: open ? "true" : "false",
    TRENDIQ_DATA_DIR: dataDir,
    TRENDIQ_PROCESS_MAX_PAID_OPERATIONS: "3",
    TRENDIQ_ANALYSIS_JOB_DEADLINE_MS: "55000",
    TRENDIQ_SEARCH_MODE: "live",
    TRENDIQ_SEARCH_PROVIDER: "dataforseo",
    TRENDIQ_REVIEWS_MODE: "mock",
    TRENDIQ_REVIEWS_PROVIDER: "dataforseo",
    DATAFORSEO_LOGIN: "fixture-login",
    DATAFORSEO_PASSWORD: "fixture-password",
    DATAFORSEO_API_BASE_URL: APPROVED_DATAFORSEO_ORIGIN,
  };
}

describe("ray-ban-meta flow with open analysis present", () => {
  it.each([false, true])("keeps the catalog and productId contract when open analysis is %s", async (open) => {
    const dataDir = await mkdtemp(join(tmpdir(), "trendiq-rayban-"));
    dirs.push(dataDir);
    const collect = vi.fn(async () => ({
      productId: "ray-ban-meta",
      searchStatus: "unavailable" as const,
      reviewStatus: "unavailable" as const,
      signals: [],
      usage: { httpRequestCount: 0, paidOperationCount: 0, taskPostCount: 0 },
    }));
    const fetchImpl = vi.fn(async () => {
      throw new Error("live_network_forbidden");
    });
    const runtime = createProductAnalysisRuntime({
      env: readyEnv(dataDir, open),
      assetsReady: () => true,
      evidenceCollector: { collect } as unknown as AnalysisEvidenceCollector,
      fetchImpl,
      idFactory: () => "analysis_raybanfixture01",
      now: () => new Date("2026-10-21T00:00:00.000Z"),
    });

    expect(getControlledProductCatalog().products.map((product) => product.productId)).toEqual(["ray-ban-meta"]);
    expect(runtime.readiness()).toEqual({ status: "ready" });

    const started = handleProductAnalysisApiRequest({
      method: "POST",
      pathname: "/api/product-analysis",
      body: { productId: "ray-ban-meta" },
    }, runtime);
    expect(started).toEqual({
      statusCode: 202,
      body: { status: "pending", analysisId: "analysis_raybanfixture01" },
    });
    expect(collect).toHaveBeenCalledTimes(1);
    expect(collect.mock.calls[0]?.[0]).toMatchObject({ productId: "ray-ban-meta" });

    const unknown = handleProductAnalysisApiRequest({
      method: "POST",
      pathname: "/api/product-analysis",
      body: { productId: "oura-ring" },
    }, runtime);
    expect(unknown).toEqual({
      statusCode: 404,
      body: { status: "unavailable", reason: "product_not_supported" },
    });
    expect(collect).toHaveBeenCalledTimes(1);

    const resolved = await runtime.resolveOpenProduct({ query: "Sony WH-1000XM5", clientKey: "client-a" });
    if (!open) {
      expect(resolved).toEqual({
        statusCode: 503,
        body: { status: "unavailable", reason: "open_analysis_disabled" },
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("keeps the ray-ban-meta contract when analysis is disabled", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "trendiq-rayban-off-"));
    dirs.push(dataDir);
    const collect = vi.fn(async () => {
      throw new Error("collector_must_not_run");
    });
    const fetchImpl = vi.fn(async () => {
      throw new Error("live_network_forbidden");
    });
    const disabled = createProductAnalysisRuntime({
      env: {
        ...readyEnv(dataDir, true),
        TRENDIQ_ANALYSIS_ENABLED: "false",
      },
      assetsReady: () => true,
      evidenceCollector: { collect } as unknown as AnalysisEvidenceCollector,
      fetchImpl,
      now: () => new Date("2026-10-21T00:00:00.000Z"),
    });
    expect(getControlledProductCatalog().products.map((product) => product.productId)).toEqual(["ray-ban-meta"]);
    const started = handleProductAnalysisApiRequest({
      method: "POST",
      pathname: "/api/product-analysis",
      body: { productId: "ray-ban-meta" },
    }, disabled);
    expect(started).toEqual({ statusCode: 503, body: { status: "unavailable", reason: "analysis_disabled" } });
    const unknown = handleProductAnalysisApiRequest({
      method: "POST",
      pathname: "/api/product-analysis",
      body: { productId: "oura-ring" },
    }, disabled);
    expect(unknown).toEqual({
      statusCode: 404,
      body: { status: "unavailable", reason: "product_not_supported" },
    });
    expect(collect).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
