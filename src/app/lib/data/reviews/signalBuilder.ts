import { normalizeLinear, normalizeLogScale, roundTo } from "../../scoring/normalization";
import type { NormalizedTrendSignal } from "../types";
import type { GoogleShoppingReviewObservation, ReviewSignalBuildResult } from "./types";

const REVIEW_AVERAGE_RATING_CONFIDENCE = 92;
const REVIEW_RATING_EVIDENCE_CONFIDENCE = 91;

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

export function buildReviewQualitySignalsFromObservation(input: {
  productId: string;
  observation: GoogleShoppingReviewObservation;
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

  return {
    signals,
    observation: input.observation,
  };
}
