import { clamp, normalizeInverseLinear, normalizeLinear, normalizeLogScale, normalizeRatio, roundTo } from "../../scoring/normalization";
import {
  adjustGrowthScoreForSearchBaseline,
  calculateBaselineReadiness,
  isLowBaseSearchGrowth,
} from "../../scoring/searchQuality";
import type {
  SearchEvidenceQuality,
  SearchInterestPoint,
  SearchInterestWindow,
  SearchInterestWindowObservation,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const AVERAGE_MONTH_DAYS = 30.4375;
const SEARCH_VOLUME_ESTIMATE_DAYS = 7;
const DEFAULT_MIN_WINDOW_OBSERVED_VALUES = 1;

export function formatSearchDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function buildSearchWindows(now: Date) {
  // DataForSEO's `past_30_days` response returns one daily point per calendar
  // day, including the snapshot date. These windows are intentionally
  // non-overlapping so a daily point can never influence both current and
  // previous momentum calculations.
  return {
    dateFrom: formatSearchDate(addDays(now, -29)),
    dateTo: formatSearchDate(now),
    current7d: {
      dateFrom: formatSearchDate(addDays(now, -6)),
      dateTo: formatSearchDate(now),
    },
    previous7d: {
      dateFrom: formatSearchDate(addDays(now, -13)),
      dateTo: formatSearchDate(addDays(now, -7)),
    },
    prior7d: {
      dateFrom: formatSearchDate(addDays(now, -20)),
      dateTo: formatSearchDate(addDays(now, -14)),
    },
    current30d: {
      dateFrom: formatSearchDate(addDays(now, -29)),
      dateTo: formatSearchDate(now),
    },
    previous30d: {
      dateFrom: formatSearchDate(addDays(now, -59)),
      dateTo: formatSearchDate(addDays(now, -30)),
    },
  };
}

function parsePointMidpoint(point: SearchInterestPoint): number {
  const startMs = Date.parse(`${point.dateFrom}T00:00:00.000Z`);
  const endMs = Date.parse(`${point.dateTo}T23:59:59.999Z`);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return Number.NaN;

  return startMs + (endMs - startMs) / 2;
}

function parsePointStart(point: SearchInterestPoint): number {
  return Date.parse(`${point.dateFrom}T00:00:00.000Z`);
}

function average(values: number[]): number {
  return roundTo(values.reduce((sum, value) => sum + value, 0) / values.length, 2);
}

function finiteValues(point: SearchInterestPoint): number[] {
  return Object.values(point.valuesByAlias)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function pointAverage(point: SearchInterestPoint): number | undefined {
  const values = finiteValues(point);
  if (!values.length) return undefined;
  return average(values);
}

function evidenceQualityForWindow(
  observedValueCount: number,
  minObservedValues: number
): SearchEvidenceQuality {
  if (observedValueCount <= 0) return "missing";
  if (observedValueCount < minObservedValues) return "sparse";
  return "observed";
}

export function calculatePercentChange(current: number, previous: number): number;
export function calculatePercentChange(
  current: number | undefined,
  previous: number | undefined
): number | undefined;
export function calculatePercentChange(
  current: number | undefined,
  previous: number | undefined
): number | undefined {
  if (
    typeof current !== "number" ||
    typeof previous !== "number" ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous)
  ) {
    return undefined;
  }

  if (previous <= 0) return current > 0 ? 100 : 0;
  return roundTo(((current - previous) / Math.abs(previous)) * 100, 1);
}

export function averageSearchInterestForWindow(
  points: SearchInterestPoint[],
  window: SearchInterestWindow,
  options: { minObservedValues?: number } = {}
): SearchInterestWindowObservation {
  const startMs = Date.parse(`${window.dateFrom}T00:00:00.000Z`);
  const endMs = Date.parse(`${window.dateTo}T23:59:59.999Z`);
  const minObservedValues = options.minObservedValues ?? DEFAULT_MIN_WINDOW_OBSERVED_VALUES;
  const windowPoints = points.filter((point) => {
    const pointMidpoint = parsePointMidpoint(point);
    return Number.isFinite(pointMidpoint) && pointMidpoint >= startMs && pointMidpoint <= endMs;
  });
  const scoped = windowPoints.filter((point) => !point.missingData);
  const values = scoped.flatMap(finiteValues);
  const pointAverages = scoped
    .map(pointAverage)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const missingValueCount = windowPoints.reduce((sum, point) => {
    const valuesByAlias = Object.values(point.valuesByAlias);
    if (point.missingData) return sum + valuesByAlias.length;

    return sum + valuesByAlias
      .filter((value) => typeof value !== "number" || !Number.isFinite(value))
      .length;
  }, 0);

  return {
    ...(pointAverages.length ? { interest: average(pointAverages) } : {}),
    pointCount: scoped.length,
    observedValueCount: values.length,
    missingValueCount,
    zeroValueCount: values.filter((value) => value === 0).length,
    positiveValueCount: values.filter((value) => value > 0).length,
    evidenceQuality: evidenceQualityForWindow(values.length, minObservedValues),
  };
}

export function calculateTrailingDailyGrowthStreak(
  points: SearchInterestPoint[],
  window: SearchInterestWindow
): number {
  const startMs = Date.parse(`${window.dateFrom}T00:00:00.000Z`);
  const endMs = Date.parse(`${window.dateTo}T23:59:59.999Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;

  const scoped = points
    .filter((point) => {
      const pointStart = parsePointStart(point);
      return (
        Number.isFinite(pointStart) &&
        pointStart >= startMs - DAY_MS &&
        pointStart <= endMs &&
        !point.missingData
      );
    })
    .map((point) => ({
      dateMs: parsePointStart(point),
      interest: pointAverage(point),
    }))
    .filter((point): point is { dateMs: number; interest: number } =>
      Number.isFinite(point.dateMs) &&
      typeof point.interest === "number" &&
      Number.isFinite(point.interest)
    )
    .sort((a, b) => a.dateMs - b.dateMs);
  const latestIndex = scoped.findLastIndex((point) => point.dateMs >= startMs && point.dateMs <= endMs);
  if (latestIndex < 0) return 0;

  let streak = 0;
  for (let index = latestIndex; index > 0 && streak < 7; index -= 1) {
    const current = scoped[index];
    const previous = scoped[index - 1];
    if (current.dateMs - previous.dateMs !== DAY_MS || current.interest <= previous.interest) break;
    streak += 1;
  }

  return streak;
}

export function calculateAliasCoveragePercent(points: SearchInterestPoint[], aliases: readonly string[]): number {
  if (!aliases.length) return 0;

  const aliasesWithData = aliases.filter((alias) =>
    points.some((point) => {
      const value = point.valuesByAlias[alias];
      return typeof value === "number" && Number.isFinite(value) && value > 0;
    })
  ).length;

  return roundTo(normalizeRatio(aliasesWithData, aliases.length), 1);
}

export function calculateSearchConfidence(input: {
  observationCount: number;
  minSampleSize: number;
  aliasCoveragePercent: number;
  freshnessHours: number;
  hasCurrentAndPrevious7d: boolean;
  has30dWindows: boolean;
}): number {
  if (!input.hasCurrentAndPrevious7d || input.observationCount < input.minSampleSize) {
    // Low data should keep live search from overpowering the mock baseline.
    return roundTo(normalizeLinear(input.observationCount, 0, input.minSampleSize) * 0.45, 2);
  }

  const sampleScore = normalizeLinear(input.observationCount, input.minSampleSize, 20);
  const freshnessScore = normalizeInverseLinear(input.freshnessHours, 0, 168);
  const windowBonus = input.has30dWindows ? 10 : 0;

  return roundTo(
    clamp(
      45 +
        sampleScore * 0.2 +
        input.aliasCoveragePercent * 0.2 +
        freshnessScore * 0.25 +
        windowBonus
    ),
    2
  );
}

export function normalizeSearchInterest(value: number): number {
  // DataForSEO Trends values are already relative popularity scores where 100
  // is peak interest in the requested comparison window.
  return roundTo(clamp(value), 2);
}

export function monthlyToSevenDaySearchVolumeFactor(): number {
  return SEARCH_VOLUME_ESTIMATE_DAYS / AVERAGE_MONTH_DAYS;
}

export function estimateSevenDaySearchVolume(monthlySearchVolume: number): number {
  return roundTo(Math.max(0, monthlySearchVolume) * monthlyToSevenDaySearchVolumeFactor(), 0);
}

export function normalizeSearchVolume7d(value: number): number {
  return roundTo(normalizeLogScale(value, 100, 250000), 2);
}

export function normalizeSearchGrowth(value: number): number {
  // Reuse TrendIQ v1's growth interpretation: -20% is cold, +120% is a strong
  // near-term discovery spike. This normalizes the provider signal only.
  return roundTo(normalizeLinear(value, -20, 120), 2);
}

export function calculateSearchBaselineReadiness(previous7dRelativeInterest: number): number {
  return calculateBaselineReadiness(previous7dRelativeInterest);
}

export function hasLowBaseSearchGrowth(previous7dRelativeInterest: number): boolean {
  return isLowBaseSearchGrowth(previous7dRelativeInterest);
}

export function normalizeSearchGrowthWithBaselineReadiness(input: {
  growthPercent: number;
  previous7dRelativeInterest: number;
}): number {
  return adjustGrowthScoreForSearchBaseline({
    rawNormalizedGrowthScore: normalizeSearchGrowth(input.growthPercent),
    previous7dRelativeInterest: input.previous7dRelativeInterest,
  });
}

export function normalizeSearchAcceleration(value: number): number {
  // Acceleration follows the v1 growth velocity assumption: -40% to +60% spans
  // sharp slowdown through fast acceleration.
  return roundTo(normalizeLinear(value, -40, 60), 2);
}

export function normalizeConsecutiveGrowthDays(value: number): number {
  return roundTo(normalizeLinear(value, 0, 7), 2);
}
