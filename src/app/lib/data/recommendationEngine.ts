import type {
  RevenueMvpExposureState,
  RevenueMvpResult,
  RevenueMvpResultStatus,
  RevenueMvpTrustDimension,
} from "./revenueMvpResult";

export const RECOMMENDATION_POLICY = Object.freeze({
  version: "recommendation_policy_v1",
  freshnessVerifiedMaxHours: 72,
  freshnessUsableMaxHours: 168,
  minimumVerifiedCoveragePercent: 50,
  minimumRatingEvidenceCount: 50,
  strongAverageRating: 4.2,
  strongRecentRating: 4,
  strongConsensusMean: 4,
  minimumConsensusQuality: 50,
  weakAverageRating: 3.2,
  weakRecentRating: 3.2,
  weakConsensusMean: 3.2,
  supportingScore: 70,
  contradictingScore: 35,
} as const);

export type Recommendation = "BUY" | "WAIT" | "SKIP" | "NO_RECOMMENDATION";
export type RecommendationResultStatus = "verified" | "degraded" | "unavailable";
export type RecommendationReasonEffect = "supporting" | "caution" | "blocking" | "context";
export type RecommendationEvidenceDimension =
  | "boundary"
  | "productBinding"
  | "freshness"
  | "coverage"
  | "score"
  | "confidence"
  | "searchMomentum"
  | "searchDemand"
  | "reviewAggregate"
  | "ratingConsensus"
  | "recentRating"
  | "reviewText"
  | "excludedEvidence";

export type RecommendationReasonCode =
  | "BOUNDARY_RESULT_UNAVAILABLE"
  | "MALFORMED_BOUNDARY_RESULT"
  | "PRODUCT_BINDING_MISMATCH"
  | "INSUFFICIENT_TRUSTWORTHY_EVIDENCE"
  | "LOW_EVIDENCE_COVERAGE"
  | "FRESH_EVIDENCE"
  | "AGING_EVIDENCE"
  | "INSUFFICIENT_FRESHNESS"
  | "STRONG_VALIDATED_REVIEWS"
  | "WEAK_VALIDATED_REVIEWS"
  | "VALIDATED_RATING_CONSENSUS"
  | "RECENT_RATING_SUPPORTS_AGGREGATE"
  | "RECENT_RATING_CONTRADICTS_AGGREGATE"
  | "POSITIVE_SEARCH_MOMENTUM"
  | "STABLE_SUPPORTED_SEARCH_DEMAND"
  | "COOLING_SEARCH_MOMENTUM"
  | "DEGRADED_SEARCH_EVIDENCE"
  | "WEAK_CURRENT_SEARCH_DEMAND"
  | "CONTRADICTORY_EVIDENCE"
  | "SCORE_SUPPORTS_RECOMMENDATION"
  | "SCORE_CONTRADICTS_RECOMMENDATION"
  | "SCORE_NOT_FULLY_VERIFIED"
  | "CONFIDENCE_IS_EVIDENCE_QUALITY"
  | "LOW_EVIDENCE_QUALITY"
  | "MISSING_SEARCH_EVIDENCE"
  | "MISSING_REVIEW_EVIDENCE"
  | "MISSING_TEXT_REVIEW_EVIDENCE"
  | "MISSING_CONFIDENCE_EVIDENCE"
  | "MOCK_FALLBACK_EVIDENCE_EXCLUDED"
  | "UNSUPPORTED_DIMENSIONS_EXCLUDED";

export interface RecommendationReason {
  code: RecommendationReasonCode;
  effect: RecommendationReasonEffect;
  dimension: RecommendationEvidenceDimension;
  message: string;
}

export type RecommendationMissingEvidence =
  | "score"
  | "confidence"
  | "searchMomentum"
  | "absoluteDemand"
  | "searchDirection"
  | "reviewAggregate"
  | "ratingConsensus"
  | "recentRating"
  | "reviewText"
  | "freshness";

export type RecommendationExcludedDimension =
  | "social"
  | "sentiment"
  | "purchaseIntent"
  | "hypeSustainability"
  | "priceCommerce"
  | "staticTrendIqTake"
  | "staticProsCons"
  | "staticSocialCopy"
  | "reviewTextThemes"
  | "providerIdentity";

export interface RecommendationProductReference {
  productId: string;
  title: string | null;
  brand: string | null;
  category: string | null;
}

export interface RecommendationTake {
  headline: string;
  summary: string;
  reasons: RecommendationReason[];
  watchOuts: string[];
  missingEvidence: RecommendationMissingEvidence[];
}

export interface RecommendationEvidenceSummary {
  score: {
    state: RevenueMvpExposureState;
    score: number | null;
    liveCoveragePercent: number | null;
    usedForDirection: boolean;
    inputIncomplete?: boolean;
  };
  confidence: {
    state: RevenueMvpExposureState;
    score: number | null;
    level: "Low" | "Developing" | "Good" | "High" | null;
    meaning: "evidence_quality_not_correctness_probability";
    provenanceWarning: string | null;
    usedForDirection: boolean;
  };
  searchMomentum: {
    state: RevenueMvpExposureState;
    direction: "Exploding" | "Rising" | "Stable" | "Cooling" | null;
    strength: "Low" | "Medium" | "High" | null;
    evidenceQuality: "observed" | "sparse" | "insufficient" | "missing" | null;
    usedForDirection: boolean;
  };
  reviews: {
    state: RevenueMvpExposureState;
    aggregateAverageRating: number | null;
    ratingEvidenceCount: number | null;
    ratingConsensusQuality: number | null;
    ratingConsensusMean: number | null;
    recentAverageRating: number | null;
    textEvidenceState: RevenueMvpExposureState;
    usedForDirection: boolean;
  };
  freshness: {
    state: RevenueMvpExposureState;
    freshestSignalAt: string | null;
    ageHours: number | null;
    usedForDirection: boolean;
  };
}

