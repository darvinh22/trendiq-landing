import type { TrendMomentumResult, TrendPoint, TrendStatus } from "./types";
import { roundTo } from "./normalization";
import { isEligibleForSearchSupportedExploding } from "./searchQuality";

export function getMomentumStatus(changePercent: number): TrendStatus {
  // v1 momentum thresholds are intentionally separate from TrendIQ Score:
  // >= +50% is Exploding, >= +10% is Rising, strictly between -10% and +10%
  // is Stable, and <= -10% is Cooling.
  if (changePercent >= 50) return "Exploding";
  if (changePercent >= 10) return "Rising";
  if (changePercent > -10) return "Stable";
  return "Cooling";
}

export function calculateTrendChangePercent(history: TrendPoint[]): number {
  if (history.length < 2) return 0;

  const first = history[0]?.value ?? 0;
  const last = history[history.length - 1]?.value ?? 0;

  if (first === 0) {
    return last > 0 ? 100 : 0;
  }

  return roundTo(((last - first) / Math.abs(first)) * 100, 1);
}

export function calculateTrendMomentum(input: {
  history?: TrendPoint[];
  changePercent?: number;
  current7dRelativeInterest?: number;
  previous7dRelativeInterest?: number;
  hasSearchGrowthContext?: boolean;
  hasLowBaseSearchGrowth?: boolean;
}): TrendMomentumResult {
  const changePercent =
    typeof input.changePercent === "number"
      ? roundTo(input.changePercent, 1)
      : calculateTrendChangePercent(input.history ?? []);
  const hasSearchGrowthContext =
    input.hasSearchGrowthContext ||
    typeof input.current7dRelativeInterest === "number" ||
    typeof input.previous7dRelativeInterest === "number";

  if (
    hasSearchGrowthContext &&
    changePercent >= 50 &&
    !isEligibleForSearchSupportedExploding({
      changePercent,
      current7dRelativeInterest: input.current7dRelativeInterest,
      previous7dRelativeInterest: input.previous7dRelativeInterest,
    })
  ) {
    return {
      changePercent,
      status: "Rising",
      isProvisional: true,
      reason: input.hasLowBaseSearchGrowth
        ? "Search growth is provisional because the previous 7-day relative-interest baseline is below the v1.1 threshold."
        : "Search growth is provisional because relative-interest levels do not meet the v1.1 Exploding gates.",
    };
  }

  return {
    changePercent,
    status: getMomentumStatus(changePercent),
  };
}
