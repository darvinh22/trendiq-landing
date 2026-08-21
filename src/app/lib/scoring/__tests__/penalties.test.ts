import { describe, expect, it } from "vitest";
import { calculateScorePenalties, sumPenalties } from "../penalties";
import type { TrendIQScoreComponents, TrendIQSignalInputs } from "../types";

const baseSignals: TrendIQSignalInputs = {
  socialMomentum: {
    mentions7d: 10000,
    mentionGrowthPercent: 40,
    engagementRatePercent: 7,
    creatorPostCount: 1000,
  },
  searchMomentum: {
    searchVolume7d: 50000,
    searchGrowthPercent: 30,
    queryShareOfCategoryPercent: 12,
  },
  sentiment: {
    positiveMentionPercent: 75,
    negativeMentionPercent: 10,
  },
  reviewQuality: {
    averageRating: 4.4,
    reviewCount: 1000,
    verifiedPurchasePercent: 80,
    recentAverageRating: 4.3,
  },
  purchaseIntent: {
    buyingKeywordSharePercent: 20,
    addToCartRatePercent: 8,
    affiliateClickThroughRatePercent: 5,
    saveRatePercent: 10,
  },
  growthVelocity: {
    trendChangePercent: 30,
    accelerationPercent: 10,
    consecutiveGrowthDays: 5,
  },
  hypeSustainability: {
    repeatMentionRatePercent: 40,
    sourceHalfLifeDays: 18,
    creatorConcentrationPercent: 35,
    evergreenInterestPercent: 55,
  },
  confidence: {
    observationCount: 5000,
    sourceCount: 5,
    newestSignalAgeHours: 6,
    agreeingSignalCount: 6,
    totalSignalCount: 7,
    completeSignalCount: 35,
    expectedSignalCount: 35,
  },
};

const baseComponents: TrendIQScoreComponents = {
  socialMomentum: 75,
  searchMomentum: 72,
  sentiment: 75,
  reviewQuality: 78,
  purchaseIntent: 70,
  growthVelocity: 68,
  hypeSustainability: 72,
};

describe("penalties", () => {
  it("does not penalize balanced signals", () => {
    expect(calculateScorePenalties(baseSignals, baseComponents)).toEqual([]);
  });

  it("penalizes concentrated creator-driven hype", () => {
    const penalties = calculateScorePenalties(
      {
        ...baseSignals,
        hypeSustainability: {
          ...baseSignals.hypeSustainability,
          creatorConcentrationPercent: 95,
        },
      },
      {
        ...baseComponents,
        socialMomentum: 90,
      }
    );

    expect(penalties.some((item) => item.id === "creator_concentration")).toBe(true);
    expect(sumPenalties(penalties)).toBeGreaterThan(0);
  });

  it("penalizes high momentum with weak sentiment", () => {
    const penalties = calculateScorePenalties(baseSignals, {
      ...baseComponents,
      socialMomentum: 90,
      searchMomentum: 85,
      sentiment: 35,
    });

    expect(penalties.some((item) => item.id === "sentiment_drag")).toBe(true);
  });
});