export interface RecommendationTrustSummary {
  boundaryStatus: RevenueMvpResultStatus | "malformed";
  verifiedCoveragePercent: number | null;
  verifiedDimensions: RevenueMvpTrustDimension[];
  degradedDimensions: RevenueMvpTrustDimension[];
  unavailableDimensions: RevenueMvpTrustDimension[];
  influencingDimensions: RecommendationEvidenceDimension[];
  excludedDimensions: RecommendationExcludedDimension[];
  missingEvidence: RecommendationMissingEvidence[];
  mockFallbackEvidenceExcluded: boolean;
  providerIdentifiersRedacted: true;
  rawReviewBodiesExposed: false;
}

export interface RecommendationResult {
  version: "recommendation_result_v1";
  policyVersion: "recommendation_policy_v1";
  recommendation: Recommendation;
  status: RecommendationResultStatus;
  product: RecommendationProductReference;
  evaluatedAt: string | null;
  take: RecommendationTake;
  evidence: RecommendationEvidenceSummary;
  trust: RecommendationTrustSummary;
}

export interface BuildRecommendationResultInput {
  revenueMvpResult: RevenueMvpResult | unknown;
  productId: string;
  evaluatedAt: string;
}

const RESULT_STATUSES = new Set<RevenueMvpResultStatus>([
  "usable",
  "partial",
  "unavailable",
  "invalid_product_binding",
  "malformed_input",
]);
const EXPOSURE_STATES = new Set<RevenueMvpExposureState>(["verified", "degraded", "unavailable"]);
const CONFIDENCE_LEVELS = new Set(["Low", "Developing", "Good", "High"] as const);
const DIRECTIONS = new Set(["Exploding", "Rising", "Stable", "Cooling"] as const);
const STRENGTHS = new Set(["Low", "Medium", "High"] as const);
const EVIDENCE_QUALITIES = new Set(["observed", "sparse", "insufficient", "missing"] as const);
const TRUST_DIMENSIONS = new Set<RevenueMvpTrustDimension>([
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

const MISSING_EVIDENCE_ORDER: readonly RecommendationMissingEvidence[] = [
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
];

const INFLUENCING_DIMENSION_ORDER: readonly RecommendationEvidenceDimension[] = [
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
];

const EXCLUDED_DIMENSIONS: readonly RecommendationExcludedDimension[] = [
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
];

const REASON_CATALOG: Readonly<Record<RecommendationReasonCode, Omit<RecommendationReason, "code">>> = {
  BOUNDARY_RESULT_UNAVAILABLE: {
    effect: "blocking",
    dimension: "boundary",
    message: "The Revenue MVP boundary did not provide a usable result.",
  },
  MALFORMED_BOUNDARY_RESULT: {
    effect: "blocking",
    dimension: "boundary",
    message: "The Revenue MVP boundary result did not match its runtime contract.",
  },
  PRODUCT_BINDING_MISMATCH: {
    effect: "blocking",
    dimension: "productBinding",
    message: "The evidence belongs to a different product.",
  },
  INSUFFICIENT_TRUSTWORTHY_EVIDENCE: {
    effect: "blocking",
    dimension: "boundary",
    message: "The trustworthy evidence is insufficient for a directional recommendation.",
  },
  LOW_EVIDENCE_COVERAGE: {
    effect: "blocking",
    dimension: "coverage",
    message: "Verified evidence coverage is below the recommendation policy minimum.",
  },
  FRESH_EVIDENCE: {
    effect: "supporting",
    dimension: "freshness",
    message: "The supporting evidence is within the verified freshness window.",
  },
  AGING_EVIDENCE: {
    effect: "caution",
    dimension: "freshness",
    message: "The supporting evidence is usable but older than the verified freshness window.",
  },
  INSUFFICIENT_FRESHNESS: {
    effect: "blocking",
    dimension: "freshness",
    message: "The evidence is missing, future-dated, or older than seven days.",
  },
  STRONG_VALIDATED_REVIEWS: {
    effect: "supporting",
    dimension: "reviewAggregate",
    message: "A sufficiently large validated rating aggregate is strongly positive.",
  },
  WEAK_VALIDATED_REVIEWS: {
    effect: "supporting",
    dimension: "reviewAggregate",
    message: "A sufficiently large validated rating aggregate is weak.",
  },
  VALIDATED_RATING_CONSENSUS: {
    effect: "supporting",
    dimension: "ratingConsensus",
    message: "A qualified rating distribution independently supports the aggregate.",
  },
  RECENT_RATING_SUPPORTS_AGGREGATE: {
    effect: "supporting",
    dimension: "recentRating",
    message: "Qualified recent ratings independently support the aggregate.",
  },
  RECENT_RATING_CONTRADICTS_AGGREGATE: {
    effect: "blocking",
    dimension: "recentRating",
    message: "Qualified recent ratings materially contradict the aggregate.",
  },
  POSITIVE_SEARCH_MOMENTUM: {
    effect: "supporting",
    dimension: "searchMomentum",
    message: "Verified current search direction is rising.",
  },
  STABLE_SUPPORTED_SEARCH_DEMAND: {
    effect: "supporting",
    dimension: "searchDemand",
    message: "Verified stable search direction is supported by meaningful absolute demand.",
  },
  COOLING_SEARCH_MOMENTUM: {
    effect: "caution",
    dimension: "searchMomentum",
    message: "Verified current search direction is cooling.",
  },
  DEGRADED_SEARCH_EVIDENCE: {
    effect: "caution",
    dimension: "searchMomentum",
    message: "Search timing evidence is present but not fully verified.",
  },
  WEAK_CURRENT_SEARCH_DEMAND: {
    effect: "caution",
    dimension: "searchDemand",
    message: "Current stable search direction has weak absolute demand support.",
  },
  CONTRADICTORY_EVIDENCE: {
    effect: "blocking",
    dimension: "boundary",
    message: "Independent verified signals materially contradict one another.",
  },
  SCORE_SUPPORTS_RECOMMENDATION: {
    effect: "supporting",
    dimension: "score",
    message: "The fully verified Score supports the evidence-led direction.",
  },
  SCORE_CONTRADICTS_RECOMMENDATION: {
    effect: "blocking",
    dimension: "score",
    message: "The fully verified Score materially contradicts the evidence-led direction.",
  },
  SCORE_NOT_FULLY_VERIFIED: {
    effect: "caution",
    dimension: "score",
    message: "The Score was not fully verified and did not determine the recommendation.",
  },
  CONFIDENCE_IS_EVIDENCE_QUALITY: {
    effect: "context",
    dimension: "confidence",
    message: "Confidence measures evidence quality, not correctness probability.",
  },
  LOW_EVIDENCE_QUALITY: {
    effect: "blocking",
    dimension: "confidence",
    message: "Evidence-quality Confidence is too low for a directional recommendation.",
  },
  MISSING_SEARCH_EVIDENCE: {
    effect: "blocking",
    dimension: "searchMomentum",
    message: "Verified current search timing evidence is unavailable.",
  },
  MISSING_REVIEW_EVIDENCE: {
    effect: "blocking",
    dimension: "reviewAggregate",
    message: "Qualified independent numeric review evidence is unavailable.",
  },
  MISSING_TEXT_REVIEW_EVIDENCE: {
    effect: "caution",
    dimension: "reviewText",
    message: "Validated review text is unavailable, so no themes, pros, or cons were inferred.",
  },
  MISSING_CONFIDENCE_EVIDENCE: {
    effect: "blocking",
    dimension: "confidence",
    message: "Evidence-quality Confidence is unavailable.",
  },
  MOCK_FALLBACK_EVIDENCE_EXCLUDED: {
    effect: "caution",
    dimension: "excludedEvidence",
    message: "Mock or fallback evidence was excluded and cannot support verified status.",
  },
  UNSUPPORTED_DIMENSIONS_EXCLUDED: {
    effect: "context",
    dimension: "excludedEvidence",
    message: "Unsupported social, commerce, static copy, and provider identity data were excluded.",
  },
};

const REASON_ORDER = Object.keys(REASON_CATALOG) as RecommendationReasonCode[];

type ConfidenceLevel = "Low" | "Developing" | "Good" | "High";
type TrendDirection = "Exploding" | "Rising" | "Stable" | "Cooling";
type SearchStrength = "Low" | "Medium" | "High";
type SearchEvidenceQuality = "observed" | "sparse" | "insufficient" | "missing";

interface ExtractedEvidence {
  score: RecommendationEvidenceSummary["score"];
  confidence: RecommendationEvidenceSummary["confidence"];
  searchMomentum: RecommendationEvidenceSummary["searchMomentum"];
  reviews: RecommendationEvidenceSummary["reviews"];
  freshness: RecommendationEvidenceSummary["freshness"];
  demandState: RevenueMvpExposureState;
  demandStrength: SearchStrength | null;
  consensusState: RevenueMvpExposureState;
  recentState: RevenueMvpExposureState;
  secondaryPositiveDimension: "ratingConsensus" | "recentRating" | null;
  secondaryNegativeDimension: "ratingConsensus" | "recentRating" | null;
  aggregateStrong: boolean;
  aggregateWeak: boolean;
  consensusPositive: boolean;
  consensusNegative: boolean;
  recentPositive: boolean;
  recentNegative: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function finiteInRange(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function exposureState(value: unknown): RevenueMvpExposureState {
  if (!isRecord(value) || !EXPOSURE_STATES.has(value.state as RevenueMvpExposureState)) return "unavailable";
  return value.state as RevenueMvpExposureState;
}

function exposureValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) && isRecord(value.value) ? value.value : null;
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>): T | null {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : null;
}

function safeTrustDimensions(value: unknown): RevenueMvpTrustDimension[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is RevenueMvpTrustDimension => TRUST_DIMENSIONS.has(item as RevenueMvpTrustDimension)))].sort();
}

