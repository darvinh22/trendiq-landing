import { describe, expect, it } from "vitest";
import { buildConsumerProductResult } from "../consumerResult";
import type {
  Recommendation,
  RecommendationMissingEvidence,
  RecommendationReason,
  RecommendationResult,
  RecommendationResultStatus,
} from "../recommendationEngine";

const PRODUCT_ID = "fixture-product-a";
const EVALUATED_AT = "2026-09-01T12:00:00.000Z";
const FRESHEST_SIGNAL_AT = "2026-08-31T12:00:00.000Z";

interface FixtureOptions {
  recommendation?: Recommendation;
  status?: RecommendationResultStatus;
  headline?: string;
  summary?: string;
  scoreState?: "verified" | "degraded" | "unavailable";
  score?: number | null;
  confidenceState?: "verified" | "degraded" | "unavailable";
  confidenceScore?: number | null;
  confidenceLevel?: "Low" | "Developing" | "Good" | "High" | null;
  momentumState?: "verified" | "degraded" | "unavailable";
  direction?: "Exploding" | "Rising" | "Stable" | "Cooling" | null;
  strength?: "Low" | "Medium" | "High" | null;
  reviewsState?: "verified" | "degraded" | "unavailable";
  averageRating?: number | null;
  reviewCount?: number | null;
  consensusQuality?: number | null;
  consensusMean?: number | null;
  recentAverageRating?: number | null;
  textEvidenceState?: "verified" | "degraded" | "unavailable";
  freshnessState?: "verified" | "degraded" | "unavailable";
  freshestSignalAt?: string | null;
  ageHours?: number | null;
  reasons?: RecommendationReason[];
  watchOuts?: string[];
  missingEvidence?: RecommendationMissingEvidence[];
  productId?: string;
  mockFallbackEvidenceExcluded?: boolean;
}

const DEFAULT_REASONS: RecommendationReason[] = [
  {
    code: "FRESH_EVIDENCE",
    effect: "supporting",
    dimension: "freshness",
    message: "The supporting evidence is within the verified freshness window.",
  },
  {
    code: "STRONG_VALIDATED_REVIEWS",
    effect: "supporting",
    dimension: "reviewAggregate",
    message: "A sufficiently large validated rating aggregate is strongly positive.",
  },
  {
    code: "POSITIVE_SEARCH_MOMENTUM",
    effect: "supporting",
    dimension: "searchMomentum",
    message: "Verified current search direction is rising.",
  },
  {
    code: "CONFIDENCE_IS_EVIDENCE_QUALITY",
    effect: "context",
    dimension: "confidence",
    message: "Confidence measures evidence quality, not correctness probability.",
  },
];

function defaultTake(recommendation: Recommendation): { headline: string; summary: string } {
  if (recommendation === "BUY") {
    return {
      headline: "Current evidence supports buying",
      summary: "Strong validated ratings are reinforced by verified rising search demand.",
    };
  }
  if (recommendation === "WAIT") {
    return {
      headline: "Current evidence favors waiting",
      summary: "Strong validated ratings remain, but verified search momentum is cooling.",
    };
  }
  if (recommendation === "SKIP") {
    return {
      headline: "Current evidence supports skipping",
      summary: "Multiple independent validated rating measures are weak.",
    };
  }
  return {
    headline: "Not enough trustworthy evidence",
    summary: "The available evidence does not safely support BUY, WAIT, or SKIP.",
  };
}

