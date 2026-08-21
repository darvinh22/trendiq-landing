import { TRENDIQ_SCORE_WEIGHTS } from "../scoring/scoreEngine";
import { roundTo } from "../scoring/normalization";
import type {
  ConfidenceScoreResult,
  TrendIQScoreComponentKey,
  TrendIQScoreResult,
  TrendMomentumResult,
} from "../scoring/types";
import type {
  NormalizedTrendSignal,
  SignalSourceProvenanceMode,
  SnapshotSourceMode,
  TrendIQComponentProvenanceSummary,
  TrendIQProvenanceFieldSummary,
  TrendIQSnapshotProvenanceSummary,
} from "./types";

const PROVENANCE_MODES: readonly SignalSourceProvenanceMode[] = [
  "live",
  "mock",
  "fallback",
  "derived-live",
  "derived-mixed",
];

const LIVE_BACKED_MODES = new Set<SignalSourceProvenanceMode>(["live", "derived-live"]);
const MOCK_FALLBACK_MODES = new Set<SignalSourceProvenanceMode>(["mock", "fallback"]);

interface ScoreFieldSpec {
  engineField: string;
  engineFields: readonly string[];
  weight: number;
  derivedFromMultipleFields?: boolean;
}

const COMPONENT_FIELD_WEIGHTS: Record<TrendIQScoreComponentKey, readonly ScoreFieldSpec[]> = {
  socialMomentum: [
    { engineField: "mentions7d", engineFields: ["mentions7d"], weight: 0.3 },
    { engineField: "mentionGrowthPercent", engineFields: ["mentionGrowthPercent"], weight: 0.35 },
    { engineField: "engagementRatePercent", engineFields: ["engagementRatePercent"], weight: 0.2 },
    { engineField: "creatorPostCount", engineFields: ["creatorPostCount"], weight: 0.15 },
  ],
  searchMomentum: [
    { engineField: "searchVolume7d", engineFields: ["searchVolume7d"], weight: 0.35 },
    { engineField: "searchGrowthPercent", engineFields: ["searchGrowthPercent"], weight: 0.45 },
    { engineField: "queryShareOfCategoryPercent", engineFields: ["queryShareOfCategoryPercent"], weight: 0.2 },
  ],
  sentiment: [
    {
      engineField: "netMentionSentimentPercent",
      engineFields: ["positiveMentionPercent", "negativeMentionPercent"],
      weight: 0.55,
      derivedFromMultipleFields: true,
    },
    { engineField: "positiveMentionPercent", engineFields: ["positiveMentionPercent"], weight: 0.3 },
    { engineField: "negativeMentionPercent", engineFields: ["negativeMentionPercent"], weight: 0.15 },
  ],
  reviewQuality: [
    { engineField: "averageRating", engineFields: ["averageRating"], weight: 0.45 },
    { engineField: "reviewCount", engineFields: ["reviewCount"], weight: 0.25 },
    { engineField: "verifiedPurchasePercent", engineFields: ["verifiedPurchasePercent"], weight: 0.15 },
    { engineField: "recentAverageRating", engineFields: ["recentAverageRating"], weight: 0.15 },
  ],
  purchaseIntent: [
    { engineField: "buyingKeywordSharePercent", engineFields: ["buyingKeywordSharePercent"], weight: 0.35 },
    { engineField: "addToCartRatePercent", engineFields: ["addToCartRatePercent"], weight: 0.25 },
    {
      engineField: "affiliateClickThroughRatePercent",
      engineFields: ["affiliateClickThroughRatePercent"],
      weight: 0.2,
    },
    { engineField: "saveRatePercent", engineFields: ["saveRatePercent"], weight: 0.2 },
  ],
  growthVelocity: [
    { engineField: "trendChangePercent", engineFields: ["trendChangePercent"], weight: 0.5 },
    { engineField: "accelerationPercent", engineFields: ["accelerationPercent"], weight: 0.3 },
    { engineField: "consecutiveGrowthDays", engineFields: ["consecutiveGrowthDays"], weight: 0.2 },
  ],
  hypeSustainability: [
    { engineField: "repeatMentionRatePercent", engineFields: ["repeatMentionRatePercent"], weight: 0.3 },
    { engineField: "sourceHalfLifeDays", engineFields: ["sourceHalfLifeDays"], weight: 0.25 },
    { engineField: "creatorConcentrationPercent", engineFields: ["creatorConcentrationPercent"], weight: 0.25 },
    { engineField: "evergreenInterestPercent", engineFields: ["evergreenInterestPercent"], weight: 0.2 },
  ],
};

