import { calculateTrendMomentum } from "../scoring/momentumEngine";
import { clamp, normalizeLogScale, roundTo } from "../scoring/normalization";
import {
  calculateBaselineReadiness,
  isLowBaseSearchGrowth,
} from "../scoring/searchQuality";
import type { TrendIQSignalInputs, TrendStatus } from "../scoring/types";
import type {
  NormalizedTrendSignal,
  SearchAbsoluteDemandLevel,
  SearchMomentumAbsoluteDemand,
  SearchMomentumBaselineQuality,
  SearchMomentumDirectionalDemand,
  SearchMomentumEvidenceQuality,
  SearchMomentumStrength,
  SearchMomentumV1,
  SignalSourceProvenanceMode,
  TrendSignalMetadata,
} from "./types";

const GOOGLE_ADS_PROVIDER = "dataforseo_google_ads";
const TRENDS_PROVIDER = "dataforseo_trends";
const SEARCH_VOLUME_MIN = 100;
const SEARCH_VOLUME_MAX = 250000;
const ABSOLUTE_DEMAND_CONFIDENCE_WEIGHT = 0.45;
const DIRECTIONAL_DEMAND_CONFIDENCE_WEIGHT = 0.55;

const EVIDENCE_CONFIDENCE: Record<SearchMomentumEvidenceQuality, number> = {
  observed: 85,
  sparse: 45,
  insufficient: 25,
  missing: 0,
};

const BASELINE_CONFIDENCE_MULTIPLIER: Record<SearchMomentumBaselineQuality, number> = {
  weak: 0.45,
  moderate: 0.75,
  strong: 1,
};

function providerFor(signal: NormalizedTrendSignal): string | undefined {
  return signal.sourceProvenance.provider ?? metadataString(signal.metadata, "provider");
}

function providerMetricFor(signal: NormalizedTrendSignal): string | undefined {
  return signal.sourceProvenance.providerMetric ?? metadataString(signal.metadata, "providerMetric");
}

function engineFieldFor(signal: NormalizedTrendSignal): string | undefined {
  return metadataString(signal.metadata, "engineField");
}

function metadataString(metadata: TrendSignalMetadata | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length ? value : undefined;
}

