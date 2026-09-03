import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProductAnalysisExecutionClient } from "../../lib/analysis/productAnalysisClient";
import type { ControlledProductCatalogItem, ProductAnalysisResponse } from "../../lib/analysis/productAnalysisContract";
import { createConsumerProductResultFixture } from "../../lib/presentation/__tests__/consumerProductResultFixture";
import {
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

function clientWithStatuses(statuses: ProductAnalysisResponse[]) {
  const start = vi.fn(async () => ({ status: "pending", analysisId: "analysis_fixture123" }) as const);
  const getStatus = vi.fn(async () => statuses.shift() ?? ({ status: "pending", analysisId: "analysis_fixture123" } as const));
  return { client: { start, getStatus } satisfies ProductAnalysisExecutionClient, start, getStatus };
}

describe("ProductAnalysisScreen", () => {
  it("starts with a controlled Analyze action and no legacy intelligence", () => {
    const html = renderState({ phase: "idle" });
    expect(html).toContain("Analyze");
    expect(html).toContain("server-validated evidence");
    expect(html).not.toMatch(/TrendIQ Says|TikTok|Reddit|\$299|Best For/i);
  });

  it("renders analyzing and pending states truthfully", () => {
    expect(renderState({ phase: "analyzing" })).toContain("Analyzing controlled evidence");
    expect(renderState({ phase: "pending", analysisId: "analysis_fixture123" })).toContain("Analysis pending");
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
  });

  it("renders unavailable, safe error, and polling-deadline states with explicit retry", () => {
    const unavailable = renderState({ phase: "unavailable", reason: "evidence_unavailable" });
    const error = renderState({ phase: "error", reason: "analysis_failed" });
    const deadline = renderState({ phase: "polling_timeout" });
    expect(unavailable).toContain("Qualified live evidence is unavailable");
    expect(error).toContain("safe application error");
    expect(deadline).toContain("polling window ended");
    expect(deadline).toContain("No new analysis was started");
    for (const html of [unavailable, error, deadline]) expect(html).toContain("Retry");
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
