import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  ProductAnalysisClientResponse,
  ProductAnalysisExecutionClient,
} from "../../lib/analysis/productAnalysisClient";
import type { ControlledProductCatalogItem } from "../../lib/analysis/productAnalysisContract";
import { createConsumerProductResultFixture } from "../../lib/presentation/__tests__/consumerProductResultFixture";
import {
  canRetryProductAnalysis,
  ProductAnalysisScreen,
  ProductAnalysisView,
  pollProductAnalysisUntilSettled,
  productAnalysisUiReducer,
  requestProductAnalysis,
  type ProductAnalysisUiState,
} from "../ProductAnalysisScreen";

const product: ControlledProductCatalogItem = {
  productId: "ray-ban-meta",
  displayName: "Ray-Ban Meta Glasses",
  brand: "Ray-Ban",
  category: "Tech",
};
const noop = () => undefined;
const noWait = async () => undefined;

function renderState(state: Exclude<ProductAnalysisUiState, { phase: "completed" }>): string {
  return renderToStaticMarkup(
    <ProductAnalysisView product={product} state={state} onAnalyze={noop} onRetry={noop} onBack={noop} />
  );
}

function clientWithStatuses(statuses: ProductAnalysisClientResponse[]) {
  const start = vi.fn(async () => ({ status: "pending", analysisId: "analysis_fixture123" }) as const);
  const getStatus = vi.fn(async () => statuses.shift() ?? ({ status: "pending", analysisId: "analysis_fixture123" } as const));
  return { client: { start, getStatus } satisfies ProductAnalysisExecutionClient, start, getStatus };
}

