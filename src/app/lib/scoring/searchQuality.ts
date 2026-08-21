import { clamp, roundTo } from "./normalization";

// TrendIQ v1.1 calibration thresholds for relative search-interest data.
// These are intentionally conservative until more live history is collected.
export const MIN_PREVIOUS_7D_INTEREST_FOR_FULL_GROWTH = 10;
export const MIN_CURRENT_7D_INTEREST_FOR_EXPLODING = 25;
export const MIN_PREVIOUS_7D_INTEREST_FOR_EXPLODING = 10;

// Search Momentum owns the main magnitude of search growth. Search-derived
// velocity still matters, but receives secondary credit to avoid counting the
// same DataForSEO movement as two full independent growth signals.
export const SEARCH_DERIVED_VELOCITY_SECONDARY_FACTOR = 0.5;

export function calculateBaselineReadiness(previous7dRelativeInterest: number): number {
  return roundTo(
    clamp(previous7dRelativeInterest / MIN_PREVIOUS_7D_INTEREST_FOR_FULL_GROWTH, 0, 1),
    3
  );
}

export function isLowBaseSearchGrowth(previous7dRelativeInterest: number): boolean {
  return previous7dRelativeInterest < MIN_PREVIOUS_7D_INTEREST_FOR_FULL_GROWTH;
}

export function adjustGrowthScoreForSearchBaseline(input: {
  rawNormalizedGrowthScore: number;
  previous7dRelativeInterest?: number;
  baselineReadiness?: number;
}): number {
  const readiness = typeof input.baselineReadiness === "number"
    ? clamp(input.baselineReadiness, 0, 1)
    : typeof input.previous7dRelativeInterest === "number"
      ? calculateBaselineReadiness(input.previous7dRelativeInterest)
      : 1;

  return roundTo(clamp(input.rawNormalizedGrowthScore) * readiness, 2);
}

export function reduceSearchDerivedVelocityScore(normalizedVelocityScore: number): number {
  return roundTo(clamp(normalizedVelocityScore) * SEARCH_DERIVED_VELOCITY_SECONDARY_FACTOR, 2);
}

export function isEligibleForSearchSupportedExploding(input: {
  changePercent: number;
  current7dRelativeInterest?: number;
  previous7dRelativeInterest?: number;
}): boolean {
  return (
    input.changePercent >= 50 &&
    typeof input.current7dRelativeInterest === "number" &&
    typeof input.previous7dRelativeInterest === "number" &&
    input.current7dRelativeInterest >= MIN_CURRENT_7D_INTEREST_FOR_EXPLODING &&
    input.previous7dRelativeInterest >= MIN_PREVIOUS_7D_INTEREST_FOR_EXPLODING
  );
}