function isRevenueMvpResult(value: unknown): value is RevenueMvpResult {
  if (!isRecord(value) || value.version !== "revenue_mvp_result_v1") return false;
  if (!RESULT_STATUSES.has(value.status as RevenueMvpResultStatus)) return false;

  return (
    isRecord(value.product) &&
    typeof value.product.productId === "string" &&
    isRecord(value.score) &&
    isRecord(value.confidence) &&
    isRecord(value.search) &&
    isRecord(value.reviews) &&
    isRecord(value.trust)
  );
}

function recommendationProduct(productId: string, result?: RevenueMvpResult): RecommendationProductReference {
  const bound = result?.product.productId === productId;
  return {
    productId,
    title: bound ? safeString(result.product.title) : null,
    brand: bound ? safeString(result.product.brand) : null,
    category: bound ? safeString(result.product.category) : null,
  };
}

function emptyEvidence(): RecommendationEvidenceSummary {
  return {
    score: { state: "unavailable", score: null, liveCoveragePercent: null, usedForDirection: false },
    confidence: {
      state: "unavailable",
      score: null,
      level: null,
      meaning: "evidence_quality_not_correctness_probability",
      provenanceWarning: null,
      usedForDirection: false,
    },
    searchMomentum: {
      state: "unavailable",
      direction: null,
      strength: null,
      evidenceQuality: null,
      usedForDirection: false,
    },
    reviews: {
      state: "unavailable",
      aggregateAverageRating: null,
      ratingEvidenceCount: null,
      ratingConsensusQuality: null,
      ratingConsensusMean: null,
      recentAverageRating: null,
      textEvidenceState: "unavailable",
      usedForDirection: false,
    },
    freshness: { state: "unavailable", freshestSignalAt: null, ageHours: null, usedForDirection: false },
  };
}