function metadataBoolean(metadata: TrendSignalMetadata | undefined, key: string): boolean | undefined {
  const value = metadata?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function metadataNumber(metadata: TrendSignalMetadata | undefined, key: string): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function finiteSignalValue(signal: NormalizedTrendSignal | undefined): number | undefined {
  return typeof signal?.value === "number" && Number.isFinite(signal.value)
    ? signal.value
    : undefined;
}

function finiteSignalPreviousValue(signal: NormalizedTrendSignal | undefined): number | undefined {
  return typeof signal?.previousValue === "number" && Number.isFinite(signal.previousValue)
    ? signal.previousValue
    : undefined;
}

function signalConfidence(signal: NormalizedTrendSignal): number | undefined {
  return typeof signal.confidence === "number" && Number.isFinite(signal.confidence)
    ? signal.confidence
    : metadataNumber(signal.metadata, "confidence");
}

function maximumSignalConfidence(signals: readonly NormalizedTrendSignal[]): number {
  return signals.reduce((max, signal) => {
    const confidence = signalConfidence(signal);
    return typeof confidence === "number" ? Math.max(max, confidence) : max;
  }, 0);
}

function sourceModeFor(signals: readonly NormalizedTrendSignal[]): SignalSourceProvenanceMode {
  return signals.some((signal) => signal.sourceProvenance.mode === "live")
    ? "live"
    : signals[0]?.sourceProvenance.mode ?? "derived-live";
}

function firstQuery(signals: readonly NormalizedTrendSignal[]): string | undefined {
  const aliasesUsed = signals
    .map((signal) => metadataString(signal.metadata, "aliasesUsed"))
    .find((value): value is string => typeof value === "string");

  return aliasesUsed
    ?.split(",")
    .map((alias) => alias.trim())
    .find(Boolean);
}

function isEvidenceQuality(value: string | undefined): value is SearchMomentumEvidenceQuality {
  return value === "observed" || value === "sparse" || value === "insufficient" || value === "missing";
}

function evidenceQualityFrom(
  signal: NormalizedTrendSignal | undefined,
  keys: readonly string[]
): SearchMomentumEvidenceQuality | undefined {
  for (const key of keys) {
    const value = metadataString(signal?.metadata, key);
    if (isEvidenceQuality(value)) return value;
  }

  return undefined;
}

function signalByEngineField(
  signals: readonly NormalizedTrendSignal[],
  engineField: string
): NormalizedTrendSignal | undefined {
  return signals.find((signal) => engineFieldFor(signal) === engineField);
}

function signalByProviderMetric(
  signals: readonly NormalizedTrendSignal[],
  providerMetric: string
): NormalizedTrendSignal | undefined {
  return signals.find((signal) => providerMetricFor(signal) === providerMetric);
}

export function absoluteDemandLevelForNormalizedScore(score: number): SearchAbsoluteDemandLevel {
  const safeScore = clamp(score);

  if (safeScore < 20) return "Very Low";
  if (safeScore < 40) return "Low";
  if (safeScore < 65) return "Medium";
  if (safeScore < 85) return "High";
  return "Very High";
}

export function strengthForAbsoluteDemandLevel(
  level: SearchAbsoluteDemandLevel | undefined
): SearchMomentumStrength {
  if (level === "High" || level === "Very High") return "High";
  if (level === "Medium") return "Medium";
  return "Low";
}

export function baselineQualityForReadiness(readiness: number): SearchMomentumBaselineQuality {
  const safeReadiness = clamp(readiness, 0, 1);

  if (safeReadiness < 0.4) return "weak";
  if (safeReadiness < 0.8) return "moderate";
  return "strong";
}

export function directionForTrendChangePercent(input: {
  trendChangePercent?: number;
  current7dRelativeInterest?: number;
  previous7dRelativeInterest?: number;
  hasLowBaseSearchGrowth?: boolean;
}): TrendStatus {
  if (typeof input.trendChangePercent !== "number" || !Number.isFinite(input.trendChangePercent)) {
    return "Stable";
  }

  return calculateTrendMomentum({
    changePercent: input.trendChangePercent,
    current7dRelativeInterest: input.current7dRelativeInterest,
    previous7dRelativeInterest: input.previous7dRelativeInterest,
    hasSearchGrowthContext:
      typeof input.current7dRelativeInterest === "number" ||
      typeof input.previous7dRelativeInterest === "number",
    hasLowBaseSearchGrowth: input.hasLowBaseSearchGrowth,
  }).status;
}

function buildAbsoluteDemand(signals: readonly NormalizedTrendSignal[]): SearchMomentumAbsoluteDemand | undefined {
  const googleAdsSignals = signals.filter((signal) => providerFor(signal) === GOOGLE_ADS_PROVIDER);
  if (!googleAdsSignals.length) return undefined;

  const monthlySignal = signalByProviderMetric(googleAdsSignals, "monthlySearchVolume");
  const weeklySignal =
    signalByEngineField(googleAdsSignals, "searchVolume7d") ??
    signalByProviderMetric(googleAdsSignals, "estimated7dSearchVolumeFromMonthlySearchVolume");
  const monthlySearchVolume =
    metadataNumber(monthlySignal?.metadata, "monthlySearchVolume") ??
    metadataNumber(weeklySignal?.metadata, "providerMonthlySearchVolume") ??
    finiteSignalValue(monthlySignal);
  const searchVolume7d =
    metadataNumber(weeklySignal?.metadata, "derived7dSearchVolume") ??
    metadataNumber(weeklySignal?.metadata, "engineValue") ??
    finiteSignalValue(weeklySignal);
  const scoreVolume = searchVolume7d ?? monthlySearchVolume;

  if (typeof scoreVolume !== "number") return undefined;

  const normalizedDemandScore = roundTo(normalizeLogScale(scoreVolume, SEARCH_VOLUME_MIN, SEARCH_VOLUME_MAX), 2);
  const level = absoluteDemandLevelForNormalizedScore(normalizedDemandScore);
  const hasMonthlyVolume = typeof monthlySearchVolume === "number";
  const hasWeeklyVolume = typeof searchVolume7d === "number";
  const completeness = (hasMonthlyVolume ? 0.35 : 0) + (hasWeeklyVolume ? 0.65 : 0);

  return {
    source: GOOGLE_ADS_PROVIDER,
    provenance: sourceModeFor(googleAdsSignals),
    ...(hasMonthlyVolume ? { monthlySearchVolume } : {}),
    ...(hasWeeklyVolume ? { searchVolume7d } : {}),
    normalizedDemandScore,
    level,
    strength: strengthForAbsoluteDemandLevel(level),
    confidence: roundTo(maximumSignalConfidence(googleAdsSignals) * completeness, 2),
    evidenceQuality: "observed",
  };
}

function directionalEvidenceQuality(input: {
  trendChangeSignal?: NormalizedTrendSignal;
  searchGrowthSignal?: NormalizedTrendSignal;
  currentSignal?: NormalizedTrendSignal;
  hasChangeSignal: boolean;
}): SearchMomentumEvidenceQuality {
  const quality =
    evidenceQualityFrom(input.trendChangeSignal, ["change7dEvidenceQuality", "evidenceQuality"]) ??
    evidenceQualityFrom(input.searchGrowthSignal, ["change7dEvidenceQuality", "evidenceQuality"]) ??
    evidenceQualityFrom(input.currentSignal, ["change7dEvidenceQuality", "current7dEvidenceQuality", "evidenceQuality"]);

  if (quality === "observed" && !input.hasChangeSignal) return "insufficient";
  return quality ?? "insufficient";
}

function buildDirectionalDemand(
  signals: readonly NormalizedTrendSignal[],
  aggregatedSignals: TrendIQSignalInputs
): SearchMomentumDirectionalDemand | undefined {
  const trendsSignals = signals.filter((signal) => providerFor(signal) === TRENDS_PROVIDER);
  if (!trendsSignals.length) return undefined;

  const currentSignal = signalByEngineField(trendsSignals, "current7dRelativeInterest");
  const searchGrowthSignal = signalByEngineField(trendsSignals, "searchGrowthPercent");
  const trendChangeSignal = signalByEngineField(trendsSignals, "trendChangePercent");
  const accelerationSignal = signalByEngineField(trendsSignals, "accelerationPercent");
  const consecutiveGrowthSignal = signalByEngineField(trendsSignals, "consecutiveGrowthDays");
  const current7dRelativeInterest =
    metadataNumber(currentSignal?.metadata, "current7dRelativeInterest") ??
    metadataNumber(searchGrowthSignal?.metadata, "current7dRelativeInterest") ??
    metadataNumber(trendChangeSignal?.metadata, "current7dRelativeInterest") ??
    finiteSignalValue(currentSignal);
  const previous7dRelativeInterest =
    metadataNumber(searchGrowthSignal?.metadata, "previous7dRelativeInterest") ??
    metadataNumber(trendChangeSignal?.metadata, "previous7dRelativeInterest") ??
    finiteSignalPreviousValue(searchGrowthSignal) ??
    finiteSignalPreviousValue(trendChangeSignal);
  const searchGrowthPercent =
    metadataNumber(searchGrowthSignal?.metadata, "engineValue") ??
    finiteSignalValue(searchGrowthSignal);
  const trendChangePercent =
    metadataNumber(trendChangeSignal?.metadata, "engineValue") ??
    finiteSignalValue(trendChangeSignal) ??
    searchGrowthPercent;
  const accelerationPercent =
    metadataNumber(accelerationSignal?.metadata, "engineValue") ??
    finiteSignalValue(accelerationSignal);
  const consecutiveGrowthDays =
    metadataNumber(consecutiveGrowthSignal?.metadata, "engineValue") ??
    finiteSignalValue(consecutiveGrowthSignal);
  const baselineReadiness =
    metadataNumber(searchGrowthSignal?.metadata, "searchGrowthBaselineReadiness") ??
    metadataNumber(trendChangeSignal?.metadata, "searchGrowthBaselineReadiness") ??
    (typeof previous7dRelativeInterest === "number"
      ? calculateBaselineReadiness(previous7dRelativeInterest)
      : aggregatedSignals.searchMomentum.searchGrowthBaselineReadiness ?? 0);
  const baselineQuality = baselineQualityForReadiness(baselineReadiness);
  const lowBaseSearchGrowth =
    metadataBoolean(searchGrowthSignal?.metadata, "lowBaseSearchGrowth") ??
    metadataBoolean(trendChangeSignal?.metadata, "lowBaseSearchGrowth") ??
    (typeof previous7dRelativeInterest === "number"
      ? isLowBaseSearchGrowth(previous7dRelativeInterest)
      : aggregatedSignals.searchMomentum.hasLowBaseSearchGrowth);
  const evidenceQuality = directionalEvidenceQuality({
    trendChangeSignal,
    searchGrowthSignal,
    currentSignal,
    hasChangeSignal: typeof trendChangePercent === "number",
  });
  const direction = directionForTrendChangePercent({
    trendChangePercent,
    current7dRelativeInterest,
    previous7dRelativeInterest,
    hasLowBaseSearchGrowth: lowBaseSearchGrowth,
  });

  return {
    source: TRENDS_PROVIDER,
    provenance: sourceModeFor(trendsSignals),
    ...(typeof current7dRelativeInterest === "number" ? { current7dRelativeInterest } : {}),
    ...(typeof previous7dRelativeInterest === "number" ? { previous7dRelativeInterest } : {}),
    ...(typeof searchGrowthPercent === "number" ? { searchGrowthPercent } : {}),
    ...(typeof trendChangePercent === "number" ? { trendChangePercent } : {}),
    ...(typeof accelerationPercent === "number" ? { accelerationPercent } : {}),
    ...(typeof consecutiveGrowthDays === "number" ? { consecutiveGrowthDays } : {}),
    direction,
    confidence: roundTo(
      Math.min(EVIDENCE_CONFIDENCE[evidenceQuality], maximumSignalConfidence(trendsSignals)) *
        BASELINE_CONFIDENCE_MULTIPLIER[baselineQuality],
      2
    ),
    evidenceQuality,
    baselineReadiness,
    baselineQuality,
  };
}

function overallEvidenceQuality(input: {
  absoluteDemand?: SearchMomentumAbsoluteDemand;
  directionalDemand?: SearchMomentumDirectionalDemand;
}): SearchMomentumEvidenceQuality {
  if (input.absoluteDemand && input.directionalDemand) return input.directionalDemand.evidenceQuality;
  if (input.directionalDemand) return input.directionalDemand.evidenceQuality;
  if (input.absoluteDemand) return "insufficient";
  return "missing";
}

export function buildSearchMomentumV1(input: {
  aggregatedSignals: TrendIQSignalInputs;
  rawSignals: readonly NormalizedTrendSignal[];
}): SearchMomentumV1 {
  const absoluteDemand = buildAbsoluteDemand(input.rawSignals);
  const directionalDemand = buildDirectionalDemand(input.rawSignals, input.aggregatedSignals);
  const sources = [
    ...(absoluteDemand ? [`absoluteDemand:${absoluteDemand.source}`] : []),
    ...(directionalDemand ? [`directionalDemand:${directionalDemand.source}`] : []),
  ];
  const query = firstQuery(input.rawSignals);

  return {
    version: "search_momentum_v1",
    direction: directionalDemand?.direction ?? "Stable",
    strength: absoluteDemand?.strength ?? "Low",
    confidence: roundTo(
      (absoluteDemand?.confidence ?? 0) * ABSOLUTE_DEMAND_CONFIDENCE_WEIGHT +
        (directionalDemand?.confidence ?? 0) * DIRECTIONAL_DEMAND_CONFIDENCE_WEIGHT,
      2
    ),
    evidenceQuality: overallEvidenceQuality({ absoluteDemand, directionalDemand }),
    ...(absoluteDemand ? { absoluteDemand } : {}),
    ...(directionalDemand ? { directionalDemand } : {}),
    provenance: {
      measurementScope: "exact",
      ...(query ? { query } : {}),
      sources,
    },
  };
}
