import { describe, expect, it, vi } from "vitest";
import type { AnalysisEvidenceCollector } from "../productionEvidenceCollector";
import { handleProductAnalysisApiRequest } from "../productAnalysisApi";
import { ProductAnalysisOrchestrator } from "../productAnalysisOrchestrator";

function testOrchestrator(collect = vi.fn(async () => ({
  productId: "ray-ban-meta",
  searchStatus: "unavailable" as const,
  reviewStatus: "unavailable" as const,
  signals: [],
  usage: { httpRequestCount: 0, paidOperationCount: 0, taskPostCount: 0 },
}))) {
  return {
    collect,
    orchestrator: new ProductAnalysisOrchestrator({
      evidenceCollector: { collect } as AnalysisEvidenceCollector,
      now: () => new Date("2026-09-02T12:00:00.000Z"),
      idFactory: () => "analysis_apifixture001",
    }),
  };
}

describe("product analysis API boundary", () => {
  it("returns only the sole allowlisted product's public-safe catalog fields at zero provider cost", () => {
    const { orchestrator, collect } = testOrchestrator();
    const response = handleProductAnalysisApiRequest({
      method: "GET",
      pathname: "/api/product-analysis/catalog",
    }, orchestrator);

    expect(response).toEqual({
      statusCode: 200,
      body: {
        version: "controlled_product_catalog_v1",
        products: [{
          productId: "ray-ban-meta",
          displayName: "Ray-Ban Meta Glasses",
          brand: "Ray-Ban",
          category: "Tech",
        }],
      },
    });
    if (!("products" in response.body)) throw new Error("expected controlled catalog response");
    expect(Object.keys(response.body.products[0]).sort()).toEqual([
      "brand", "category", "displayName", "productId",
    ]);
    expect(collect).not.toHaveBeenCalled();

    const serialized = JSON.stringify(response.body);
    for (const forbidden of [
      "providerIds", "taskId", "gid", "dataDocid", "aliases", "query", "guardrails",
      "seller", "sourceDomain", "Authorization", "rawResponse", "rawReviewBody",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("accepts only the browser-owned productId field", () => {
    const { orchestrator } = testOrchestrator();
    expect(handleProductAnalysisApiRequest({
      method: "POST",
      pathname: "/api/product-analysis",
      body: { productId: "ray-ban-meta" },
    }, orchestrator)).toEqual({
      statusCode: 202,
      body: { status: "pending", analysisId: "analysis_apifixture001" },
    });
  });

  it.each([
    undefined,
    null,
    {},
    { productId: "Ray Ban Meta" },
    { productId: "ray-ban-meta", brand: "attacker-brand" },
    { productId: "ray-ban-meta", providerIds: { gid: "attacker" } },
    { productId: "ray-ban-meta", approval: true, budget: 999 },
  ])("rejects malformed or authority-bearing request bodies", (body) => {
    const { orchestrator, collect } = testOrchestrator();
    expect(handleProductAnalysisApiRequest({
      method: "POST",
      pathname: "/api/product-analysis",
      body,
    }, orchestrator)).toEqual({
      statusCode: 400,
      body: { status: "error", reason: "invalid_request" },
    });
    expect(collect).not.toHaveBeenCalled();
  });

  it("returns a safe unavailable response for unknown products before execution", () => {
    const { orchestrator, collect } = testOrchestrator();
    expect(handleProductAnalysisApiRequest({
      method: "POST",
      pathname: "/api/product-analysis",
      body: { productId: "not-allowlisted" },
    }, orchestrator)).toEqual({
      statusCode: 404,
      body: { status: "unavailable", reason: "product_not_supported" },
    });
    expect(collect).not.toHaveBeenCalled();
  });

  it("supports opaque application-owned status polling", async () => {
    const { orchestrator } = testOrchestrator();
    handleProductAnalysisApiRequest({
      method: "POST",
      pathname: "/api/product-analysis",
      body: { productId: "ray-ban-meta" },
    }, orchestrator);
    expect(handleProductAnalysisApiRequest({
      method: "GET",
      pathname: "/api/product-analysis/analysis_apifixture001",
    }, orchestrator).body.status).toBe("pending");

    await orchestrator.waitForSettled("analysis_apifixture001");
    expect(handleProductAnalysisApiRequest({
      method: "GET",
      pathname: "/api/product-analysis/analysis_apifixture001",
    }, orchestrator)).toEqual({
      statusCode: 503,
      body: { status: "unavailable", reason: "evidence_unavailable" },
    });
  });

  it("never treats provider-looking status IDs as valid application IDs", () => {
    const { orchestrator } = testOrchestrator();
    expect(handleProductAnalysisApiRequest({
      method: "GET",
      pathname: "/api/product-analysis/provider-task-123",
    }, orchestrator)).toEqual({
      statusCode: 400,
      body: { status: "error", reason: "invalid_request" },
    });
  });
});
