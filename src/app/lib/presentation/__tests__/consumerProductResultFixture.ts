import type { ConsumerEvidenceStatus, ConsumerProductResult } from "../../data/consumerResult";
import type { Recommendation, RecommendationResultStatus } from "../../data/recommendationEngine";

export interface ConsumerProductResultFixtureOptions {
  recommendation?: Recommendation;
  status?: RecommendationResultStatus;
  productId?: string;
  score?: number | null;
  scoreStatus?: ConsumerEvidenceStatus;
  confidence?: number | null;
  confidenceStatus?: ConsumerEvidenceStatus;
  momentumDirection?: "Exploding" | "Rising" | "Stable" | "Cooling" | null;
  momentumStatus?: ConsumerEvidenceStatus;
  reviewStatus?: ConsumerEvidenceStatus;
  averageRating?: number | null;
  reviewCount?: number | null;
  textEvidenceStatus?: ConsumerEvidenceStatus;
  watchOuts?: string[];
  liveCoveragePercent?: number | null;
  scoreInputIncomplete?: boolean;
  missingEvidence?: ConsumerProductResult["explanation"]["missingEvidence"];
  evaluatedAt?: string | null;
  freshnessStatus?: ConsumerEvidenceStatus;
  freshnessAgeHours?: number | null;
}

