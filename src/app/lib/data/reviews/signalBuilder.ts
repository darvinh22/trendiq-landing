import { normalizeLinear, normalizeLogScale, roundTo } from "../../scoring/normalization";
import type { NormalizedTrendSignal } from "../types";
import type {
  GoogleShoppingRecentReviewsObservation,
  GoogleShoppingReviewObservation,
  NormalizedDegradedReviewEvidence,
  NormalizedRatingGroupEvidence,
  NormalizedReviewCostProvenance,
  NormalizedReviewDistributionEvidence,
  NormalizedTextReviewEvidence,
  NormalizedValidatedReviewEvidence,
  NormalizedReviewsValidatedEvidence,
  RatingConsensusQualityStatus,
  RatingDistributionScope,
  RatingDistributionSource,
  RecentAverageRatingStatus,
  ReviewDistributionEvidenceStatus,
  ReviewSignalBuildResult,
  ValidatedDetailedReviewEvidenceStatus,
} from "./types";

const REVIEW_AVERAGE_RATING_CONFIDENCE = 92;
const REVIEW_RATING_EVIDENCE_CONFIDENCE = 91;
const REVIEW_RECENT_AVERAGE_RATING_CONFIDENCE = 89;
const REVIEW_RATING_CONSENSUS_QUALITY_CONFIDENCE = 87;

function optionalString(value: string | undefined): string | undefined {
  return value && value.length ? value : undefined;
}

function finiteNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length ? value.trim() : undefined;
}

function validatedDetailedReviewStatus(value: unknown): ValidatedDetailedReviewEvidenceStatus | undefined {
  if (
    value === "reviews_validated" ||
    value === "identity_inconclusive" ||
    value === "provider_pending" ||
    value === "provider_no_result" ||
    value === "provider_error" ||
    value === "malformed_response"
  ) {
    return value;
  }

  return undefined;
}

function recentAverageRatingStatus(value: unknown): RecentAverageRatingStatus | undefined {
  if (value === "derived-live" || value === "provisional" || value === "insufficient") {
    return value;
  }

  return undefined;
}

function ratingConsensusQualityStatus(value: unknown): RatingConsensusQualityStatus | undefined {
  if (
    value === "derived-live" ||
    value === "provisional" ||
    value === "insufficient" ||
    value === "mismatch"
  ) {
    return value;
  }

  return undefined;
}

function ratingDistributionSource(value: unknown): RatingDistributionSource | null {
  return value === "provider_rating_groups" || value === "review_items" ? value : null;
}

function ratingDistributionScope(value: unknown): RatingDistributionScope | null {
  return value === "full_provider_distribution" || value === "fetched_review_sample" ? value : null;
}

function reviewProviderVendor(value: unknown): GoogleShoppingRecentReviewsObservation["provider"] | undefined {
  return value === "dataforseo" ? value : undefined;
}

function normalizedReviewCount(value: unknown): number {
  const count = finiteNonNegativeNumber(value);
  return count === null ? 0 : Math.round(count);
}

function normalizedSourceDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return [...new Set(value.map(nonEmptyString).filter((domain): domain is string => Boolean(domain)))].sort();
}

function validatedObservationIssue(
  observation: GoogleShoppingRecentReviewsObservation | undefined,
  canonicalProductId: string
): {
  status: Exclude<ValidatedDetailedReviewEvidenceStatus, "reviews_validated">;
  reason: string;
  provider?: GoogleShoppingRecentReviewsObservation["provider"];
  observedAt?: string;
} | undefined {
  if (!canonicalProductId) {
    return {
      status: "malformed_response",
      reason: "missing_canonical_product_id",
    };
  }

  if (!observation || typeof observation !== "object") {
    return {
      status: "malformed_response",
      reason: "missing_validated_review_observation",
    };
  }

  const observedProductId = nonEmptyString(observation.productId);
  const provider = reviewProviderVendor(observation.provider);
  const observedAt = nonEmptyString(observation.fetchedAt);

  if (!observedProductId) {
    return {
      status: "malformed_response",
      reason: "missing_observation_product_id",
      provider,
      observedAt,
    };
  }

  if (observedProductId !== canonicalProductId) {
    return {
      status: "identity_inconclusive",
      reason: "canonical_product_id_mismatch",
      provider,
      observedAt,
    };
  }

  if (!provider) {
    return {
      status: "malformed_response",
      reason: "malformed_recent_review_provider",
      observedAt,
    };
  }

  if (!recentAverageRatingStatus(observation.status)) {
    return {
      status: "malformed_response",
      reason: "malformed_recent_review_status",
      provider,
      observedAt,
    };
  }

  if (!Array.isArray(observation.sourceDomains)) {
    return {
      status: "malformed_response",
      reason: "malformed_recent_review_source_domains",
      provider,
      observedAt,
    };
  }

  return undefined;
}