function recommendationFixture(options: FixtureOptions = {}): RecommendationResult {
  const recommendation = options.recommendation ?? "BUY";
  const status = options.status ?? (recommendation === "NO_RECOMMENDATION" ? "unavailable" : "verified");
  const take = defaultTake(recommendation);
  const scoreState = options.scoreState ?? "verified";
  const confidenceState = options.confidenceState ?? "verified";
  const momentumState = options.momentumState ?? "verified";
  const reviewsState = options.reviewsState ?? "verified";
  const freshnessState = options.freshnessState ?? "verified";
  const score = options.score === undefined ? (scoreState === "unavailable" ? null : 82) : options.score;
  const confidenceScore =
    options.confidenceScore === undefined ? (confidenceState === "unavailable" ? null : 90) : options.confidenceScore;
  const confidenceLevel =
    options.confidenceLevel === undefined ? (confidenceState === "unavailable" ? null : "High") : options.confidenceLevel;
  const direction = options.direction === undefined ? (momentumState === "unavailable" ? null : "Rising") : options.direction;
  const strength = options.strength === undefined ? (momentumState === "unavailable" ? null : "High") : options.strength;
  const averageRating =
    options.averageRating === undefined ? (reviewsState === "unavailable" ? null : 4.6) : options.averageRating;
  const reviewCount =
    options.reviewCount === undefined ? (reviewsState === "unavailable" ? null : 500) : options.reviewCount;
  const consensusQuality = options.consensusQuality === undefined ? 86 : options.consensusQuality;
  const consensusMean = options.consensusMean === undefined ? 4.5 : options.consensusMean;
  const recentAverageRating = options.recentAverageRating === undefined ? 4.4 : options.recentAverageRating;
  const freshestSignalAt =
    options.freshestSignalAt === undefined
      ? freshnessState === "unavailable"
        ? null
        : FRESHEST_SIGNAL_AT
      : options.freshestSignalAt;
  const ageHours = options.ageHours === undefined ? (freshnessState === "unavailable" ? null : 24) : options.ageHours;
  const missingEvidence = options.missingEvidence ?? [];
  const consensusAvailable = consensusQuality !== null && consensusMean !== null;
  const recentAvailable = recentAverageRating !== null;

  return {
    version: "recommendation_result_v1",
    policyVersion: "recommendation_policy_v1",
    recommendation,
    status,
    product: {
      productId: options.productId ?? PRODUCT_ID,
      title: "Fixture Product",
      brand: "Fixture Brand",
      category: "Fixture Category",
    },
    evaluatedAt: EVALUATED_AT,
    take: {
      headline: options.headline ?? take.headline,
      summary: options.summary ?? take.summary,
      reasons: options.reasons ?? DEFAULT_REASONS.map((item) => ({ ...item })),
      watchOuts: options.watchOuts ?? [],
      missingEvidence,
    },
    evidence: {
      score: {
        state: scoreState,
        score,
        liveCoveragePercent: scoreState === "unavailable" ? null : 100,
        usedForDirection: scoreState === "verified",
      },
      confidence: {
        state: confidenceState,
        score: confidenceScore,
        level: confidenceLevel,
        meaning: "evidence_quality_not_correctness_probability",
        usedForDirection: confidenceState !== "unavailable",
      },
      searchMomentum: {
        state: momentumState,
        direction,
        strength,
        evidenceQuality: momentumState === "unavailable" ? null : "observed",
        usedForDirection: momentumState !== "unavailable",
      },
      reviews: {
        state: reviewsState,
        aggregateAverageRating: averageRating,
        ratingEvidenceCount: reviewCount,
        ratingConsensusQuality: consensusQuality,
        ratingConsensusMean: consensusMean,
        recentAverageRating,
        textEvidenceState: options.textEvidenceState ?? "verified",
        usedForDirection: reviewsState !== "unavailable",
      },
      freshness: {
        state: freshnessState,
        freshestSignalAt,
        ageHours,
        usedForDirection: freshnessState !== "unavailable",
      },
    },
    trust: {
      boundaryStatus: status === "verified" ? "usable" : status === "degraded" ? "partial" : "unavailable",
      verifiedCoveragePercent: status === "unavailable" ? null : 100,
      verifiedDimensions: [
        "score",
        "confidence",
        "searchMomentum",
        "searchDemand",
        "searchDirection",
        "reviews",
        "reviewAggregate",
        ...(consensusAvailable ? (["ratingConsensus"] as const) : []),
        ...(recentAvailable ? (["recentRating"] as const) : []),
      ],
      degradedDimensions: status === "degraded" ? ["score"] : [],
      unavailableDimensions: [
        ...(!consensusAvailable ? (["ratingConsensus"] as const) : []),
        ...(!recentAvailable ? (["recentRating"] as const) : []),
        "social",
        "sentiment",
        "purchaseIntent",
        "hypeSustainability",
        "priceCommerce",
        "staticTrendIqTake",
        "staticProsCons",
        "staticSocialCopy",
      ],
      influencingDimensions: ["boundary", "productBinding", "freshness", "confidence", "searchMomentum", "reviewAggregate"],
      excludedDimensions: [
        "social",
        "sentiment",
        "purchaseIntent",
        "hypeSustainability",
        "priceCommerce",
        "staticTrendIqTake",
        "staticProsCons",
        "staticSocialCopy",
        "reviewTextThemes",
        "providerIdentity",
      ],
      missingEvidence,
      mockFallbackEvidenceExcluded: options.mockFallbackEvidenceExcluded ?? false,
      providerIdentifiersRedacted: true,
      rawReviewBodiesExposed: false,
    },
  };
}

