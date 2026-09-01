import type {
  Recommendation,
  RecommendationEvidenceDimension,
  RecommendationExcludedDimension,
  RecommendationMissingEvidence,
  RecommendationReason,
  RecommendationReasonCode,
  RecommendationReasonEffect,
  RecommendationResult,
  RecommendationResultStatus,
} from "./recommendationEngine";

export type ConsumerEvidenceStatus = "verified" | "degraded" | "unavailable";
export type ConsumerConfidenceLevel = "Low" | "Developing" | "Good" | "High";
export type ConsumerMomentumDirection = "Exploding" | "Rising" | "Stable" | "Cooling";
export type ConsumerMomentumStrength = "Low" | "Medium" | "High";
export type ConsumerMomentumEvidenceQuality = "observed" | "sparse" | "insufficient" | "missing";
export type ConsumerResultIssueCode = "CONSUMER_INPUT_MALFORMED" | "CONSUMER_PRODUCT_BINDING_MISMATCH";

export interface ConsumerProductIdentity {
  id: string;
  name: string | null;
  brand: string | null;
  category: string | null;
}

export interface ConsumerDecisionPresentation {
  recommendation: Recommendation;
  status: RecommendationResultStatus;
  headline: string;
  summary: string;
  trustMessage: string;
}

export interface ConsumerScorePresentation {
  value: number | null;
  status: ConsumerEvidenceStatus;
  liveCoveragePercent: number | null;
  usedForDecision: boolean;
  explanation: string;
}

export interface ConsumerConfidencePresentation {
  value: number | null;
  level: ConsumerConfidenceLevel | null;
  status: ConsumerEvidenceStatus;
  meaning: "evidence_quality_not_correctness_probability";
  usedForDecision: boolean;
  explanation: "Confidence reflects the quality and completeness of available evidence.";
}

export interface ConsumerMomentumPresentation {
  direction: ConsumerMomentumDirection | null;
  strength: ConsumerMomentumStrength | null;
  evidenceQuality: ConsumerMomentumEvidenceQuality | null;
  status: ConsumerEvidenceStatus;
  usedForDecision: boolean;
  explanation: string;
}

export interface ConsumerReviewsPresentation {
  status: ConsumerEvidenceStatus;
  usedForDecision: boolean;
  aggregate: {
    averageRating: number | null;
    reviewCount: number | null;
    status: ConsumerEvidenceStatus;
  };
  ratingConsensus: {
    quality: number | null;
    averageRating: number | null;
    status: ConsumerEvidenceStatus;
  };
  recentRating: {
    averageRating: number | null;
    status: ConsumerEvidenceStatus;
  };
  textEvidence: {
    status: ConsumerEvidenceStatus;
    summary: null;
    themes: [];
  };
  sampleWindow: {
    status: "unavailable";
    start: null;
    end: null;
  };
}

export interface ConsumerExplanation {
  reasons: RecommendationReason[];
  watchOuts: string[];
  missingEvidence: RecommendationMissingEvidence[];
  bestFor: {
    status: "unavailable";
    items: [];
  };
}

export interface ConsumerUnsupportedPresentation {
  reviewTextIntelligence: {
    status: "unavailable";
    pros: [];
    cons: [];
    themes: [];
    sentimentSummary: null;
  };
  socialAndHype: {
    status: "unavailable";
    tiktokSentiment: null;
    redditSentiment: null;
    socialBuzz: null;
    purchaseIntent: null;
    hypeSustainability: null;
    influencerSentiment: null;
  };
  priceAndCommerce: {
    status: "unavailable";
    price: null;
    currency: null;
    dealStatus: null;
    discountClaim: null;
    merchantRecommendations: [];
    affiliateLinks: [];
  };
}

export interface ConsumerTrustSummary {
  status: RecommendationResultStatus;
  summary: string;
  verifiedCoveragePercent: number | null;
  verifiedDimensions: string[];
  degradedDimensions: string[];
  unavailableDimensions: string[];
  influencingDimensions: RecommendationEvidenceDimension[];
  excludedDimensions: RecommendationExcludedDimension[];
  missingCriticalEvidence: RecommendationMissingEvidence[];
  freshness: {
    status: ConsumerEvidenceStatus;
    freshestSignalAt: string | null;
    ageHours: number | null;
  };
  mockFallbackEvidenceExcluded: boolean;
  redactions: {
    providerIdentifiersRedacted: true;
    taskIdentifiersRedacted: true;
    sellerIdentityRedacted: true;
    sourceDomainsRedacted: true;
    rawQueriesRedacted: true;
    rawReviewBodiesRedacted: true;
    demoCommerceRedacted: true;
  };
}