function emptyDistributionEvidence(): NormalizedReviewDistributionEvidence {
  return {
    status: "unavailable",
    reviewsCount: null,
    ratingGroups: [],
    ratingConsensusStatus: null,
    ratingConsensusQuality: null,
    provisionalRatingConsensusQuality: null,
    distributionSource: null,
    distributionScope: null,
    distributionComposition: null,
  };
}

function emptyTextEvidence(): NormalizedTextReviewEvidence {
  return {
    status: "unavailable",
    fetchedReviewCount: 0,
    qualifyingReviewCount: 0,
    recentAverageRating: null,
    provisionalRecentAverageRating: null,
    sourceDomains: [],
    sampleScope: "none",
    windowStart: null,
    windowEnd: null,
    windowDays: null,
    calculationMethod: null,
    datePrecision: null,
  };
}

function normalizedCost(input: {
  taskCost?: unknown;
  observationCost?: unknown;
  observation?: GoogleShoppingRecentReviewsObservation;
}): NormalizedReviewCostProvenance {
  const taskCost = finiteNonNegativeNumber(input.taskCost);
  const observationCostSource = input.observationCost === null
    ? null
    : input.observationCost ?? input.observation?.cost;
  const observationCost = finiteNonNegativeNumber(observationCostSource);

  return {
    taskCost,
    observationCost,
    sourceCostCompatibleValue: taskCost,
  };
}

function degradedEvidence(input: {
  canonicalProductId: string;
  status: Exclude<ValidatedDetailedReviewEvidenceStatus, "reviews_validated">;
  provider?: GoogleShoppingRecentReviewsObservation["provider"];
  providerEvidenceMode?: NormalizedValidatedReviewEvidence["providerEvidenceMode"];
  observedAt?: unknown;
  reason?: string;
  taskCost?: unknown;
  observationCost?: unknown;
}): NormalizedDegradedReviewEvidence {
  return {
    canonicalProductId: input.canonicalProductId,
    status: input.status,
    validationStatus: input.status,
    provider: input.provider ?? "dataforseo",
    providerEvidenceMode: input.providerEvidenceMode ?? "live",
    reviewRetrievalStatus: input.status,
    totalReviewsAvailable: null,
    fetchedReviewCount: 0,
    qualifyingReviewCount: 0,
    sourceDomains: [],
    observedAt: nonEmptyString(input.observedAt) ?? null,
    cost: normalizedCost({
      taskCost: input.taskCost,
      observationCost: input.observationCost,
    }),
    distributionEvidence: emptyDistributionEvidence(),
    textEvidence: emptyTextEvidence(),
    distributionEvidenceStatus: "unavailable",
    textEvidenceStatus: "unavailable",
    recentAverageRating: null,
    ratingConsensusStatus: null,
    ratingConsensusQuality: null,
    distributionSource: null,
    distributionScope: null,
    textSampleScope: "none",
    reason: input.reason,
  };
}

function distributionStatus(
  consensus: GoogleShoppingRecentReviewsObservation["ratingConsensus"],
  input: {
    reviewsCount: number | null;
    ratingGroups: NormalizedRatingGroupEvidence[];
    distributionSource: RatingDistributionSource | null;
    distributionScope: RatingDistributionScope | null;
  }
): ReviewDistributionEvidenceStatus {
  if (!consensus) return "unavailable";
  const status = ratingConsensusQualityStatus(consensus.status);
  if (!status) return "unavailable";
  if (
    status === "derived-live" &&
    finiteNonNegativeNumber(consensus.ratingConsensusQuality) !== null &&
    input.reviewsCount !== null &&
    input.ratingGroups.length === 5 &&
    input.distributionSource !== null &&
    input.distributionScope !== null
  ) {
    return "usable";
  }
  if (status === "derived-live") return "unavailable";

  return status;
}