describe("ProductAnalysisScreen", () => {
  it("starts with a controlled Analyze action and no legacy intelligence", () => {
    const html = renderState({ phase: "idle" });
    expect(html).toContain("Analyze");
    expect(html).toContain("supported evidence");
    expect(html).toContain("worth considering");
    expect(html).not.toMatch(/TrendIQ Says|TikTok|Reddit|\$299|Best For/i);
  });

  it("renders analyzing and pending states truthfully", () => {
    const analyzing = renderState({ phase: "analyzing" });
    const pending = renderState({ phase: "pending", analysisId: "analysis_fixture123" });
    expect(analyzing).toContain("Checking available evidence");
    expect(pending).toContain("Finishing your analysis");
    expect(`${analyzing}${pending}`).not.toMatch(/server|provider|polling|runtime|operator/i);
  });

  it("renders a completed ConsumerProductResult through the controlled result view", () => {
    const result = createConsumerProductResultFixture({ productId: product.productId, recommendation: "WAIT" });
    const html = renderToStaticMarkup(
      <ProductAnalysisScreen
        product={product}
        onBack={noop}
        initialState={{ phase: "completed", result }}
      />
    );
    expect(html).toContain("WAIT");
    expect(html).toContain("Evidence verified");
    expect(html).not.toMatch(/TIKTOK SAYS|REDDIT SENTIMENT|Similar Alternatives/i);
    expect(html).toContain('data-result-viewport=""');
    expect(html).toContain('data-result-scroll=""');
    expect(html).toContain("min-h-0");
    expect(html).toContain("overflow-y-auto");
    expect(html).not.toMatch(/max-h-\[|h-screen|h-\[844px\]/);
  });

  it("renders settled unavailable without Retry and transient states with explicit Retry", () => {
    const unavailable = renderState({ phase: "unavailable", reason: "evidence_unavailable" });
    const error = renderState({ phase: "error", reason: "request_failed" });
    const deadline = renderState({ phase: "polling_timeout" });
    expect(unavailable).toContain("not enough supported evidence");
    expect(unavailable).not.toContain("Retry");
    expect(error).toContain("Something interrupted this request");
    expect(error).toContain("Retry");
    expect(deadline).toContain("taking longer than expected");
    expect(deadline).toContain("without starting a second analysis");
    expect(deadline).toContain("Retry");
  });

  it.each([
    ["analysis_disabled", "Analysis is temporarily unavailable"],
    ["process_paid_operation_ceiling_exhausted", "private alpha has reached its analysis limit"],
    ["analysis_deadline_exceeded", "analysis took too long to complete"],
    ["runtime_not_ready", "Please come back later"],
    ["evidence_unavailable", "not enough supported evidence"],
    ["product_not_supported", "product is not available for analysis"],
    ["analysis_failed", "analysis could not be completed"],
  ] as const)("renders the non-retryable safe reason %s without internal language or Retry", (reason, expectedText) => {
    const html = renderState({ phase: "unavailable", reason });
    expect(html).toContain(expectedText);
    expect(html).not.toContain("Retry");
    expect(html).not.toContain(reason);
    expect(html).not.toMatch(/credential|authorization|provider|operator|server|polling|runtime|process budget|stack trace/i);
  });

  it("offers Retry only for public states where another explicit attempt can reasonably help", () => {
    expect(canRetryProductAnalysis({ phase: "error", reason: "request_failed" })).toBe(true);
    expect(canRetryProductAnalysis({ phase: "unavailable", reason: "analysis_not_found" })).toBe(true);
    expect(canRetryProductAnalysis({ phase: "polling_timeout" })).toBe(true);
    expect(renderState({ phase: "unavailable", reason: "analysis_not_found" })).toContain("Retry");

    for (const reason of [
      "analysis_failed",
      "analysis_disabled",
      "analysis_deadline_exceeded",
      "evidence_unavailable",
      "invalid_request",
      "process_paid_operation_ceiling_exhausted",
      "product_binding_mismatch",
      "product_not_supported",
      "runtime_not_ready",
    ] as const) {
      expect(canRetryProductAnalysis({ phase: "unavailable", reason })).toBe(false);
    }
  });

  it("has deterministic analyze, response, deadline, and retry transitions", () => {
    expect(productAnalysisUiReducer({ phase: "idle" }, { type: "analyze" })).toEqual({ phase: "analyzing" });
    expect(productAnalysisUiReducer({ phase: "analyzing" }, {
      type: "response",
      response: { status: "pending", analysisId: "analysis_fixture123" },
    })).toEqual({ phase: "pending", analysisId: "analysis_fixture123" });
    expect(productAnalysisUiReducer(
      { phase: "pending", analysisId: "analysis_fixture123" },
      { type: "pollingDeadline" }
    )).toEqual({ phase: "polling_timeout" });
    expect(productAnalysisUiReducer({ phase: "polling_timeout" }, { type: "retry" })).toEqual({ phase: "idle" });
  });
});

describe("bounded product-analysis polling", () => {
  it("settles pending to completed", async () => {
    const result = createConsumerProductResultFixture({ productId: product.productId });
    const { client, getStatus } = clientWithStatuses([
      { status: "pending", analysisId: "analysis_fixture123" },
      { status: "completed", result },
    ]);

    await expect(pollProductAnalysisUntilSettled(client, "analysis_fixture123", { wait: noWait }))
      .resolves.toEqual({ status: "settled", response: { status: "completed", result } });
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it.each([
    { status: "unavailable", reason: "evidence_unavailable" } as const,
    { status: "error", reason: "analysis_failed" } as const,
  ])("settles pending to $status", async (terminal) => {
    const { client } = clientWithStatuses([
      { status: "pending", analysisId: "analysis_fixture123" },
      terminal,
    ]);
    await expect(pollProductAnalysisUntilSettled(client, "analysis_fixture123", { wait: noWait }))
      .resolves.toEqual({ status: "settled", response: terminal });
  });

  it("reaches a deterministic deadline without starting another analysis", async () => {
    const { client, start, getStatus } = clientWithStatuses([]);
    await expect(pollProductAnalysisUntilSettled(client, "analysis_fixture123", {
      maxAttempts: 3,
      wait: noWait,
    })).resolves.toEqual({ status: "deadline" });
    expect(getStatus).toHaveBeenCalledTimes(3);
    expect(start).not.toHaveBeenCalled();
  });

  it("keeps retry user initiated", async () => {
    const { client, start } = clientWithStatuses([]);
    expect(start).not.toHaveBeenCalled();
    await requestProductAnalysis(client, product.productId);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(product.productId);
  });
});
