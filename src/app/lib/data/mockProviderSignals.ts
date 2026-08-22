import type { TrendIQSignalInputs } from "../scoring/types";

export const DATA_LAYER_TIMESTAMP = "2026-08-11T00:00:00Z";
export const RAY_BAN_META_PRODUCT_ID = "ray-ban-meta";

// These raw values intentionally match the existing Ray-Ban v1 mock scoring
// metrics. Provider adapters normalize and label them, while the aggregator
// reconstructs this API-ready shape for the score engine.
export const RAY_BAN_META_SIGNAL_INPUTS: TrendIQSignalInputs = {
  socialMomentum: {
    mentions7d: 42000,
    mentionGrowthPercent: 64,
    engagementRatePercent: 9.8,
    creatorPostCount: 3200,
  },
  searchMomentum: {
    searchVolume7d: 185000,
    searchGrowthPercent: 46,
    queryShareOfCategoryPercent: 18,
  },
  sentiment: {
    positiveMentionPercent: 74,
    negativeMentionPercent: 12,
  },
  reviewQuality: {
    averageRating: 4.4,
    ratingEvidenceCount: 2900,
    ratingConsensusQuality: 85,
    recentAverageRating: 4.3,
  },
  purchaseIntent: {
    buyingKeywordSharePercent: 26,
    addToCartRatePercent: 10.5,
    affiliateClickThroughRatePercent: 7.2,
    saveRatePercent: 14,
  },
  growthVelocity: {
    trendChangePercent: 34.2,
    accelerationPercent: 18,
    consecutiveGrowthDays: 5,
  },
  hypeSustainability: {
    repeatMentionRatePercent: 42,
    sourceHalfLifeDays: 18,
    creatorConcentrationPercent: 38,
    evergreenInterestPercent: 52,
  },
  confidence: {
    observationCount: 9300,
    sourceCount: 6,
    newestSignalAgeHours: 8,
    agreeingSignalCount: 6,
    totalSignalCount: 7,
    completeSignalCount: 35,
    expectedSignalCount: 35,
  },
};