function ratingGroupsForConsensus(
  consensus: GoogleShoppingRecentReviewsObservation["ratingConsensus"]
): NormalizedRatingGroupEvidence[] {
  if (!consensus) return [];
  const counts = [
    finiteNonNegativeNumber(consensus.star1Count),
    finiteNonNegativeNumber(consensus.star2Count),
    finiteNonNegativeNumber(consensus.star3Count),
    finiteNonNegativeNumber(consensus.star4Count),
    finiteNonNegativeNumber(consensus.star5Count),
  ];
  if (!counts.every((count): count is number => count !== null)) return [];

  return [
    { star: 1, count: counts[0] },
    { star: 2, count: counts[1] },
    { star: 3, count: counts[2] },
    { star: 4, count: counts[3] },
    { star: 5, count: counts[4] },
  ];
}

function distributionEvidence(
  observation: GoogleShoppingRecentReviewsObservation
): NormalizedReviewDistributionEvidence {
  const consensus = observation.ratingConsensus;

  if (!consensus) return emptyDistributionEvidence();
  const reviewsCount = finiteNonNegativeNumber(consensus.totalDistributionCount);
  const ratingGroups = ratingGroupsForConsensus(consensus);
  const distributionSource = ratingDistributionSource(consensus.distributionSource);
  const distributionScope = ratingDistributionScope(consensus.distributionScope);
  const ratingConsensusStatus = ratingConsensusQualityStatus(consensus.status);
  const status = distributionStatus(consensus, {
    reviewsCount,
    ratingGroups,
    distributionSource,
    distributionScope,
  });
  const ratingConsensusQuality = finiteNonNegativeNumber(consensus.ratingConsensusQuality);

  return {
    status,
    reviewsCount,
    ratingGroups,
    ratingConsensusStatus: ratingConsensusStatus ?? null,
    ratingConsensusQuality: status === "usable" ? ratingConsensusQuality : null,
    provisionalRatingConsensusQuality: finiteNonNegativeNumber(consensus.provisionalRatingConsensusQuality),
    distributionSource,
    distributionScope,
    distributionComposition: nonEmptyString(consensus.distributionComposition) ?? null,
  };
}

function textEvidence(
  observation: GoogleShoppingRecentReviewsObservation
): NormalizedTextReviewEvidence {
  return {
    status: recentAverageRatingStatus(observation.status) ?? "insufficient",
    fetchedReviewCount: normalizedReviewCount(observation.totalReviewsFetched),
    qualifyingReviewCount: normalizedReviewCount(observation.qualifyingReviewCount),
    recentAverageRating: finiteNonNegativeNumber(observation.recentAverageRating),
    provisionalRecentAverageRating: finiteNonNegativeNumber(observation.provisionalRecentAverageRating),
    sourceDomains: normalizedSourceDomains(observation.sourceDomains),
    sampleScope: "trailing_window_dated_reviews",
    windowStart: nonEmptyString(observation.windowStart) ?? null,
    windowEnd: nonEmptyString(observation.windowEnd) ?? null,
    windowDays: finiteNonNegativeNumber(observation.windowDays),
    calculationMethod: nonEmptyString(observation.calculationMethod) ?? null,
    datePrecision: nonEmptyString(observation.datePrecision) ?? null,
  };
}

