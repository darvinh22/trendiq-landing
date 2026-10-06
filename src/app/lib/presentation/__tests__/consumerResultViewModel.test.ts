import { describe, expect, it } from "vitest";
import type { ConsumerProductResult } from "../../data/consumerResult";
import { buildConsumerResultViewModel } from "../consumerResultViewModel";
import { createConsumerProductResultFixture } from "./consumerProductResultFixture";

const PRODUCT_ID = "fixture-product-a";

function view(result: ConsumerProductResult | unknown, productId = PRODUCT_ID) {
  return buildConsumerResultViewModel({ consumerResult: result, productId });
}

describe("buildConsumerResultViewModel", () => {
  it("maps BUY directly", () => {
    const result = view(createConsumerProductResultFixture({ recommendation: "BUY" }));

    expect(result.decision.recommendation).toBe("BUY");
    expect(result.decision.recommendationLabel).toBe("BUY");
  });

  it("maps WAIT directly", () => {
    const result = view(
      createConsumerProductResultFixture({ recommendation: "WAIT", momentumDirection: "Cooling" })
    );

    expect(result.decision.recommendation).toBe("WAIT");
    expect(result.decision.recommendationLabel).toBe("WAIT");
    expect(result.decision.headline).toBe("Current evidence favors waiting");
  });

  it("maps SKIP directly", () => {
    const result = view(createConsumerProductResultFixture({ recommendation: "SKIP" }));

    expect(result.decision.recommendation).toBe("SKIP");
    expect(result.decision.recommendationLabel).toBe("SKIP");
  });

  it("presents NO_RECOMMENDATION without exposing the internal token", () => {
    const result = view(
      createConsumerProductResultFixture({ recommendation: "NO_RECOMMENDATION", status: "unavailable" })
    );

    expect(result.decision.recommendation).toBe("NO_RECOMMENDATION");
    expect(result.decision.recommendationLabel).toBe("NO RECOMMENDATION");
    expect(result.decision.status).toBe("unavailable");
  });

  it("never changes any valid recommendation direction", () => {
    for (const recommendation of ["BUY", "WAIT", "SKIP", "NO_RECOMMENDATION"] as const) {
      const status = recommendation === "NO_RECOMMENDATION" ? "unavailable" : "verified";
      expect(view(createConsumerProductResultFixture({ recommendation, status })).decision.recommendation).toBe(
        recommendation
      );
    }
  });

  it("renders verified status with a text label", () => {
    const result = view(createConsumerProductResultFixture({ status: "verified" }));

    expect(result.decision.status).toBe("verified");
    expect(result.decision.statusLabel).toBe("Evidence verified");
  });

  it("renders degraded status with a distinct text label", () => {
    const result = view(createConsumerProductResultFixture({ status: "degraded" }));

    expect(result.decision.status).toBe("degraded");
    expect(result.decision.statusLabel).toBe("Evidence limited");
  });

  it("renders unavailable status with a distinct text label", () => {
    const result = view(createConsumerProductResultFixture({ status: "unavailable" }));

    expect(result.decision.status).toBe("unavailable");
    expect(result.decision.statusLabel).toBe("Not enough evidence");
  });

  it("copies Score without recalculation", () => {
    const result = view(createConsumerProductResultFixture({ score: 83.75 }));

    expect(result.score.value).toBe(83.75);
    expect(result.score.valueLabel).toBe("83.75");
  });

  it("preserves degraded Score status", () => {
    const result = view(createConsumerProductResultFixture({ score: 71, scoreStatus: "degraded" }));

    expect(result.score).toMatchObject({ value: 71, status: "degraded", statusLabel: "Evidence limited" });
  });

  it("does not create a numeric fallback for unavailable Score", () => {
    const result = view(createConsumerProductResultFixture({ score: null, scoreStatus: "unavailable" }));

    expect(result.score.value).toBeNull();
    expect(result.score.valueLabel).toBe("Score unavailable");
  });

  it("preserves the numeric score as Signal Quality", () => {
    const result = view(createConsumerProductResultFixture({ confidence: 90 }));

    expect(result.confidence.meaning).toBe("evidence_quality_not_correctness_probability");
    expect(result.confidence.metricLabel).toBe("Signal Quality");
    expect(result.confidence.value).toBe(90);
    expect(result.confidence.valueLabel).toBe("90");
    expect(result.confidence.level).toBe("High");
    expect(result.confidence.qualitativeLabel).toBe("High");
    expect(result.evidenceCoverage).toMatchObject({
      percent: 100,
      label: "100%",
      source: "liveCoveragePercent",
    });
  });

  it("never describes Confidence as correctness probability", () => {
    const result = view(createConsumerProductResultFixture({ confidence: 85 }));
    const serialized = JSON.stringify(result.confidence);

    expect(serialized).not.toMatch(/85%|likely.*correct|probability.*correct/i);
  });

  it("renders rising momentum from the contract", () => {
    const result = view(createConsumerProductResultFixture({ momentumDirection: "Rising" }));

    expect(result.momentum).toMatchObject({ direction: "Rising", valueLabel: "Rising · High" });
  });

  it("renders cooling momentum from the contract", () => {
    const result = view(
      createConsumerProductResultFixture({ recommendation: "WAIT", momentumDirection: "Cooling" })
    );

    expect(result.momentum).toMatchObject({ direction: "Cooling", valueLabel: "Cooling · High" });
  });

  it("keeps unavailable momentum unavailable", () => {
    const result = view(
      createConsumerProductResultFixture({ momentumDirection: null, momentumStatus: "unavailable" })
    );

    expect(result.momentum).toMatchObject({ value: null, valueLabel: "Momentum unavailable", status: "unavailable" });
  });

  it("formats aggregate rating and count without changing their values", () => {
    const result = view(createConsumerProductResultFixture({ averageRating: 4.37, reviewCount: 1234 }));

    expect(result.reviews.aggregate).toMatchObject({
      averageRating: 4.37,
      averageRatingLabel: "4.37 / 5",
      reviewCount: 1234,
      reviewCountLabel: "1,234 reviews",
    });
  });

  it("keeps consensus distinct from aggregate rating", () => {
    const result = view(createConsumerProductResultFixture({ averageRating: 4.6 }));

    expect(result.reviews.aggregate.averageRatingLabel).toBe("4.6 / 5");
    expect(result.reviews.ratingConsensus.qualityLabel).toBe("86 / 100 evidence quality");
    expect(result.reviews.ratingConsensus.averageRatingLabel).toBe("4.5 / 5");
  });

  it("does not create themes when review text is missing", () => {
    const result = view(createConsumerProductResultFixture({ textEvidenceStatus: "unavailable" }));

    expect(result.reviews.textEvidence.themes).toEqual([]);
    expect(result.reviews.textEvidence.message).toContain("unavailable");
  });

  it("does not expose pros", () => {
    expect(view(createConsumerProductResultFixture())).not.toHaveProperty("pros");
  });

  it("does not expose cons", () => {
    expect(view(createConsumerProductResultFixture())).not.toHaveProperty("cons");
  });

  it("does not create product complaint claims", () => {
    const serialized = JSON.stringify(view(createConsumerProductResultFixture()));

    expect(serialized).not.toMatch(/battery|overheats|poor quality|breaks easily/i);
  });

  it("keeps Best For unavailable", () => {
    expect(view(createConsumerProductResultFixture()).availability.bestFor).toEqual({
      status: "unavailable",
      label: "Best For unavailable",
    });
  });

  it("copies only safe upstream watch-outs", () => {
    const warning = "Review text evidence is unavailable, so no themes, pros, or cons were inferred.";
    const result = view(createConsumerProductResultFixture({ watchOuts: [warning] }));

    expect(result.take.watchOuts).toEqual([warning]);
  });

  it("does not accept injected TikTok demo data", () => {
    const result = createConsumerProductResultFixture() as ConsumerProductResult & Record<string, unknown>;
    result.tiktokSays = "must-not-render-tiktok-copy";

    expect(JSON.stringify(view(result))).not.toContain("must-not-render-tiktok-copy");
  });

  it("does not accept injected Reddit demo data", () => {
    const result = createConsumerProductResultFixture() as ConsumerProductResult & Record<string, unknown>;
    result.redditSentiment = "must-not-render-reddit-copy";

    expect(JSON.stringify(view(result))).not.toContain("must-not-render-reddit-copy");
  });

  it("keeps social and hype unavailable despite injected fields", () => {
    const result = createConsumerProductResultFixture() as ConsumerProductResult & Record<string, unknown>;
    result.socialBuzz = { status: "verified", value: 100 };

    expect(view(result).availability.socialAndHype.status).toBe("unavailable");
    expect(JSON.stringify(view(result))).not.toContain("socialBuzz");
  });

  it("keeps price unavailable despite injected fields", () => {
    const result = createConsumerProductResultFixture() as ConsumerProductResult & Record<string, unknown>;
    result.price = { status: "verified", value: 1 };

    expect(view(result).availability.priceAndCommerce.status).toBe("unavailable");
    expect(JSON.stringify(view(result))).not.toContain('"price"');
  });

  it("does not expose demo commerce URLs", () => {
    const result = createConsumerProductResultFixture() as ConsumerProductResult & Record<string, unknown>;
    result.commerce = { productUrl: "https://example.com/demo-product" };

    expect(JSON.stringify(view(result))).not.toContain("example.com");
  });

  it("does not expose provider IDs", () => {
    const result = createConsumerProductResultFixture() as ConsumerProductResult & Record<string, unknown>;
    result.providerProductId = "must-not-render-provider-id";

    expect(JSON.stringify(view(result))).not.toContain("must-not-render-provider-id");
  });

  it("does not expose task IDs", () => {
    const result = createConsumerProductResultFixture() as ConsumerProductResult & Record<string, unknown>;
    result.taskId = "must-not-render-task-id";

    expect(JSON.stringify(view(result))).not.toContain("must-not-render-task-id");
  });

  it("does not expose seller identity or source domains", () => {
    const result = createConsumerProductResultFixture() as ConsumerProductResult & Record<string, unknown>;
    result.seller = "must-not-render-seller";
    result.sourceDomain = "must-not-render.example";
    const serialized = JSON.stringify(view(result));

    expect(serialized).not.toContain("must-not-render-seller");
    expect(serialized).not.toContain("must-not-render.example");
  });

  it("does not expose raw review bodies", () => {
    const result = createConsumerProductResultFixture() as ConsumerProductResult & Record<string, unknown>;
    result.rawReviewBody = "must-not-render-review-body";

    expect(JSON.stringify(view(result))).not.toContain("must-not-render-review-body");
  });

  it("does not expose raw provider queries", () => {
    const result = createConsumerProductResultFixture() as ConsumerProductResult & Record<string, unknown>;
    result.query = "must-not-render-provider-query";

    expect(JSON.stringify(view(result))).not.toContain("must-not-render-provider-query");
  });

  it("fails safely for malformed ConsumerProductResult", () => {
    const result = view({ version: "consumer_product_result_v1" });

    expect(result.decision).toMatchObject({
      recommendation: "NO_RECOMMENDATION",
      recommendationLabel: "NO RECOMMENDATION",
      status: "unavailable",
    });
    expect(result.issues).toEqual(["UI_INPUT_MALFORMED"]);
  });

  it("fails safely for malformed nested fields", () => {
    const result = createConsumerProductResultFixture() as ConsumerProductResult & Record<string, unknown>;
    result.score = { value: Number.NaN, status: "verified" };

    expect(view(result).issues).toEqual(["UI_INPUT_MALFORMED"]);
  });

  it("fails closed on product-binding mismatch", () => {
    const result = view(createConsumerProductResultFixture(), "fixture-product-b");

    expect(result.product).toEqual({
      id: "fixture-product-b",
      name: "Product result unavailable",
      brand: null,
      category: null,
    });
    expect(result.decision.recommendation).toBe("NO_RECOMMENDATION");
    expect(result.decision.recommendationLabel).toBe("NO RECOMMENDATION");
    expect(result.issues).toEqual(["UI_PRODUCT_BINDING_MISMATCH"]);
  });

  it("is deterministic for identical inputs", () => {
    const result = createConsumerProductResultFixture();

    expect(view(result)).toEqual(view(result));
  });

  it("copies the deterministic Take rather than generating another one", () => {
    const source = createConsumerProductResultFixture({ recommendation: "WAIT", momentumDirection: "Cooling" });
    const result = view(source);

    expect(result.take.headline).toBe(source.decision.headline);
    expect(result.take.summary).toBe(source.decision.summary);
    expect(result.take.reasons).toEqual(source.explanation.reasons);
  });

  it("preserves trust status and summary", () => {
    const source = createConsumerProductResultFixture({ status: "degraded" });
    const result = view(source);

    expect(result.trust.status).toBe("degraded");
    expect(result.trust.summary).toBe(source.trust.summary);
  });

  it("formats public evaluation time and freshness age without exposing provider detail", () => {
    const result = view(createConsumerProductResultFixture({
      evaluatedAt: "2026-09-01T12:34:00.000Z",
      freshnessStatus: "degraded",
      freshnessAgeHours: 36.5,
    }));

    expect(result.trust).toMatchObject({
      evaluatedAtLabel: "2026-09-01 12:34 UTC",
      freshnessStatus: "degraded",
      freshnessStatusLabel: "Evidence limited",
      freshnessAgeHours: 36.5,
      freshnessAgeLabel: "36.5 hours old",
    });
    expect(JSON.stringify(result.trust)).not.toMatch(/provider|taskId|sourceDomain/i);
  });

  it("does not mutate the ConsumerProductResult input", () => {
    const result = createConsumerProductResultFixture();
    const before = structuredClone(result);

    view(result);

    expect(result).toEqual(before);
  });
});
