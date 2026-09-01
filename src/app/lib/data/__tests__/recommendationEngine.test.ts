import { describe, expect, it } from "vitest";
import {
  buildRecommendationResult,
  RECOMMENDATION_POLICY,
  type RecommendationReasonCode,
} from "../recommendationEngine";
import type {
  RevenueMvpExposure,
  RevenueMvpExposureState,
  RevenueMvpResult,
} from "../revenueMvpResult";

const PRODUCT_ID = "fixture-product-a";
const EVALUATED_AT = "2026-09-01T12:00:00.000Z";
const FRESH_SIGNAL_AT = "2026-08-31T12:00:00.000Z";

interface FixtureOptions {
  status?: RevenueMvpResult["status"];
  productId?: string;
  scoreState?: RevenueMvpExposureState;
  score?: number;
  confidenceState?: RevenueMvpExposureState;
  confidenceScore?: number;
  confidenceLevel?: "Low" | "Developing" | "Good" | "High";
  searchState?: RevenueMvpExposureState;
  direction?: "Exploding" | "Rising" | "Stable" | "Cooling";
  demandState?: RevenueMvpExposureState;
  demandStrength?: "Low" | "Medium" | "High";
  aggregateState?: RevenueMvpExposureState;
  averageRating?: number;
  ratingEvidenceCount?: number;
  consensusState?: RevenueMvpExposureState;
  consensusQuality?: number;
  consensusMean?: number;
  recentState?: RevenueMvpExposureState;
  recentAverageRating?: number;
  textState?: RevenueMvpExposureState;
  freshestSignalAt?: string | null;
  verifiedCoveragePercent?: number;
  mockFallbackSignalCountExcluded?: number;
  mockFallbackComponentsExcluded?: RevenueMvpResult["trust"]["mockFallbackComponentsExcluded"];
}

function exposure<T>(state: RevenueMvpExposureState, value: T): RevenueMvpExposure<T> {
  return {
    state,
    value: state === "unavailable" ? null : value,
    reasons: state === "verified" ? [] : [`fixture_${state}`],
  };
}

