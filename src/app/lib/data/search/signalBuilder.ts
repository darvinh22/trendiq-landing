import type { NormalizedTrendSignal } from "../types";
import {
  averageSearchInterestForWindow,
  buildSearchWindows,
  calculateAliasCoveragePercent,
  calculatePercentChange,
  calculateSearchBaselineReadiness,
  calculateSearchConfidence,
  calculateTrailingDailyGrowthStreak,
  estimateSevenDaySearchVolume,
  hasLowBaseSearchGrowth,
  normalizeConsecutiveGrowthDays,
  normalizeSearchAcceleration,
  normalizeSearchGrowth,
  normalizeSearchGrowthWithBaselineReadiness,
  normalizeSearchInterest,
  normalizeSearchVolume7d,
  monthlyToSevenDaySearchVolumeFactor,
} from "./normalization";
import type {
  SearchEvidenceQuality,
  SearchInterestSeries,
  SearchInterestWindowObservation,
  SearchSignalBuildResult,
  SearchSignalSummary,
  SearchVolumeSeries,
} from "./types";

const MIN_30D_WINDOW_POINTS = 21;
const MIN_7D_COMPARISON_OBSERVED_VALUES = 4;
const SEARCH_VOLUME_CONFIDENCE = 88;

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
    prior7dRelativeInterest: summary.prior7dInterest,
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
    evidenceQuality: summary.evidenceQuality,
    current7dEvidenceQuality: summary.current7dEvidenceQuality,
    previous7dEvidenceQuality: summary.previous7dEvidenceQuality,
    prior7dEvidenceQuality: summary.prior7dEvidenceQuality,
    change7dEvidenceQuality: summary.change7dEvidenceQuality,
    previous7dChangeEvidenceQuality: summary.previous7dChangeEvidenceQuality,
    accelerationEvidenceQuality: summary.accelerationEvidenceQuality,
    current7dObservedValueCount: summary.current7dObservedValueCount,
    previous7dObservedValueCount: summary.previous7dObservedValueCount,
    prior7dObservedValueCount: summary.prior7dObservedValueCount,
    missingValueCount: summary.missingValueCount,
  };
}

function hasFiniteInterest(window: SearchInterestWindowObservation): window is SearchInterestWindowObservation & {
  interest: number;
} {
  return typeof window.interest === "number" && Number.isFinite(window.interest);
}

function comparisonEvidenceQuality(
  current: SearchInterestWindowObservation,
  previous: SearchInterestWindowObservation
): SearchEvidenceQuality {
  if (!hasFiniteInterest(current) || !hasFiniteInterest(previous)) return "missing";
  if (current.evidenceQuality === "observed" && previous.evidenceQuality === "observed") return "observed";
  if (current.evidenceQuality === "sparse" || previous.evidenceQuality === "sparse") return "sparse";
  return "insufficient";
}

function calculateSupportedPercentChange(input: {
  current: SearchInterestWindowObservation;
  previous: SearchInterestWindowObservation;
  evidenceQuality: SearchEvidenceQuality;
}): number | undefined {
  if (input.evidenceQuality !== "observed") return undefined;
  return calculatePercentChange(input.current.interest, input.previous.interest);
}

function accelerationEvidenceQuality(input: {
  change7dEvidenceQuality: SearchEvidenceQuality;
  previous7dChangeEvidenceQuality: SearchEvidenceQuality;
  previous7dInterest?: number;
  prior7dInterest?: number;
}): SearchEvidenceQuality {
  if (
    input.change7dEvidenceQuality !== "observed" ||
    input.previous7dChangeEvidenceQuality !== "observed"
  ) {
    if (
      input.change7dEvidenceQuality === "missing" ||
      input.previous7dChangeEvidenceQuality === "missing"
    ) {
      return "missing";
    }

    return "sparse";
  }

  if (
    typeof input.previous7dInterest !== "number" ||
    typeof input.prior7dInterest !== "number" ||
    calculateSearchBaselineReadiness(input.previous7dInterest) < 1 ||
    calculateSearchBaselineReadiness(input.prior7dInterest) < 1
  ) {
    return "insufficient";
  }

  return "observed";
}

