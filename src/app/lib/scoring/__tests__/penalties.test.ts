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
    ratingEvidenceCount: 1000,
    ratingConsensusQuality: 80,
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
  function volatileGrowthPenalty(input: Partial<TrendIQSignalInputs["growthVelocity"]>) {
    return calculateScorePenalties(
      {
        ...baseSignals,
        growthVelocity: {
          ...baseSignals.growthVelocity,
          ...input,
        },
      },
      baseComponents
    ).find((item) => item.id === "volatile_growth");
  }

  it("does not penalize balanced signals", () => {
    expect(calculateScorePenalties(baseSignals, baseComponents)).toEqual([]);
  });

  it("penalizes high ratings backed by thin rating evidence without changing magnitude", () => {
    const penalties = calculateScorePenalties(
      {
        ...baseSignals,
        reviewQuality: {
          ...baseSignals.reviewQuality,
          averageRating: 4.7,
          ratingEvidenceCount: 30,
        },
      },
      baseComponents
    );
    const thinEvidence = penalties.find((item) => item.id === "thin_rating_evidence");

    expect(thinEvidence?.label).toBe("Thin rating evidence");
    expect(thinEvidence?.reason).toBe("High rating is based on limited rating evidence.");
    expect(thinEvidence?.points).toBe(3);
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

  it("penalizes positive acceleration with a short growth streak", () => {
    expect(volatileGrowthPenalty({
      accelerationPercent: 100,
      consecutiveGrowthDays: 2,
    })?.points).toBe(2.14);
  });

  it("does not penalize positive acceleration with a durable growth streak", () => {
    expect(volatileGrowthPenalty({
      accelerationPercent: 100,
      consecutiveGrowthDays: 3,
    })).toBeUndefined();
  });

  it("does not penalize sharp negative acceleration with a short streak", () => {
    expect(volatileGrowthPenalty({
      accelerationPercent: -165.6,
      consecutiveGrowthDays: 0,
    })).toBeUndefined();
  });

  it("does not penalize stable acceleration", () => {
    expect(volatileGrowthPenalty({
      accelerationPercent: 0,
      consecutiveGrowthDays: 0,
    })).toBeUndefined();
  });

  it("caps volatile growth at five points for very high positive acceleration", () => {
    expect(volatileGrowthPenalty({
      accelerationPercent: 180,
      consecutiveGrowthDays: 1,
    })?.points).toBe(5);
  });
});
