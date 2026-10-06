import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConsumerProductResult } from "../../lib/data/consumerResult";
import { createConsumerProductResultFixture } from "../../lib/presentation/__tests__/consumerProductResultFixture";
import { ConsumerResultPanel } from "../ConsumerResultPanel";
import { ProductDetail } from "../ProductDetail";

const PRODUCT_ID = "fixture-product-a";

function renderPanel(result: ConsumerProductResult | unknown, productId = PRODUCT_ID): string {
  return renderToStaticMarkup(<ConsumerResultPanel consumerResult={result} productId={productId} />);
}

describe("ConsumerResultPanel", () => {
  it("renders recommendation and trust as independent text labels", () => {
    const html = renderPanel(createConsumerProductResultFixture({ recommendation: "BUY", status: "degraded" }));

    expect(html).toContain("BUY");
    expect(html).toContain("Evidence limited");
  });

  it("renders BUY, WAIT, and SKIP unchanged", () => {
    for (const recommendation of ["BUY", "WAIT", "SKIP"] as const) {
      expect(renderPanel(createConsumerProductResultFixture({ recommendation }))).toContain(recommendation);
    }
  });

  it("renders a consumer-safe NO RECOMMENDATION label without the internal token", () => {
    const html = renderPanel(
      createConsumerProductResultFixture({ recommendation: "NO_RECOMMENDATION", status: "unavailable" })
    );

    expect(html).toContain("NO RECOMMENDATION");
    expect(html).not.toContain("NO_RECOMMENDATION");
  });

  it("renders unavailable Score, Confidence, and momentum without numeric defaults", () => {
    const html = renderPanel(
      createConsumerProductResultFixture({
        score: null,
        scoreStatus: "unavailable",
        confidence: null,
        confidenceStatus: "unavailable",
        momentumDirection: null,
        momentumStatus: "unavailable",
      })
    );

    expect(html).toContain("Score unavailable");
    expect(html).toContain("Confidence unavailable");
    expect(html).toContain("Momentum unavailable");
  });

  it("does not headline a partial score when no recommendation can be made", () => {
    const html = renderPanel(createConsumerProductResultFixture({
      recommendation: "NO_RECOMMENDATION",
      status: "unavailable",
      score: 74,
      scoreStatus: "degraded",
      liveCoveragePercent: 100,
    }));

    expect(html).toContain("NO RECOMMENDATION");
    expect(html).toContain("Evidence incomplete");
    expect(html).toContain("a recommendation cannot safely be made");
    expect(html).toContain("Rising");
    expect(html).not.toContain("Live evidence coverage:");
    expect(html).not.toContain(">74<");
  });

  it("does not headline a partial score when score input is incomplete", () => {
    const html = renderPanel(createConsumerProductResultFixture({
      recommendation: "BUY",
      score: 68,
      scoreStatus: "degraded",
      liveCoveragePercent: 100,
      scoreInputIncomplete: true,
    }));

    expect(html).toContain("BUY");
    expect(html).toContain("Evidence incomplete");
    expect(html).toContain("not a complete product judgment");
    expect(html).toContain("Rising");
    expect(html).not.toContain("Live evidence coverage:");
    expect(html).not.toContain(">68<");
  });

  it("still shows a normal score when evidence is sufficiently complete", () => {
    const html = renderPanel(createConsumerProductResultFixture({
      recommendation: "BUY",
      score: 82,
      scoreStatus: "verified",
      liveCoveragePercent: 100,
    }));

    expect(html).toContain("BUY");
    expect(html).toContain(">82<");
    expect(html).toContain("The Score is backed by fully verified evidence.");
    expect(html).not.toContain("Evidence incomplete");
  });

  it("shows live coverage when a numeric Score is degraded", () => {
    const html = renderPanel(createConsumerProductResultFixture({
      score: 68,
      scoreStatus: "degraded",
      liveCoveragePercent: 62.5,
    }));

    expect(html).toContain("68");
    expect(html).toContain("Evidence limited");
    expect(html).toContain("Live evidence coverage: 62.5%");
  });

  it("states that Confidence is evidence quality rather than correctness probability", () => {
    const html = renderPanel(createConsumerProductResultFixture({ confidence: 84 }));

    expect(html).toContain("84 evidence quality");
    expect(html).toContain("Confidence measures evidence quality");
    expect(html).toContain("not the probability that the recommendation is correct");
  });

  it("renders the actual missing-evidence list", () => {
    const html = renderPanel(createConsumerProductResultFixture({
      missingEvidence: ["reviewText", "freshness", "absoluteDemand"],
    }));

    expect(html).toContain("MISSING EVIDENCE");
    expect(html).toContain("Review text unavailable");
    expect(html).toContain("Freshness unavailable");
    expect(html).toContain("Absolute search demand unavailable");
  });

  it("renders safe evaluation time and evidence age", () => {
    const html = renderPanel(createConsumerProductResultFixture({
      evaluatedAt: "2026-09-01T12:34:00.000Z",
      freshnessStatus: "degraded",
      freshnessAgeHours: 36.5,
    }));

    expect(html).toContain("2026-09-01 12:34 UTC");
    expect(html).toContain("Evidence freshness");
    expect(html).toContain("Evidence limited · 36.5 hours old");
  });

  it("renders aggregate, consensus, recent, and text evidence separately", () => {
    const html = renderPanel(createConsumerProductResultFixture());

    expect(html).toContain("Aggregate rating");
    expect(html).toContain("Rating consensus");
    expect(html).toContain("Recent rating");
    expect(html).toContain("Review text");
    expect(html).toContain("Review text evidence is unavailable");
  });

  it("renders only upstream watch-outs", () => {
    const warning = "Review text evidence is unavailable, so no themes, pros, or cons were inferred.";
    const html = renderPanel(createConsumerProductResultFixture({ watchOuts: [warning] }));

    expect(html).toContain("WATCH OUT");
    expect(html).toContain(warning);
  });

  it("renders readable result reasons without exposing internal reason codes", () => {
    const result = createConsumerProductResultFixture({ recommendation: "WAIT" });
    const html = renderPanel(result);

    expect(html).toContain("Verified current search direction is cooling.");
    for (const reason of result.explanation.reasons) {
      expect(html).not.toContain(reason.code);
    }
  });

  it("renders Best For, social, review themes, and commerce as unavailable", () => {
    const html = renderPanel(createConsumerProductResultFixture());

    expect(html).toContain("Best For unavailable");
    expect(html).toContain("Social intelligence not available yet");
    expect(html).toContain("Review themes not available yet");
    expect(html).toContain("Price and commerce not available yet");
  });

  it("contains no links, price claims, or Buy Now action", () => {
    const html = renderPanel(createConsumerProductResultFixture());

    expect(html).not.toContain("href=");
    expect(html).not.toContain("example.com");
    expect(html).not.toMatch(/Buy Now|\$\d|discount|deal badge/i);
  });

  it("fails closed for malformed input", () => {
    const html = renderPanel({ version: "consumer_product_result_v1" });

    expect(html).toContain("NO RECOMMENDATION");
    expect(html).not.toContain("NO_RECOMMENDATION");
    expect(html).toContain("Result unavailable");
    expect(html).toContain("Not enough evidence");
  });

  it("fails closed for a product-binding mismatch", () => {
    const html = renderPanel(createConsumerProductResultFixture(), "fixture-product-b");

    expect(html).toContain("NO RECOMMENDATION");
    expect(html).not.toContain("NO_RECOMMENDATION");
    expect(html).not.toContain("Synthetic Fixture Product");
  });

  it("does not render injected unsafe fields", () => {
    const result = createConsumerProductResultFixture() as ConsumerProductResult & Record<string, unknown>;
    result.tiktokSays = "must-not-render-tiktok";
    result.redditSentiment = "must-not-render-reddit";
    result.providerProductId = "must-not-render-provider";
    result.taskId = "must-not-render-task";
    result.seller = "must-not-render-seller";
    result.sourceDomain = "must-not-render.example";
    result.rawReviewBody = "must-not-render-review";
    result.query = "must-not-render-query";
    result.commerce = { productUrl: "https://example.com/demo-product" };
    const html = renderPanel(result);

    for (const forbidden of [
      "must-not-render-tiktok",
      "must-not-render-reddit",
      "must-not-render-provider",
      "must-not-render-task",
      "must-not-render-seller",
      "must-not-render.example",
      "must-not-render-review",
      "must-not-render-query",
      "example.com",
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });
});

describe("ProductDetail safe consumer-result seam", () => {
  it("renders the safe contract path without legacy static intelligence or external media", () => {
    const result = createConsumerProductResultFixture();
    const html = renderToStaticMarkup(
      <ProductDetail consumerResult={result} productId={PRODUCT_ID} onBack={() => undefined} />
    );

    expect(html).toContain("TRENDIQ RESULT");
    expect(html).toContain("Synthetic Fixture Product");
    expect(html).not.toContain("TIKTOK SAYS");
    expect(html).not.toContain("REDDIT SENTIMENT");
    expect(html).not.toContain("Pros &amp; Cons");
    expect(html).not.toContain("Similar Alternatives");
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/(?:src|href)="https?:/i);
  });

  it("ignores runtime legacy Product data when the safe branch is selected", () => {
    const props = {
      consumerResult: createConsumerProductResultFixture(),
      productId: PRODUCT_ID,
      onBack: () => undefined,
      product: {
        trendiqSays: "must-not-render-static-take",
        tiktokSays: "must-not-render-static-social",
        imageUrl: "https://example.com/must-not-render-image",
        bestFor: ["must-not-render-persona"],
        watchOut: ["must-not-render-complaint"],
        pros: ["must-not-render-pro"],
        cons: ["must-not-render-con"],
      },
    } as unknown as Parameters<typeof ProductDetail>[0];
    const html = renderToStaticMarkup(<ProductDetail {...props} />);

    expect(html).not.toContain("must-not-render");
    expect(html).not.toContain("example.com");
  });
});
