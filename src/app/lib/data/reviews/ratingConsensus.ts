import { clamp, normalizeLinear, roundTo } from "../../scoring/normalization";
import type { RatingConsensusQualityResult, RatingDistributionInput } from "./types";

export const RATING_CONSENSUS_MIN_SCORING_SAMPLE_SIZE = 100;
export const RATING_CONSENSUS_PROVISIONAL_SAMPLE_SIZE = 30;

// Sampled review distributions are scored only when their mean is close enough
// to the product aggregate rating to avoid treating a skewed page sample as the
// full product consensus.
export const RATING_CONSENSUS_SAMPLE_MEAN_MISMATCH_THRESHOLD = 0.75;

export const RATING_CONSENSUS_CALCULATION_METHOD =
  "distribution_adjusted_rating_consensus_quality_v1";

interface RatingConsensusCalculation {
  totalDistributionCount: number;
  mean: number;
  variance: number;
  standardDeviation: number;
  qualityGate: number;
  shapeSupport: number;
  lowTailPenalty: number;
  ratingConsensusQuality: number;
}

function totalCount(input: RatingDistributionInput): number {
  return input.star1Count
    + input.star2Count
    + input.star3Count
    + input.star4Count
    + input.star5Count;
}

function starCounts(input: RatingDistributionInput): number[] {
  return [
    input.star1Count,
    input.star2Count,
    input.star3Count,
    input.star4Count,
    input.star5Count,
  ];
}

function calculateRawRatingConsensus(input: RatingDistributionInput): RatingConsensusCalculation {
  const totalDistributionCount = totalCount(input);
  const counts = starCounts(input);
  const probabilities = counts.map((count) => totalDistributionCount > 0 ? count / totalDistributionCount : 0);
  const mean = probabilities.reduce((sum, probability, index) => sum + (index + 1) * probability, 0);
  const variance = probabilities.reduce(
    (sum, probability, index) => sum + probability * ((index + 1) - mean) ** 2,
    0
  );
  const standardDeviation = Math.sqrt(variance);
  const [p1, p2, p3, , p5] = probabilities;
  const qualityGate = normalizeLinear(mean, 2.8, 4.3);
  const shapeSupport = clamp(
    100
    - 35 * Math.min(1, standardDeviation / 2)
    - 90 * Math.min(p1 + p2, p5)
    - 40 * Math.max(0, p5 - 0.85)
  );
  const lowTailPenalty = 60 * p1 + 30 * p2 + 6 * p3;
  const ratingConsensusQuality = clamp(shapeSupport * qualityGate / 100 - lowTailPenalty);

  return {
    totalDistributionCount,
    mean,
    variance,
    standardDeviation,
    qualityGate,
    shapeSupport,
    lowTailPenalty,
    ratingConsensusQuality,
  };
}

export function calculateRatingConsensusQuality(input: RatingDistributionInput): Omit<
  RatingConsensusQualityResult,
  | "status"
  | "ratingConsensusQuality"
  | "provisionalRatingConsensusQuality"
  | "aggregateAverageRating"
  | "aggregateRatingDelta"
  | "aggregateRatingMismatchThreshold"
> {
  const calculated = calculateRawRatingConsensus(input);

  return {
    ...input,
    totalDistributionCount: calculated.totalDistributionCount,
    mean: roundTo(calculated.mean, 4),
    standardDeviation: roundTo(calculated.standardDeviation, 4),
    variance: roundTo(calculated.variance, 4),
    qualityGate: roundTo(calculated.qualityGate, 2),
    shapeSupport: roundTo(calculated.shapeSupport, 2),
    lowTailPenalty: roundTo(calculated.lowTailPenalty, 2),
    calculationMethod: RATING_CONSENSUS_CALCULATION_METHOD,
  };
}

export function buildRatingConsensusQuality(input: RatingDistributionInput & {
  aggregateAverageRating?: number;
  minimumScoringSampleSize?: number;
  provisionalSampleSize?: number;
  mismatchThreshold?: number;
}): RatingConsensusQualityResult {
  const calculated = calculateRawRatingConsensus(input);
  const base = calculateRatingConsensusQuality(input);
  const minimumScoringSampleSize = input.minimumScoringSampleSize ?? RATING_CONSENSUS_MIN_SCORING_SAMPLE_SIZE;
  const provisionalSampleSize = input.provisionalSampleSize ?? RATING_CONSENSUS_PROVISIONAL_SAMPLE_SIZE;
  const mismatchThreshold = input.mismatchThreshold ?? RATING_CONSENSUS_SAMPLE_MEAN_MISMATCH_THRESHOLD;
  const aggregateAverageRating = typeof input.aggregateAverageRating === "number"
    ? input.aggregateAverageRating
    : undefined;
  const aggregateRatingDelta = typeof aggregateAverageRating === "number"
    ? roundTo(Math.abs(base.mean - aggregateAverageRating), 4)
    : undefined;
  const hasSampleMismatch = input.distributionSource === "review_items" &&
    typeof aggregateRatingDelta === "number" &&
    aggregateRatingDelta > mismatchThreshold;
  const computedQuality = roundTo(calculated.ratingConsensusQuality, 1);

  if (hasSampleMismatch) {
    return {
      ...base,
      status: "mismatch",
      aggregateAverageRating,
      aggregateRatingDelta,
      aggregateRatingMismatchThreshold: mismatchThreshold,
    };
  }

  if (base.totalDistributionCount >= minimumScoringSampleSize) {
    return {
      ...base,
      status: "derived-live",
      ratingConsensusQuality: computedQuality,
      aggregateAverageRating,
      aggregateRatingDelta,
      aggregateRatingMismatchThreshold: mismatchThreshold,
    };
  }

  if (base.totalDistributionCount >= provisionalSampleSize) {
    return {
      ...base,
      status: "provisional",
      provisionalRatingConsensusQuality: computedQuality,
      aggregateAverageRating,
      aggregateRatingDelta,
      aggregateRatingMismatchThreshold: mismatchThreshold,
    };
  }

  return {
    ...base,
    status: "insufficient",
    aggregateAverageRating,
    aggregateRatingDelta,
    aggregateRatingMismatchThreshold: mismatchThreshold,
  };
}
