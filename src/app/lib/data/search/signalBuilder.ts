import type { NormalizedTrendSignal } from "../types";
import {
  averageSearchInterestForWindow,
  buildSearchWindows,
  calculateAliasCoveragePercent,
  calculatePercentChange,
  calculateSearchBaselineReadiness,
  calculateSearchConfidence,
  calculateTrailingDailyGrowthStreak,
  hasLowBaseSearchGrowth,
  normalizeConsecutiveGrowthDays,
  normalizeSearchAcceleration,
  normalizeSearchGrowth,
  normalizeSearchGrowthWithBaselineReadiness,
  normalizeSearchInterest,
} from "./normalization";
import type { SearchInterestSeries, SearchSignalBuildResult, SearchSignalSummary } from "./types";

const MIN_30D_WINDOW_POINTS = 21;

function calculateFreshnessHours(series: SearchInterestSeries, now: Date): number {
  const fetchedAtMs = Date.parse(series.fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) return 168;
  return Math.max(0, Math.round((now.getTime() - fetchedAtMs) / 3600000));
}

function buildMetadata(summary: SearchSignalSummary) {
  return {
    provider: "dataforseo_trends",
    sourceName: "DataForSEO Trends API",
    sourceMetric: "Search Interest",
    aliasesUsed: summary.aliasesUsed.join(", "),
    queriesMatched: summary.queriesMatched,
    sampleSize: summary.observationCount,
    timestamp: summary.timestamp,
    locationCode: summary.locationCode,
    current7dStart: summary.windows.current7d.dateFrom,
    current7dEnd: summary.windows.current7d.dateTo,
    previous7dStart: summary.windows.previous7d.dateFrom,
    previous7dEnd: summary.windows.previous7d.dateTo,
    current7dRelativeInterest: summary.current7dInterest,
    previous7dRelativeInterest: summary.previous7dInterest,
    searchGrowthBaselineReadiness: summary.baselineReadiness,
    lowBaseSearchGrowth: summary.lowBaseGrowth,
    prior7dStart: summary.windows.prior7d.dateFrom,
    prior7dEnd: summary.windows.prior7d.dateTo,
    current30dStart: summary.windows.current30d.dateFrom,
    current30dEnd: summary.windows.current30d.dateTo,
    previous30dStart: summary.windows.previous30d.dateFrom,
    previous30dEnd: summary.windows.previous30d.dateTo,
    aliasCoveragePercent: summary.aliasCoveragePercent,
    consecutiveGrowthDays: summary.consecutiveGrowthDays,
    hasSufficientData: summary.hasSufficientData,
  };
}