export interface ConsumerProductResult {
  version: "consumer_product_result_v1";
  source: {
    recommendationResultVersion: "recommendation_result_v1" | null;
    recommendationPolicyVersion: "recommendation_policy_v1" | null;
    evaluatedAt: string | null;
  };
  product: ConsumerProductIdentity;
  decision: ConsumerDecisionPresentation;
  score: ConsumerScorePresentation;
  confidence: ConsumerConfidencePresentation;
  momentum: ConsumerMomentumPresentation;
  reviews: ConsumerReviewsPresentation;
  explanation: ConsumerExplanation;
  trust: ConsumerTrustSummary;
  unsupported: ConsumerUnsupportedPresentation;
  issues: ConsumerResultIssueCode[];
}

export interface BuildConsumerProductResultInput {
  recommendationResult: RecommendationResult | unknown;
  productId: string;
}

const RECOMMENDATIONS = new Set<Recommendation>(["BUY", "WAIT", "SKIP", "NO_RECOMMENDATION"]);
const STATUSES = new Set<ConsumerEvidenceStatus>(["verified", "degraded", "unavailable"]);
const CONFIDENCE_LEVELS = new Set<ConsumerConfidenceLevel>(["Low", "Developing", "Good", "High"]);
const MOMENTUM_DIRECTIONS = new Set<ConsumerMomentumDirection>(["Exploding", "Rising", "Stable", "Cooling"]);
const MOMENTUM_STRENGTHS = new Set<ConsumerMomentumStrength>(["Low", "Medium", "High"]);
const MOMENTUM_EVIDENCE_QUALITIES = new Set<ConsumerMomentumEvidenceQuality>([
  "observed",
  "sparse",
  "insufficient",
  "missing",
]);
const REASON_EFFECTS = new Set<RecommendationReasonEffect>(["supporting", "caution", "blocking", "context"]);
const REASON_CODES = new Set<RecommendationReasonCode>([
  "BOUNDARY_RESULT_UNAVAILABLE",
  "MALFORMED_BOUNDARY_RESULT",
  "PRODUCT_BINDING_MISMATCH",
  "INSUFFICIENT_TRUSTWORTHY_EVIDENCE",
  "LOW_EVIDENCE_COVERAGE",
  "FRESH_EVIDENCE",
  "AGING_EVIDENCE",
  "INSUFFICIENT_FRESHNESS",
  "STRONG_VALIDATED_REVIEWS",
  "WEAK_VALIDATED_REVIEWS",
  "VALIDATED_RATING_CONSENSUS",
  "RECENT_RATING_SUPPORTS_AGGREGATE",
  "RECENT_RATING_CONTRADICTS_AGGREGATE",
  "POSITIVE_SEARCH_MOMENTUM",
  "STABLE_SUPPORTED_SEARCH_DEMAND",
  "COOLING_SEARCH_MOMENTUM",
  "DEGRADED_SEARCH_EVIDENCE",
  "WEAK_CURRENT_SEARCH_DEMAND",
  "CONTRADICTORY_EVIDENCE",
  "SCORE_SUPPORTS_RECOMMENDATION",
  "SCORE_CONTRADICTS_RECOMMENDATION",
  "SCORE_NOT_FULLY_VERIFIED",
  "CONFIDENCE_IS_EVIDENCE_QUALITY",
  "LOW_EVIDENCE_QUALITY",
  "MISSING_SEARCH_EVIDENCE",
  "MISSING_REVIEW_EVIDENCE",
  "MISSING_TEXT_REVIEW_EVIDENCE",
  "MISSING_CONFIDENCE_EVIDENCE",
  "MOCK_FALLBACK_EVIDENCE_EXCLUDED",
  "UNSUPPORTED_DIMENSIONS_EXCLUDED",
]);
const REASON_DIMENSIONS = new Set<RecommendationEvidenceDimension>([
  "boundary",
  "productBinding",
  "freshness",
  "coverage",
  "score",
  "confidence",
  "searchMomentum",
  "searchDemand",
  "reviewAggregate",
  "ratingConsensus",
  "recentRating",
  "reviewText",
  "excludedEvidence",
]);
const MISSING_EVIDENCE = new Set<RecommendationMissingEvidence>([
  "score",
  "confidence",
  "searchMomentum",
  "absoluteDemand",
  "searchDirection",
  "reviewAggregate",
  "ratingConsensus",
  "recentRating",
  "reviewText",
  "freshness",
]);
const EXCLUDED_DIMENSIONS = new Set<RecommendationExcludedDimension>([
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
]);
const TRUST_DIMENSIONS = new Set([
  "score",
  "confidence",
  "searchMomentum",
  "searchDemand",
  "searchDirection",
  "reviews",
  "reviewAggregate",
  "ratingConsensus",
  "recentRating",
  "social",
  "sentiment",
  "purchaseIntent",
  "hypeSustainability",
  "priceCommerce",
  "staticTrendIqTake",
  "staticProsCons",
  "staticSocialCopy",
]);
const BOUNDARY_STATUSES = new Set([
  "usable",
  "partial",
  "unavailable",
  "invalid_product_binding",
  "malformed_input",
  "malformed",
]);

