import { normalizeLinear, roundTo } from "../../scoring/normalization";
import type { NormalizedTrendSignal } from "../types";
import type { GoogleShoppingReviewObservation, ReviewSignalBuildResult } from "./types";

const REVIEW_AVERAGE_RATING_CONFIDENCE = 92;

function optionalString(value: string | undefined): string | undefined {
  return value && value.length ? value : undefined;
}

export function buildReviewAverageRatingSignalFromObservation(input: {
  productId: string;
  observation: GoogleShoppingReviewObservation;
}): ReviewSignalBuildResult {
  const signal: NormalizedTrendSignal = {
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
      notes: "Provider aggregate rating is used for averageRating only; provider review count remains metadata in Phase 3B.",
    },
    value: input.observation.averageRating,
    normalizedValue: roundTo(normalizeLinear(input.observation.averageRating, 3.2, 4.8), 2),
    sampleSize: input.observation.providerReviewCount,
    timestamp: input.observation.fetchedAt,
    confidence: REVIEW_AVERAGE_RATING_CONFIDENCE,
    metadata: {
      provider: "dataforseo_google_shopping",
      providerMetric: "aggregateAverageRating",
      sourceName: "DataForSEO Google Shopping Products API",
      sourceMetric: "product_rating.value",
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
      providerReviewCount: input.observation.providerReviewCount,
      providerReviewCountRole: "metadata_only_phase_3b",
      providerVariantGrouping: input.observation.providerVariantGrouping,
      providerRankGroup: input.observation.rankGroup,
      providerRankAbsolute: input.observation.rankAbsolute,
      providerBestMatch: input.observation.isBestMatch,
      sourceCost: input.observation.cost,
      confidence: REVIEW_AVERAGE_RATING_CONFIDENCE,
      engineField: "averageRating",
      engineValue: input.observation.averageRating,
    },
  };

  return {
    signals: [signal],
    observation: input.observation,
  };
}
