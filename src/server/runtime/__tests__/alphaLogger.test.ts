import { describe, expect, it, vi } from "vitest";
import type { AlphaLogEvent } from "../alphaLogger";
import { SanitizedAlphaLogger } from "../alphaLogger";

describe("SanitizedAlphaLogger", () => {
  it("emits one structured JSON lifecycle record with only the safe schema", () => {
    const write = vi.fn();
    const logger = new SanitizedAlphaLogger(write);
    logger.log({
      event: "analysis_settled",
      analysisId: "analysis_logfixture001",
      productId: "ray-ban-meta",
      jobState: "settled",
      startedAt: "2026-09-08T12:00:00.000Z",
      completedAt: "2026-09-08T12:00:01.250Z",
      durationMs: 1250,
      httpRequestCount: 6,
      paidOperationCount: 2,
      taskPostCount: 2,
      finalStatus: "unavailable",
      reason: "evidence_unavailable",
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(write.mock.calls[0][0])).toEqual({
      event: "analysis_settled",
      analysisId: "analysis_logfixture001",
      productId: "ray-ban-meta",
      jobState: "settled",
      startedAt: "2026-09-08T12:00:00.000Z",
      completedAt: "2026-09-08T12:00:01.250Z",
      durationMs: 1250,
      httpRequestCount: 6,
      paidOperationCount: 2,
      taskPostCount: 2,
      finalStatus: "unavailable",
      reason: "evidence_unavailable",
    });
  });

  it("projects caller input through an allowlist so prohibited provider data cannot be logged", () => {
    const write = vi.fn();
    const logger = new SanitizedAlphaLogger(write);
    const unsafeEvent = {
      event: "analysis_rejected",
      productId: "ray-ban-meta",
      jobState: "rejected",
      startedAt: "2026-09-08T12:00:00.000Z",
      finalStatus: "unavailable",
      reason: "analysis_disabled",
      credentials: "credential-marker",
      authorization: "authorization-marker",
      providerTaskId: "task-marker",
      providerPayload: "payload-marker",
      providerQuery: "query-marker",
      rawEvidence: "evidence-marker",
      sellerIdentity: "seller-marker",
      environmentValue: "environment-marker",
    } as unknown as AlphaLogEvent;

    logger.log(unsafeEvent);
    const serialized = write.mock.calls[0][0] as string;
    expect(JSON.parse(serialized)).toEqual({
      event: "analysis_rejected",
      productId: "ray-ban-meta",
      jobState: "rejected",
      startedAt: "2026-09-08T12:00:00.000Z",
      finalStatus: "unavailable",
      reason: "analysis_disabled",
    });
    for (const marker of [
      "credential-marker",
      "authorization-marker",
      "task-marker",
      "payload-marker",
      "query-marker",
      "evidence-marker",
      "seller-marker",
      "environment-marker",
    ]) {
      expect(serialized).not.toContain(marker);
    }
  });

  it("emits only allowlisted provider-execution fields and count diagnostics", () => {
    const write = vi.fn();
    const logger = new SanitizedAlphaLogger(write);
    const unsafeEvent = {
      event: "provider_execution",
      provider: "dataforseo_trends",
      signal: "search_momentum_trends",
      executionStatus: "failed",
      blockReason: "adapter_failed",
      failureCategory: "provider_http_error",
      emittedSignalCount: 0,
      warningCount: 1,
      credentials: "credential-marker",
      authorization: "authorization-marker",
      headers: { Authorization: "authorization-header-marker" },
      rawRequestPayload: "payload-marker",
      rawProviderResponse: "response-marker",
      aliases: ["alias-marker"],
      rawQuery: "query-marker",
      providerTaskId: "task-marker",
      providerProductId: "provider-product-marker",
      seller: "seller-marker",
      sourceDomain: "source-domain-marker",
      metadata: { uncontrolled: "metadata-marker" },
      httpStatus: 599,
      providerStatusCode: 59999,
      providerMessage: "provider-message-marker",
      providerDiagnostics: { message: "provider-diagnostics-marker", httpStatus: 598 },
      warnings: ["warning-text-marker"],
      signals: [{ raw: "signal-marker" }],
    } as unknown as AlphaLogEvent;

    logger.log(unsafeEvent);
    const serialized = write.mock.calls[0][0] as string;
    expect(JSON.parse(serialized)).toEqual({
      event: "provider_execution",
      provider: "dataforseo_trends",
      signal: "search_momentum_trends",
      executionStatus: "failed",
      blockReason: "adapter_failed",
      failureCategory: "provider_http_error",
      emittedSignalCount: 0,
      warningCount: 1,
    });
    for (const marker of [
      "credential-marker",
      "authorization-marker",
      "authorization-header-marker",
      "payload-marker",
      "response-marker",
      "alias-marker",
      "query-marker",
      "task-marker",
      "provider-product-marker",
      "seller-marker",
      "source-domain-marker",
      "metadata-marker",
      "provider-message-marker",
      "provider-diagnostics-marker",
      "warning-text-marker",
      "signal-marker",
    ]) {
      expect(serialized).not.toContain(marker);
    }
    expect(serialized).not.toContain("599");
    expect(serialized).not.toContain("598");
  });

  it("omits unsafe block reasons and drops diagnostics with uncontrolled identity enums", () => {
    const write = vi.fn();
    const logger = new SanitizedAlphaLogger(write);

    logger.log({
      event: "provider_execution",
      provider: "dataforseo_google_ads",
      signal: "search_volume_google_ads",
      executionStatus: "failed",
      blockReason: "provider-task-id-123",
      failureCategory: "forged-provider-category",
      emittedSignalCount: 0,
      warningCount: 1,
    } as unknown as AlphaLogEvent);

    const serialized = write.mock.calls[0][0] as string;
    expect(JSON.parse(serialized)).toEqual({
      event: "provider_execution",
      provider: "dataforseo_google_ads",
      signal: "search_volume_google_ads",
      executionStatus: "failed",
      emittedSignalCount: 0,
      warningCount: 1,
    });
    expect(serialized).not.toContain("provider-task-id-123");
    expect(serialized).not.toContain("forged-provider-category");

    logger.log({
      event: "provider_execution",
      provider: "private-provider.example",
      signal: "raw-secret-query",
      executionStatus: "SECRET-response-body",
      emittedSignalCount: 1,
      warningCount: 1,
    } as unknown as AlphaLogEvent);

    expect(write).toHaveBeenCalledTimes(1);
  });

  it("omits a category unless it describes a failed adapter execution", () => {
    const write = vi.fn();
    const logger = new SanitizedAlphaLogger(write);

    logger.log({
      event: "provider_execution",
      provider: "dataforseo_trends",
      signal: "search_momentum_trends",
      executionStatus: "failed",
      blockReason: "operation_safety_violation",
      failureCategory: "provider_http_error",
      emittedSignalCount: 0,
      warningCount: 1,
    });

    expect(JSON.parse(write.mock.calls[0][0])).toEqual({
      event: "provider_execution",
      provider: "dataforseo_trends",
      signal: "search_momentum_trends",
      executionStatus: "failed",
      blockReason: "operation_safety_violation",
      emittedSignalCount: 0,
      warningCount: 1,
    });
  });

  it("never changes application behavior when the log writer fails", () => {
    const logger = new SanitizedAlphaLogger(() => {
      throw new Error("writer failed");
    });
    expect(() => logger.log({
      event: "analysis_started",
      analysisId: "analysis_logfixture002",
      productId: "ray-ban-meta",
      jobState: "pending",
      startedAt: "2026-09-08T12:00:00.000Z",
    })).not.toThrow();
  });
});