const CONFIDENCE_EXPLANATION =
  "Confidence reflects the quality and completeness of available evidence." as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function nullableFiniteInRange(value: unknown, minimum: number, maximum: number): value is number | null {
  return value === null || finiteInRange(value, minimum, maximum);
}

function nullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function enumOrNull<T extends string>(value: unknown, allowed: ReadonlySet<T>): value is T | null {
  return value === null || (typeof value === "string" && allowed.has(value as T));
}

function enumArray<T extends string>(value: unknown, allowed: ReadonlySet<T>): value is T[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && allowed.has(item as T));
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validTimestampOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function validReason(value: unknown): value is RecommendationReason {
  return (
    isRecord(value) &&
    REASON_CODES.has(value.code as RecommendationReasonCode) &&
    REASON_EFFECTS.has(value.effect as RecommendationReasonEffect) &&
    REASON_DIMENSIONS.has(value.dimension as RecommendationEvidenceDimension) &&
    nonEmptyString(value.message)
  );
}

function validReasons(value: unknown): value is RecommendationReason[] {
  return Array.isArray(value) && value.every(validReason);
}

function validScoreEvidence(value: unknown): boolean {
  if (!isRecord(value) || !STATUSES.has(value.state as ConsumerEvidenceStatus)) return false;
  return (
    nullableFiniteInRange(value.score, 0, 100) &&
    nullableFiniteInRange(value.liveCoveragePercent, 0, 100) &&
    typeof value.usedForDirection === "boolean" &&
    (value.state === "unavailable" ? value.score === null : typeof value.score === "number")
  );
}

function validConfidenceEvidence(value: unknown): boolean {
  if (!isRecord(value) || !STATUSES.has(value.state as ConsumerEvidenceStatus)) return false;
  return (
    nullableFiniteInRange(value.score, 0, 100) &&
    enumOrNull(value.level, CONFIDENCE_LEVELS) &&
    value.meaning === "evidence_quality_not_correctness_probability" &&
    typeof value.usedForDirection === "boolean" &&
    (value.state === "unavailable" ? value.score === null && value.level === null : typeof value.score === "number" && typeof value.level === "string")
  );
}

function validMomentumEvidence(value: unknown): boolean {
  if (!isRecord(value) || !STATUSES.has(value.state as ConsumerEvidenceStatus)) return false;
  return (
    enumOrNull(value.direction, MOMENTUM_DIRECTIONS) &&
    enumOrNull(value.strength, MOMENTUM_STRENGTHS) &&
    enumOrNull(value.evidenceQuality, MOMENTUM_EVIDENCE_QUALITIES) &&
    typeof value.usedForDirection === "boolean" &&
    (value.state === "unavailable" ? value.direction === null : typeof value.direction === "string")
  );
}