export function normalizeValidatedDetailedReviewEvidence(input: {
  canonicalProductId: string;
  status: ValidatedDetailedReviewEvidenceStatus | string;
  recentReviews?: GoogleShoppingRecentReviewsObservation;
  providerEvidenceMode?: NormalizedValidatedReviewEvidence["providerEvidenceMode"];
  observedAt?: string;
  reason?: string;
  taskCost?: number | null;
  observationCost?: number | null;
}): NormalizedValidatedReviewEvidence {
  const canonicalProductId = nonEmptyString(input.canonicalProductId) ?? "";
  const status = validatedDetailedReviewStatus(input.status) ?? "malformed_response";

  if (status !== "reviews_validated") {
    return degradedEvidence({
      canonicalProductId,
      status,
      providerEvidenceMode: input.providerEvidenceMode,
      observedAt: input.observedAt,
      reason: input.reason,
      taskCost: input.taskCost,
      observationCost: input.observationCost,
    });
  }

  const observationIssue = validatedObservationIssue(input.recentReviews, canonicalProductId);
  if (observationIssue) {
    return degradedEvidence({
      canonicalProductId,
      status: observationIssue.status,
      provider: observationIssue.provider,
      providerEvidenceMode: input.providerEvidenceMode,
      observedAt: input.observedAt ?? observationIssue.observedAt,
      reason: observationIssue.reason,
      taskCost: input.taskCost,
      observationCost: input.observationCost,
    });
  }

  const observation = input.recentReviews as GoogleShoppingRecentReviewsObservation;
  const normalizedDistribution = distributionEvidence(observation);
  const normalizedText = textEvidence(observation);

  return {
    canonicalProductId,
    status: "reviews_validated",
    validationStatus: "reviews_validated",
    provider: observation.provider,
    providerEvidenceMode: input.providerEvidenceMode ?? "derived-live",
    reviewRetrievalStatus: "reviews_validated",
    totalReviewsAvailable: finiteNonNegativeNumber(observation.totalReviewsAvailable),
    fetchedReviewCount: normalizedText.fetchedReviewCount,
    qualifyingReviewCount: normalizedText.qualifyingReviewCount,
    sourceDomains: normalizedText.sourceDomains,
    observedAt: nonEmptyString(input.observedAt) ?? observation.fetchedAt,
    cost: normalizedCost({
      taskCost: input.taskCost,
      observationCost: input.observationCost,
      observation,
    }),
    distributionEvidence: normalizedDistribution,
    textEvidence: normalizedText,
    distributionEvidenceStatus: normalizedDistribution.status,
    textEvidenceStatus: normalizedText.status,
    recentAverageRating: normalizedText.recentAverageRating,
    ratingConsensusStatus: normalizedDistribution.ratingConsensusStatus,
    ratingConsensusQuality: normalizedDistribution.ratingConsensusQuality,
    distributionSource: normalizedDistribution.distributionSource,
    distributionScope: normalizedDistribution.distributionScope,
    textSampleScope: normalizedText.sampleScope,
    reason: input.reason,
  };
}

function ratingEvidenceMetadata(observation: GoogleShoppingReviewObservation) {
  return {
    writtenReviewCount: observation.writtenReviewCount,
    ratingVoteCount: observation.ratingVoteCount,
    ratingCount: observation.ratingCount,
    ratingEvidenceCount: observation.ratingEvidenceCount,
    ratingEvidenceSourceField: observation.ratingEvidenceSourceField,
    ratingEvidenceComposition: observation.ratingEvidenceComposition,
  };
}