function reason(code: RecommendationReasonCode): RecommendationReason {
  return { code, ...REASON_CATALOG[code] };
}

function orderedReasons(codes: Iterable<RecommendationReasonCode>): RecommendationReason[] {
  const unique = new Set(codes);
  return REASON_ORDER.filter((code) => unique.has(code)).map(reason);
}

function orderedMissing(values: Iterable<RecommendationMissingEvidence>): RecommendationMissingEvidence[] {
  const unique = new Set(values);
  return MISSING_EVIDENCE_ORDER.filter((value) => unique.has(value));
}

function orderedInfluencing(values: Iterable<RecommendationEvidenceDimension>): RecommendationEvidenceDimension[] {
  const unique = new Set(values);
  return INFLUENCING_DIMENSION_ORDER.filter((value) => unique.has(value));
}

function watchOuts(reasons: readonly RecommendationReason[]): string[] {
  return reasons.filter((item) => item.effect === "caution" || item.effect === "blocking").map((item) => item.message);
}

function takeCopy(
  recommendation: Recommendation,
  reasonCodes: ReadonlySet<RecommendationReasonCode>
): Pick<RecommendationTake, "headline" | "summary"> {
  if (recommendation === "BUY") {
    return {
      headline: "Current evidence supports buying",
      summary: reasonCodes.has("POSITIVE_SEARCH_MOMENTUM")
        ? "Strong validated ratings are reinforced by verified rising search demand."
        : "Strong validated ratings are reinforced by stable, meaningful search demand.",
    };
  }

  if (recommendation === "WAIT") {
    return {
      headline: "Current evidence favors waiting",
      summary: reasonCodes.has("COOLING_SEARCH_MOMENTUM")
        ? "Strong validated ratings remain, but verified search momentum is cooling."
        : "Strong validated ratings remain, but current search timing is not strong enough for BUY.",
    };
  }

  if (recommendation === "SKIP") {
    return {
      headline: "Current evidence supports skipping",
      summary: "Multiple independent validated rating measures are weak.",
    };
  }

  let summary = "The available evidence does not safely support BUY, WAIT, or SKIP.";
  if (reasonCodes.has("PRODUCT_BINDING_MISMATCH")) summary = "The supplied evidence is not bound to the requested product.";
  else if (reasonCodes.has("INSUFFICIENT_FRESHNESS")) summary = "The evidence is not recent enough for a current recommendation.";
  else if (reasonCodes.has("CONTRADICTORY_EVIDENCE")) summary = "Verified signals conflict too strongly for a safe recommendation.";
  else if (reasonCodes.has("MALFORMED_BOUNDARY_RESULT")) summary = "The evidence boundary could not be validated at runtime.";

  return { headline: "Not enough trustworthy evidence", summary };
}

function noRecommendation(input: {
  productId: string;
  evaluatedAt: string | null;
  boundaryStatus: RevenueMvpResultStatus | "malformed";
  codes: Iterable<RecommendationReasonCode>;
  missing?: Iterable<RecommendationMissingEvidence>;
  evidence?: RecommendationEvidenceSummary;
  trust?: Partial<RecommendationTrustSummary>;
  result?: RevenueMvpResult;
}): RecommendationResult {
  const codes = new Set(input.codes);
  codes.add("UNSUPPORTED_DIMENSIONS_EXCLUDED");
  const reasons = orderedReasons(codes);
  const missingEvidence = orderedMissing(input.missing ?? []);
  const copy = takeCopy("NO_RECOMMENDATION", codes);
  const resultTrust = input.result?.trust;

  return {
    version: "recommendation_result_v1",
    policyVersion: RECOMMENDATION_POLICY.version,
    recommendation: "NO_RECOMMENDATION",
    status: "unavailable",
    product: recommendationProduct(input.productId, input.result),
    evaluatedAt: input.evaluatedAt,
    take: {
      ...copy,
      reasons,
      watchOuts: watchOuts(reasons),
      missingEvidence,
    },
    evidence: input.evidence ?? emptyEvidence(),
    trust: {
      boundaryStatus: input.boundaryStatus,
      verifiedCoveragePercent: input.trust?.verifiedCoveragePercent ?? null,
      verifiedDimensions: input.trust?.verifiedDimensions ?? safeTrustDimensions(resultTrust?.verifiedDimensions),
      degradedDimensions: input.trust?.degradedDimensions ?? safeTrustDimensions(resultTrust?.degradedDimensions),
      unavailableDimensions: input.trust?.unavailableDimensions ?? safeTrustDimensions(resultTrust?.unavailableDimensions),
      influencingDimensions: orderedInfluencing(input.trust?.influencingDimensions ?? ["boundary"]),
      excludedDimensions: [...EXCLUDED_DIMENSIONS],
      missingEvidence,
      mockFallbackEvidenceExcluded: input.trust?.mockFallbackEvidenceExcluded ?? false,
      providerIdentifiersRedacted: true,
      rawReviewBodiesExposed: false,
    },
  };
}