function validReviewEvidence(value: unknown): boolean {
  if (!isRecord(value) || !STATUSES.has(value.state as ConsumerEvidenceStatus)) return false;
  return (
    nullableFiniteInRange(value.aggregateAverageRating, 0, 5) &&
    nullableNonNegativeInteger(value.ratingEvidenceCount) &&
    nullableFiniteInRange(value.ratingConsensusQuality, 0, 100) &&
    nullableFiniteInRange(value.ratingConsensusMean, 0, 5) &&
    nullableFiniteInRange(value.recentAverageRating, 0, 5) &&
    STATUSES.has(value.textEvidenceState as ConsumerEvidenceStatus) &&
    typeof value.usedForDirection === "boolean" &&
    (value.state === "unavailable"
      ? value.aggregateAverageRating === null && value.ratingEvidenceCount === null
      : typeof value.aggregateAverageRating === "number" && typeof value.ratingEvidenceCount === "number")
  );
}

function validFreshnessEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    STATUSES.has(value.state as ConsumerEvidenceStatus) &&
    validTimestampOrNull(value.freshestSignalAt) &&
    (value.ageHours === null || (typeof value.ageHours === "number" && Number.isFinite(value.ageHours))) &&
    typeof value.usedForDirection === "boolean" &&
    (value.state === "unavailable" || value.freshestSignalAt !== null)
  );
}

function validTrust(value: unknown): boolean {
  return (
    isRecord(value) &&
    BOUNDARY_STATUSES.has(value.boundaryStatus as string) &&
    nullableFiniteInRange(value.verifiedCoveragePercent, 0, 100) &&
    enumArray(value.verifiedDimensions, TRUST_DIMENSIONS) &&
    enumArray(value.degradedDimensions, TRUST_DIMENSIONS) &&
    enumArray(value.unavailableDimensions, TRUST_DIMENSIONS) &&
    enumArray(value.influencingDimensions, REASON_DIMENSIONS) &&
    enumArray(value.excludedDimensions, EXCLUDED_DIMENSIONS) &&
    enumArray(value.missingEvidence, MISSING_EVIDENCE) &&
    typeof value.mockFallbackEvidenceExcluded === "boolean" &&
    value.providerIdentifiersRedacted === true &&
    value.rawReviewBodiesExposed === false
  );
}

function isRecommendationResult(value: unknown): value is RecommendationResult {
  if (
    !isRecord(value) ||
    value.version !== "recommendation_result_v1" ||
    value.policyVersion !== "recommendation_policy_v1" ||
    !RECOMMENDATIONS.has(value.recommendation as Recommendation) ||
    !STATUSES.has(value.status as RecommendationResultStatus) ||
    !validTimestampOrNull(value.evaluatedAt)
  ) {
    return false;
  }

  if (
    !isRecord(value.product) ||
    !nonEmptyString(value.product.productId) ||
    !nullableString(value.product.title) ||
    !nullableString(value.product.brand) ||
    !nullableString(value.product.category)
  ) {
    return false;
  }

  if (
    !isRecord(value.take) ||
    !nonEmptyString(value.take.headline) ||
    !nonEmptyString(value.take.summary) ||
    !validReasons(value.take.reasons) ||
    !stringArray(value.take.watchOuts) ||
    !enumArray(value.take.missingEvidence, MISSING_EVIDENCE)
  ) {
    return false;
  }

  return (
    isRecord(value.evidence) &&
    validScoreEvidence(value.evidence.score) &&
    validConfidenceEvidence(value.evidence.confidence) &&
    validMomentumEvidence(value.evidence.searchMomentum) &&
    validReviewEvidence(value.evidence.reviews) &&
    validFreshnessEvidence(value.evidence.freshness) &&
    validTrust(value.trust)
  );
}

function trustMessage(status: RecommendationResultStatus): string {
  if (status === "verified") return "TrendIQ has strong current evidence for this result.";
  if (status === "degraded") return "TrendIQ has useful evidence, but some important signals are limited.";
  return "TrendIQ does not yet have enough trustworthy evidence for this result.";
}

function scoreExplanation(status: ConsumerEvidenceStatus): string {
  if (status === "verified") return "The Score is backed by fully verified evidence.";
  if (status === "degraded") return "The Score is available but is not fully verified.";
  return "A trustworthy Score is unavailable.";
}

function momentumExplanation(status: ConsumerEvidenceStatus, direction: ConsumerMomentumDirection | null): string {
  if (status === "verified" && direction) return `Current search momentum is ${direction.toLowerCase()}.`;
  if (status === "degraded") return "Search momentum is available but is not fully verified.";
  return "Current search timing is unavailable.";
}