export function buildSearchSignalsFromSeries(input: {
  productId: string;
  series: SearchInterestSeries;
  now: Date;
  minSampleSize: number;
}): SearchSignalBuildResult {
  const windows = buildSearchWindows(input.now);
  const current7d = averageSearchInterestForWindow(input.series.points, windows.current7d);
  const previous7d = averageSearchInterestForWindow(input.series.points, windows.previous7d);
  const prior7d = averageSearchInterestForWindow(input.series.points, windows.prior7d);
  const current30d = averageSearchInterestForWindow(input.series.points, windows.current30d);
  const previous30d = averageSearchInterestForWindow(input.series.points, windows.previous30d);
  const change7dPercent = calculatePercentChange(current7d.interest, previous7d.interest);
  const previous7dChangePercent = calculatePercentChange(previous7d.interest, prior7d.interest);
  const consecutiveGrowthDays = calculateTrailingDailyGrowthStreak(input.series.points, windows.current7d);
  const baselineReadiness = calculateSearchBaselineReadiness(previous7d.interest);
  const lowBaseGrowth = hasLowBaseSearchGrowth(previous7d.interest);
  const aliasCoveragePercent = calculateAliasCoveragePercent(input.series.points, input.series.aliases);
  const observationCount = input.series.points
    .filter((point) => !point.missingData)
    .reduce((sum, point) => sum + Object.values(point.valuesByAlias).filter((value) => Number.isFinite(value)).length, 0);
  const hasCurrentAndPrevious7d = current7d.pointCount > 0 && previous7d.pointCount > 0;
  const hasPrior7d = previous7d.pointCount > 0 && prior7d.pointCount > 0;
  // A `past_30_days` response can include a single boundary point just outside
  // the current 30-day range. Require enough daily coverage before treating it
  // as a comparable previous 30-day window.
  const has30dWindows =
    current30d.pointCount >= MIN_30D_WINDOW_POINTS &&
    previous30d.pointCount >= MIN_30D_WINDOW_POINTS;
  const change30dPercent = has30dWindows
    ? calculatePercentChange(current30d.interest, previous30d.interest)
    : undefined;
  // With a `past_30_days` daily series, acceleration is best measured as the
  // change in 7-day growth rate: current-vs-previous 7d minus previous-vs-prior
  // 7d. If the prior 7-day window is absent, this live field is omitted so the
  // existing mock fallback can continue supplying acceleration.
  const accelerationPercent = hasPrior7d
    ? change7dPercent - previous7dChangePercent
    : undefined;
  const confidence = calculateSearchConfidence({
    observationCount,
    minSampleSize: input.minSampleSize,
    aliasCoveragePercent,
    freshnessHours: calculateFreshnessHours(input.series, input.now),
    hasCurrentAndPrevious7d,
    has30dWindows,
  });
  const summary: SearchSignalSummary = {
    productId: input.productId,
    provider: input.series.provider,
    mode: "live",
    locationCode: input.series.locationCode,
    timestamp: input.now.toISOString(),
    aliasesUsed: input.series.aliases,
    queriesMatched: Math.round((aliasCoveragePercent / 100) * input.series.aliases.length),
    current7dInterest: current7d.interest,
    previous7dInterest: previous7d.interest,
    prior7dInterest: hasPrior7d ? prior7d.interest : undefined,
    change7dPercent,
    previous7dChangePercent: hasPrior7d ? previous7dChangePercent : undefined,
    current30dInterest: has30dWindows ? current30d.interest : undefined,
    previous30dInterest: has30dWindows ? previous30d.interest : undefined,
    change30dPercent,
    accelerationPercent,
    consecutiveGrowthDays: hasCurrentAndPrevious7d ? consecutiveGrowthDays : undefined,
    observationCount,
    aliasCoveragePercent,
    freshnessHours: calculateFreshnessHours(input.series, input.now),
    confidence,
    baselineReadiness,
    lowBaseGrowth,
    hasSufficientData: hasCurrentAndPrevious7d && observationCount >= input.minSampleSize,
    windows: {
      current7d: windows.current7d,
      previous7d: windows.previous7d,
      prior7d: windows.prior7d,
      current30d: windows.current30d,
      previous30d: windows.previous30d,
    },
  };
  const metadata = buildMetadata(summary);
  const signals: NormalizedTrendSignal[] = [
    {
      source: "searchWeb",
      signalType: "searchMomentum",
      productId: input.productId,
      sourceProvenance: {
        mode: "live",
        provider: "dataforseo_trends",
        providerLabel: "DataForSEO Trends API",
        providerMetric: "current7dRelativeSearchInterest",
        approvalStatus: "not-required",
        liveApiRequestMade: true,
      },
      value: current7d.interest,
      normalizedValue: normalizeSearchInterest(current7d.interest),
      previousValue: previous7d.interest,
      percentChange: change7dPercent,
      sampleSize: observationCount,
      timestamp: summary.timestamp,
      confidence,
      metadata: {
        ...metadata,
        providerMetric: "current7dRelativeSearchInterest",
        engineField: "current7dRelativeInterest",
        engineValue: current7d.interest,
      },
    },
    {
      source: "searchWeb",
      signalType: "searchMomentum",
      productId: input.productId,
      sourceProvenance: {
        mode: "derived-live",
        provider: "dataforseo_trends",
        providerLabel: "DataForSEO Trends API",
        providerMetric: "searchInterestGrowth7d",
        approvalStatus: "not-required",
        liveApiRequestMade: true,
      },
      value: change7dPercent,
      normalizedValue: normalizeSearchGrowthWithBaselineReadiness({
        growthPercent: change7dPercent,
        previous7dRelativeInterest: previous7d.interest,
      }),
      previousValue: previous7d.interest,
      percentChange: change7dPercent,
      sampleSize: observationCount,
      timestamp: summary.timestamp,
      confidence,
      metadata: {
        ...metadata,
        providerMetric: "searchInterestGrowth7d",
        rawNormalizedGrowthScore: normalizeSearchGrowth(change7dPercent),
        engineField: "searchGrowthPercent",
        engineValue: change7dPercent,
      },
    },
    {
      source: "searchWeb",
      signalType: "growthVelocity",
      productId: input.productId,
      sourceProvenance: {
        mode: "derived-live",
        provider: "dataforseo_trends",
        providerLabel: "DataForSEO Trends API",
        providerMetric: "searchInterestTrendChange7d",
        approvalStatus: "not-required",
        liveApiRequestMade: true,
      },
      value: change7dPercent,
      normalizedValue: normalizeSearchGrowth(change7dPercent),
      previousValue: previous7d.interest,
      percentChange: change7dPercent,
      sampleSize: observationCount,
      timestamp: summary.timestamp,
      confidence,
      metadata: {
        ...metadata,
        providerMetric: "searchInterestTrendChange7d",
        engineField: "trendChangePercent",
        engineValue: change7dPercent,
        searchDerived: true,
      },
    },
  ];

  if (typeof accelerationPercent === "number") {
    signals.push({
      source: "searchWeb",
      signalType: "growthVelocity",
      productId: input.productId,
      sourceProvenance: {
        mode: "derived-live",
        provider: "dataforseo_trends",
        providerLabel: "DataForSEO Trends API",
        providerMetric: "searchInterestAcceleration",
        approvalStatus: "not-required",
        liveApiRequestMade: true,
      },
      value: accelerationPercent,
      normalizedValue: normalizeSearchAcceleration(accelerationPercent),
      sampleSize: observationCount,
      timestamp: summary.timestamp,
      confidence,
      metadata: {
        ...metadata,
        providerMetric: "searchInterestAcceleration",
        engineField: "accelerationPercent",
        engineValue: accelerationPercent,
        searchDerived: true,
      },
    });
  }

  if (hasCurrentAndPrevious7d) {
    signals.push({
      source: "searchWeb",
      signalType: "growthVelocity",
      productId: input.productId,
      sourceProvenance: {
        mode: "derived-live",
        provider: "dataforseo_trends",
        providerLabel: "DataForSEO Trends API",
        providerMetric: "searchInterestConsecutiveGrowthDays",
        approvalStatus: "not-required",
        liveApiRequestMade: true,
      },
      value: consecutiveGrowthDays,
      normalizedValue: normalizeConsecutiveGrowthDays(consecutiveGrowthDays),
      sampleSize: observationCount,
      timestamp: summary.timestamp,
      confidence,
      metadata: {
        ...metadata,
        providerMetric: "searchInterestConsecutiveGrowthDays",
        engineField: "consecutiveGrowthDays",
        engineValue: consecutiveGrowthDays,
        searchDerived: true,
      },
    });
  }

  if (has30dWindows && typeof change30dPercent === "number") {
    signals.push({
      source: "searchWeb",
      signalType: "growthVelocity",
      productId: input.productId,
      sourceProvenance: {
        mode: "derived-live",
        provider: "dataforseo_trends",
        providerLabel: "DataForSEO Trends API",
        providerMetric: "searchInterestGrowth30d",
        approvalStatus: "not-required",
        liveApiRequestMade: true,
      },
      value: change30dPercent,
      normalizedValue: normalizeSearchGrowth(change30dPercent),
      previousValue: previous30d.interest,
      percentChange: change30dPercent,
      sampleSize: observationCount,
      timestamp: summary.timestamp,
      confidence,
      metadata: {
        ...metadata,
        providerMetric: "searchInterestGrowth30d",
      },
    });
  }

  return { signals, summary };
}