function recentAverageRatingMetadata(recentReviews: GoogleShoppingRecentReviewsObservation | undefined) {
  if (!recentReviews) return {};
  const consensus = recentReviews.ratingConsensus;

  return {
    recentAverageRatingStatus: recentReviews.status,
    recentAverageRatingComputed: recentReviews.recentAverageRating,
    provisionalRecentAverageRating: recentReviews.provisionalRecentAverageRating,
    recentAverageRatingCalculationMethod: recentReviews.calculationMethod,
    recentAverageRatingDatePrecision: recentReviews.datePrecision,
    recentAverageRatingWindowStart: recentReviews.windowStart,
    recentAverageRatingWindowEnd: recentReviews.windowEnd,
    recentAverageRatingWindowDays: recentReviews.windowDays,
    qualifyingRecentReviewCount: recentReviews.qualifyingReviewCount,
    totalReviewsFetched: recentReviews.totalReviewsFetched,
    datedReviewCount: recentReviews.datedReviewCount,
    excludedReviewCount: recentReviews.excludedReviewCount,
    undatedReviewCount: recentReviews.undatedReviewCount,
    invalidRatingCount: recentReviews.invalidRatingCount,
    outsideWindowReviewCount: recentReviews.outsideWindowReviewCount,
    totalReviewsAvailable: recentReviews.totalReviewsAvailable,
    recentReviewSourceDomains: recentReviews.sourceDomains.join(", "),
    recentReviewsSourceEndpoint: recentReviews.endpoint,
    recentReviewsSourceTimestamp: recentReviews.fetchedAt,
    recentReviewsSourceDatetime: recentReviews.sourceDatetime,
    recentReviewsSourceCost: recentReviews.cost,
    recentReviewsProviderGid: recentReviews.identifiers.gid,
    recentReviewsProviderProductId: optionalString(recentReviews.identifiers.productId),
    recentReviewsProviderDataDocid: optionalString(recentReviews.identifiers.dataDocid),
    ratingConsensusQualityStatus: consensus?.status,
    ratingConsensusQualityComputed: consensus?.ratingConsensusQuality,
    provisionalRatingConsensusQuality: consensus?.provisionalRatingConsensusQuality,
    ratingConsensusQualityCalculationMethod: consensus?.calculationMethod,
    ratingConsensusQualityObservationCount: consensus?.totalDistributionCount,
    ratingConsensusDistributionSource: consensus?.distributionSource,
    ratingConsensusDistributionScope: consensus?.distributionScope,
    ratingConsensusDistributionComposition: consensus?.distributionComposition,
    ratingConsensusStar1Count: consensus?.star1Count,
    ratingConsensusStar2Count: consensus?.star2Count,
    ratingConsensusStar3Count: consensus?.star3Count,
    ratingConsensusStar4Count: consensus?.star4Count,
    ratingConsensusStar5Count: consensus?.star5Count,
    ratingConsensusMean: consensus?.mean,
    ratingConsensusStandardDeviation: consensus?.standardDeviation,
    ratingConsensusVariance: consensus?.variance,
    ratingConsensusQualityGate: consensus?.qualityGate,
    ratingConsensusShapeSupport: consensus?.shapeSupport,
    ratingConsensusLowTailPenalty: consensus?.lowTailPenalty,
    ratingConsensusAggregateAverageRating: consensus?.aggregateAverageRating,
    ratingConsensusAggregateRatingDelta: consensus?.aggregateRatingDelta,
    ratingConsensusAggregateRatingMismatchThreshold: consensus?.aggregateRatingMismatchThreshold,
  };
}