const COMPONENT_KEYS = Object.keys(TRENDIQ_SCORE_WEIGHTS) as TrendIQScoreComponentKey[];

function emptyContributionMap(): Record<SignalSourceProvenanceMode, number> {
  return PROVENANCE_MODES.reduce((mapped, mode) => ({
    ...mapped,
    [mode]: 0,
  }), {} as Record<SignalSourceProvenanceMode, number>);
}

function inferModeForLegacySignal(
  signal: NormalizedTrendSignal,
  sourceMode: SnapshotSourceMode
): SignalSourceProvenanceMode {
  if (signal.metadata?.provider === "dataforseo_trends") {
    return signal.metadata.engineField === "current7dRelativeInterest" ? "live" : "derived-live";
  }

  return sourceMode === "live" ? "fallback" : "mock";
}

function signalMode(signal: NormalizedTrendSignal, sourceMode: SnapshotSourceMode): SignalSourceProvenanceMode {
  return signal.sourceProvenance?.mode ?? inferModeForLegacySignal(signal, sourceMode);
}

function dedupeSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort();
}

function combineModes(
  modes: SignalSourceProvenanceMode[],
  derivedFromMultipleFields = false
): SignalSourceProvenanceMode {
  const uniqueModes = dedupeSorted(modes);
  const hasLive = uniqueModes.some((mode) => LIVE_BACKED_MODES.has(mode));
  const hasMockFallback = uniqueModes.some((mode) => MOCK_FALLBACK_MODES.has(mode));

  if (!uniqueModes.length) return "mock";
  if (uniqueModes.includes("derived-mixed") || (hasLive && hasMockFallback)) return "derived-mixed";
  if (hasLive) {
    if (derivedFromMultipleFields || uniqueModes.includes("derived-live")) return "derived-live";
    return "live";
  }
  if (uniqueModes.includes("fallback")) return "fallback";

  return "mock";
}

function liveShareForModes(modes: SignalSourceProvenanceMode[]): number {
  if (!modes.length) return 0;

  const liveShares = modes.map((mode) => {
    if (LIVE_BACKED_MODES.has(mode)) return 1;
    if (mode === "derived-mixed") return 0.5;
    return 0;
  });

  return liveShares.reduce((sum, share) => sum + share, 0) / liveShares.length;
}

function signalsForField(
  rawSignals: NormalizedTrendSignal[],
  component: TrendIQScoreComponentKey,
  field: ScoreFieldSpec
): NormalizedTrendSignal[] {
  const engineFields = new Set(field.engineFields);

  return rawSignals.filter((signal) =>
    signal.signalType === component &&
    typeof signal.metadata?.engineField === "string" &&
    engineFields.has(signal.metadata.engineField)
  );
}

function buildFieldSummary(input: {
  component: TrendIQScoreComponentKey;
  field: ScoreFieldSpec;
  componentWeight: number;
  rawSignals: NormalizedTrendSignal[];
  sourceMode: SnapshotSourceMode;
}): TrendIQProvenanceFieldSummary | undefined {
  const signals = signalsForField(input.rawSignals, input.component, input.field);
  if (!signals.length) return undefined;

  const modes = signals.map((signal) => signalMode(signal, input.sourceMode));
  const scoreWeight = roundTo(input.componentWeight * input.field.weight, 4);
  const liveBackedWeight = roundTo(scoreWeight * liveShareForModes(modes), 4);

  return {
    component: input.component,
    engineField: input.field.engineField,
    provenance: combineModes(modes, input.field.derivedFromMultipleFields),
    provenanceModes: dedupeSorted(modes),
    scoreWeight,
    liveBackedWeight,
    mockFallbackWeight: roundTo(scoreWeight - liveBackedWeight, 4),
    contributingSources: dedupeSorted(signals.map((signal) => signal.source)),
    providers: dedupeSorted(signals.map((signal) =>
      signal.sourceProvenance?.provider ??
      (typeof signal.metadata?.provider === "string" ? signal.metadata.provider : signal.source)
    )),
  };
}

