import { describe, expect, it, vi } from "vitest";
import { handleProductAnalysisApiRequest } from "../../analysis/productAnalysisApi";
import type { AnalysisEvidenceCollector } from "../../analysis/productionEvidenceCollector";
import { createProductAnalysisRuntime } from "../productAnalysisRuntime";
import {
  APPROVED_DATAFORSEO_ORIGIN,
  readPrivateAlphaRuntimeConfig,
  type RuntimeEnvironment,
} from "../runtimeConfig";

const PRODUCT_ID = "ray-ban-meta";

function readyEnvironment(overrides: RuntimeEnvironment = {}): RuntimeEnvironment {
  return {
    TRENDIQ_ANALYSIS_ENABLED: "true",
    TRENDIQ_PROCESS_MAX_PAID_OPERATIONS: "3",
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

function unusedCollector() {
  const collect = vi.fn();
  return { collect, evidenceCollector: { collect } as unknown as AnalysisEvidenceCollector };
}

describe("private-alpha runtime configuration", () => {
  it("is ready only with built assets and a valid deliberately-live server configuration", () => {
    const providerFetch = vi.fn();
    const runtime = createProductAnalysisRuntime({
      env: readyEnvironment(),
      assetsReady: () => true,
      fetchImpl: providerFetch,
    });

    expect(runtime.health()).toEqual({ status: "ok" });
    expect(runtime.readiness()).toEqual({ status: "ready" });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("keeps health live while readiness fails closed without built assets", () => {
    const providerFetch = vi.fn();
    const runtime = createProductAnalysisRuntime({
      env: readyEnvironment(),
      assetsReady: () => false,
      fetchImpl: providerFetch,
    });

    expect(runtime.health()).toEqual({ status: "ok" });
    expect(runtime.readiness()).toEqual({
      status: "not_ready",
      reason: "build_assets_unavailable",
    });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["disabled", { TRENDIQ_ANALYSIS_ENABLED: "false" }, "analysis_disabled"],
    ["no live path", { TRENDIQ_SEARCH_MODE: "mock", TRENDIQ_REVIEWS_MODE: "mock" }, "live_evidence_path_not_configured"],
    ["missing credentials", { DATAFORSEO_PASSWORD: "" }, "provider_credentials_missing"],
    ["invalid search mode", { TRENDIQ_SEARCH_MODE: "automatic" }, "invalid_provider_configuration"],
    ["invalid live provider", { TRENDIQ_SEARCH_PROVIDER: "arbitrary" }, "invalid_provider_configuration"],
    ["non-finite ceiling", { TRENDIQ_PROCESS_MAX_PAID_OPERATIONS: "Infinity" }, "invalid_paid_operation_ceiling"],
    ["zero ceiling", { TRENDIQ_PROCESS_MAX_PAID_OPERATIONS: "0" }, "invalid_paid_operation_ceiling"],
    ["short deadline", { TRENDIQ_ANALYSIS_JOB_DEADLINE_MS: "999" }, "invalid_job_deadline"],
    ["long deadline", { TRENDIQ_ANALYSIS_JOB_DEADLINE_MS: "120001" }, "invalid_job_deadline"],
  ] as const)("fails readiness closed for %s", (_name, override, reason) => {
    const config = readPrivateAlphaRuntimeConfig(readyEnvironment(override));
    expect(config.validationFailure).toBe(reason);
  });

  it.each([
    "http://api.dataforseo.com",
    "https://api.dataforseo.com.evil.example",
    "https://evil.example/api.dataforseo.com",
    "https://user:pass@api.dataforseo.com",
    "https://api.dataforseo.com/v3",
    "https://api.dataforseo.com/?redirect=evil",
    "https://api.dataforseo.com/#fragment",
    "not a URL",
  ])("rejects an unapproved provider URL without preserving it: %s", (candidate) => {
    const config = readPrivateAlphaRuntimeConfig(readyEnvironment({
      DATAFORSEO_API_BASE_URL: candidate,
    }));
    expect(config.validationFailure).toBe("unapproved_provider_origin");
    expect(config.providerEnvironment.DATAFORSEO_API_BASE_URL).toBe(APPROVED_DATAFORSEO_ORIGIN);
  });

  it.each([
    APPROVED_DATAFORSEO_ORIGIN,
    `${APPROVED_DATAFORSEO_ORIGIN}/`,
    "https://api.dataforseo.com:443",
  ])("accepts only URL forms that normalize to the exact approved origin: %s", (candidate) => {
    const config = readPrivateAlphaRuntimeConfig(readyEnvironment({
      DATAFORSEO_API_BASE_URL: candidate,
    }));
    expect(config.validationFailure).toBeNull();
    expect(config.dataForSeoApiBaseUrl).toBe(APPROVED_DATAFORSEO_ORIGIN);
  });
});

describe("private-alpha runtime enforcement", () => {
  it("rejects disabled analysis at the server boundary with zero evidence or paid work", () => {
    const { collect, evidenceCollector } = unusedCollector();
    const logWriter = vi.fn();
    const runtime = createProductAnalysisRuntime({
      env: readyEnvironment({ TRENDIQ_ANALYSIS_ENABLED: "false" }),
      assetsReady: () => true,
      evidenceCollector,
      logWriter,
      now: () => new Date("2026-09-08T12:00:00.000Z"),
    });

    const response = handleProductAnalysisApiRequest({
      method: "POST",
      pathname: "/api/product-analysis",
      body: { productId: PRODUCT_ID },
    }, runtime);

    expect(response).toEqual({
      statusCode: 503,
      body: { status: "unavailable", reason: "analysis_disabled" },
    });
    expect(collect).not.toHaveBeenCalled();
    expect(runtime.paidOperationGuard.snapshot().reserved).toBe(0);
    expect(logWriter).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logWriter.mock.calls[0][0])).toEqual({
      event: "analysis_rejected",
      productId: PRODUCT_ID,
      jobState: "rejected",
      startedAt: "2026-09-08T12:00:00.000Z",
      finalStatus: "unavailable",
      reason: "analysis_disabled",
    });
  });

  it("rejects new analysis after process-budget exhaustion with zero additional provider work", () => {
    const { collect, evidenceCollector } = unusedCollector();
    const runtime = createProductAnalysisRuntime({
      env: readyEnvironment({ TRENDIQ_PROCESS_MAX_PAID_OPERATIONS: "1" }),
      assetsReady: () => true,
      evidenceCollector,
      logger: { log: vi.fn() },
    });
    runtime.paidOperationGuard.reserve();

    expect(runtime.readiness()).toEqual({
      status: "not_ready",
      reason: "process_paid_operation_ceiling_exhausted",
    });
    expect(runtime.analyzeProduct(PRODUCT_ID)).toEqual({
      status: "unavailable",
      reason: "process_paid_operation_ceiling_exhausted",
    });
    expect(collect).not.toHaveBeenCalled();
    expect(runtime.paidOperationGuard.snapshot()).toEqual({
      maximum: 1,
      reserved: 1,
      rejected: 0,
      exhausted: true,
    });
  });

  it("maps all unsafe runtime configuration to one safe public analysis reason", () => {
    const { collect, evidenceCollector } = unusedCollector();
    const runtime = createProductAnalysisRuntime({
      env: readyEnvironment({ DATAFORSEO_API_BASE_URL: "https://lookalike.invalid" }),
      assetsReady: () => true,
      evidenceCollector,
      logger: { log: vi.fn() },
    });
    const serialized = JSON.stringify(runtime.analyzeProduct(PRODUCT_ID));

    expect(serialized).toBe(JSON.stringify({ status: "unavailable", reason: "runtime_not_ready" }));
    expect(serialized).not.toContain("lookalike.invalid");
    expect(collect).not.toHaveBeenCalled();
  });
});