export function buildReviewQualitySignalsFromObservation(input: {
  productId: string;
  observation: GoogleShoppingReviewObservation;
  recentReviews?: GoogleShoppingRecentReviewsObservation;
}): ReviewSignalBuildResult {
  const commonMetadata = {
    provider: "dataforseo_google_shopping",
    sourceName: "DataForSEO Google Shopping Products API",
    sourceEndpoint: input.observation.endpoint,
    sourceTimestamp: input.observation.fetchedAt,
    sourceDatetime: input.observation.sourceDatetime,
    canonicalSearchQuery: input.observation.searchQuery,
    locationCode: input.observation.locationCode,
    languageCode: input.observation.languageCode,
    matchedProductTitle: input.observation.matchedProductTitle,
    providerSeller: input.observation.seller,
    providerProductId: optionalString(input.observation.identifiers.productId),
    providerDataDocid: optionalString(input.observation.identifiers.dataDocid),
    providerGid: optionalString(input.observation.identifiers.gid),
    matchConfidence: input.observation.matchConfidence,
    matchScore: input.observation.matchScore,
    matchReasons: input.observation.matchReasons.join(", "),
    rawProviderRating: input.observation.averageRating,
    providerRatingMax: input.observation.ratingMax,
    ...ratingEvidenceMetadata(input.observation),
    ...recentAverageRatingMetadata(input.recentReviews),
    providerVariantGrouping: input.observation.providerVariantGrouping,
    providerRankGroup: input.observation.rankGroup,
    providerRankAbsolute: input.observation.rankAbsolute,
    providerBestMatch: input.observation.isBestMatch,
    sourceCost: input.observation.cost,
  };
  const averageRatingSignal: NormalizedTrendSignal = {
    source: "reviews",
    signalType: "reviewQuality",
    productId: input.productId,
    sourceProvenance: {
      mode: "live",
      provider: "dataforseo_google_shopping",
      providerLabel: "DataForSEO Google Shopping",
      providerMetric: "aggregateAverageRating",
      approvalStatus: "not-required",
      liveApiRequestMade: true,
      notes: "Provider aggregate rating is used directly for averageRating; rating evidence count is emitted separately when provider count semantics are consistent.",
    },
    value: input.observation.averageRating,
    normalizedValue: roundTo(normalizeLinear(input.observation.averageRating, 3.2, 4.8), 2),
    sampleSize: input.observation.ratingEvidenceCount,
    timestamp: input.observation.fetchedAt,
    confidence: REVIEW_AVERAGE_RATING_CONFIDENCE,
    metadata: {
      ...commonMetadata,
      providerMetric: "aggregateAverageRating",
      sourceMetric: "product_rating.value",
      confidence: REVIEW_AVERAGE_RATING_CONFIDENCE,
      engineField: "averageRating",
      engineValue: input.observation.averageRating,
    },
  };
  const signals = [averageRatingSignal];

  if (typeof input.observation.ratingEvidenceCount === "number") {
    signals.push({
      source: "reviews",
      signalType: "reviewQuality",
      productId: input.productId,
      sourceProvenance: {
        mode: "live",
        provider: "dataforseo_google_shopping",
        providerLabel: "DataForSEO Google Shopping",
        providerMetric: "ratingEvidenceCount",
        approvalStatus: "not-required",
        liveApiRequestMade: true,
        notes: "Provider count is used directly as ratingEvidenceCount under the Phase 3E rating evidence semantics.",
      },
      value: input.observation.ratingEvidenceCount,
      normalizedValue: roundTo(normalizeLogScale(input.observation.ratingEvidenceCount, 20, 20000), 2),
      sampleSize: input.observation.ratingEvidenceCount,
      timestamp: input.observation.fetchedAt,
      confidence: REVIEW_RATING_EVIDENCE_CONFIDENCE,
      metadata: {
        ...commonMetadata,
        providerMetric: "ratingEvidenceCount",
        sourceMetric: input.observation.ratingEvidenceSourceField,
        confidence: REVIEW_RATING_EVIDENCE_CONFIDENCE,
        engineField: "ratingEvidenceCount",
        engineValue: input.observation.ratingEvidenceCount,
      },
    });
  }

  if (typeof input.recentReviews?.recentAverageRating === "number") {
    signals.push({
      source: "reviews",
      signalType: "reviewQuality",
      productId: input.productId,
      sourceProvenance: {
        mode: "derived-live",
        provider: "dataforseo_google_shopping_reviews",
        providerLabel: "DataForSEO Google Shopping Reviews",
        providerMetric: "recentAverageRating90d",
        approvalStatus: "not-required",
        liveApiRequestMade: true,
        notes: "recentAverageRating is computed from live Google Shopping review ratings with provider-observed approximate publication dates inside the trailing 90-day window.",
      },
      value: input.recentReviews.recentAverageRating,
      normalizedValue: roundTo(normalizeLinear(input.recentReviews.recentAverageRating, 3.0, 4.8), 2),
      sampleSize: input.recentReviews.qualifyingReviewCount,
      timestamp: input.recentReviews.fetchedAt,
      confidence: REVIEW_RECENT_AVERAGE_RATING_CONFIDENCE,
      metadata: {
        ...commonMetadata,
        provider: "dataforseo_google_shopping_reviews",
        providerMetric: "recentAverageRating90d",
        sourceName: "DataForSEO Google Shopping Reviews API",
        sourceMetric: "items[].rating.value",
        sourceEndpoint: input.recentReviews.endpoint,
        sourceTimestamp: input.recentReviews.fetchedAt,
        sourceDatetime: input.recentReviews.sourceDatetime,
        sourceCost: input.recentReviews.cost,
        confidence: REVIEW_RECENT_AVERAGE_RATING_CONFIDENCE,
        engineField: "recentAverageRating",
        engineValue: input.recentReviews.recentAverageRating,
      },
    });
  }

  if (typeof input.recentReviews?.ratingConsensus?.ratingConsensusQuality === "number") {
    const consensus = input.recentReviews.ratingConsensus;

    signals.push({
      source: "reviews",
      signalType: "reviewQuality",
      productId: input.productId,
      sourceProvenance: {
        mode: "derived-live",
        provider: "dataforseo_google_shopping_reviews",
        providerLabel: "DataForSEO Google Shopping Reviews",
        providerMetric: "ratingConsensusQuality",
        approvalStatus: "not-required",
        liveApiRequestMade: true,
        notes: "ratingConsensusQuality is computed from the live Google Shopping rating distribution using the Phase 3I distribution-adjusted consensus formula.",
      },
      value: consensus.ratingConsensusQuality,
      normalizedValue: roundTo(consensus.ratingConsensusQuality, 2),
      sampleSize: consensus.totalDistributionCount,
      timestamp: input.recentReviews.fetchedAt,
      confidence: REVIEW_RATING_CONSENSUS_QUALITY_CONFIDENCE,
      metadata: {
        ...commonMetadata,
        provider: "dataforseo_google_shopping_reviews",
        providerMetric: "ratingConsensusQuality",
        sourceName: "DataForSEO Google Shopping Reviews API",
        sourceMetric: consensus.distributionSource === "provider_rating_groups"
          ? "rating_groups[].rating_count_or_votes_count"
          : "items[].rating.value",
        sourceEndpoint: input.recentReviews.endpoint,
        sourceTimestamp: input.recentReviews.fetchedAt,
        sourceDatetime: input.recentReviews.sourceDatetime,
        sourceCost: input.recentReviews.cost,
        confidence: REVIEW_RATING_CONSENSUS_QUALITY_CONFIDENCE,
        engineField: "ratingConsensusQuality",
        engineValue: consensus.ratingConsensusQuality,
      },
    });
  }

  return {
    signals,
    observation: input.observation,
    recentReviews: input.recentReviews,
  };
}

