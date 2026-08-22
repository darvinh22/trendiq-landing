import { normalizeLinear, normalizeLogScale, roundTo } from "../../scoring/normalization";
import type { NormalizedTrendSignal } from "../types";
import type {
  GoogleShoppingRecentReviewsObservation,
  GoogleShoppingReviewObservation,
  ReviewSignalBuildResult,
} from "./types";

const REVIEW_AVERAGE_RATING_CONFIDENCE = 92;
const REVIEW_RATING_EVIDENCE_CONFIDENCE = 91;
const REVIEW_RECENT_AVERAGE_RATING_CONFIDENCE = 89;

function optionalString(value: string | undefined): string | undefined {
  return value && value.length ? value : undefined;
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

  return {
    signals,
    observation: input.observation,
    recentReviews: input.recentReviews,
  };
}
