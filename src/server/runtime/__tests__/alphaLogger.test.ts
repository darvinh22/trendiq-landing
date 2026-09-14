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
      emittedSignalCount: 0,
      warningCount: 1,
      credentials: "credential-marker",
      authorization: "authorization-marker",
      rawRequestPayload: "payload-marker",
      rawProviderResponse: "response-marker",
      aliases: ["alias-marker"],
      rawQuery: "query-marker",
      providerTaskId: "task-marker",
      providerProductId: "provider-product-marker",
      seller: "seller-marker",
      sourceDomain: "source-domain-marker",
      metadata: { uncontrolled: "metadata-marker" },
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
      emittedSignalCount: 0,
      warningCount: 1,
    });
    for (const marker of [
      "credential-marker",
      "authorization-marker",
      "payload-marker",
      "response-marker",
      "alias-marker",
      "query-marker",
      "task-marker",
      "provider-product-marker",
      "seller-marker",
      "source-domain-marker",
      "metadata-marker",
      "warning-text-marker",
      "signal-marker",
    ]) {
      expect(serialized).not.toContain(marker);
    }
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