function safeValidatedReviewMetadata(evidence: NormalizedReviewsValidatedEvidence) {
  return {
    provider: "dataforseo_google_shopping_reviews",
    sourceName: "DataForSEO Google Shopping Reviews API",
    canonicalProductId: evidence.canonicalProductId,
    validationStatus: evidence.validationStatus,
    reviewRetrievalStatus: evidence.reviewRetrievalStatus,
    providerEvidenceMode: evidence.providerEvidenceMode,
    totalReviewsAvailable: evidence.totalReviewsAvailable,
    fetchedReviewCount: evidence.fetchedReviewCount,
    qualifyingReviewCount: evidence.qualifyingReviewCount,
    textEvidenceStatus: evidence.textEvidenceStatus,
    textSampleScope: evidence.textSampleScope,
    recentAverageRatingStatus: evidence.textEvidenceStatus,
    recentAverageRatingComputed: evidence.recentAverageRating,
    provisionalRecentAverageRating: evidence.textEvidence.provisionalRecentAverageRating,
    totalReviewsFetched: evidence.fetchedReviewCount,
    qualifyingRecentReviewCount: evidence.qualifyingReviewCount,
    recentReviewSourceDomains: evidence.sourceDomains.join(", "),
    recentAverageRatingWindowStart: evidence.textEvidence.windowStart,
    recentAverageRatingWindowEnd: evidence.textEvidence.windowEnd,
    recentAverageRatingWindowDays: evidence.textEvidence.windowDays,
    recentAverageRatingCalculationMethod: evidence.textEvidence.calculationMethod,
    recentAverageRatingDatePrecision: evidence.textEvidence.datePrecision,
    distributionEvidenceStatus: evidence.distributionEvidenceStatus,
    ratingConsensusQualityStatus: evidence.ratingConsensusStatus,
    ratingConsensusQualityComputed: evidence.ratingConsensusQuality,
    provisionalRatingConsensusQuality: evidence.distributionEvidence.provisionalRatingConsensusQuality,
    ratingConsensusQualityObservationCount: evidence.distributionEvidence.reviewsCount,
    ratingConsensusDistributionSource: evidence.distributionSource,
    ratingConsensusDistributionScope: evidence.distributionScope,
    ratingConsensusDistributionComposition: evidence.distributionEvidence.distributionComposition,
    ratingConsensusStar1Count: evidence.distributionEvidence.ratingGroups.find((group) => group.star === 1)?.count,
    ratingConsensusStar2Count: evidence.distributionEvidence.ratingGroups.find((group) => group.star === 2)?.count,
    ratingConsensusStar3Count: evidence.distributionEvidence.ratingGroups.find((group) => group.star === 3)?.count,
    ratingConsensusStar4Count: evidence.distributionEvidence.ratingGroups.find((group) => group.star === 4)?.count,
    ratingConsensusStar5Count: evidence.distributionEvidence.ratingGroups.find((group) => group.star === 5)?.count,
    detailedReviewTaskCost: evidence.cost.taskCost,
    detailedReviewObservationCost: evidence.cost.observationCost,
    sourceCost: evidence.cost.sourceCostCompatibleValue,
    sourceTimestamp: evidence.observedAt,
  };
}