function takeFor(recommendation: Recommendation): { headline: string; summary: string } {
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

function trustCopy(status: RecommendationResultStatus): string {
  if (status === "verified") return "TrendIQ has strong current evidence for this result.";
  if (status === "degraded") return "TrendIQ has useful evidence, but some important signals are limited.";
  return "TrendIQ does not yet have enough trustworthy evidence for this result.";
}

export function createConsumerProductResultFixture(
  options: ConsumerProductResultFixtureOptions = {}
): ConsumerProductResult {
  const recommendation = options.recommendation ?? "BUY";
  const status = options.status ?? (recommendation === "NO_RECOMMENDATION" ? "unavailable" : "verified");
  const scoreStatus = options.scoreStatus ?? "verified";
  const confidenceStatus = options.confidenceStatus ?? "verified";
  const momentumStatus = options.momentumStatus ?? "verified";
  const reviewStatus = options.reviewStatus ?? "verified";
  const score = options.score === undefined ? (scoreStatus === "unavailable" ? null : 82) : options.score;
  const confidence =
    options.confidence === undefined ? (confidenceStatus === "unavailable" ? null : 90) : options.confidence;
  const momentumDirection =
    options.momentumDirection === undefined
      ? momentumStatus === "unavailable"
        ? null
        : "Rising"
      : options.momentumDirection;
  const averageRating =
    options.averageRating === undefined ? (reviewStatus === "unavailable" ? null : 4.6) : options.averageRating;
  const reviewCount =
    options.reviewCount === undefined ? (reviewStatus === "unavailable" ? null : 500) : options.reviewCount;
  const take = takeFor(recommendation);
  const watchOuts = options.watchOuts ?? [];

  return {
    version: "consumer_product_result_v1",
    source: {
      recommendationResultVersion: "recommendation_result_v1",
      recommendationPolicyVersion: "recommendation_policy_v1",
      evaluatedAt: options.evaluatedAt === undefined ? "2026-09-01T12:00:00.000Z" : options.evaluatedAt,
    },
    product: {
      id: options.productId ?? "fixture-product-a",
      name: "Synthetic Fixture Product",
      brand: "Synthetic Brand",
      category: "Synthetic Category",
    },
    decision: {
      recommendation,
      status,
      headline: take.headline,
      summary: take.summary,
      trustMessage: trustCopy(status),
    },
    score: {
      value: score,
      status: scoreStatus,
      liveCoveragePercent:
        options.liveCoveragePercent === undefined
          ? scoreStatus === "unavailable" ? null : 100
          : options.liveCoveragePercent,
      usedForDecision: scoreStatus !== "unavailable",
      explanation:
        scoreStatus === "verified"
          ? "The Score is backed by fully verified evidence."
          : scoreStatus === "degraded"
            ? "The Score is available but is not fully verified."
            : "A trustworthy Score is unavailable.",
      scoreInputIncomplete: options.scoreInputIncomplete === true,
    },
    confidence: {
      value: confidence,
      level: confidenceStatus === "unavailable" ? null : status === "degraded" ? "Developing" : "High",
      status: confidenceStatus,
      meaning: "evidence_quality_not_correctness_probability",
      usedForDecision: confidenceStatus !== "unavailable",
      explanation: "Confidence reflects the quality and completeness of available evidence.",
    },
    momentum: {
      direction: momentumDirection,
      strength: momentumStatus === "unavailable" ? null : "High",
      evidenceQuality: momentumStatus === "unavailable" ? null : "observed",
      status: momentumStatus,
      usedForDecision: momentumStatus !== "unavailable",
      explanation:
        momentumStatus === "verified" && momentumDirection
          ? `Current search momentum is ${momentumDirection.toLowerCase()}.`
          : momentumStatus === "degraded"
            ? "Search momentum is available but is not fully verified."
            : "Current search timing is unavailable.",
    },
    reviews: {
      status: reviewStatus,
      usedForDecision: reviewStatus !== "unavailable",
      aggregate: {
        averageRating,
        reviewCount,
        status: reviewStatus,
      },
      ratingConsensus: {
        quality: reviewStatus === "unavailable" ? null : 86,
        averageRating: reviewStatus === "unavailable" ? null : 4.5,
        status: reviewStatus,
      },
      recentRating: {
        averageRating: reviewStatus === "unavailable" ? null : 4.4,
        status: reviewStatus,
      },
      textEvidence: {
        status: options.textEvidenceStatus ?? "unavailable",
        summary: null,
        themes: [],
      },
      sampleWindow: { status: "unavailable", start: null, end: null },
    },
    explanation: {
      reasons: [
        {
          code: recommendation === "WAIT" ? "COOLING_SEARCH_MOMENTUM" : "STRONG_VALIDATED_REVIEWS",
          effect: recommendation === "WAIT" ? "caution" : "supporting",
          dimension: recommendation === "WAIT" ? "searchMomentum" : "reviewAggregate",
          message:
            recommendation === "WAIT"
              ? "Verified current search direction is cooling."
              : "A sufficiently large validated rating aggregate is strongly positive.",
        },
      ],
      watchOuts,
      missingEvidence:
        options.missingEvidence ?? (options.textEvidenceStatus === "verified" ? [] : ["reviewText"]),
      bestFor: { status: "unavailable", items: [] },
    },
    trust: {
      status,
      summary: trustCopy(status),
      verifiedCoveragePercent: status === "unavailable" ? null : 100,
      verifiedDimensions: status === "verified" ? ["score", "confidence", "searchMomentum", "reviewAggregate"] : [],
      degradedDimensions: status === "degraded" ? ["score", "confidence"] : [],
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
      influencingDimensions: ["confidence", "searchMomentum", "reviewAggregate"],
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
      missingCriticalEvidence: options.textEvidenceStatus === "verified" ? [] : ["reviewText"],
      freshness: {
        status: options.freshnessStatus ?? (status === "unavailable" ? "unavailable" : "verified"),
        freshestSignalAt: status === "unavailable" ? null : "2026-08-31T12:00:00.000Z",
        ageHours:
          options.freshnessAgeHours === undefined
            ? status === "unavailable" ? null : 24
            : options.freshnessAgeHours,
      },
      mockFallbackEvidenceExcluded: false,
      redactions: {
        providerIdentifiersRedacted: true,
        taskIdentifiersRedacted: true,
        sellerIdentityRedacted: true,
        sourceDomainsRedacted: true,
        rawQueriesRedacted: true,
        rawReviewBodiesRedacted: true,
        demoCommerceRedacted: true,
      },
    },
    unsupported: {
      reviewTextIntelligence: {
        status: "unavailable",
        pros: [],
        cons: [],
        themes: [],
        sentimentSummary: null,
      },
      socialAndHype: {
        status: "unavailable",
        tiktokSentiment: null,
        redditSentiment: null,
        socialBuzz: null,
        purchaseIntent: null,
        hypeSustainability: null,
        influencerSentiment: null,
      },
      priceAndCommerce: {
        status: "unavailable",
        price: null,
        currency: null,
        dealStatus: null,
        discountClaim: null,
        merchantRecommendations: [],
        affiliateLinks: [],
      },
    },
    issues: [],
  };
}