function resultFixture(options: FixtureOptions = {}): RevenueMvpResult {
  const scoreState = options.scoreState ?? "verified";
  const confidenceState = options.confidenceState ?? "verified";
  const searchState = options.searchState ?? "verified";
  const demandState = options.demandState ?? "verified";
  const aggregateState = options.aggregateState ?? "verified";
  const consensusState = options.consensusState ?? "verified";
  const recentState = options.recentState ?? "verified";
  const textState = options.textState ?? "verified";

  return {
    version: "revenue_mvp_result_v1",
    status: options.status ?? "usable",
    product: {
      productId: options.productId ?? PRODUCT_ID,
      title: "Fixture Product",
      brand: "Fixture Brand",
      category: "Fixture Category",
      query: "must-not-be-exposed-query",
    },
    generatedAt: FRESH_SIGNAL_AT,
    score: {
      ...exposure(scoreState, {
        score: options.score ?? 82,
        scoreVersion: "v1.1",
        weightedComponentScore: 82,
        penaltyTotal: 0,
      }),
      liveCoveragePercent: scoreState === "unavailable" ? null : 100,
      totalActiveScoringWeight: scoreState === "unavailable" ? null : 1,
      liveBackedScoringWeight: scoreState === "unavailable" ? null : 1,
      mockFallbackScoringWeight: scoreState === "unavailable" ? null : 0,
      verifiedComponents: scoreState === "verified" ? ["searchMomentum", "reviewQuality"] : [],
      degradedComponents: scoreState === "degraded" ? ["searchMomentum"] : [],
      unsupportedScoreComponents: [],
      excludedMockFallbackComponents: [],
    },
    confidence: {
      ...exposure(confidenceState, {
        score: options.confidenceScore ?? 90,
        level: options.confidenceLevel ?? "High",
        scoreVersion: "v1.1",
        meaning: "evidence_quality_not_correctness_probability" as const,
      }),
      liveCoveragePercent: confidenceState === "unavailable" ? null : 100,
    },
    search: {
      state: searchState,
      searchMomentum: exposure(searchState, {
        direction: options.direction ?? "Rising",
        strength: "High",
        confidence: 90,
        evidenceQuality: "observed",
      }),
      absoluteDemand: exposure(demandState, {
        source: "dataforseo_google_ads",
        provenance: "live",
        monthlySearchVolume: 8_000,
        searchVolume7d: 2_000,
        normalizedDemandScore: 82,
        level: "High",
        strength: options.demandStrength ?? "High",
        confidence: 90,
        evidenceQuality: "observed",
      }),
      directionalDemand: exposure(searchState, {
        source: "dataforseo_trends",
        provenance: "live",
        current7dRelativeInterest: 80,
        previous7dRelativeInterest: 50,
        searchGrowthPercent: 60,
        trendChangePercent: 60,
        accelerationPercent: 8,
        consecutiveGrowthDays: 5,
        direction: options.direction ?? "Rising",
        confidence: 90,
        evidenceQuality: "observed",
        baselineReadiness: 100,
        baselineQuality: "strong",
      }),
      legacyMomentum: exposure(searchState, {
        status: options.direction ?? "Rising",
        changePercent: 60,
        isProvisional: false,
        reason: null,
      }),
      provenance: {
        measurementScope: "exact",
        query: "must-not-be-exposed-search-query",
        sources: ["must-not-be-exposed-provider-source"],
      },
      reasons: [],
    },
    reviews: {
      state:
        aggregateState === "verified" && (consensusState === "verified" || recentState === "verified")
          ? "verified"
          : "degraded",
      aggregateRating: exposure(aggregateState, {
        averageRating: options.averageRating ?? 4.6,
        ratingEvidenceCount: options.ratingEvidenceCount ?? 500,
        ratingMax: 5,
        evidenceSourceField: "must-not-be-exposed-review-field",
        evidenceComposition: "must-not-be-exposed-review-composition",
      }),
      ratingConsensus: exposure(consensusState, {
        ratingConsensusQuality: options.consensusQuality ?? 86,
        status: "derived-live",
        reviewsCount: 500,
        distributionSource: "must-not-be-exposed-distribution-source",
        distributionScope: "full_provider_distribution",
        distributionComposition: "must-not-be-exposed-distribution-composition",
        mean: options.consensusMean ?? 4.5,
        standardDeviation: 0.7,
        variance: 0.49,
        qualityGate: 90,
        shapeSupport: 85,
        lowTailPenalty: 1,
        aggregateAverageRating: options.averageRating ?? 4.6,
        aggregateRatingDelta: 0.1,
        aggregateRatingMismatchThreshold: 0.75,
        calculationMethod: "must-not-be-exposed-calculation-method",
      }),
      recentRating: exposure(recentState, {
        recentAverageRating: options.recentAverageRating ?? 4.4,
        status: "derived-live",
        fetchedReviewCount: 100,
        qualifyingReviewCount: 80,
        sampleScope: "must-not-be-exposed-sample-scope",
        windowStart: "2026-08-01T00:00:00.000Z",
        windowEnd: "2026-08-31T00:00:00.000Z",
        windowDays: 30,
        calculationMethod: "must-not-be-exposed-recent-method",
        datePrecision: "day",
      }),
      textEvidence: exposure(textState, {
        status: "validated",
        sampleScope: "must-not-be-exposed-text-scope",
        fetchedReviewCount: 100,
        qualifyingReviewCount: 80,
      }),
      providerIdsRedacted: true,
      rawReviewBodiesExposed: false,
      reasons: [],
    },
    unsupportedEvidence: {
      social: exposure("unavailable", undefined as never),
      sentiment: exposure("unavailable", undefined as never),
      purchaseIntent: exposure("unavailable", undefined as never),
      hypeSustainability: exposure("unavailable", undefined as never),
    },
    commerce: {
      price: exposure("unavailable", undefined as never),
      commerce: exposure("unavailable", undefined as never),
    },
    staticCopy: {
      trendIqTake: exposure("unavailable", undefined as never),
      tiktokRedditCopy: exposure("unavailable", undefined as never),
      prosCons: exposure("unavailable", undefined as never),
    },
    trust: {
      liveCoveragePercent: 100,
      verifiedCoveragePercent: options.verifiedCoveragePercent ?? 100,
      generatedAt: FRESH_SIGNAL_AT,
      freshestSignalAt: options.freshestSignalAt === undefined ? FRESH_SIGNAL_AT : options.freshestSignalAt,
      verifiedDimensions: [
        "score",
        "confidence",
        "searchMomentum",
        "searchDemand",
        "searchDirection",
        "reviews",
        "reviewAggregate",
        "ratingConsensus",
        "recentRating",
      ],
      degradedDimensions: [],
      unavailableDimensions: [
        "social",
        "sentiment",
        "purchaseIntent",
        "hypeSustainability",
        "priceCommerce",
        "staticTrendIqTake",
        "staticProsCons",
        "staticSocialCopy",
      ],
      mockFallbackComponentsExcluded: options.mockFallbackComponentsExcluded ?? [],
      mockFallbackSignalCountExcluded: options.mockFallbackSignalCountExcluded ?? 0,
      staticEvidenceExcluded: true,
      commerceEvidenceExcluded: true,
      providerIdentifiersRedacted: true,
      rawReviewBodiesExposed: false,
      warnings: ["must-not-be-exposed-warning"],
    },
  };
}