export function buildReviewQualitySignalsFromValidatedEvidence(input: {
  evidence: NormalizedValidatedReviewEvidence;
}): NormalizedTrendSignal[] {
  const evidence = input.evidence;
  if (evidence.status !== "reviews_validated") return [];

  const metadata = safeValidatedReviewMetadata(evidence);
  const timestamp = evidence.observedAt ?? new Date(0).toISOString();
  const signals: NormalizedTrendSignal[] = [];

  if (
    evidence.distributionEvidence.status === "usable" &&
    typeof evidence.ratingConsensusQuality === "number"
  ) {
    signals.push({
      source: "reviews",
      signalType: "reviewQuality",
      productId: evidence.canonicalProductId,
      sourceProvenance: {
        mode: "derived-live",
        provider: "dataforseo_google_shopping_reviews",
        providerLabel: "DataForSEO Google Shopping Reviews",
        providerMetric: "ratingConsensusQuality",
        approvalStatus: "not-required",
        liveApiRequestMade: true,
        notes: "ratingConsensusQuality is emitted only from identity-validated detailed-review distribution evidence.",
      },
      value: evidence.ratingConsensusQuality,
      normalizedValue: roundTo(evidence.ratingConsensusQuality, 2),
      sampleSize: evidence.distributionEvidence.reviewsCount ?? undefined,
      timestamp,
      confidence: REVIEW_RATING_CONSENSUS_QUALITY_CONFIDENCE,
      metadata: {
        ...metadata,
        providerMetric: "ratingConsensusQuality",
        sourceMetric: evidence.distributionSource === "provider_rating_groups"
          ? "rating_groups[].rating_count_or_votes_count"
          : "items[].rating.value",
        confidence: REVIEW_RATING_CONSENSUS_QUALITY_CONFIDENCE,
        engineField: "ratingConsensusQuality",
        engineValue: evidence.ratingConsensusQuality,
      },
    });
  }

  if (
    evidence.textEvidence.status === "derived-live" &&
    typeof evidence.recentAverageRating === "number"
  ) {
    signals.push({
      source: "reviews",
      signalType: "reviewQuality",
      productId: evidence.canonicalProductId,
      sourceProvenance: {
        mode: "derived-live",
        provider: "dataforseo_google_shopping_reviews",
        providerLabel: "DataForSEO Google Shopping Reviews",
        providerMetric: "recentAverageRating90d",
        approvalStatus: "not-required",
        liveApiRequestMade: true,
        notes: "recentAverageRating is emitted only when identity-validated detailed-review text evidence meets the scoring guardrail.",
      },
      value: evidence.recentAverageRating,
      normalizedValue: roundTo(normalizeLinear(evidence.recentAverageRating, 3.0, 4.8), 2),
      sampleSize: evidence.qualifyingReviewCount,
      timestamp,
      confidence: REVIEW_RECENT_AVERAGE_RATING_CONFIDENCE,
      metadata: {
        ...metadata,
        providerMetric: "recentAverageRating90d",
        sourceMetric: "items[].rating.value",
        confidence: REVIEW_RECENT_AVERAGE_RATING_CONFIDENCE,
        engineField: "recentAverageRating",
        engineValue: evidence.recentAverageRating,
      },
    });
  }

  return signals;
}