function freshnessEvidence(result: RevenueMvpResult, evaluatedAtMs: number): RecommendationEvidenceSummary["freshness"] {
  const timestamp = safeString(result.trust.freshestSignalAt);
  if (!timestamp) return { state: "unavailable", freshestSignalAt: null, ageHours: null, usedForDirection: false };

  const signalAtMs = Date.parse(timestamp);
  if (!Number.isFinite(signalAtMs)) {
    return { state: "unavailable", freshestSignalAt: null, ageHours: null, usedForDirection: false };
  }

  const ageHours = (evaluatedAtMs - signalAtMs) / 3_600_000;
  if (ageHours < 0 || ageHours > RECOMMENDATION_POLICY.freshnessUsableMaxHours) {
    return { state: "unavailable", freshestSignalAt: timestamp, ageHours, usedForDirection: false };
  }

  return {
    state: ageHours <= RECOMMENDATION_POLICY.freshnessVerifiedMaxHours ? "verified" : "degraded",
    freshestSignalAt: timestamp,
    ageHours,
    usedForDirection: false,
  };
}

function extractEvidence(result: RevenueMvpResult, evaluatedAtMs: number): ExtractedEvidence {
  const scoreValue = exposureValue(result.score);
  const rawScoreState = exposureState(result.score);
  const score = finiteInRange(scoreValue?.score, 0, 100);
  const scoreState = score !== null ? rawScoreState : "unavailable";

  const confidenceValue = exposureValue(result.confidence);
  const rawConfidenceState = exposureState(result.confidence);
  const confidenceScore = finiteInRange(confidenceValue?.score, 0, 100);
  const confidenceLevel = enumValue(confidenceValue?.level, CONFIDENCE_LEVELS) as ConfidenceLevel | null;
  const confidenceMeaning = confidenceValue?.meaning;
  const provenanceWarning = typeof confidenceValue?.provenanceWarning === "string" && confidenceValue.provenanceWarning.trim()
    ? confidenceValue.provenanceWarning
    : null;
  const confidenceState =
    confidenceScore !== null &&
    confidenceLevel !== null &&
    confidenceMeaning === "evidence_quality_not_correctness_probability"
      ? rawConfidenceState
      : "unavailable";

  const directionalExposure = isRecord(result.search.directionalDemand) ? result.search.directionalDemand : null;
  const momentumExposure = isRecord(result.search.searchMomentum) ? result.search.searchMomentum : null;
  const preferredSearchExposure =
    exposureState(directionalExposure) !== "unavailable" && exposureValue(directionalExposure)
      ? directionalExposure
      : momentumExposure;
  const searchValue = exposureValue(preferredSearchExposure);
  const rawSearchState = exposureState(preferredSearchExposure);
  const direction = enumValue(searchValue?.direction, DIRECTIONS) as TrendDirection | null;
  const strength = enumValue(searchValue?.strength, STRENGTHS) as SearchStrength | null;
  const evidenceQuality = enumValue(searchValue?.evidenceQuality, EVIDENCE_QUALITIES) as SearchEvidenceQuality | null;
  const searchState = direction !== null ? rawSearchState : "unavailable";

  const demandValue = exposureValue(result.search.absoluteDemand);
  const rawDemandState = exposureState(result.search.absoluteDemand);
  const demandStrength = enumValue(demandValue?.strength, STRENGTHS) as SearchStrength | null;
  const demandState = demandStrength !== null ? rawDemandState : "unavailable";

  const aggregateValue = exposureValue(result.reviews.aggregateRating);
  const aggregateState = exposureState(result.reviews.aggregateRating);
  const aggregateAverage = finiteInRange(aggregateValue?.averageRating, 0, 5);
  const ratingEvidenceCount = nonNegativeInteger(aggregateValue?.ratingEvidenceCount);
  const ratingMax = aggregateValue?.ratingMax === null ? null : finiteInRange(aggregateValue?.ratingMax, 5, 5);
  const aggregateValid =
    aggregateState === "verified" &&
    aggregateAverage !== null &&
    ratingEvidenceCount !== null &&
    (aggregateValue?.ratingMax === null || ratingMax === 5);

  const consensusValue = exposureValue(result.reviews.ratingConsensus);
  const rawConsensusState = exposureState(result.reviews.ratingConsensus);
  const consensusQuality = finiteInRange(consensusValue?.ratingConsensusQuality, 0, 100);
  const consensusMean = finiteInRange(consensusValue?.mean, 0, 5);
  const consensusState = consensusQuality !== null && consensusMean !== null ? rawConsensusState : "unavailable";

  const recentValue = exposureValue(result.reviews.recentRating);
  const rawRecentState = exposureState(result.reviews.recentRating);
  const recentAverage = finiteInRange(recentValue?.recentAverageRating, 0, 5);
  const recentState = recentAverage !== null ? rawRecentState : "unavailable";

  const aggregateStrong =
    aggregateValid &&
    aggregateAverage >= RECOMMENDATION_POLICY.strongAverageRating &&
    ratingEvidenceCount >= RECOMMENDATION_POLICY.minimumRatingEvidenceCount;
  const aggregateWeak =
    aggregateValid &&
    aggregateAverage <= RECOMMENDATION_POLICY.weakAverageRating &&
    ratingEvidenceCount >= RECOMMENDATION_POLICY.minimumRatingEvidenceCount;
  const consensusQualified =
    consensusState === "verified" && consensusQuality >= RECOMMENDATION_POLICY.minimumConsensusQuality;
  const consensusPositive = consensusQualified && consensusMean >= RECOMMENDATION_POLICY.strongConsensusMean;
  const consensusNegative = consensusQualified && consensusMean <= RECOMMENDATION_POLICY.weakConsensusMean;
  const recentPositive = recentState === "verified" && recentAverage >= RECOMMENDATION_POLICY.strongRecentRating;
  const recentNegative = recentState === "verified" && recentAverage <= RECOMMENDATION_POLICY.weakRecentRating;

  return {
    score: {
      state: scoreState,
      score,
      liveCoveragePercent: finiteInRange(result.score.liveCoveragePercent, 0, 100),
      usedForDirection: false,
      inputIncomplete:
        Array.isArray(result.score.reasons) && result.score.reasons.includes("score_input_is_incomplete"),
    },
    confidence: {
      state: confidenceState,
      score: confidenceScore,
      level: confidenceLevel,
      meaning: "evidence_quality_not_correctness_probability",
      provenanceWarning,
      usedForDirection: false,
    },
    searchMomentum: {
      state: searchState,
      direction,
      strength,
      evidenceQuality,
      usedForDirection: false,
    },
    reviews: {
      state: aggregateValid ? aggregateState : "unavailable",
      aggregateAverageRating: aggregateValid ? aggregateAverage : null,
      ratingEvidenceCount: aggregateValid ? ratingEvidenceCount : null,
      ratingConsensusQuality: consensusState === "unavailable" ? null : consensusQuality,
      ratingConsensusMean: consensusState === "unavailable" ? null : consensusMean,
      recentAverageRating: recentState === "unavailable" ? null : recentAverage,
      textEvidenceState: exposureState(result.reviews.textEvidence),
      usedForDirection: false,
    },
    freshness: freshnessEvidence(result, evaluatedAtMs),
    demandState,
    demandStrength,
    consensusState,
    recentState,
    secondaryPositiveDimension: consensusPositive ? "ratingConsensus" : recentPositive ? "recentRating" : null,
    secondaryNegativeDimension: consensusNegative ? "ratingConsensus" : recentNegative ? "recentRating" : null,
    aggregateStrong,
    aggregateWeak,
    consensusPositive,
    consensusNegative,
    recentPositive,
    recentNegative,
  };
}

