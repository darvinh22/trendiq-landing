import { roundTo } from "../scoring/normalization";
import {
  calculateBaselineReadiness,
  isLowBaseSearchGrowth,
} from "../scoring/searchQuality";
import type { ConfidenceSignals, TrendIQSignalInputs } from "../scoring/types";
import type {
  AggregatedSignalResult,
  DataProvenanceSummary,
  NormalizedTrendSignal,
  SignalSourceProvenanceMode,
  TrendIQDataSource,
  TrendIQSignalType,
} from "./types";

export const DATA_SOURCE_LABELS: Record<TrendIQDataSource, string> = {
  searchWeb: "Search/Web interest",
  googleTrends: "Google Search Trends",
  reddit: "Reddit discussions",
  reviews: "Product reviews",
  social: "Social momentum",
  merchant: "Merchant availability",
  mockHistorical: "Mock historical trend snapshots",
};

type EngineField = readonly [TrendIQSignalType, string];

export const EXPECTED_ENGINE_FIELDS: readonly EngineField[] = [
  ["socialMomentum", "mentions7d"],
  ["socialMomentum", "mentionGrowthPercent"],
  ["socialMomentum", "engagementRatePercent"],
  ["socialMomentum", "creatorPostCount"],
  ["searchMomentum", "searchVolume7d"],
  ["searchMomentum", "searchGrowthPercent"],
  ["searchMomentum", "queryShareOfCategoryPercent"],
  ["sentiment", "positiveMentionPercent"],
  ["sentiment", "negativeMentionPercent"],
  ["reviewQuality", "averageRating"],
  ["reviewQuality", "reviewCount"],
  ["reviewQuality", "verifiedPurchasePercent"],
  ["reviewQuality", "recentAverageRating"],
  ["purchaseIntent", "buyingKeywordSharePercent"],
  ["purchaseIntent", "addToCartRatePercent"],
  ["purchaseIntent", "affiliateClickThroughRatePercent"],
  ["purchaseIntent", "saveRatePercent"],
  ["growthVelocity", "trendChangePercent"],
  ["growthVelocity", "accelerationPercent"],
  ["growthVelocity", "consecutiveGrowthDays"],
  ["hypeSustainability", "repeatMentionRatePercent"],
  ["hypeSustainability", "sourceHalfLifeDays"],
  ["hypeSustainability", "creatorConcentrationPercent"],
  ["hypeSustainability", "evergreenInterestPercent"],
];

const EXPECTED_ENGINE_FIELD_COUNT = EXPECTED_ENGINE_FIELDS.length;

function signalKey(signalType: TrendIQSignalType, engineField: string): string {
  return `${signalType}.${engineField}`;
}

function signalProvenanceMode(signal: NormalizedTrendSignal): SignalSourceProvenanceMode {
  return signal.sourceProvenance?.mode ?? "mock";
}

function buildEngineValueMap(signals: NormalizedTrendSignal[]): Map<string, number[]> {
  const values = new Map<string, number[]>();

  for (const signal of signals) {
    const engineField = signal.metadata?.engineField;
    const engineValue = signal.metadata?.engineValue;

    if (!engineField || typeof engineValue !== "number") continue;

    const key = signalKey(signal.signalType, engineField);
    const existing = values.get(key) ?? [];
    values.set(key, [...existing, engineValue]);
  }

  return values;
}

function averageField(values: Map<string, number[]>, signalType: TrendIQSignalType, engineField: string): number {
  const fieldValues = values.get(signalKey(signalType, engineField));

  // Missing fields default to 0 because the score engine expects a complete
  // v1 input object. Confidence completeness records that the field was absent.
  if (!fieldValues?.length) return 0;

  return roundTo(fieldValues.reduce((sum, value) => sum + value, 0) / fieldValues.length, 2);
}

function optionalAverageField(
  values: Map<string, number[]>,
  signalType: TrendIQSignalType,
  engineField: string
): number | undefined {
  const fieldValues = values.get(signalKey(signalType, engineField));
  if (!fieldValues?.length) return undefined;

  return roundTo(fieldValues.reduce((sum, value) => sum + value, 0) / fieldValues.length, 2);
}