function present(result: RecommendationResult | unknown, productId = PRODUCT_ID) {
  return buildConsumerProductResult({ recommendationResult: result, productId });
}

function expectNoUndefined(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(expectNoUndefined);
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => {
      expect(item).not.toBeUndefined();
      expectNoUndefined(item);
    });
  }
}

describe("buildConsumerProductResult", () => {
  it("maps a verified BUY without changing direction or trust", () => {
    const result = present(recommendationFixture());

    expect(result.decision).toMatchObject({
      recommendation: "BUY",
      status: "verified",
      headline: "Current evidence supports buying",
    });
    expect(result.trust.status).toBe("verified");
  });

  it("preserves a degraded BUY and communicates limited signals", () => {
    const result = present(recommendationFixture({ status: "degraded", scoreState: "degraded" }));

    expect(result.decision.recommendation).toBe("BUY");
    expect(result.decision.status).toBe("degraded");
    expect(result.decision.trustMessage).toContain("some important signals are limited");
  });

  it("maps WAIT exactly without implying a discount or future price drop", () => {
    const result = present(recommendationFixture({ recommendation: "WAIT", direction: "Cooling" }));
    const decisionCopy = JSON.stringify({ decision: result.decision, explanation: result.explanation });

    expect(result.decision.recommendation).toBe("WAIT");
    expect(result.decision.headline).toBe("Current evidence favors waiting");
    expect(decisionCopy).not.toMatch(/discount|sale|price drop/i);
  });

  it("maps SKIP exactly", () => {
    const result = present(recommendationFixture({ recommendation: "SKIP" }));

    expect(result.decision.recommendation).toBe("SKIP");
    expect(result.decision.summary).toBe("Multiple independent validated rating measures are weak.");
  });

  it("maps NO_RECOMMENDATION exactly", () => {
    const result = present(recommendationFixture({ recommendation: "NO_RECOMMENDATION", status: "unavailable" }));

    expect(result.decision.recommendation).toBe("NO_RECOMMENDATION");
    expect(result.decision.status).toBe("unavailable");
  });

  it("never changes any valid upstream recommendation direction", () => {
    for (const recommendation of ["BUY", "WAIT", "SKIP", "NO_RECOMMENDATION"] as const) {
      const status = recommendation === "NO_RECOMMENDATION" ? "unavailable" : "verified";
      expect(present(recommendationFixture({ recommendation, status })).decision.recommendation).toBe(recommendation);
    }
  });

  it("copies the Score value without recalculating it", () => {
    const result = present(recommendationFixture({ score: 83.75 }));

    expect(result.score.value).toBe(83.75);
  });

  it("preserves degraded Score status", () => {
    const result = present(recommendationFixture({ status: "degraded", scoreState: "degraded", score: 71 }));

    expect(result.score).toMatchObject({ value: 71, status: "degraded" });
    expect(result.score.explanation).toContain("not fully verified");
  });

  it("uses null and unavailable when Score is unavailable", () => {
    const result = present(recommendationFixture({ scoreState: "unavailable", score: null }));

    expect(result.score).toMatchObject({ value: null, status: "unavailable", liveCoveragePercent: null });
  });

  it("preserves the exact Confidence meaning", () => {
    const result = present(recommendationFixture());

    expect(result.confidence.meaning).toBe("evidence_quality_not_correctness_probability");
    expect(result.confidence.explanation).toBe(
      "Confidence reflects the quality and completeness of available evidence."
    );
  });

  it("never presents Confidence as probability that TrendIQ is correct", () => {
    const result = present(recommendationFixture({ confidenceScore: 97 }));
    const confidenceCopy = JSON.stringify(result.confidence);

    expect(confidenceCopy).not.toMatch(/97%|likely to be correct|probability.*correct/i);
  });

  it("maps verified rising search momentum safely", () => {
    const result = present(recommendationFixture({ direction: "Rising", strength: "High" }));

    expect(result.momentum).toMatchObject({ direction: "Rising", strength: "High", status: "verified" });
  });

  it("maps verified cooling search momentum safely", () => {
    const result = present(recommendationFixture({ recommendation: "WAIT", direction: "Cooling" }));

    expect(result.momentum).toMatchObject({ direction: "Cooling", status: "verified" });
  });

  it("keeps unavailable search timing null and unavailable", () => {
    const result = present(
      recommendationFixture({ momentumState: "unavailable", direction: null, strength: null })
    );

    expect(result.momentum).toMatchObject({
      direction: null,
      strength: null,
      evidenceQuality: null,
      status: "unavailable",
    });
  });

  it("maps aggregate review rating and count exactly", () => {
    const result = present(recommendationFixture({ averageRating: 4.37, reviewCount: 1_234 }));

    expect(result.reviews.aggregate).toEqual({ averageRating: 4.37, reviewCount: 1_234, status: "verified" });
  });

  it("maps validated rating consensus separately from aggregate ratings", () => {
    const result = present(recommendationFixture({ consensusQuality: 82.5, consensusMean: 4.31 }));

    expect(result.reviews.ratingConsensus).toEqual({
      quality: 82.5,
      averageRating: 4.31,
      status: "verified",
    });
  });

  it("maps qualified recent ratings separately", () => {
    const result = present(recommendationFixture({ recentAverageRating: 4.18 }));

    expect(result.reviews.recentRating).toEqual({ averageRating: 4.18, status: "verified" });
  });

  it("does not fabricate themes when review text is unavailable", () => {
    const result = present(recommendationFixture({ textEvidenceState: "unavailable" }));

    expect(result.reviews.textEvidence).toEqual({ status: "unavailable", summary: null, themes: [] });
  });

  it("never creates review pros or cons", () => {
    const result = present(recommendationFixture());

    expect(result.unsupported.reviewTextIntelligence.pros).toEqual([]);
    expect(result.unsupported.reviewTextIntelligence.cons).toEqual([]);
  });

  it("keeps Best For unavailable rather than inferring buyer personas", () => {
    const result = present(recommendationFixture());

    expect(result.explanation.bestFor).toEqual({ status: "unavailable", items: [] });
  });

  it("copies only the Recommendation Engine watch-outs", () => {
    const warning = "Review text evidence is unavailable, so no themes, pros, or cons were inferred.";
    const result = present(recommendationFixture({ watchOuts: [warning] }));

    expect(result.explanation.watchOuts).toEqual([warning]);
  });

  it("keeps every social and hype field explicitly unavailable", () => {
    const social = present(recommendationFixture()).unsupported.socialAndHype;

    expect(social.status).toBe("unavailable");
    expect(Object.values(social).filter((value) => value !== "unavailable")).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("keeps price intelligence explicitly unavailable", () => {
    const commerce = present(recommendationFixture()).unsupported.priceAndCommerce;

    expect(commerce.price).toBeNull();
    expect(commerce.currency).toBeNull();
    expect(commerce.dealStatus).toBeNull();
  });

  it("keeps merchants and affiliate links unavailable", () => {
    const commerce = present(recommendationFixture()).unsupported.priceAndCommerce;

    expect(commerce.merchantRecommendations).toEqual([]);
    expect(commerce.affiliateLinks).toEqual([]);
  });

  it("does not leak demo or example URLs", () => {
    const upstream = recommendationFixture() as RecommendationResult & Record<string, unknown>;
    upstream.commerce = { productUrl: "https://example.com/demo-product" };

    expect(JSON.stringify(present(upstream))).not.toContain("example.com");
  });

  it("does not expose injected provider identifiers", () => {
    const upstream = recommendationFixture() as RecommendationResult & Record<string, unknown>;
    upstream.providerProductId = "must-not-leak-provider-id";

    expect(JSON.stringify(present(upstream))).not.toContain("must-not-leak-provider-id");
  });

  it("does not expose injected task identifiers", () => {
    const upstream = recommendationFixture() as RecommendationResult & Record<string, unknown>;
    upstream.taskId = "must-not-leak-task-id";

    expect(JSON.stringify(present(upstream))).not.toContain("must-not-leak-task-id");
  });

  it("does not expose injected seller identity or source domains", () => {
    const upstream = recommendationFixture() as RecommendationResult & Record<string, unknown>;
    upstream.seller = "must-not-leak-seller";
    upstream.sourceDomain = "must-not-leak.example";
    const serialized = JSON.stringify(present(upstream));

    expect(serialized).not.toContain("must-not-leak-seller");
    expect(serialized).not.toContain("must-not-leak.example");
  });

  it("does not expose injected raw review bodies", () => {
    const upstream = recommendationFixture() as RecommendationResult & Record<string, unknown>;
    upstream.rawReviewBody = "must-not-leak-review-body";

    expect(JSON.stringify(present(upstream))).not.toContain("must-not-leak-review-body");
  });

  it("does not expose injected raw queries", () => {
    const upstream = recommendationFixture() as RecommendationResult & Record<string, unknown>;
    upstream.query = "must-not-leak-provider-query";

    expect(JSON.stringify(present(upstream))).not.toContain("must-not-leak-provider-query");
  });

  it("fails closed when Product A evidence is requested for Product B", () => {
    const result = present(recommendationFixture(), "fixture-product-b");

    expect(result.decision).toMatchObject({ recommendation: "NO_RECOMMENDATION", status: "unavailable" });
    expect(result.product).toEqual({ id: "fixture-product-b", name: null, brand: null, category: null });
    expect(result.issues).toEqual(["CONSUMER_PRODUCT_BINDING_MISMATCH"]);
  });

  it("fails closed for malformed input", () => {
    const result = present({ version: "recommendation_result_v1" });

    expect(result.decision.recommendation).toBe("NO_RECOMMENDATION");
    expect(result.issues).toEqual(["CONSUMER_INPUT_MALFORMED"]);
  });

  it("fails closed for malformed nested evidence", () => {
    const upstream = recommendationFixture() as RecommendationResult & Record<string, unknown>;
    upstream.evidence = { score: { state: "verified", score: Number.NaN } };

    expect(present(upstream).issues).toEqual(["CONSUMER_INPUT_MALFORMED"]);
  });

  it("is deterministic for identical input", () => {
    const upstream = recommendationFixture();

    expect(present(upstream)).toEqual(present(upstream));
  });

  it("serializes cleanly to JSON and round-trips", () => {
    const result = present(recommendationFixture());

    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("contains no undefined-dependent external semantics", () => {
    const result = present(recommendationFixture());

    expectNoUndefined(result);
  });

  it("ignores unsupported fields instead of allowing them to upgrade trust", () => {
    const first = recommendationFixture({ status: "degraded", scoreState: "degraded" });
    const second = structuredClone(first) as RecommendationResult & Record<string, unknown>;
    second.social = { state: "verified", sentiment: 100 };
    second.price = { state: "verified", value: 1 };
    second.hypeSustainability = { state: "verified", value: 100 };

    expect(present(second)).toEqual(present(first));
    expect(present(second).trust.status).toBe("degraded");
  });

  it("ignores existing static UI content", () => {
    const first = recommendationFixture();
    const second = structuredClone(first) as RecommendationResult & Record<string, unknown>;
    second.trendiqSays = "Static UI says something different";
    second.bestFor = ["Unsafe buyer persona"];
    second.watchOut = ["Unsafe product complaint"];
    second.pros = ["Unsafe pro"];
    second.cons = ["Unsafe con"];

    expect(present(second)).toEqual(present(first));
  });

  it("copies the deterministic Take exactly rather than generating another one", () => {
    const upstream = recommendationFixture({
      headline: "Current evidence supports buying",
      summary: "Strong validated ratings are reinforced by stable, meaningful search demand.",
    });
    const result = present(upstream);

    expect(result.decision.headline).toBe(upstream.take.headline);
    expect(result.decision.summary).toBe(upstream.take.summary);
    expect(result.explanation.reasons).toEqual(upstream.take.reasons);
  });

  it("preserves safe product identity but never creates URL or query fields", () => {
    const result = present(recommendationFixture());

    expect(result.product).toEqual({
      id: PRODUCT_ID,
      name: "Fixture Product",
      brand: "Fixture Brand",
      category: "Fixture Category",
    });
    expect(result.product).not.toHaveProperty("query");
    expect(result.product).not.toHaveProperty("url");
  });

  it("provides a compact trust summary with freshness and redaction guarantees", () => {
    const result = present(recommendationFixture({ mockFallbackEvidenceExcluded: true }));

    expect(result.trust.freshness).toEqual({
      status: "verified",
      freshestSignalAt: FRESHEST_SIGNAL_AT,
      ageHours: 24,
    });
    expect(result.trust.mockFallbackEvidenceExcluded).toBe(true);
    expect(Object.values(result.trust.redactions).every(Boolean)).toBe(true);
  });

  it("keeps review sample-window metadata unavailable when the engine does not expose it", () => {
    const result = present(recommendationFixture());

    expect(result.reviews.sampleWindow).toEqual({ status: "unavailable", start: null, end: null });
  });

  it("does not mutate the Recommendation Engine input", () => {
    const upstream = recommendationFixture();
    const before = structuredClone(upstream);

    present(upstream);

    expect(upstream).toEqual(before);
  });

  it("uses explicit unavailable placeholders in fail-closed output", () => {
    const result = present(null);

    expect(result.score.value).toBeNull();
    expect(result.confidence.value).toBeNull();
    expect(result.momentum.direction).toBeNull();
    expect(result.reviews.aggregate.averageRating).toBeNull();
    expect(result.unsupported.priceAndCommerce.status).toBe("unavailable");
  });
});
