import { calculateScorePenalties, sumPenalties } from "./penalties";
import {
  adjustGrowthScoreForSearchBaseline,
  reduceSearchDerivedVelocityScore,
} from "./searchQuality";
import { SCORE_VERSION, type TrendIQScoreComponents, type TrendIQScoreResult, type TrendIQSignalInputs } from "./types";
import { clamp, normalizeInverseLinear, normalizeLinear, normalizeLogScale, roundScore, roundTo, weightedAverage } from "./normalization";

export const TRENDIQ_SCORE_WEIGHTS = {
  socialMomentum: 0.2,
  searchMomentum: 0.15,
  sentiment: 0.15,
  reviewQuality: 0.15,
  purchaseIntent: 0.15,
  growthVelocity: 0.1,
  hypeSustainability: 0.1,
} as const;

export function calculateScoreComponents(input: TrendIQSignalInputs): TrendIQScoreComponents {
  const rawSearchGrowthScore = normalizeLinear(input.searchMomentum.searchGrowthPercent, -20, 120);
  const adjustedSearchGrowthScore = adjustGrowthScoreForSearchBaseline({
    rawNormalizedGrowthScore: rawSearchGrowthScore,
    previous7dRelativeInterest: input.searchMomentum.previous7dRelativeInterest,
    baselineReadiness: input.searchMomentum.searchGrowthBaselineReadiness,
  });
  const trendChangeScore = normalizeVelocitySubScore({
    rawPercent: input.growthVelocity.trendChangePercent,
    nonSearchPercent: input.growthVelocity.nonSearchTrendChangePercent,
    searchPercent: input.growthVelocity.searchDerivedTrendChangePercent,
    minInput: -20,
    maxInput: 80,
    baselineReadiness: input.growthVelocity.searchGrowthBaselineReadiness,
    hasSearchDerivedVelocity: input.growthVelocity.hasSearchDerivedVelocity,
  });
  const accelerationScore = normalizeVelocitySubScore({
    rawPercent: input.growthVelocity.accelerationPercent,
    nonSearchPercent: input.growthVelocity.nonSearchAccelerationPercent,
    searchPercent: input.growthVelocity.searchDerivedAccelerationPercent,
    minInput: -40,
    maxInput: 60,
    baselineReadiness: input.growthVelocity.searchGrowthBaselineReadiness,
    hasSearchDerivedVelocity: input.growthVelocity.hasSearchDerivedVelocity,
  });
  const socialMomentum = weightedAverage([
    // Consumer products need a low non-zero baseline, so 100 weekly mentions is
    // treated as emerging and 50,000+ mentions as saturated social awareness.
    { score: normalizeLogScale(input.socialMomentum.mentions7d, 100, 50000), weight: 0.3 },

    // Weekly mention growth below -25% is cooling; +150% or higher is breakout
    // social acceleration for v1 mock trend data.
    { score: normalizeLinear(input.socialMomentum.mentionGrowthPercent, -25, 150), weight: 0.35 },

    // Engagement rate uses a 1%-12% consumer-social range; above 12% is capped
    // because virality should not dominate the whole score.
    { score: normalizeLinear(input.socialMomentum.engagementRatePercent, 1, 12), weight: 0.2 },

    // Creator post count is log-scaled so broad participation matters without
    // letting one massive platform dwarf every other component.
    { score: normalizeLogScale(input.socialMomentum.creatorPostCount, 10, 5000), weight: 0.15 },
  ]);

  const searchMomentum = weightedAverage([
    // Search volume is log-scaled from niche interest to mainstream discovery.
    { score: normalizeLogScale(input.searchMomentum.searchVolume7d, 100, 250000), weight: 0.35 },

    // Search growth maps -20% to 0 and +120% to 100 for near-term intent spikes.
    // v1.1 applies baseline readiness so tiny prior relative-interest periods
    // cannot produce full breakout credit on percentage growth alone.
    { score: adjustedSearchGrowthScore, weight: 0.45 },

    // Category query share caps at 25%; beyond that, the product already owns a
    // large share of category curiosity for v1 purposes.
    { score: normalizeLinear(input.searchMomentum.queryShareOfCategoryPercent, 0, 25), weight: 0.2 },
  ]);

  const sentiment = weightedAverage([
    // Net sentiment from -30 to +80 captures the practical range in noisy social
    // data, where even loved products still have some criticism.
    { score: normalizeLinear(input.sentiment.positiveMentionPercent - input.sentiment.negativeMentionPercent, -30, 80), weight: 0.55 },
    { score: normalizeLinear(input.sentiment.positiveMentionPercent, 30, 90), weight: 0.3 },
    { score: normalizeInverseLinear(input.sentiment.negativeMentionPercent, 5, 45), weight: 0.15 },
  ]);

  const reviewQuality = weightedAverage([
    // Ratings below 3.2 rarely indicate a recommendable product; 4.8+ is
    // effectively best-in-class after review-volume checks.
    { score: normalizeLinear(input.reviewQuality.averageRating, 3.2, 4.8), weight: 0.45 },

    // Rating evidence count is log-scaled from 20 to 20,000 so credibility
    // rises quickly at first, then tapers once the rating is well-supported.
    { score: normalizeLogScale(input.reviewQuality.ratingEvidenceCount, 20, 20000), weight: 0.25 },

    // Verified-purchase share below 30% is weak; 95%+ is capped as excellent.
    { score: normalizeLinear(input.reviewQuality.verifiedPurchasePercent, 30, 95), weight: 0.15 },

    // Recent rating guards against stale historical love hiding current issues.
    { score: normalizeLinear(input.reviewQuality.recentAverageRating, 3.0, 4.8), weight: 0.15 },
  ]);

  const purchaseIntent = weightedAverage([
    // Buying keyword share is the most direct mock proxy for "people are trying
    // to buy this," with 35%+ treated as exceptional intent.
    { score: normalizeLinear(input.purchaseIntent.buyingKeywordSharePercent, 2, 35), weight: 0.35 },
    { score: normalizeLinear(input.purchaseIntent.addToCartRatePercent, 1, 18), weight: 0.25 },
    { score: normalizeLinear(input.purchaseIntent.affiliateClickThroughRatePercent, 0.5, 12), weight: 0.2 },
    { score: normalizeLinear(input.purchaseIntent.saveRatePercent, 1, 20), weight: 0.2 },
  ]);

  const growthVelocity = weightedAverage([
    // Trend change is separate from the displayed Trend Momentum status, but the
    // score still uses growth velocity as one component of product opportunity.
    { score: trendChangeScore, weight: 0.5 },
    { score: accelerationScore, weight: 0.3 },
    { score: normalizeLinear(input.growthVelocity.consecutiveGrowthDays, 0, 7), weight: 0.2 },
  ]);

  const hypeSustainability = weightedAverage([
    // Repeat mention rate and source half-life proxy whether hype is recurring
    // instead of a single-post spike.
    { score: normalizeLinear(input.hypeSustainability.repeatMentionRatePercent, 5, 60), weight: 0.3 },
    { score: normalizeLinear(input.hypeSustainability.sourceHalfLifeDays, 1, 30), weight: 0.25 },
    { score: normalizeInverseLinear(input.hypeSustainability.creatorConcentrationPercent, 15, 85), weight: 0.25 },
    { score: normalizeLinear(input.hypeSustainability.evergreenInterestPercent, 10, 80), weight: 0.2 },
  ]);

  return {
    socialMomentum: roundTo(clamp(socialMomentum), 2),
    searchMomentum: roundTo(clamp(searchMomentum), 2),
    sentiment: roundTo(clamp(sentiment), 2),
    reviewQuality: roundTo(clamp(reviewQuality), 2),
    purchaseIntent: roundTo(clamp(purchaseIntent), 2),
    growthVelocity: roundTo(clamp(growthVelocity), 2),
    hypeSustainability: roundTo(clamp(hypeSustainability), 2),
  };
}