function optionalAverageMetadataNumber(signals: NormalizedTrendSignal[], key: string): number | undefined {
  const fieldValues = signals
    .map((signal) => signal.metadata?.[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (!fieldValues.length) return undefined;

  return roundTo(fieldValues.reduce((sum, value) => sum + value, 0) / fieldValues.length, 3);
}

function metadataSignalCount(signals: NormalizedTrendSignal[], key: string): number {
  return signals.filter((signal) => signal.metadata?.[key] === true).length;
}

function optionalAverageEngineValueByProvenance(
  signals: NormalizedTrendSignal[],
  signalType: TrendIQSignalType,
  engineField: string,
  searchDerived: boolean
): number | undefined {
  const fieldValues = signals
    .filter((signal) =>
      signal.signalType === signalType &&
      signal.metadata?.engineField === engineField &&
      isSearchDerivedSignal(signal) === searchDerived &&
      typeof signal.metadata.engineValue === "number"
    )
    .map((signal) => signal.metadata?.engineValue)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (!fieldValues.length) return undefined;

  return roundTo(fieldValues.reduce((sum, value) => sum + value, 0) / fieldValues.length, 2);
}

function isSearchDerivedSignal(signal: NormalizedTrendSignal): boolean {
  return signal.metadata?.searchDerived === true || signal.metadata?.provider === "dataforseo_trends";
}

function optionalAveragePreviousValue(signals: NormalizedTrendSignal[], providerMetric: string): number | undefined {
  const fieldValues = signals
    .filter((signal) =>
      signal.metadata?.providerMetric === providerMetric &&
      typeof signal.previousValue === "number"
    )
    .map((signal) => signal.previousValue)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (!fieldValues.length) return undefined;

  return roundTo(fieldValues.reduce((sum, value) => sum + value, 0) / fieldValues.length, 2);
}

function optionalAverageSignalValue(signals: NormalizedTrendSignal[], providerMetrics: string[]): number | undefined {
  const metricSet = new Set(providerMetrics);
  const fieldValues = signals
    .filter((signal) => metricSet.has(String(signal.metadata?.providerMetric)))
    .map((signal) => signal.value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (!fieldValues.length) return undefined;

  return roundTo(fieldValues.reduce((sum, value) => sum + value, 0) / fieldValues.length, 2);
}

function calculateNewestSignalAgeHours(signals: NormalizedTrendSignal[], timestamp: string): number {
  if (!signals.length) return 168;

  const snapshotTime = Date.parse(timestamp);
  const newestSignalTime = Math.max(...signals.map((signal) => Date.parse(signal.timestamp)));

  if (!Number.isFinite(snapshotTime) || !Number.isFinite(newestSignalTime)) return 168;

  // Recency is measured from the newest available source because any fresh
  // source can confirm that the snapshot is not wholly stale.
  return roundTo(Math.max(0, (snapshotTime - newestSignalTime) / 3600000), 1);
}

export function buildDataProvenance(signals: NormalizedTrendSignal[], generatedAt: string): DataProvenanceSummary {
  const grouped = new Map<TrendIQDataSource, NormalizedTrendSignal[]>();

  for (const signal of signals) {
    const existing = grouped.get(signal.source) ?? [];
    grouped.set(signal.source, [...existing, signal]);
  }

  const sources = [...grouped.entries()]
    .map(([source, sourceSignals]) => ({
      source,
      label: DATA_SOURCE_LABELS[source],
      signalCount: sourceSignals.length,
      modes: [...new Set(sourceSignals.map(signalProvenanceMode))].sort(),
      lastUpdated: sourceSignals
        .map((signal) => signal.timestamp)
        .sort()
        .at(-1) ?? generatedAt,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    generatedAt,
    sources,
  };
}

export function buildConfidenceSignals(signals: NormalizedTrendSignal[], timestamp: string): ConfidenceSignals {
  const values = buildEngineValueMap(signals);
  const completeSignalCount = EXPECTED_ENGINE_FIELDS.filter(([signalType, engineField]) =>
    values.has(signalKey(signalType, engineField))
  ).length;
  const previous7dRelativeInterest =
    optionalAverageMetadataNumber(signals, "previous7dRelativeInterest") ??
    optionalAveragePreviousValue(signals, "searchInterestGrowth7d");
  const searchGrowthBaselineReadiness =
    optionalAverageMetadataNumber(signals, "searchGrowthBaselineReadiness") ??
    (typeof previous7dRelativeInterest === "number"
      ? calculateBaselineReadiness(previous7dRelativeInterest)
      : undefined);
  const lowBaselineGrowthSignalCount =
    metadataSignalCount(signals, "lowBaseSearchGrowth") ||
    (typeof previous7dRelativeInterest === "number" && isLowBaseSearchGrowth(previous7dRelativeInterest)
      ? 1
      : 0);

  return {
    // Data volume sums observed samples across provider signals. This is a
    // confidence proxy only and never changes the TrendIQ Score component math.
    observationCount: signals.reduce((sum, signal) => sum + (signal.sampleSize ?? 0), 0),
    sourceCount: new Set(signals.map((signal) => signal.source)).size,
    newestSignalAgeHours: calculateNewestSignalAgeHours(signals, timestamp),
    // Provider normalizedValue is "higher is better" by convention; 50+ means
    // the signal agrees with an above-baseline trend read.
    agreeingSignalCount: signals.filter((signal) => signal.normalizedValue >= 50).length,
    totalSignalCount: signals.length,
    completeSignalCount,
    expectedSignalCount: EXPECTED_ENGINE_FIELD_COUNT,
    lowBaselineGrowthSignalCount,
    growthInterpretationQuality: searchGrowthBaselineReadiness,
  };
}

export function aggregateSignals(
  productId: string,
  rawSignals: NormalizedTrendSignal[],
  timestamp = new Date().toISOString()
): AggregatedSignalResult {
  const productSignals = rawSignals.filter((signal) => signal.productId === productId);
  const values = buildEngineValueMap(productSignals);
  const previous7dRelativeInterest =
    optionalAverageMetadataNumber(productSignals, "previous7dRelativeInterest") ??
    optionalAveragePreviousValue(productSignals, "searchInterestGrowth7d");
  const current7dRelativeInterest =
    optionalAverageField(values, "searchMomentum", "current7dRelativeInterest") ??
    optionalAverageSignalValue(productSignals, ["current7dRelativeSearchInterest", "current7dSearchInterest"]);
  const searchGrowthBaselineReadiness =
    optionalAverageMetadataNumber(productSignals, "searchGrowthBaselineReadiness") ??
    (typeof previous7dRelativeInterest === "number"
      ? calculateBaselineReadiness(previous7dRelativeInterest)
      : undefined);
  const hasLowBaseSearchGrowth =
    metadataSignalCount(productSignals, "lowBaseSearchGrowth") > 0 ||
    (typeof previous7dRelativeInterest === "number" && isLowBaseSearchGrowth(previous7dRelativeInterest));
  const confidenceSignals = buildConfidenceSignals(productSignals, timestamp);

  const aggregatedSignals: TrendIQSignalInputs = {
    socialMomentum: {
      mentions7d: averageField(values, "socialMomentum", "mentions7d"),
      mentionGrowthPercent: averageField(values, "socialMomentum", "mentionGrowthPercent"),
      engagementRatePercent: averageField(values, "socialMomentum", "engagementRatePercent"),
      creatorPostCount: averageField(values, "socialMomentum", "creatorPostCount"),
    },
    searchMomentum: {
      searchVolume7d: averageField(values, "searchMomentum", "searchVolume7d"),
      searchGrowthPercent: averageField(values, "searchMomentum", "searchGrowthPercent"),
      queryShareOfCategoryPercent: averageField(values, "searchMomentum", "queryShareOfCategoryPercent"),
      current7dRelativeInterest,
      previous7dRelativeInterest,
      searchGrowthBaselineReadiness,
      hasLowBaseSearchGrowth,
    },
    sentiment: {
      positiveMentionPercent: averageField(values, "sentiment", "positiveMentionPercent"),
      negativeMentionPercent: averageField(values, "sentiment", "negativeMentionPercent"),
    },
    reviewQuality: {
      averageRating: averageField(values, "reviewQuality", "averageRating"),
      reviewCount: averageField(values, "reviewQuality", "reviewCount"),
      verifiedPurchasePercent: averageField(values, "reviewQuality", "verifiedPurchasePercent"),
      recentAverageRating: averageField(values, "reviewQuality", "recentAverageRating"),
    },
    purchaseIntent: {
      buyingKeywordSharePercent: averageField(values, "purchaseIntent", "buyingKeywordSharePercent"),
      addToCartRatePercent: averageField(values, "purchaseIntent", "addToCartRatePercent"),
      affiliateClickThroughRatePercent: averageField(values, "purchaseIntent", "affiliateClickThroughRatePercent"),
      saveRatePercent: averageField(values, "purchaseIntent", "saveRatePercent"),
    },
    growthVelocity: {
      trendChangePercent: averageField(values, "growthVelocity", "trendChangePercent"),
      accelerationPercent: averageField(values, "growthVelocity", "accelerationPercent"),
      consecutiveGrowthDays: averageField(values, "growthVelocity", "consecutiveGrowthDays"),
      searchDerivedTrendChangePercent: optionalAverageEngineValueByProvenance(
        productSignals,
        "growthVelocity",
        "trendChangePercent",
        true
      ),
      searchDerivedAccelerationPercent: optionalAverageEngineValueByProvenance(
        productSignals,
        "growthVelocity",
        "accelerationPercent",
        true
      ),
      nonSearchTrendChangePercent: optionalAverageEngineValueByProvenance(
        productSignals,
        "growthVelocity",
        "trendChangePercent",
        false
      ),
      nonSearchAccelerationPercent: optionalAverageEngineValueByProvenance(
        productSignals,
        "growthVelocity",
        "accelerationPercent",
        false
      ),
      searchGrowthBaselineReadiness,
      hasSearchDerivedVelocity: productSignals.some((signal) =>
        signal.signalType === "growthVelocity" && isSearchDerivedSignal(signal)
      ),
      hasLowBaseSearchGrowth,
    },
    hypeSustainability: {
      repeatMentionRatePercent: averageField(values, "hypeSustainability", "repeatMentionRatePercent"),
      sourceHalfLifeDays: averageField(values, "hypeSustainability", "sourceHalfLifeDays"),
      creatorConcentrationPercent: averageField(values, "hypeSustainability", "creatorConcentrationPercent"),
      evergreenInterestPercent: averageField(values, "hypeSustainability", "evergreenInterestPercent"),
    },
    confidence: confidenceSignals,
  };

  return {
    productId,
    timestamp,
    rawSignals: productSignals,
    aggregatedSignals,
    confidenceSignals,
    provenance: buildDataProvenance(productSignals, timestamp),
  };
}
