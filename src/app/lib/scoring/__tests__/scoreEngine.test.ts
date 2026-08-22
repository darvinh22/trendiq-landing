import { describe, expect, it } from "vitest";
import { roundScore } from "../normalization";
import { calculateBaselineReadiness } from "../searchQuality";
import { calculateScoreComponents, calculateTrendIQScore, TRENDIQ_SCORE_WEIGHTS } from "../scoreEngine";
import type { TrendIQScoreComponentKey, TrendIQSignalInputs } from "../types";

const completeHighSignal: TrendIQSignalInputs = {
  socialMomentum: {
    mentions7d: 50000,
    mentionGrowthPercent: 150,
    engagementRatePercent: 12,
    creatorPostCount: 5000,
  },
  searchMomentum: {
    searchVolume7d: 250000,
    searchGrowthPercent: 120,
    queryShareOfCategoryPercent: 25,
  },
  sentiment: {
    positiveMentionPercent: 90,
    negativeMentionPercent: 5,
  },
  reviewQuality: {
    averageRating: 4.8,
    ratingEvidenceCount: 20000,
    ratingConsensusQuality: 100,
    recentAverageRating: 4.8,
  },
  purchaseIntent: {
    buyingKeywordSharePercent: 35,
    addToCartRatePercent: 18,
    affiliateClickThroughRatePercent: 12,
    saveRatePercent: 20,
  },
  growthVelocity: {
    trendChangePercent: 80,
    accelerationPercent: 60,
    consecutiveGrowthDays: 7,
  },
  hypeSustainability: {
    repeatMentionRatePercent: 60,
    sourceHalfLifeDays: 30,
    creatorConcentrationPercent: 15,
    evergreenInterestPercent: 80,
  },
  confidence: {
    observationCount: 5000,
    sourceCount: 6,
    newestSignalAgeHours: 0,
    agreeingSignalCount: 7,
    totalSignalCount: 7,
    completeSignalCount: 35,
    expectedSignalCount: 35,
  },
};

describe("scoreEngine", () => {
  it("uses the v1.1 TrendIQ Score weights", () => {
    expect(TRENDIQ_SCORE_WEIGHTS).toEqual({
      socialMomentum: 0.2,
      searchMomentum: 0.15,
      sentiment: 0.15,
      reviewQuality: 0.15,
      purchaseIntent: 0.15,
      growthVelocity: 0.1,
      hypeSustainability: 0.1,
    });
  });

  it("normalizes every component to 0-100", () => {
    const components = calculateScoreComponents(completeHighSignal);
    const componentKeys: TrendIQScoreComponentKey[] = [
      "socialMomentum",
      "searchMomentum",
      "sentiment",
      "reviewQuality",
      "purchaseIntent",
      "growthVelocity",
      "hypeSustainability",
    ];

    for (const key of componentKeys) {
      expect(components[key]).toBeGreaterThanOrEqual(0);
      expect(components[key]).toBeLessThanOrEqual(100);
    }
  });

  it("uses ratingConsensusQuality directly without legacy percentage normalization", () => {
    const components = calculateScoreComponents({
      ...completeHighSignal,
      reviewQuality: {
        averageRating: 3.2,
        ratingEvidenceCount: 20,
        ratingConsensusQuality: 80,
        recentAverageRating: 3,
      },
    });

    expect(components.reviewQuality).toBe(12);
  });

  it("calculates a deterministic versioned score", () => {
    const first = calculateTrendIQScore(completeHighSignal);
    const second = calculateTrendIQScore(completeHighSignal);

    expect(first).toEqual(second);
    expect(first.scoreVersion).toBe("v1.1");
    expect(first.score).toBe(100);
  });

  it("reduces percentage-growth credit when relative search interest starts from a low base", () => {
    const lowBase = calculateScoreComponents({
      ...completeHighSignal,
      searchMomentum: {
        ...completeHighSignal.searchMomentum,
        searchGrowthPercent: 500,
        previous7dRelativeInterest: 1.71,
        searchGrowthBaselineReadiness: calculateBaselineReadiness(1.71),
        hasLowBaseSearchGrowth: true,
      },
    });
    const fullBase = calculateScoreComponents({
      ...completeHighSignal,
      searchMomentum: {
        ...completeHighSignal.searchMomentum,
        searchGrowthPercent: 500,
        previous7dRelativeInterest: 10,
        searchGrowthBaselineReadiness: calculateBaselineReadiness(10),
      },
    });

    expect(lowBase.searchMomentum).toBeLessThan(fullBase.searchMomentum);
    expect(lowBase.searchMomentum).toBeCloseTo(62.7, 1);
    expect(fullBase.searchMomentum).toBe(100);
  });

  it("keeps strong growth credit when the baseline is meaningful", () => {
    const components = calculateScoreComponents({
      ...completeHighSignal,
      searchMomentum: {
        ...completeHighSignal.searchMomentum,
        searchGrowthPercent: 100,
        previous7dRelativeInterest: 30,
        searchGrowthBaselineReadiness: calculateBaselineReadiness(30),
      },
    });

    expect(components.searchMomentum).toBeGreaterThan(90);
  });

  it("reduces search-derived growth velocity so the same provider spike is not counted twice at full value", () => {
    const searchOnly = calculateScoreComponents({
      ...completeHighSignal,
      growthVelocity: {
        trendChangePercent: 500,
        accelerationPercent: 500,
        consecutiveGrowthDays: 7,
        searchDerivedTrendChangePercent: 500,
        searchDerivedAccelerationPercent: 500,
        searchGrowthBaselineReadiness: 1,
        hasSearchDerivedVelocity: true,
      },
    });
    const ordinary = calculateScoreComponents({
      ...completeHighSignal,
      growthVelocity: {
        trendChangePercent: 80,
        accelerationPercent: 60,
        consecutiveGrowthDays: 7,
      },
    });

    expect(ordinary.growthVelocity).toBe(100);
    expect(searchOnly.growthVelocity).toBe(60);
  });

  it("subtracts penalties before rounding the final score", () => {
    const result = calculateTrendIQScore({
      ...completeHighSignal,
      sentiment: {
        positiveMentionPercent: 35,
        negativeMentionPercent: 40,
      },
      hypeSustainability: {
        ...completeHighSignal.hypeSustainability,
        creatorConcentrationPercent: 95,
      },
    });

    expect(result.penaltyTotal).toBeGreaterThan(0);
    expect(result.score).toBe(roundScore(result.weightedComponentScore - result.penaltyTotal));
  });
});
