import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../../../app/lib/data/search/client";
import { getControlledProductProfile } from "../controlledProductCatalog";
import { ProductionAnalysisEvidenceCollector } from "../productionEvidenceCollector";
import type { AlphaLogEvent } from "../../runtime/alphaLogger";

const NOW = "2026-09-14T12:00:00.000Z";

describe("ProductionAnalysisEvidenceCollector provider diagnostics", () => {
  it("logs only safe failed/zero-signal outcomes and ignores logger failures", async () => {
    const forbiddenResponse = {
      status_code: 50000,
      status_message: "raw-response-marker",
      tasks_error: 1,
      tasks: [{
        id: "provider-task-marker",
        status_code: 50000,
        status_message: "seller-marker source-domain-marker",
      }],
    };
    const zeroSignalResponse = {
      status_code: 20000,
      status_message: "Ok.",
      tasks: [{
        status_code: 20000,
        status_message: "Ok.",
        result: [{
          keyword: "unapproved-query-marker",
          location_code: 2840,
          language_code: "en",
          search_volume: 100,
        }],
      }],
    };
    const fetchImpl: FetchLike = vi.fn(async (url) =>
      url.includes("dataforseo_trends")
        ? {
            ok: false,
            status: 500,
            json: async () => forbiddenResponse,
            text: async () => JSON.stringify(forbiddenResponse),
          }
        : {
            ok: true,
            status: 200,
            json: async () => zeroSignalResponse,
            text: async () => JSON.stringify(zeroSignalResponse),
          }
    );
    const log = vi.fn((_event: AlphaLogEvent) => {
      throw new Error("logging failed");
    });
    const collector = new ProductionAnalysisEvidenceCollector({
      env: {
        TRENDIQ_SEARCH_MODE: "live",
        TRENDIQ_SEARCH_PROVIDER: "dataforseo",
        TRENDIQ_REVIEWS_MODE: "mock",
        TRENDIQ_REVIEWS_PROVIDER: "dataforseo",
        DATAFORSEO_LOGIN: "credential-login-marker",
        DATAFORSEO_PASSWORD: "credential-password-marker",
        DATAFORSEO_API_BASE_URL: "https://api.dataforseo.com",
      },
      fetchImpl,
      logger: { log },
    });
    const profile = getControlledProductProfile("ray-ban-meta");
    if (!profile) throw new Error("controlled profile fixture missing");

    const collection = await collector.collect(profile, () => new Date(NOW));

    expect(collection).toEqual({
      productId: "ray-ban-meta",
      searchStatus: "completed",
      reviewStatus: "unavailable",
      signals: [],
      usage: { httpRequestCount: 2, paidOperationCount: 2, taskPostCount: 0 },
      processPaidOperationRejected: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.map(([event]) => event)).toEqual([
      {
        event: "provider_execution",
        provider: "dataforseo_trends",
        signal: "search_momentum_trends",
        executionStatus: "failed",
        blockReason: "adapter_failed",
        failureCategory: "provider_http_error",
        emittedSignalCount: 0,
        warningCount: 1,
      },
      {
        event: "provider_execution",
        provider: "dataforseo_google_ads",
        signal: "search_volume_google_ads",
        executionStatus: "completed",
        emittedSignalCount: 0,
        warningCount: 2,
      },
    ]);

    const serializedDiagnostics = JSON.stringify(log.mock.calls);
    for (const forbidden of [
      "raw-response-marker",
      "provider-task-marker",
      "seller-marker",
      "source-domain-marker",
      "unapproved-query-marker",
      "credential-login-marker",
      "credential-password-marker",
    ]) {
      expect(serializedDiagnostics).not.toContain(forbidden);
    }
  });
});
