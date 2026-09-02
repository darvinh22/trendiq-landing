import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PRODUCTS } from "../data";
import {
  ProductAnalysisScreen,
  ProductAnalysisView,
  productAnalysisUiReducer,
  type ProductAnalysisUiState,
} from "../ProductAnalysisScreen";
import { createConsumerProductResultFixture } from "../../lib/presentation/__tests__/consumerProductResultFixture";

const product = PRODUCTS.find((item) => item.id === "ray-ban-meta")!;
const noop = () => undefined;

function renderState(state: Exclude<ProductAnalysisUiState, { phase: "completed" }>): string {
  return renderToStaticMarkup(
    <ProductAnalysisView product={product} state={state} onAnalyze={noop} onRetry={noop} onBack={noop} />
  );
}

describe("ProductAnalysisScreen", () => {
  it("starts with a controlled Analyze action and no legacy intelligence", () => {
    const html = renderState({ phase: "idle" });
    expect(html).toContain("Analyze");
    expect(html).toContain("server-validated evidence");
    expect(html).not.toContain(product.trendiqSays);
    expect(html).not.toContain(product.tiktokSays);
    expect(html).not.toContain(product.redditSentiment);
  });

  it("renders analyzing and pending states truthfully", () => {
    expect(renderState({ phase: "analyzing" })).toContain("Analyzing controlled evidence");
    expect(renderState({ phase: "pending", analysisId: "analysis_fixture123" })).toContain("Analysis pending");
  });

  it("routes a completed ConsumerProductResult through the safe ProductDetail branch", () => {
    const result = createConsumerProductResultFixture({ productId: product.id, recommendation: "WAIT" });
    const html = renderToStaticMarkup(
      <ProductAnalysisScreen
        product={product}
        onBack={noop}
        initialState={{ phase: "completed", result }}
      />
    );
    expect(html).toContain("WAIT");
    expect(html).toContain("Evidence verified");
    expect(html).not.toContain(product.trendiqSays);
  });

  it("renders unavailable and safe error states with retry", () => {
    const unavailable = renderState({ phase: "unavailable", reason: "evidence_unavailable" });
    const error = renderState({ phase: "error", reason: "analysis_failed" });
    expect(unavailable).toContain("Qualified live evidence is unavailable");
    expect(unavailable).toContain("Retry");
    expect(error).toContain("safe application error");
    expect(error).toContain("Retry");
  });

  it("has deterministic analyze, response, and retry transitions", () => {
    expect(productAnalysisUiReducer({ phase: "idle" }, { type: "analyze" })).toEqual({ phase: "analyzing" });
    expect(productAnalysisUiReducer({ phase: "analyzing" }, {
      type: "response",
      response: { status: "pending", analysisId: "analysis_fixture123" },
    })).toEqual({ phase: "pending", analysisId: "analysis_fixture123" });
    expect(productAnalysisUiReducer({ phase: "error", reason: "analysis_failed" }, { type: "retry" }))
      .toEqual({ phase: "idle" });
  });
});