function setEvidenceUsage(
  evidence: ExtractedEvidence,
  recommendation: Recommendation,
  reviewSecondary: "ratingConsensus" | "recentRating" | null,
  searchUsed: boolean,
  scoreUsed: boolean
): RecommendationEvidenceSummary {
  return {
    score: { ...evidence.score, usedForDirection: scoreUsed },
    confidence: { ...evidence.confidence, usedForDirection: recommendation !== "NO_RECOMMENDATION" },
    searchMomentum: { ...evidence.searchMomentum, usedForDirection: searchUsed },
    reviews: { ...evidence.reviews, usedForDirection: recommendation !== "NO_RECOMMENDATION" && reviewSecondary !== null },
    freshness: { ...evidence.freshness, usedForDirection: recommendation !== "NO_RECOMMENDATION" },
  };
}

function missingEvidence(evidence: ExtractedEvidence): RecommendationMissingEvidence[] {
  const missing = new Set<RecommendationMissingEvidence>();
  if (evidence.score.state === "unavailable") missing.add("score");
  if (evidence.confidence.state === "unavailable") missing.add("confidence");
  if (evidence.searchMomentum.state === "unavailable") {
    missing.add("searchMomentum");
    missing.add("searchDirection");
  }
  if (evidence.demandState === "unavailable") missing.add("absoluteDemand");
  if (evidence.reviews.state === "unavailable") missing.add("reviewAggregate");
  if (evidence.consensusState === "unavailable") missing.add("ratingConsensus");
  if (evidence.recentState === "unavailable") missing.add("recentRating");
  if (evidence.reviews.textEvidenceState === "unavailable") missing.add("reviewText");
  if (evidence.freshness.state === "unavailable") missing.add("freshness");
  return orderedMissing(missing);
}

function recommendationStatus(input: {
  result: RevenueMvpResult;
  evidence: ExtractedEvidence;
  recommendation: Exclude<Recommendation, "NO_RECOMMENDATION">;
  mockFallbackEvidenceExcluded: boolean;
  searchUsed: boolean;
}): RecommendationResultStatus {
  if (
    input.result.status !== "usable" ||
    input.evidence.freshness.state !== "verified" ||
    input.evidence.confidence.state !== "verified" ||
    input.evidence.confidence.level === "Developing" ||
    input.mockFallbackEvidenceExcluded ||
    (input.searchUsed && input.evidence.searchMomentum.state !== "verified")
  ) {
    return "degraded";
  }

  return "verified";
}