function unsupportedPresentation(): ConsumerUnsupportedPresentation {
  return {
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
  };
}

function unavailableScore(): ConsumerScorePresentation {
  return {
    value: null,
    status: "unavailable",
    liveCoveragePercent: null,
    usedForDecision: false,
    explanation: scoreExplanation("unavailable"),
  };
}

function unavailableConfidence(): ConsumerConfidencePresentation {
  return {
    value: null,
    level: null,
    status: "unavailable",
    meaning: "evidence_quality_not_correctness_probability",
    usedForDecision: false,
    explanation: CONFIDENCE_EXPLANATION,
  };
}

function unavailableMomentum(): ConsumerMomentumPresentation {
  return {
    direction: null,
    strength: null,
    evidenceQuality: null,
    status: "unavailable",
    usedForDecision: false,
    explanation: momentumExplanation("unavailable", null),
  };
}

function unavailableReviews(): ConsumerReviewsPresentation {
  return {
    status: "unavailable",
    usedForDecision: false,
    aggregate: { averageRating: null, reviewCount: null, status: "unavailable" },
    ratingConsensus: { quality: null, averageRating: null, status: "unavailable" },
    recentRating: { averageRating: null, status: "unavailable" },
    textEvidence: { status: "unavailable", summary: null, themes: [] },
    sampleWindow: { status: "unavailable", start: null, end: null },
  };
}

