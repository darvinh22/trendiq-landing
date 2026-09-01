import { clamp, normalizeLinear, roundTo } from "../../scoring/normalization";
import type { RatingConsensusQualityResult, RatingDistributionInput } from "./types";

export const RATING_CONSENSUS_MIN_SCORING_SAMPLE_SIZE = 100;
export const RATING_CONSENSUS_PROVISIONAL_SAMPLE_SIZE = 30;

// Sampled review distributions are scored only when their mean is close enough
// to the product aggregate rating to avoid treating a skewed page sample as the
// full product consensus.
export const RATING_CONSENSUS_SAMPLE_MEAN_MISMATCH_THRESHOLD = 0.75;

// ratingConsensusQuality is a bounded rating-distribution consensus score only;
// it is not text quality, sentiment/theme evidence, authenticity, or identity confidence.
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

function emptyCalculation(): RatingConsensusCalculation {
  return {
    totalDistributionCount: 0,
    mean: 0,
    variance: 0,
    standardDeviation: 0,
    qualityGate: 0,
    shapeSupport: 0,
    lowTailPenalty: 0,
    ratingConsensusQuality: 0,
  };
}

function safeCount(value: number): number {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0 ? value : 0;
}

function safeDistributionInput(input: RatingDistributionInput): RatingDistributionInput {
  return {
    ...input,
    star1Count: safeCount(input.star1Count),
    star2Count: safeCount(input.star2Count),
    star3Count: safeCount(input.star3Count),
    star4Count: safeCount(input.star4Count),
    star5Count: safeCount(input.star5Count),
  };
}

function sourceScopePairIsValid(input: RatingDistributionInput): boolean {
  if (input.distributionSource === "provider_rating_groups") {
    return input.distributionScope === "full_provider_distribution";
  }

  if (input.distributionSource === "review_items") {
    return input.distributionScope === "fetched_review_sample";
  }

  return false;
}

function distributionIntegrityIssue(input: RatingDistributionInput): boolean {
  const counts = starCounts(input);

  return (
    !counts.every((count) => Number.isFinite(count) && Number.isInteger(count) && count >= 0) ||
    !sourceScopePairIsValid(input) ||
    typeof input.distributionComposition !== "string" ||
    !input.distributionComposition.trim()
  );
}

function calculateRawRatingConsensus(input: RatingDistributionInput): RatingConsensusCalculation {
  if (distributionIntegrityIssue(input)) return emptyCalculation();

  const totalDistributionCount = totalCount(input);
  if (!Number.isFinite(totalDistributionCount) || totalDistributionCount <= 0) return emptyCalculation();

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
  const safeInput = safeDistributionInput(input);
  const calculated = calculateRawRatingConsensus(input);

  return {
    ...safeInput,
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
  const hasIntegrityIssue = distributionIntegrityIssue(input) || base.totalDistributionCount <= 0;
  const minimumScoringSampleSize = input.minimumScoringSampleSize ?? RATING_CONSENSUS_MIN_SCORING_SAMPLE_SIZE;
  const provisionalSampleSize = input.provisionalSampleSize ?? RATING_CONSENSUS_PROVISIONAL_SAMPLE_SIZE;
  const mismatchThreshold = input.mismatchThreshold ?? RATING_CONSENSUS_SAMPLE_MEAN_MISMATCH_THRESHOLD;
  const aggregateAverageRating = typeof input.aggregateAverageRating === "number"
    ? input.aggregateAverageRating
    : undefined;
  const aggregateRatingDelta = !hasIntegrityIssue && typeof aggregateAverageRating === "number"
    ? roundTo(Math.abs(base.mean - aggregateAverageRating), 4)
    : undefined;
  const hasSampleMismatch = input.distributionSource === "review_items" &&
    typeof aggregateRatingDelta === "number" &&
    aggregateRatingDelta > mismatchThreshold;
  const computedQuality = roundTo(calculated.ratingConsensusQuality, 1);

  if (hasIntegrityIssue) {
    return {
      ...base,
      status: "insufficient",
      aggregateAverageRating,
      aggregateRatingDelta,
      aggregateRatingMismatchThreshold: mismatchThreshold,
    };
  }

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