export function buildRecommendationResult(input: BuildRecommendationResultInput): RecommendationResult {
  const expectedProductId = safeString(input.productId) ?? "unknown";
  const evaluatedAtMs = Date.parse(input.evaluatedAt);
  const evaluatedAt = Number.isFinite(evaluatedAtMs) ? new Date(evaluatedAtMs).toISOString() : null;

  if (!Number.isFinite(evaluatedAtMs) || !isRevenueMvpResult(input.revenueMvpResult)) {
    return noRecommendation({
      productId: expectedProductId,
      evaluatedAt,
      boundaryStatus: "malformed",
      codes: ["MALFORMED_BOUNDARY_RESULT"],
      missing: MISSING_EVIDENCE_ORDER,
    });
  }

  const result = input.revenueMvpResult;
  if (result.product.productId !== expectedProductId) {
    return noRecommendation({
      productId: expectedProductId,
      evaluatedAt,
      boundaryStatus: result.status,
      codes: ["PRODUCT_BINDING_MISMATCH"],
      missing: [],
      result,
      trust: { influencingDimensions: ["productBinding"] },
    });
  }

  if (result.status === "unavailable" || result.status === "invalid_product_binding" || result.status === "malformed_input") {
    return noRecommendation({
      productId: expectedProductId,
      evaluatedAt,
      boundaryStatus: result.status,
      codes: ["BOUNDARY_RESULT_UNAVAILABLE"],
      missing: MISSING_EVIDENCE_ORDER,
      result,
    });
  }

  try {
    const extracted = extractEvidence(result, evaluatedAtMs);
    const missing = missingEvidence(extracted);
    const reasonCodes = new Set<RecommendationReasonCode>([
      "CONFIDENCE_IS_EVIDENCE_QUALITY",
      "UNSUPPORTED_DIMENSIONS_EXCLUDED",
    ]);
    const influencing = new Set<RecommendationEvidenceDimension>(["boundary", "productBinding"]);
    const verifiedCoveragePercent = finiteInRange(result.trust.verifiedCoveragePercent, 0, 100);
    const mockFallbackEvidenceExcluded =
      (nonNegativeInteger(result.trust.mockFallbackSignalCountExcluded) ?? 0) > 0 ||
      (Array.isArray(result.trust.mockFallbackComponentsExcluded) && result.trust.mockFallbackComponentsExcluded.length > 0);

    if (extracted.reviews.textEvidenceState === "unavailable") reasonCodes.add("MISSING_TEXT_REVIEW_EVIDENCE");
    if (extracted.score.state === "degraded") reasonCodes.add("SCORE_NOT_FULLY_VERIFIED");
    if (mockFallbackEvidenceExcluded) reasonCodes.add("MOCK_FALLBACK_EVIDENCE_EXCLUDED");

    if (verifiedCoveragePercent === null || verifiedCoveragePercent < RECOMMENDATION_POLICY.minimumVerifiedCoveragePercent) {
      reasonCodes.add("LOW_EVIDENCE_COVERAGE");
      influencing.add("coverage");
      return noRecommendation({
        productId: expectedProductId,
        evaluatedAt,
        boundaryStatus: result.status,
        codes: reasonCodes,
        missing,
        evidence: setEvidenceUsage(extracted, "NO_RECOMMENDATION", null, false, false),
        result,
        trust: { verifiedCoveragePercent, influencingDimensions: influencing, mockFallbackEvidenceExcluded },
      });
    }

    influencing.add("freshness");
    if (extracted.freshness.state === "unavailable") {
      reasonCodes.add("INSUFFICIENT_FRESHNESS");
      return noRecommendation({
        productId: expectedProductId,
        evaluatedAt,
        boundaryStatus: result.status,
        codes: reasonCodes,
        missing,
        evidence: setEvidenceUsage(extracted, "NO_RECOMMENDATION", null, false, false),
        result,
        trust: { verifiedCoveragePercent, influencingDimensions: influencing, mockFallbackEvidenceExcluded },
      });
    }
    reasonCodes.add(extracted.freshness.state === "verified" ? "FRESH_EVIDENCE" : "AGING_EVIDENCE");

    influencing.add("confidence");
    if (extracted.confidence.state === "unavailable") {
      reasonCodes.add("MISSING_CONFIDENCE_EVIDENCE");
      return noRecommendation({
        productId: expectedProductId,
        evaluatedAt,
        boundaryStatus: result.status,
        codes: reasonCodes,
        missing,
        evidence: setEvidenceUsage(extracted, "NO_RECOMMENDATION", null, false, false),
        result,
        trust: { verifiedCoveragePercent, influencingDimensions: influencing, mockFallbackEvidenceExcluded },
      });
    }
    if (extracted.confidence.level === "Low") {
      reasonCodes.add("LOW_EVIDENCE_QUALITY");
      return noRecommendation({
        productId: expectedProductId,
        evaluatedAt,
        boundaryStatus: result.status,
        codes: reasonCodes,
        missing,
        evidence: setEvidenceUsage(extracted, "NO_RECOMMENDATION", null, false, false),
        result,
        trust: { verifiedCoveragePercent, influencingDimensions: influencing, mockFallbackEvidenceExcluded },
      });
    }

    const qualifiedStrongReviews = extracted.aggregateStrong && extracted.secondaryPositiveDimension !== null;
    const qualifiedWeakReviews = extracted.aggregateWeak && extracted.secondaryNegativeDimension !== null;
    const aggregateSecondaryContradiction =
      (extracted.aggregateStrong && (extracted.consensusNegative || extracted.recentNegative)) ||
      (extracted.aggregateWeak && (extracted.consensusPositive || extracted.recentPositive));
    const positiveSearch =
      extracted.searchMomentum.state === "verified" &&
      (extracted.searchMomentum.direction === "Rising" || extracted.searchMomentum.direction === "Exploding");
    const stableSupportedSearch =
      extracted.searchMomentum.state === "verified" &&
      extracted.searchMomentum.direction === "Stable" &&
      extracted.demandState === "verified" &&
      (extracted.demandStrength === "Medium" || extracted.demandStrength === "High");
    const coolingSearch =
      extracted.searchMomentum.state === "verified" && extracted.searchMomentum.direction === "Cooling";
    const verifiedScore = extracted.score.state === "verified" ? extracted.score.score : null;
    const scoreContradiction =
      (qualifiedStrongReviews && verifiedScore !== null && verifiedScore <= RECOMMENDATION_POLICY.contradictingScore) ||
      (qualifiedWeakReviews && verifiedScore !== null && verifiedScore >= RECOMMENDATION_POLICY.supportingScore);
    const searchReviewContradiction = qualifiedWeakReviews && positiveSearch;

    if (aggregateSecondaryContradiction || scoreContradiction || searchReviewContradiction) {
      reasonCodes.add("CONTRADICTORY_EVIDENCE");
      if (extracted.aggregateStrong && extracted.recentNegative) reasonCodes.add("RECENT_RATING_CONTRADICTS_AGGREGATE");
      if (scoreContradiction) reasonCodes.add("SCORE_CONTRADICTS_RECOMMENDATION");
      influencing.add("reviewAggregate");
      if (extracted.recentNegative || extracted.recentPositive) influencing.add("recentRating");
      if (extracted.consensusNegative || extracted.consensusPositive) influencing.add("ratingConsensus");
      if (scoreContradiction) influencing.add("score");
      if (searchReviewContradiction) influencing.add("searchMomentum");
      return noRecommendation({
        productId: expectedProductId,
        evaluatedAt,
        boundaryStatus: result.status,
        codes: reasonCodes,
        missing,
        evidence: setEvidenceUsage(extracted, "NO_RECOMMENDATION", null, false, false),
        result,
        trust: { verifiedCoveragePercent, influencingDimensions: influencing, mockFallbackEvidenceExcluded },
      });
    }

    let recommendation: Recommendation = "NO_RECOMMENDATION";
    let reviewSecondary: "ratingConsensus" | "recentRating" | null = null;
    let searchUsed = false;
    if (qualifiedStrongReviews) {
      recommendation = positiveSearch || stableSupportedSearch ? "BUY" : "WAIT";
      reviewSecondary = extracted.secondaryPositiveDimension;
      searchUsed = true;
      reasonCodes.add("STRONG_VALIDATED_REVIEWS");
      reasonCodes.add(
        reviewSecondary === "ratingConsensus" ? "VALIDATED_RATING_CONSENSUS" : "RECENT_RATING_SUPPORTS_AGGREGATE"
      );
      if (positiveSearch) reasonCodes.add("POSITIVE_SEARCH_MOMENTUM");
      else if (stableSupportedSearch) reasonCodes.add("STABLE_SUPPORTED_SEARCH_DEMAND");
      else if (coolingSearch) reasonCodes.add("COOLING_SEARCH_MOMENTUM");
      else if (extracted.searchMomentum.state === "degraded") reasonCodes.add("DEGRADED_SEARCH_EVIDENCE");
      else if (extracted.searchMomentum.state === "verified" && extracted.searchMomentum.direction === "Stable") {
        reasonCodes.add("WEAK_CURRENT_SEARCH_DEMAND");
      } else {
        recommendation = "NO_RECOMMENDATION";
        reasonCodes.add("MISSING_SEARCH_EVIDENCE");
      }
    } else if (qualifiedWeakReviews) {
      recommendation = "SKIP";
      reviewSecondary = extracted.secondaryNegativeDimension;
      reasonCodes.add("WEAK_VALIDATED_REVIEWS");
      reasonCodes.add(
        reviewSecondary === "ratingConsensus" ? "VALIDATED_RATING_CONSENSUS" : "RECENT_RATING_SUPPORTS_AGGREGATE"
      );
    } else {
      reasonCodes.add("MISSING_REVIEW_EVIDENCE");
    }

    if (recommendation === "NO_RECOMMENDATION") {
      reasonCodes.add("INSUFFICIENT_TRUSTWORTHY_EVIDENCE");
      influencing.add("reviewAggregate");
      if (searchUsed) influencing.add("searchMomentum");
      return noRecommendation({
        productId: expectedProductId,
        evaluatedAt,
        boundaryStatus: result.status,
        codes: reasonCodes,
        missing,
        evidence: setEvidenceUsage(extracted, recommendation, reviewSecondary, searchUsed, false),
        result,
        trust: { verifiedCoveragePercent, influencingDimensions: influencing, mockFallbackEvidenceExcluded },
      });
    }

    influencing.add("reviewAggregate");
    if (reviewSecondary) influencing.add(reviewSecondary);
    if (searchUsed) influencing.add("searchMomentum");

    let scoreUsed = false;
    if (verifiedScore !== null) {
      const scoreSupports =
        (recommendation === "BUY" && verifiedScore >= RECOMMENDATION_POLICY.supportingScore) ||
        (recommendation === "SKIP" && verifiedScore <= RECOMMENDATION_POLICY.contradictingScore);
      if (scoreSupports) {
        scoreUsed = true;
        influencing.add("score");
        reasonCodes.add("SCORE_SUPPORTS_RECOMMENDATION");
      }
    }

    const reasons = orderedReasons(reasonCodes);
    const copy = takeCopy(recommendation, reasonCodes);
    const directionalRecommendation = recommendation as Exclude<Recommendation, "NO_RECOMMENDATION">;
    const status = recommendationStatus({
      result,
      evidence: extracted,
      recommendation: directionalRecommendation,
      mockFallbackEvidenceExcluded,
      searchUsed,
    });

    return {
      version: "recommendation_result_v1",
      policyVersion: RECOMMENDATION_POLICY.version,
      recommendation: directionalRecommendation,
      status,
      product: recommendationProduct(expectedProductId, result),
      evaluatedAt,
      take: {
        ...copy,
        reasons,
        watchOuts: watchOuts(reasons),
        missingEvidence: missing,
      },
      evidence: setEvidenceUsage(extracted, directionalRecommendation, reviewSecondary, searchUsed, scoreUsed),
      trust: {
        boundaryStatus: result.status,
        verifiedCoveragePercent,
        verifiedDimensions: safeTrustDimensions(result.trust.verifiedDimensions),
        degradedDimensions: safeTrustDimensions(result.trust.degradedDimensions),
        unavailableDimensions: safeTrustDimensions(result.trust.unavailableDimensions),
        influencingDimensions: orderedInfluencing(influencing),
        excludedDimensions: [...EXCLUDED_DIMENSIONS],
        missingEvidence: missing,
        mockFallbackEvidenceExcluded,
        providerIdentifiersRedacted: true,
        rawReviewBodiesExposed: false,
      },
    };
  } catch {
    return noRecommendation({
      productId: expectedProductId,
      evaluatedAt,
      boundaryStatus: "malformed",
      codes: ["MALFORMED_BOUNDARY_RESULT"],
      missing: MISSING_EVIDENCE_ORDER,
    });
  }
}