function normalizeVelocitySubScore(input: {
  rawPercent: number;
  nonSearchPercent?: number;
  searchPercent?: number;
  minInput: number;
  maxInput: number;
  baselineReadiness?: number;
  hasSearchDerivedVelocity?: boolean;
}): number {
  if (!input.hasSearchDerivedVelocity || typeof input.searchPercent !== "number") {
    return normalizeLinear(input.rawPercent, input.minInput, input.maxInput);
  }

  const searchScore = reduceSearchDerivedVelocityScore(
    adjustGrowthScoreForSearchBaseline({
      rawNormalizedGrowthScore: normalizeLinear(input.searchPercent, input.minInput, input.maxInput),
      baselineReadiness: input.baselineReadiness,
    })
  );

  if (typeof input.nonSearchPercent !== "number") {
    return searchScore;
  }

  const nonSearchScore = normalizeLinear(input.nonSearchPercent, input.minInput, input.maxInput);

  return (searchScore + nonSearchScore) / 2;
}

export function calculateTrendIQScore(input: TrendIQSignalInputs): TrendIQScoreResult {
  const components = calculateScoreComponents(input);
  const weightedComponentScore = roundTo(
    weightedAverage([
      { score: components.socialMomentum, weight: TRENDIQ_SCORE_WEIGHTS.socialMomentum },
      { score: components.searchMomentum, weight: TRENDIQ_SCORE_WEIGHTS.searchMomentum },
      { score: components.sentiment, weight: TRENDIQ_SCORE_WEIGHTS.sentiment },
      { score: components.reviewQuality, weight: TRENDIQ_SCORE_WEIGHTS.reviewQuality },
      { score: components.purchaseIntent, weight: TRENDIQ_SCORE_WEIGHTS.purchaseIntent },
      { score: components.growthVelocity, weight: TRENDIQ_SCORE_WEIGHTS.growthVelocity },
      { score: components.hypeSustainability, weight: TRENDIQ_SCORE_WEIGHTS.hypeSustainability },
    ]),
    2
  );
  const penalties = calculateScorePenalties(input, components);
  const penaltyTotal = sumPenalties(penalties);
  const score = roundScore(weightedComponentScore - penaltyTotal);

  return {
    scoreVersion: SCORE_VERSION,
    score,
    weightedComponentScore,
    components,
    penalties,
    penaltyTotal,
  };
}