export function buildSearchSignalsFromSeries(input: {
  productId: string;
  series: SearchInterestSeries;
  now: Date;
  minSampleSize: number;
}): SearchSignalBuildResult {
  const windows = buildSearchWindows(input.now);
  const current7d = averageSearchInterestForWindow(input.series.points, windows.current7d, {
    minObservedValues: MIN_7D_COMPARISON_OBSERVED_VALUES,
  });
  const previous7d = averageSearchInterestForWindow(input.series.points, windows.previous7d, {
    minObservedValues: MIN_7D_COMPARISON_OBSERVED_VALUES,
  });
  const prior7d = averageSearchInterestForWindow(input.series.points, windows.prior7d, {
    minObservedValues: MIN_7D_COMPARISON_OBSERVED_VALUES,
  });
  const current30d = averageSearchInterestForWindow(input.series.points, windows.current30d, {
    minObservedValues: MIN_30D_WINDOW_POINTS,
  });
  const previous30d = averageSearchInterestForWindow(input.series.points, windows.previous30d, {
    minObservedValues: MIN_30D_WINDOW_POINTS,
  });
  const change7dEvidenceQuality = comparisonEvidenceQuality(current7d, previous7d);
  const previous7dChangeEvidenceQuality = comparisonEvidenceQuality(previous7d, prior7d);
  const change7dPercent = calculateSupportedPercentChange({
    current: current7d,
    previous: previous7d,
    evidenceQuality: change7dEvidenceQuality,
  });
  const previous7dChangePercent = calculateSupportedPercentChange({
    current: previous7d,
    previous: prior7d,
    evidenceQuality: previous7dChangeEvidenceQuality,
  });
  const consecutiveGrowthDays = calculateTrailingDailyGrowthStreak(input.series.points, windows.current7d);
  const baselineReadiness = hasFiniteInterest(previous7d)
    ? calculateSearchBaselineReadiness(previous7d.interest)
    : 0;
  const lowBaseGrowth = hasFiniteInterest(previous7d)
    ? hasLowBaseSearchGrowth(previous7d.interest)
    : false;
  const aliasCoveragePercent = calculateAliasCoveragePercent(input.series.points, input.series.aliases);
  const observationCount = input.series.points
    .filter((point) => !point.missingData)
    .reduce((sum, point) =>
      sum + Object.values(point.valuesByAlias)
        .filter((value) => typeof value === "number" && Number.isFinite(value))
        .length,
    0);
  const missingValueCount = input.series.points.reduce((sum, point) => {
    const valuesByAlias = Object.values(point.valuesByAlias);
    if (point.missingData) return sum + valuesByAlias.length;

    return sum + valuesByAlias
      .filter((value) => typeof value !== "number" || !Number.isFinite(value))
      .length;
  }, 0);
  const hasSupported7dChange =
    change7dEvidenceQuality === "observed" &&
    typeof change7dPercent === "number";
  const hasSufficientScoringEvidence = hasSupported7dChange && observationCount >= input.minSampleSize;
  // A `past_30_days` response can include a single boundary point just outside
  // the current 30-day range. Require enough daily coverage before treating it
  // as a comparable previous 30-day window.
  const change30dEvidenceQuality = comparisonEvidenceQuality(current30d, previous30d);
  const has30dWindows =
    current30d.pointCount >= MIN_30D_WINDOW_POINTS &&
    previous30d.pointCount >= MIN_30D_WINDOW_POINTS &&
    change30dEvidenceQuality === "observed";
  const change30dPercent = calculateSupportedPercentChange({
    current: current30d,
    previous: previous30d,
    evidenceQuality: has30dWindows ? change30dEvidenceQuality : "insufficient",
  });
  // With a `past_30_days` daily series, acceleration is best measured as the
  // change in 7-day growth rate: current-vs-previous 7d minus previous-vs-prior
  // 7d. Both component changes need independently supported windows, and both
  // baselines must clear the low-base gate before acceleration becomes a
  // scoring signal.
  const accelerationQuality = accelerationEvidenceQuality({
    change7dEvidenceQuality,
    previous7dChangeEvidenceQuality,
    previous7dInterest: previous7d.interest,
    prior7dInterest: prior7d.interest,
  });
  const accelerationPercent =
    hasSufficientScoringEvidence &&
    accelerationQuality === "observed" &&
    typeof change7dPercent === "number" &&
    typeof previous7dChangePercent === "number"
      ? change7dPercent - previous7dChangePercent
      : undefined;
  const confidence = calculateSearchConfidence({
    observationCount,
    minSampleSize: input.minSampleSize,
    aliasCoveragePercent,
    freshnessHours: calculateFreshnessHours(input.series, input.now),
    hasCurrentAndPrevious7d: hasSufficientScoringEvidence,
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
    prior7dInterest: prior7d.interest,
    change7dPercent,
    previous7dChangePercent,
    current30dInterest: has30dWindows ? current30d.interest : undefined,
    previous30dInterest: has30dWindows ? previous30d.interest : undefined,
    change30dPercent,
    accelerationPercent,
    consecutiveGrowthDays: hasSufficientScoringEvidence ? consecutiveGrowthDays : undefined,
    observationCount,
    missingValueCount,
    current7dObservedValueCount: current7d.observedValueCount,
    previous7dObservedValueCount: previous7d.observedValueCount,
    prior7dObservedValueCount: prior7d.observedValueCount,
    current7dEvidenceQuality: current7d.evidenceQuality,
    previous7dEvidenceQuality: previous7d.evidenceQuality,
    prior7dEvidenceQuality: prior7d.evidenceQuality,
    change7dEvidenceQuality,
    previous7dChangeEvidenceQuality,
    accelerationEvidenceQuality: accelerationQuality,
    evidenceQuality: change7dEvidenceQuality,
    aliasCoveragePercent,
    freshnessHours: calculateFreshnessHours(input.series, input.now),
    confidence,
    baselineReadiness,
    lowBaseGrowth,
    hasSufficientData: hasSufficientScoringEvidence,
    windows: {
      current7d: windows.current7d,
      previous7d: windows.previous7d,
      prior7d: windows.prior7d,
      current30d: windows.current30d,
      previous30d: windows.previous30d,
    },
  };
  const metadata = buildMetadata(summary);
  const signals: NormalizedTrendSignal[] = [];

  if (hasFiniteInterest(current7d) && current7d.evidenceQuality === "observed") {
    signals.push({
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
    });
  }

  if (
    hasSufficientScoringEvidence &&
    typeof change7dPercent === "number" &&
    hasFiniteInterest(previous7d)
  ) {
    signals.push({
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
    });

    signals.push({
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
    });
  }

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

  if (hasSufficientScoringEvidence) {
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

export function buildSearchVolumeSignalsFromSeries(input: {
  productId: string;
  series: SearchVolumeSeries;
  now: Date;
}): NormalizedTrendSignal[] {
  const estimated7d = estimateSevenDaySearchVolume(input.series.monthlySearchVolume);
  const matchedKeywords = input.series.observations.map((observation) => observation.keyword);
  const timestamp = input.now.toISOString();

  const monthlyObservation: NormalizedTrendSignal = {
    source: "searchWeb",
    signalType: "searchMomentum",
    productId: input.productId,
    sourceProvenance: {
      mode: "live",
      provider: "dataforseo_google_ads",
      providerLabel: "DataForSEO Google Ads Search Volume API",
      providerMetric: "monthlySearchVolume",
      approvalStatus: "not-required",
      liveApiRequestMade: true,
    },
    value: input.series.monthlySearchVolume,
    normalizedValue: normalizeSearchVolume7d(input.series.monthlySearchVolume),
    sampleSize: input.series.monthlySearchVolume,
    timestamp,
    confidence: SEARCH_VOLUME_CONFIDENCE,
    metadata: {
      provider: "dataforseo_google_ads",
      providerMetric: "monthlySearchVolume",
      sourceMetric: "search_volume",
      sourceEndpoint: input.series.endpoint,
      sourceTimestamp: input.series.fetchedAt,
      sourceTimeGranularity: "monthly",
      monthlySearchVolume: input.series.monthlySearchVolume,
      aliasesUsed: input.series.aliases.join(", "),
      queriesMatched: matchedKeywords.length,
      matchedKeywords: matchedKeywords.join(", "),
      locationCode: input.series.locationCode,
      languageCode: input.series.languageCode,
      volumeAggregationMethod: "sum_alias_monthly_search_volume",
      sourceCost: input.series.cost,
      confidence: SEARCH_VOLUME_CONFIDENCE,
    },
  };

  const derivedWeeklyEstimate: NormalizedTrendSignal = {
    source: "searchWeb",
    signalType: "searchMomentum",
    productId: input.productId,
    sourceProvenance: {
      mode: "derived-live",
      provider: "dataforseo_google_ads",
      providerLabel: "DataForSEO Google Ads Search Volume API",
      providerMetric: "estimated7dSearchVolumeFromMonthlySearchVolume",
      approvalStatus: "not-required",
      liveApiRequestMade: true,
      notes: "Derived from monthly search_volume using monthlySearchVolume * (7 / 30.4375).",
    },
    value: estimated7d,
    normalizedValue: normalizeSearchVolume7d(estimated7d),
    sampleSize: input.series.monthlySearchVolume,
    timestamp,
    confidence: SEARCH_VOLUME_CONFIDENCE,
    metadata: {
      provider: "dataforseo_google_ads",
      providerMetric: "estimated7dSearchVolumeFromMonthlySearchVolume",
      sourceMetric: "search_volume",
      sourceEndpoint: input.series.endpoint,
      sourceTimestamp: input.series.fetchedAt,
      sourceTimeGranularity: "monthly",
      providerMonthlySearchVolume: input.series.monthlySearchVolume,
      monthlyTo7dFormula: "monthlySearchVolume * (7 / 30.4375)",
      monthlyTo7dFactor: monthlyToSevenDaySearchVolumeFactor(),
      derived7dSearchVolume: estimated7d,
      aliasesUsed: input.series.aliases.join(", "),
      queriesMatched: matchedKeywords.length,
      matchedKeywords: matchedKeywords.join(", "),
      locationCode: input.series.locationCode,
      languageCode: input.series.languageCode,
      volumeAggregationMethod: "sum_alias_monthly_search_volume",
      sourceCost: input.series.cost,
      confidence: SEARCH_VOLUME_CONFIDENCE,
      engineField: "searchVolume7d",
      engineValue: estimated7d,
    },
  };

  return [monthlyObservation, derivedWeeklyEstimate];
}