function buildComponentSummary(input: {
  component: TrendIQScoreComponentKey;
  trendIQScore: TrendIQScoreResult;
  rawSignals: NormalizedTrendSignal[];
  sourceMode: SnapshotSourceMode;
}): TrendIQComponentProvenanceSummary {
  const scoreWeight = TRENDIQ_SCORE_WEIGHTS[input.component];
  const fields = COMPONENT_FIELD_WEIGHTS[input.component]
    .map((field) => buildFieldSummary({
      component: input.component,
      field,
      componentWeight: scoreWeight,
      rawSignals: input.rawSignals,
      sourceMode: input.sourceMode,
    }))
    .filter((field): field is TrendIQProvenanceFieldSummary => Boolean(field));
  const componentModes = fields.map((field) => field.provenance);
  const liveBackedWeight = roundTo(fields.reduce((sum, field) => sum + field.liveBackedWeight, 0), 4);
  const mockFallbackWeight = roundTo(fields.reduce((sum, field) => sum + field.mockFallbackWeight, 0), 4);
  const activeWeight = liveBackedWeight + mockFallbackWeight;
  const score = input.trendIQScore.components[input.component];

  return {
    component: input.component,
    score,
    scoreWeight,
    weightedIQContribution: roundTo(score * scoreWeight, 2),
    provenance: combineModes(componentModes),
    liveBackedWeight,
    mockFallbackWeight,
    liveCoveragePercent: activeWeight > 0 ? roundTo((liveBackedWeight / activeWeight) * 100, 1) : 0,
    fields,
  };
}

function addContribution(
  contributionByProvenance: Record<SignalSourceProvenanceMode, number>,
  mode: SignalSourceProvenanceMode,
  amount: number
) {
  contributionByProvenance[mode] = roundTo(contributionByProvenance[mode] + amount, 2);
}

export function buildTrendIQSnapshotProvenanceSummary(input: {
  sourceMode: SnapshotSourceMode;
  rawSignals: NormalizedTrendSignal[];
  trendIQScore: TrendIQScoreResult;
  confidence: ConfidenceScoreResult;
  trendStatus: TrendMomentumResult;
}): TrendIQSnapshotProvenanceSummary {
  const componentSummaries = COMPONENT_KEYS.map((component) => buildComponentSummary({
    component,
    trendIQScore: input.trendIQScore,
    rawSignals: input.rawSignals,
    sourceMode: input.sourceMode,
  }));
  const weightedIQContributionByProvenance = emptyContributionMap();

  for (const component of componentSummaries) {
    for (const field of component.fields) {
      addContribution(
        weightedIQContributionByProvenance,
        field.provenance,
        component.score * field.scoreWeight
      );
    }
  }

  const totalActiveScoringWeight = roundTo(
    componentSummaries.reduce((sum, component) =>
      sum + component.liveBackedWeight + component.mockFallbackWeight,
      0
    ),
    4
  );
  const liveBackedScoringWeight = roundTo(
    componentSummaries.reduce((sum, component) => sum + component.liveBackedWeight, 0),
    4
  );
  const mockFallbackScoringWeight = roundTo(
    componentSummaries.reduce((sum, component) => sum + component.mockFallbackWeight, 0),
    4
  );

  return {
    overallTrendIQScore: input.trendIQScore.score,
    weightedComponentScore: input.trendIQScore.weightedComponentScore,
    penaltyTotal: input.trendIQScore.penaltyTotal,
    scoreVersion: input.trendIQScore.scoreVersion,
    confidence: {
      score: input.confidence.score,
      level: input.confidence.level,
    },
    momentum: input.trendStatus,
    liveComponents: componentSummaries
      .filter((component) => component.liveBackedWeight > 0)
      .map((component) => component.component),
    mockFallbackComponents: componentSummaries
      .filter((component) => component.mockFallbackWeight > 0)
      .map((component) => component.component),
    componentSummaries,
    weightedIQContributionByProvenance,
    weightedLiveIQContribution: roundTo(
      weightedIQContributionByProvenance.live + weightedIQContributionByProvenance["derived-live"],
      2
    ),
    weightedMockFallbackIQContribution: roundTo(
      weightedIQContributionByProvenance.mock +
        weightedIQContributionByProvenance.fallback +
        weightedIQContributionByProvenance["derived-mixed"],
      2
    ),
    totalActiveScoringWeight,
    liveBackedScoringWeight,
    mockFallbackScoringWeight,
    liveCoveragePercent: totalActiveScoringWeight > 0
      ? roundTo((liveBackedScoringWeight / totalActiveScoringWeight) * 100, 1)
      : 0,
    reddit: {
      mode: "mock/fallback",
      approvalStatus: "pending",
      liveApiRequestMade: false,
    },
  };
}