function recommend(result: RevenueMvpResult | unknown, productId = PRODUCT_ID, evaluatedAt = EVALUATED_AT) {
  return buildRecommendationResult({ revenueMvpResult: result, productId, evaluatedAt });
}

function reasonCodes(result: ReturnType<typeof recommend>): RecommendationReasonCode[] {
  return result.take.reasons.map((item) => item.code);
}

describe("buildRecommendationResult", () => {
  it("returns BUY for strong independent ratings and verified rising search timing", () => {
    const result = recommend(resultFixture());

    expect(result.recommendation).toBe("BUY");
    expect(result.status).toBe("verified");
    expect(reasonCodes(result)).toContain("POSITIVE_SEARCH_MOMENTUM");
    expect(result.evidence.reviews.usedForDirection).toBe(true);
    expect(result.evidence.searchMomentum.usedForDirection).toBe(true);
  });

  it("returns BUY for stable search with verified medium absolute demand", () => {
    const result = recommend(resultFixture({ direction: "Stable", demandStrength: "Medium" }));

    expect(result.recommendation).toBe("BUY");
    expect(reasonCodes(result)).toContain("STABLE_SUPPORTED_SEARCH_DEMAND");
  });

  it("returns WAIT when strong reviews meet verified cooling search momentum", () => {
    const result = recommend(resultFixture({ direction: "Cooling" }));

    expect(result.recommendation).toBe("WAIT");
    expect(reasonCodes(result)).toContain("COOLING_SEARCH_MOMENTUM");
  });

  it("returns WAIT when strong reviews have stable but low absolute demand", () => {
    const result = recommend(resultFixture({ direction: "Stable", demandStrength: "Low" }));

    expect(result.recommendation).toBe("WAIT");
    expect(reasonCodes(result)).toContain("WEAK_CURRENT_SEARCH_DEMAND");
  });

  it("returns degraded WAIT when strong reviews have degraded search timing", () => {
    const result = recommend(resultFixture({ status: "partial", searchState: "degraded" }));

    expect(result.recommendation).toBe("WAIT");
    expect(result.status).toBe("degraded");
    expect(reasonCodes(result)).toContain("DEGRADED_SEARCH_EVIDENCE");
  });

  it("returns SKIP only when aggregate and independent ratings are both weak", () => {
    const result = recommend(
      resultFixture({
        averageRating: 3.1,
        consensusMean: 3.1,
        recentAverageRating: 3.1,
        direction: "Cooling",
        score: 30,
      })
    );

    expect(result.recommendation).toBe("SKIP");
    expect(reasonCodes(result)).toEqual(
      expect.arrayContaining(["WEAK_VALIDATED_REVIEWS", "VALIDATED_RATING_CONSENSUS"])
    );
  });

  it("uses qualified recent ratings as the independent positive review measure", () => {
    const result = recommend(resultFixture({ consensusState: "unavailable" }));

    expect(result.recommendation).toBe("BUY");
    expect(reasonCodes(result)).toContain("RECENT_RATING_SUPPORTS_AGGREGATE");
    expect(result.trust.influencingDimensions).toContain("recentRating");
  });

  it("uses qualified recent ratings as the independent negative review measure", () => {
    const result = recommend(
      resultFixture({
        averageRating: 3,
        consensusState: "unavailable",
        recentAverageRating: 3.1,
        direction: "Cooling",
        score: 30,
      })
    );

    expect(result.recommendation).toBe("SKIP");
    expect(result.trust.influencingDimensions).toContain("recentRating");
  });

  it("abstains when numeric review evidence is missing", () => {
    const result = recommend(
      resultFixture({ aggregateState: "unavailable", consensusState: "unavailable", recentState: "unavailable" })
    );

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(reasonCodes(result)).toContain("MISSING_REVIEW_EVIDENCE");
  });

  it("abstains from BUY when current search timing is unavailable", () => {
    const result = recommend(resultFixture({ searchState: "unavailable" }));

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(reasonCodes(result)).toContain("MISSING_SEARCH_EVIDENCE");
  });

  it("does not let a high degraded Score create BUY", () => {
    const result = recommend(
      resultFixture({
        scoreState: "degraded",
        score: 99,
        averageRating: 3.8,
        consensusMean: 3.8,
        recentAverageRating: 3.8,
      })
    );

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(result.evidence.score.usedForDirection).toBe(false);
    expect(reasonCodes(result)).toContain("SCORE_NOT_FULLY_VERIFIED");
  });

  it("does not let a low degraded Score create SKIP", () => {
    const result = recommend(
      resultFixture({
        scoreState: "degraded",
        score: 1,
        averageRating: 3.8,
        consensusMean: 3.8,
        recentAverageRating: 3.8,
      })
    );

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(result.evidence.score.usedForDirection).toBe(false);
  });

  it("does not treat high Confidence as correctness probability or direction", () => {
    const result = recommend(
      resultFixture({ averageRating: 3.8, consensusMean: 3.8, recentAverageRating: 3.8, confidenceScore: 100 })
    );

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(result.evidence.confidence.meaning).toBe("evidence_quality_not_correctness_probability");
    expect(reasonCodes(result)).toContain("CONFIDENCE_IS_EVIDENCE_QUALITY");
  });

  it("abstains when evidence-quality Confidence is Low", () => {
    const result = recommend(resultFixture({ confidenceLevel: "Low", confidenceScore: 39 }));

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(reasonCodes(result)).toContain("LOW_EVIDENCE_QUALITY");
  });

  it("allows Developing Confidence but degrades the directional result", () => {
    const result = recommend(resultFixture({ confidenceLevel: "Developing", confidenceScore: 64 }));

    expect(result.recommendation).toBe("BUY");
    expect(result.status).toBe("degraded");
  });

  it("abstains when Confidence is unavailable", () => {
    const result = recommend(resultFixture({ confidenceState: "unavailable" }));

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(reasonCodes(result)).toContain("MISSING_CONFIDENCE_EVIDENCE");
  });

  it("abstains below the verified coverage threshold", () => {
    const result = recommend(
      resultFixture({ verifiedCoveragePercent: RECOMMENDATION_POLICY.minimumVerifiedCoveragePercent - 0.1 })
    );

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(reasonCodes(result)).toContain("LOW_EVIDENCE_COVERAGE");
  });

  it("accepts the exact verified coverage threshold", () => {
    const result = recommend(
      resultFixture({ verifiedCoveragePercent: RECOMMENDATION_POLICY.minimumVerifiedCoveragePercent })
    );

    expect(result.recommendation).toBe("BUY");
  });

  it("abstains from mock-only evidence", () => {
    const result = recommend(
      resultFixture({
        status: "partial",
        scoreState: "degraded",
        confidenceState: "degraded",
        searchState: "degraded",
        aggregateState: "degraded",
        verifiedCoveragePercent: 0,
        mockFallbackSignalCountExcluded: 20,
      })
    );

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(reasonCodes(result)).toEqual(
      expect.arrayContaining(["LOW_EVIDENCE_COVERAGE", "MOCK_FALLBACK_EVIDENCE_EXCLUDED"])
    );
  });

  it("never labels mixed live and fallback evidence as verified", () => {
    const result = recommend(
      resultFixture({ status: "partial", mockFallbackSignalCountExcluded: 2, mockFallbackComponentsExcluded: ["sentiment"] })
    );

    expect(result.recommendation).toBe("BUY");
    expect(result.status).toBe("degraded");
    expect(result.trust.mockFallbackEvidenceExcluded).toBe(true);
  });

  it("allows strong numeric review evidence when text evidence is missing", () => {
    const result = recommend(resultFixture({ status: "partial", textState: "unavailable" }));

    expect(result.recommendation).toBe("BUY");
    expect(reasonCodes(result)).toContain("MISSING_TEXT_REVIEW_EVIDENCE");
    expect(result.take.missingEvidence).toContain("reviewText");
  });

  it("never invents review themes, pros, or cons from text status", () => {
    const result = recommend(resultFixture());
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("review theme");
    expect(serialized).not.toContain("prosCons");
    expect(result.trust.excludedDimensions).toContain("reviewTextThemes");
  });

  it("abstains on a severe aggregate-versus-recent rating contradiction", () => {
    const result = recommend(resultFixture({ recentAverageRating: 2.5 }));

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(reasonCodes(result)).toEqual(
      expect.arrayContaining(["RECENT_RATING_CONTRADICTS_AGGREGATE", "CONTRADICTORY_EVIDENCE"])
    );
  });

  it("abstains when a fully verified low Score contradicts strong reviews", () => {
    const result = recommend(resultFixture({ score: RECOMMENDATION_POLICY.contradictingScore }));

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(reasonCodes(result)).toContain("SCORE_CONTRADICTS_RECOMMENDATION");
  });

  it("abstains when verified positive search contradicts weak ratings", () => {
    const result = recommend(
      resultFixture({ averageRating: 3, consensusMean: 3, recentAverageRating: 3, score: 30 })
    );

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(reasonCodes(result)).toContain("CONTRADICTORY_EVIDENCE");
  });

  it("abstains when evidence is older than seven days", () => {
    const result = recommend(resultFixture({ freshestSignalAt: "2026-08-20T00:00:00.000Z" }));

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(reasonCodes(result)).toContain("INSUFFICIENT_FRESHNESS");
  });

  it("degrades but permits evidence between 72 hours and seven days old", () => {
    const result = recommend(resultFixture({ freshestSignalAt: "2026-08-27T12:00:00.000Z" }));

    expect(result.recommendation).toBe("BUY");
    expect(result.status).toBe("degraded");
    expect(reasonCodes(result)).toContain("AGING_EVIDENCE");
  });

  it("abstains on future-dated evidence", () => {
    const result = recommend(resultFixture({ freshestSignalAt: "2026-09-02T12:00:00.000Z" }));

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(reasonCodes(result)).toContain("INSUFFICIENT_FRESHNESS");
  });

  it("fails closed for malformed input", () => {
    const result = recommend({ version: "revenue_mvp_result_v1", product: { productId: PRODUCT_ID } });

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(result.trust.boundaryStatus).toBe("malformed");
    expect(reasonCodes(result)).toContain("MALFORMED_BOUNDARY_RESULT");
  });

  it("fails closed for an invalid evaluation timestamp without reading the clock", () => {
    const result = recommend(resultFixture(), PRODUCT_ID, "not-a-timestamp");

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(result.evaluatedAt).toBeNull();
    expect(reasonCodes(result)).toContain("MALFORMED_BOUNDARY_RESULT");
  });

  it("rejects product A evidence for requested product B", () => {
    const result = recommend(resultFixture(), "fixture-product-b");

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(result.product).toEqual({
      productId: "fixture-product-b",
      title: null,
      brand: null,
      category: null,
    });
    expect(reasonCodes(result)).toContain("PRODUCT_BINDING_MISMATCH");
  });

  it("fails closed when the boundary reports its own invalid binding", () => {
    const result = recommend(resultFixture({ status: "invalid_product_binding" }));

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(reasonCodes(result)).toContain("BOUNDARY_RESULT_UNAVAILABLE");
  });

  it("does not expose provider IDs, task IDs, source domains, seller data, queries, or raw bodies", () => {
    const boundary = resultFixture() as RevenueMvpResult & Record<string, unknown>;
    boundary.providerTaskId = "must-not-leak-task-id";
    boundary.seller = "must-not-leak-seller";
    boundary.sourceDomain = "must-not-leak.example";
    boundary.rawReviewBody = "must-not-leak-review-body";
    const serialized = JSON.stringify(recommend(boundary));

    for (const forbidden of [
      "must-not-leak-task-id",
      "must-not-leak-seller",
      "must-not-leak.example",
      "must-not-leak-review-body",
      "must-not-be-exposed-query",
      "must-not-be-exposed-search-query",
      "must-not-be-exposed-provider-source",
      "must-not-be-exposed-warning",
      "must-not-be-exposed-calculation-method",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toContain("providerTaskId");
    expect(serialized).not.toContain("rawReviewBody");
  });

  it("does not allow unsupported social, commerce, price, or static copy to affect output", () => {
    const first = resultFixture() as RevenueMvpResult & Record<string, unknown>;
    const second = structuredClone(first);
    (second as Record<string, unknown>).unsupportedEvidence = {
      social: { state: "verified", value: { mentions: 1_000_000 } },
      sentiment: { state: "verified", value: { score: 100 } },
      purchaseIntent: { state: "verified", value: { score: 100 } },
      hypeSustainability: { state: "verified", value: { score: 100 } },
    };
    (second as Record<string, unknown>).commerce = {
      price: { state: "verified", value: { price: 1 } },
      commerce: { state: "verified", value: { seller: "unsafe" } },
    };
    (second as Record<string, unknown>).staticCopy = {
      trendIqTake: { state: "verified", value: "BUY NOW" },
      prosCons: { state: "verified", value: ["unsafe"] },
      tiktokRedditCopy: { state: "verified", value: "viral" },
    };

    expect(recommend(second)).toEqual(recommend(first));
  });

  it("returns reason codes in a stable policy order", () => {
    const result = recommend(
      resultFixture({
        status: "partial",
        scoreState: "degraded",
        textState: "unavailable",
        freshestSignalAt: "2026-08-27T12:00:00.000Z",
        mockFallbackSignalCountExcluded: 1,
      })
    );

    expect(reasonCodes(result)).toEqual([
      "AGING_EVIDENCE",
      "STRONG_VALIDATED_REVIEWS",
      "VALIDATED_RATING_CONSENSUS",
      "POSITIVE_SEARCH_MOMENTUM",
      "SCORE_NOT_FULLY_VERIFIED",
      "CONFIDENCE_IS_EVIDENCE_QUALITY",
      "MISSING_TEXT_REVIEW_EVIDENCE",
      "MOCK_FALLBACK_EVIDENCE_EXCLUDED",
      "UNSUPPORTED_DIMENSIONS_EXCLUDED",
    ]);
  });

  it("is deterministic for identical inputs", () => {
    const boundary = resultFixture();
    const input = { revenueMvpResult: boundary, productId: PRODUCT_ID, evaluatedAt: EVALUATED_AT };

    expect(buildRecommendationResult(input)).toEqual(buildRecommendationResult(input));
  });

  it("does not mutate the Revenue MVP boundary input", () => {
    const boundary = resultFixture();
    const before = structuredClone(boundary);

    recommend(boundary);

    expect(boundary).toEqual(before);
  });

  it("applies the strong-rating and minimum-count thresholds exactly", () => {
    const accepted = recommend(
      resultFixture({
        averageRating: RECOMMENDATION_POLICY.strongAverageRating,
        ratingEvidenceCount: RECOMMENDATION_POLICY.minimumRatingEvidenceCount,
        consensusMean: RECOMMENDATION_POLICY.strongConsensusMean,
        consensusQuality: RECOMMENDATION_POLICY.minimumConsensusQuality,
      })
    );
    const rejected = recommend(
      resultFixture({
        averageRating: RECOMMENDATION_POLICY.strongAverageRating,
        ratingEvidenceCount: RECOMMENDATION_POLICY.minimumRatingEvidenceCount - 1,
      })
    );

    expect(accepted.recommendation).toBe("BUY");
    expect(rejected.recommendation).toBe("NO_RECOMMENDATION");
  });

  it("treats non-finite and out-of-range numeric evidence as unavailable", () => {
    const boundary = resultFixture();
    if (boundary.reviews.aggregateRating.value) boundary.reviews.aggregateRating.value.averageRating = Number.NaN;
    boundary.trust.verifiedCoveragePercent = Number.POSITIVE_INFINITY;
    const result = recommend(boundary);

    expect(result.recommendation).toBe("NO_RECOMMENDATION");
    expect(result.evidence.reviews.aggregateAverageRating).toBeNull();
    expect(reasonCodes(result)).toContain("LOW_EVIDENCE_COVERAGE");
  });
});