function failClosed(productId: string, issue: ConsumerResultIssueCode): ConsumerProductResult {
  const missingEvidence = [...MISSING_EVIDENCE];
  return {
    version: "consumer_product_result_v1",
    source: {
      recommendationResultVersion: null,
      recommendationPolicyVersion: null,
      evaluatedAt: null,
    },
    product: { id: productId, name: null, brand: null, category: null },
    decision: {
      recommendation: "NO_RECOMMENDATION",
      status: "unavailable",
      headline: "Not enough trustworthy evidence",
      summary: "TrendIQ cannot safely present a recommendation from this input.",
      trustMessage: trustMessage("unavailable"),
    },
    score: unavailableScore(),
    confidence: unavailableConfidence(),
    momentum: unavailableMomentum(),
    reviews: unavailableReviews(),
    explanation: {
      reasons: [],
      watchOuts: [],
      missingEvidence,
      bestFor: { status: "unavailable", items: [] },
    },
    trust: {
      status: "unavailable",
      summary: trustMessage("unavailable"),
      verifiedCoveragePercent: null,
      verifiedDimensions: [],
      degradedDimensions: [],
      unavailableDimensions: [],
      influencingDimensions: [],
      excludedDimensions: [...EXCLUDED_DIMENSIONS],
      missingCriticalEvidence: missingEvidence,
      freshness: { status: "unavailable", freshestSignalAt: null, ageHours: null },
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
    unsupported: unsupportedPresentation(),
    issues: [issue],
  };
}

function dimensionStatus(result: RecommendationResult, dimension: string): ConsumerEvidenceStatus {
  if (result.trust.verifiedDimensions.some((item) => item === dimension)) return "verified";
  if (result.trust.degradedDimensions.some((item) => item === dimension)) return "degraded";
  return "unavailable";
}

function safeReviewSubstatus(
  result: RecommendationResult,
  dimension: "ratingConsensus" | "recentRating",
  hasValue: boolean
): ConsumerEvidenceStatus {
  if (!hasValue) return "unavailable";
  return dimensionStatus(result, dimension);
}

export function buildConsumerProductResult(input: BuildConsumerProductResultInput): ConsumerProductResult {
  const requestedProductId = nonEmptyString(input.productId) ? input.productId.trim() : "unknown";
  if (!nonEmptyString(input.productId) || !isRecommendationResult(input.recommendationResult)) {
    return failClosed(requestedProductId, "CONSUMER_INPUT_MALFORMED");
  }

  const result = input.recommendationResult;
  if (result.product.productId !== requestedProductId) {
    return failClosed(requestedProductId, "CONSUMER_PRODUCT_BINDING_MISMATCH");
  }

  const scoreStatus = result.evidence.score.state;
  const confidenceStatus = result.evidence.confidence.state;
  const momentumStatus = result.evidence.searchMomentum.state;
  const aggregateStatus = result.evidence.reviews.state;
  const consensusStatus = safeReviewSubstatus(
    result,
    "ratingConsensus",
    result.evidence.reviews.ratingConsensusQuality !== null && result.evidence.reviews.ratingConsensusMean !== null
  );
  const recentStatus = safeReviewSubstatus(
    result,
    "recentRating",
    result.evidence.reviews.recentAverageRating !== null
  );

  return {
    version: "consumer_product_result_v1",
    source: {
      recommendationResultVersion: result.version,
      recommendationPolicyVersion: result.policyVersion,
      evaluatedAt: result.evaluatedAt,
    },
    product: {
      id: requestedProductId,
      name: result.product.title,
      brand: result.product.brand,
      category: result.product.category,
    },
    decision: {
      recommendation: result.recommendation,
      status: result.status,
      headline: result.take.headline,
      summary: result.take.summary,
      trustMessage: trustMessage(result.status),
    },
    score: {
      value: scoreStatus === "unavailable" ? null : result.evidence.score.score,
      status: scoreStatus,
      liveCoveragePercent: result.evidence.score.liveCoveragePercent,
      usedForDecision: result.evidence.score.usedForDirection,
      explanation: scoreExplanation(scoreStatus),
    },
    confidence: {
      value: confidenceStatus === "unavailable" ? null : result.evidence.confidence.score,
      level: confidenceStatus === "unavailable" ? null : result.evidence.confidence.level,
      status: confidenceStatus,
      meaning: "evidence_quality_not_correctness_probability",
      usedForDecision: result.evidence.confidence.usedForDirection,
      explanation: CONFIDENCE_EXPLANATION,
    },
    momentum: {
      direction: momentumStatus === "unavailable" ? null : result.evidence.searchMomentum.direction,
      strength: momentumStatus === "unavailable" ? null : result.evidence.searchMomentum.strength,
      evidenceQuality: momentumStatus === "unavailable" ? null : result.evidence.searchMomentum.evidenceQuality,
      status: momentumStatus,
      usedForDecision: result.evidence.searchMomentum.usedForDirection,
      explanation: momentumExplanation(momentumStatus, result.evidence.searchMomentum.direction),
    },
    reviews: {
      status: aggregateStatus,
      usedForDecision: result.evidence.reviews.usedForDirection,
      aggregate: {
        averageRating:
          aggregateStatus === "unavailable" ? null : result.evidence.reviews.aggregateAverageRating,
        reviewCount: aggregateStatus === "unavailable" ? null : result.evidence.reviews.ratingEvidenceCount,
        status: aggregateStatus,
      },
      ratingConsensus: {
        quality: consensusStatus === "unavailable" ? null : result.evidence.reviews.ratingConsensusQuality,
        averageRating: consensusStatus === "unavailable" ? null : result.evidence.reviews.ratingConsensusMean,
        status: consensusStatus,
      },
      recentRating: {
        averageRating: recentStatus === "unavailable" ? null : result.evidence.reviews.recentAverageRating,
        status: recentStatus,
      },
      textEvidence: {
        status: result.evidence.reviews.textEvidenceState,
        summary: null,
        themes: [],
      },
      sampleWindow: { status: "unavailable", start: null, end: null },
    },
    explanation: {
      reasons: result.take.reasons.map((item) => ({ ...item })),
      watchOuts: [...result.take.watchOuts],
      missingEvidence: [...result.take.missingEvidence],
      bestFor: { status: "unavailable", items: [] },
    },
    trust: {
      status: result.status,
      summary: trustMessage(result.status),
      verifiedCoveragePercent: result.trust.verifiedCoveragePercent,
      verifiedDimensions: [...result.trust.verifiedDimensions],
      degradedDimensions: [...result.trust.degradedDimensions],
      unavailableDimensions: [...result.trust.unavailableDimensions],
      influencingDimensions: [...result.trust.influencingDimensions],
      excludedDimensions: [...result.trust.excludedDimensions],
      missingCriticalEvidence: [...result.trust.missingEvidence],
      freshness: {
        status: result.evidence.freshness.state,
        freshestSignalAt: result.evidence.freshness.freshestSignalAt,
        ageHours: result.evidence.freshness.ageHours,
      },
      mockFallbackEvidenceExcluded: result.trust.mockFallbackEvidenceExcluded,
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
    unsupported: unsupportedPresentation(),
    issues: [],
  };
}
