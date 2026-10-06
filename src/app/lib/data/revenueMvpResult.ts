import { roundTo } from "../scoring/normalization";
import type {
  ConfidenceLevel,
  ScoreVersion,
  TrendIQScoreComponentKey,
  TrendStatus,
} from "../scoring/types";
import type {
  NormalizedTrendSignal,
  ProductCommerce,
  ProductTrendSnapshot,
  SearchAbsoluteDemandLevel,
  SearchMomentumBaselineQuality,
  SearchMomentumEvidenceQuality,
  SearchMomentumStrength,
  SearchMomentumV1,
  SignalSourceProvenanceMode,
  TrendIQDataSource,
} from "./types";

export type RevenueMvpExposureState = "verified" | "degraded" | "unavailable";
export type RevenueMvpResultStatus =
  | "usable"
  | "partial"
  | "unavailable"
  | "invalid_product_binding"
  | "malformed_input";
export type RevenueMvpTrustDimension =
  | "score"
  | "confidence"
  | "searchMomentum"
  | "searchDemand"
  | "searchDirection"
  | "reviews"
  | "reviewAggregate"
  | "ratingConsensus"
  | "recentRating"
  | "social"
  | "sentiment"
  | "purchaseIntent"
  | "hypeSustainability"
  | "priceCommerce"
  | "staticTrendIqTake"
  | "staticProsCons"
  | "staticSocialCopy";

export interface RevenueMvpExposure<T> {
  state: RevenueMvpExposureState;
  value: T | null;
  reasons: string[];
}

export interface RevenueMvpProductReferenceInput {
  productId?: string;
  title?: string;
  canonicalTitle?: string;
  brand?: string;
  category?: string;
  query?: string;
  commerce?: ProductCommerce;
  [key: string]: unknown;
}

export interface RevenueMvpProductReference {
  productId: string;
  title: string | null;
  brand: string | null;
  category: string | null;
  query: string | null;
}

export interface RevenueMvpScoreValue {
  score: number;
  scoreVersion: ScoreVersion;
  weightedComponentScore: number;
  penaltyTotal: number;
}

export interface RevenueMvpScoreExposure extends RevenueMvpExposure<RevenueMvpScoreValue> {
  liveCoveragePercent: number | null;
  totalActiveScoringWeight: number | null;
  liveBackedScoringWeight: number | null;
  mockFallbackScoringWeight: number | null;
  verifiedComponents: TrendIQScoreComponentKey[];
  degradedComponents: TrendIQScoreComponentKey[];
  unsupportedScoreComponents: TrendIQScoreComponentKey[];
  excludedMockFallbackComponents: TrendIQScoreComponentKey[];
}

export interface RevenueMvpConfidenceValue {
  score: number;
  level: ConfidenceLevel;
  scoreVersion: ScoreVersion;
  meaning: "evidence_quality_not_correctness_probability";
  provenanceWarning: string | null;
}

export interface RevenueMvpConfidenceExposure extends RevenueMvpExposure<RevenueMvpConfidenceValue> {
  liveCoveragePercent: number | null;
}

export interface RevenueMvpLegacyMomentumValue {
  status: TrendStatus;
  changePercent: number;
  isProvisional: boolean;
  reason: string | null;
}

export interface RevenueMvpAbsoluteDemandValue {
  source: "dataforseo_google_ads";
  provenance: Extract<SignalSourceProvenanceMode, "live" | "derived-live">;
  monthlySearchVolume: number | null;
  searchVolume7d: number | null;
  normalizedDemandScore: number;
  level: SearchAbsoluteDemandLevel;
  strength: SearchMomentumStrength;
  confidence: number;
  evidenceQuality: SearchMomentumEvidenceQuality;
}

export interface RevenueMvpDirectionalDemandValue {
  source: "dataforseo_trends";
  provenance: Extract<SignalSourceProvenanceMode, "live" | "derived-live">;
  current7dRelativeInterest: number | null;
  previous7dRelativeInterest: number | null;
  searchGrowthPercent: number | null;
  trendChangePercent: number | null;
  accelerationPercent: number | null;
  consecutiveGrowthDays: number | null;
  direction: TrendStatus;
  confidence: number;
  evidenceQuality: SearchMomentumEvidenceQuality;
  baselineReadiness: number;
  baselineQuality: SearchMomentumBaselineQuality;
}

export interface RevenueMvpSearchMomentumValue {
  direction: TrendStatus;
  strength: SearchMomentumStrength;
  confidence: number;
  evidenceQuality: SearchMomentumEvidenceQuality;
}

export interface RevenueMvpSearchEvidence {
  state: RevenueMvpExposureState;
  searchMomentum: RevenueMvpExposure<RevenueMvpSearchMomentumValue>;
  absoluteDemand: RevenueMvpExposure<RevenueMvpAbsoluteDemandValue>;
  directionalDemand: RevenueMvpExposure<RevenueMvpDirectionalDemandValue>;
  legacyMomentum: RevenueMvpExposure<RevenueMvpLegacyMomentumValue>;
  provenance: {
    measurementScope: "exact";
    query: string | null;
    sources: string[];
  };
  reasons: string[];
}

export interface RevenueMvpAggregateReviewValue {
  averageRating: number;
  ratingEvidenceCount: number | null;
  ratingMax: number | null;
  evidenceSourceField: string | null;
  evidenceComposition: string | null;
}

export interface RevenueMvpRatingConsensusValue {
  ratingConsensusQuality: number;
  status: string | null;
  reviewsCount: number | null;
  distributionSource: string | null;
  distributionScope: string | null;
  distributionComposition: string | null;
  mean: number | null;
  standardDeviation: number | null;
  variance: number | null;
  qualityGate: number | null;
  shapeSupport: number | null;
  lowTailPenalty: number | null;
  aggregateAverageRating: number | null;
  aggregateRatingDelta: number | null;
  aggregateRatingMismatchThreshold: number | null;
  calculationMethod: string | null;
}

export interface RevenueMvpRecentReviewValue {
  recentAverageRating: number;
  status: string | null;
  fetchedReviewCount: number | null;
  qualifyingReviewCount: number | null;
  sampleScope: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  windowDays: number | null;
  calculationMethod: string | null;
  datePrecision: string | null;
}

export interface RevenueMvpReviewEvidence {
  state: RevenueMvpExposureState;
  aggregateRating: RevenueMvpExposure<RevenueMvpAggregateReviewValue>;
  ratingConsensus: RevenueMvpExposure<RevenueMvpRatingConsensusValue>;
  recentRating: RevenueMvpExposure<RevenueMvpRecentReviewValue>;
  textEvidence: RevenueMvpExposure<{
    status: string;
    sampleScope: string | null;
    fetchedReviewCount: number | null;
    qualifyingReviewCount: number | null;
  }>;
  providerIdsRedacted: true;
  rawReviewBodiesExposed: false;
  reasons: string[];
}

export interface RevenueMvpUnsupportedEvidence {
  social: RevenueMvpExposure<never>;
  sentiment: RevenueMvpExposure<never>;
  purchaseIntent: RevenueMvpExposure<never>;
  hypeSustainability: RevenueMvpExposure<never>;
}

export interface RevenueMvpCommerceEvidence {
  price: RevenueMvpExposure<never>;
  commerce: RevenueMvpExposure<never>;
}

export interface RevenueMvpStaticCopyEvidence {
  trendIqTake: RevenueMvpExposure<never>;
  tiktokRedditCopy: RevenueMvpExposure<never>;
  prosCons: RevenueMvpExposure<never>;
}

export interface RevenueMvpTrustSummary {
  liveCoveragePercent: number | null;
  verifiedCoveragePercent: number;
  generatedAt: string | null;
  freshestSignalAt: string | null;
  verifiedDimensions: RevenueMvpTrustDimension[];
  degradedDimensions: RevenueMvpTrustDimension[];
  unavailableDimensions: RevenueMvpTrustDimension[];
  mockFallbackComponentsExcluded: TrendIQScoreComponentKey[];
  mockFallbackSignalCountExcluded: number;
  staticEvidenceExcluded: boolean;
  commerceEvidenceExcluded: boolean;
  providerIdentifiersRedacted: true;
  rawReviewBodiesExposed: false;
  warnings: string[];
}

export interface RevenueMvpResult {
  version: "revenue_mvp_result_v1";
  status: RevenueMvpResultStatus;
  product: RevenueMvpProductReference;
  generatedAt: string | null;
  score: RevenueMvpScoreExposure;
  confidence: RevenueMvpConfidenceExposure;
  search: RevenueMvpSearchEvidence;
  reviews: RevenueMvpReviewEvidence;
  unsupportedEvidence: RevenueMvpUnsupportedEvidence;
  commerce: RevenueMvpCommerceEvidence;
  staticCopy: RevenueMvpStaticCopyEvidence;
  trust: RevenueMvpTrustSummary;
}

export interface BuildRevenueMvpResultInput {
  snapshot: ProductTrendSnapshot | unknown;
  product?: RevenueMvpProductReferenceInput | null;
}

const LIVE_BACKED_MODES = new Set<SignalSourceProvenanceMode>(["live", "derived-live"]);
const UNSAFE_SCORE_MODES = new Set<SignalSourceProvenanceMode>(["mock", "fallback", "derived-mixed"]);
const UNSUPPORTED_EXTERNAL_SCORE_COMPONENTS = new Set<TrendIQScoreComponentKey>([
  "socialMomentum",
  "sentiment",
  "purchaseIntent",
  "hypeSustainability",
]);
const CORE_RESULT_DIMENSIONS: readonly RevenueMvpTrustDimension[] = [
  "score",
  "confidence",
  "searchMomentum",
  "reviews",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteNonNegativeNumber(value: unknown): number | null {
  const numberValue = finiteNumber(value);
  return numberValue !== null && numberValue >= 0 ? numberValue : null;
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function unavailable<T>(reason: string): RevenueMvpExposure<T> {
  return {
    state: "unavailable",
    value: null,
    reasons: [reason],
  };
}

function emptyProduct(input: RevenueMvpProductReferenceInput | null | undefined): RevenueMvpProductReference {
  return {
    productId: safeString(input?.productId) ?? "unknown",
    title: safeString(input?.title) ?? safeString(input?.canonicalTitle),
    brand: safeString(input?.brand),
    category: safeString(input?.category),
    query: safeString(input?.query),
  };
}

function productReference(
  snapshot: ProductTrendSnapshot,
  input: RevenueMvpProductReferenceInput | null | undefined
): RevenueMvpProductReference {
  return {
    productId: snapshot.productId,
    title: safeString(input?.title) ?? safeString(input?.canonicalTitle),
    brand: safeString(input?.brand),
    category: safeString(input?.category),
    query: safeString(input?.query) ?? snapshot.searchMomentumV1?.provenance.query ?? null,
  };
}

function isProductTrendSnapshot(value: unknown): value is ProductTrendSnapshot {
  if (!isRecord(value)) return false;

  return (
    typeof value.productId === "string" &&
    typeof value.timestamp === "string" &&
    Array.isArray(value.rawSignals) &&
    value.rawSignals.every(isNormalizedTrendSignal) &&
    isRecord(value.trendIQScore) &&
    isRecord(value.confidence) &&
    isRecord(value.trendStatus)
  );
}

function isNormalizedTrendSignal(value: unknown): value is NormalizedTrendSignal {
  return (
    isRecord(value) &&
    typeof value.productId === "string" &&
    typeof value.source === "string" &&
    typeof value.signalType === "string" &&
    typeof value.timestamp === "string" &&
    isRecord(value.sourceProvenance) &&
    typeof value.sourceProvenance.mode === "string" &&
    typeof value.sourceProvenance.provider === "string" &&
    (value.metadata === undefined || isRecord(value.metadata))
  );
}

function signalMode(signal: NormalizedTrendSignal): SignalSourceProvenanceMode {
  return signal.sourceProvenance?.mode ?? "mock";
}

function isLiveBackedSignal(signal: NormalizedTrendSignal): boolean {
  return LIVE_BACKED_MODES.has(signalMode(signal));
}

function metadataNumber(signal: NormalizedTrendSignal | undefined, key: string): number | null {
  return finiteNumber(signal?.metadata?.[key]);
}

function metadataString(signal: NormalizedTrendSignal | undefined, key: string): string | null {
  return safeString(signal?.metadata?.[key]);
}

function signalEngineField(signal: NormalizedTrendSignal): string | null {
  return metadataString(signal, "engineField");
}

function safeSignalValue(signal: NormalizedTrendSignal | undefined): number | null {
  return finiteNumber(signal?.value) ?? metadataNumber(signal, "engineValue");
}

function safeSignalSampleSize(signal: NormalizedTrendSignal | undefined): number | null {
  return finiteNonNegativeNumber(signal?.sampleSize);
}

function signalSortKey(signal: NormalizedTrendSignal): string {
  return [
    signal.timestamp,
    signal.source,
    signal.signalType,
    signal.sourceProvenance.provider,
    signal.sourceProvenance.providerMetric,
    signalEngineField(signal),
    String(signal.value),
  ].map((part) => part ?? "").join("|");
}

function selectSignal(input: {
  signals: readonly NormalizedTrendSignal[];
  source?: TrendIQDataSource;
  signalType?: TrendIQScoreComponentKey;
  engineField: string;
  requireLiveBacked?: boolean;
}): NormalizedTrendSignal | undefined {
  const matches = input.signals
    .filter((signal) =>
      (!input.source || signal.source === input.source) &&
      (!input.signalType || signal.signalType === input.signalType) &&
      signalEngineField(signal) === input.engineField &&
      (!input.requireLiveBacked || isLiveBackedSignal(signal))
    )
    .filter((signal) => safeSignalValue(signal) !== null)
    .sort((a, b) => signalSortKey(b).localeCompare(signalSortKey(a)));

  return matches[0];
}

function snapshotSignals(snapshot: ProductTrendSnapshot): NormalizedTrendSignal[] {
  return (snapshot.rawSignals as unknown[])
    .filter(isNormalizedTrendSignal)
    .filter((signal) => signal.productId === snapshot.productId);
}

function liveCoveragePercent(snapshot: ProductTrendSnapshot): number | null {
  return finiteNumber(snapshot.liveDataAudit?.liveCoveragePercent);
}

function scoreExposure(snapshot: ProductTrendSnapshot): RevenueMvpScoreExposure {
  const audit = snapshot.liveDataAudit;
  const score = finiteNumber(snapshot.trendIQScore.score);
  const weightedComponentScore = finiteNumber(snapshot.trendIQScore.weightedComponentScore);
  const penaltyTotal = finiteNumber(snapshot.trendIQScore.penaltyTotal);
  const liveCoverage = liveCoveragePercent(snapshot);
  const totalActiveScoringWeight = finiteNumber(audit?.totalActiveScoringWeight);
  const liveBackedScoringWeight = finiteNumber(audit?.liveBackedScoringWeight);
  const mockFallbackScoringWeight = finiteNumber(audit?.mockFallbackScoringWeight);
  const unsupportedScoreComponents = sortedUnique((audit?.componentSummaries ?? [])
    .filter((component) =>
      UNSUPPORTED_EXTERNAL_SCORE_COMPONENTS.has(component.component) &&
      component.fields.length > 0
    )
    .map((component) => component.component));
  const verifiedComponents = sortedUnique((audit?.liveComponents ?? [])
    .filter((component) => !UNSUPPORTED_EXTERNAL_SCORE_COMPONENTS.has(component)));
  const excludedMockFallbackComponents = sortedUnique(audit?.mockFallbackComponents ?? []);
  const degradedComponents = sortedUnique([
    ...verifiedComponents.filter((component) => excludedMockFallbackComponents.includes(component)),
    ...excludedMockFallbackComponents,
    ...unsupportedScoreComponents,
  ]);

  if (score === null || weightedComponentScore === null || penaltyTotal === null) {
    return {
      ...unavailable("missing_or_malformed_score"),
      liveCoveragePercent: liveCoverage,
      totalActiveScoringWeight,
      liveBackedScoringWeight,
      mockFallbackScoringWeight,
      verifiedComponents,
      degradedComponents,
      unsupportedScoreComponents,
      excludedMockFallbackComponents,
    };
  }

  if (
    liveCoverage === 100 &&
    totalActiveScoringWeight === 1 &&
    mockFallbackScoringWeight === 0 &&
    unsupportedScoreComponents.length === 0
  ) {
    return {
      state: "verified",
      value: {
        score,
        scoreVersion: snapshot.trendIQScore.scoreVersion,
        weightedComponentScore,
        penaltyTotal,
      },
      reasons: ["all_active_score_fields_are_live_backed"],
      liveCoveragePercent: liveCoverage,
      totalActiveScoringWeight,
      liveBackedScoringWeight,
      mockFallbackScoringWeight,
      verifiedComponents,
      degradedComponents: [],
      unsupportedScoreComponents,
      excludedMockFallbackComponents,
    };
  }

  if ((liveCoverage ?? 0) > 0) {
    const reasons = [
      ...(totalActiveScoringWeight !== 1 ? ["score_input_is_incomplete"] : []),
      ...(excludedMockFallbackComponents.length ? ["score_includes_mock_or_fallback_prone_dimensions"] : []),
      ...(unsupportedScoreComponents.length ? ["score_includes_currently_unsupported_external_dimensions"] : []),
    ];

    return {
      state: "degraded",
      value: {
        score,
        scoreVersion: snapshot.trendIQScore.scoreVersion,
        weightedComponentScore,
        penaltyTotal,
      },
      reasons: reasons.length ? reasons : ["score_has_partial_live_coverage"],
      liveCoveragePercent: liveCoverage,
      totalActiveScoringWeight,
      liveBackedScoringWeight,
      mockFallbackScoringWeight,
      verifiedComponents,
      degradedComponents,
      unsupportedScoreComponents,
      excludedMockFallbackComponents,
    };
  }

  return {
    ...unavailable("score_has_no_verified_live_backing"),
    liveCoveragePercent: liveCoverage,
    totalActiveScoringWeight,
    liveBackedScoringWeight,
    mockFallbackScoringWeight,
    verifiedComponents,
    degradedComponents,
    unsupportedScoreComponents,
    excludedMockFallbackComponents,
  };
}

function consumerProvenanceWarning(snapshot: ProductTrendSnapshot): string | null {
  if (snapshot.liveDataAudit?.confidenceProvenanceWarning !== true || snapshot.confidence.level !== "High") {
    return null;
  }

  const reason = snapshot.liveDataAudit.confidenceProvenanceWarningReason;
  if (!reason) {
    return "Confidence is capped at Good because live coverage is below the provenance-warning threshold.";
  }

  return reason.replace(/^Confidence is High\b/, "Confidence is capped at Good");
}

function confidenceExposure(snapshot: ProductTrendSnapshot): RevenueMvpConfidenceExposure {
  const score = finiteNumber(snapshot.confidence.score);
  const liveCoverage = liveCoveragePercent(snapshot);
  const totalActiveScoringWeight = finiteNumber(snapshot.liveDataAudit?.totalActiveScoringWeight);
  const hasUnsupportedScoreComponents = (snapshot.liveDataAudit?.componentSummaries ?? []).some((component) =>
    UNSUPPORTED_EXTERNAL_SCORE_COMPONENTS.has(component.component) &&
    component.fields.length > 0
  );

  if (score === null) {
    return {
      ...unavailable("missing_or_malformed_confidence"),
      liveCoveragePercent: liveCoverage,
    };
  }

  const provenanceWarning = consumerProvenanceWarning(snapshot);
  const value: RevenueMvpConfidenceValue = {
    score,
    level: provenanceWarning ? "Good" : snapshot.confidence.level,
    scoreVersion: snapshot.confidence.scoreVersion,
    meaning: "evidence_quality_not_correctness_probability",
    provenanceWarning,
  };

  if (liveCoverage === 100 && totalActiveScoringWeight === 1 && !hasUnsupportedScoreComponents) {
    return {
      state: "verified",
      value,
      reasons: [
        "confidence_inputs_are_live_backed",
        ...(provenanceWarning ? [provenanceWarning] : []),
      ],
      liveCoveragePercent: liveCoverage,
    };
  }

  if ((liveCoverage ?? 0) > 0) {
    return {
      state: "degraded",
      value,
      reasons: [
        "confidence_is_data_quality_not_correctness_probability",
        ...(totalActiveScoringWeight !== 1 ? ["confidence_inputs_do_not_cover_all_score_dimensions"] : []),
        ...(hasUnsupportedScoreComponents ? ["confidence_inputs_include_currently_unsupported_external_dimensions"] : []),
        ...(provenanceWarning ? [provenanceWarning] : []),
      ],
      liveCoveragePercent: liveCoverage,
    };
  }

  return {
    ...unavailable("confidence_has_no_verified_live_backing"),
    liveCoveragePercent: liveCoverage,
  };
}

function modeIsLiveBacked(mode: SignalSourceProvenanceMode | undefined): mode is Extract<SignalSourceProvenanceMode, "live" | "derived-live"> {
  return mode === "live" || mode === "derived-live";
}

function absoluteDemandExposure(
  searchMomentum: SearchMomentumV1 | undefined,
  signals: readonly NormalizedTrendSignal[]
): RevenueMvpExposure<RevenueMvpAbsoluteDemandValue> {
  const demand = searchMomentum?.absoluteDemand;
  if (
    !demand ||
    demand.source !== "dataforseo_google_ads" ||
    !modeIsLiveBacked(demand.provenance)
  ) {
    return unavailable("no_verified_absolute_search_demand");
  }

  const normalizedDemandScore = finiteNumber(demand.normalizedDemandScore);
  const confidence = finiteNumber(demand.confidence);
  if (normalizedDemandScore === null || confidence === null) {
    return unavailable("malformed_absolute_search_demand");
  }

  const value: RevenueMvpAbsoluteDemandValue = {
    source: demand.source,
    provenance: demand.provenance,
    monthlySearchVolume: finiteNonNegativeNumber(demand.monthlySearchVolume),
    searchVolume7d: finiteNonNegativeNumber(demand.searchVolume7d),
    normalizedDemandScore,
    level: demand.level,
    strength: demand.strength,
    confidence,
    evidenceQuality: demand.evidenceQuality,
  };
  const hasObservedVolume = value.monthlySearchVolume !== null || value.searchVolume7d !== null;
  const hasUnsafeContributingSignal = signals.some((signal) =>
    signal.sourceProvenance.provider === "dataforseo_google_ads" &&
    (
      signal.sourceProvenance.providerMetric === "monthlySearchVolume" ||
      signal.sourceProvenance.providerMetric === "estimated7dSearchVolumeFromMonthlySearchVolume" ||
      signalEngineField(signal) === "searchVolume7d"
    ) &&
    !isLiveBackedSignal(signal)
  );
  const state: RevenueMvpExposureState =
    demand.evidenceQuality === "observed" && hasObservedVolume && !hasUnsafeContributingSignal
      ? "verified"
      : "degraded";

  return {
    state,
    value,
    reasons: state === "verified"
      ? ["absolute_search_demand_has_live_google_ads_volume"]
      : hasUnsafeContributingSignal
        ? ["absolute_search_demand_includes_mock_or_fallback_input"]
        : ["absolute_search_demand_is_live_but_incomplete"],
  };
}

function directionalDemandExposure(
  searchMomentum: SearchMomentumV1 | undefined,
  signals: readonly NormalizedTrendSignal[]
): RevenueMvpExposure<RevenueMvpDirectionalDemandValue> {
  const demand = searchMomentum?.directionalDemand;
  if (
    !demand ||
    demand.source !== "dataforseo_trends" ||
    !modeIsLiveBacked(demand.provenance)
  ) {
    return unavailable("no_verified_directional_search_demand");
  }

  const confidence = finiteNumber(demand.confidence);
  const baselineReadiness = finiteNumber(demand.baselineReadiness);
  if (confidence === null || baselineReadiness === null) {
    return unavailable("malformed_directional_search_demand");
  }

  const value: RevenueMvpDirectionalDemandValue = {
    source: demand.source,
    provenance: demand.provenance,
    current7dRelativeInterest: finiteNumber(demand.current7dRelativeInterest),
    previous7dRelativeInterest: finiteNumber(demand.previous7dRelativeInterest),
    searchGrowthPercent: finiteNumber(demand.searchGrowthPercent),
    trendChangePercent: finiteNumber(demand.trendChangePercent),
    accelerationPercent: finiteNumber(demand.accelerationPercent),
    consecutiveGrowthDays: finiteNonNegativeNumber(demand.consecutiveGrowthDays),
    direction: demand.direction,
    confidence,
    evidenceQuality: demand.evidenceQuality,
    baselineReadiness,
    baselineQuality: demand.baselineQuality,
  };
  const contributingFields = new Set([
    "current7dRelativeInterest",
    "searchGrowthPercent",
    "trendChangePercent",
    "accelerationPercent",
    "consecutiveGrowthDays",
  ]);
  const hasUnsafeContributingSignal = signals.some((signal) =>
    signal.sourceProvenance.provider === "dataforseo_trends" &&
    contributingFields.has(signalEngineField(signal) ?? "") &&
    !isLiveBackedSignal(signal)
  );
  const hasObservedComparison =
    value.current7dRelativeInterest !== null &&
    value.previous7dRelativeInterest !== null;
  const state: RevenueMvpExposureState =
    demand.evidenceQuality === "observed" &&
    demand.baselineQuality !== "weak" &&
    hasObservedComparison &&
    !hasUnsafeContributingSignal
      ? "verified"
      : "degraded";

  return {
    state,
    value,
    reasons: state === "verified"
      ? ["directional_search_demand_has_live_trends_support"]
      : hasUnsafeContributingSignal
        ? ["directional_search_demand_includes_mock_or_fallback_input"]
        : ["directional_search_demand_is_live_but_has_sparse_or_weak_baseline_support"],
  };
}

function legacyMomentumExposure(
  snapshot: ProductTrendSnapshot,
  directionalDemand: RevenueMvpExposure<RevenueMvpDirectionalDemandValue>
): RevenueMvpExposure<RevenueMvpLegacyMomentumValue> {
  const changePercent = finiteNumber(snapshot.trendStatus.changePercent);
  if (changePercent === null) return unavailable("malformed_legacy_momentum");

  if (directionalDemand.state === "unavailable") {
    return unavailable("legacy_momentum_not_exposed_without_verified_search_direction");
  }

  const trendChangeProvenance = snapshot.liveDataAudit?.componentSummaries
    ?.find((component) => component.component === "growthVelocity")
    ?.fields.find((field) => field.engineField === "trendChangePercent")
    ?.provenance;
  if (!trendChangeProvenance) {
    return unavailable("legacy_momentum_provenance_unavailable");
  }
  const state: RevenueMvpExposureState =
    directionalDemand.state === "verified" && modeIsLiveBacked(trendChangeProvenance)
      ? "verified"
      : "degraded";

  return {
    state,
    value: {
      status: snapshot.trendStatus.status,
      changePercent,
      isProvisional: snapshot.trendStatus.isProvisional === true,
      reason: safeString(snapshot.trendStatus.reason),
    },
    reasons: state === "verified"
      ? ["legacy_momentum_is_supported_by_search_direction"]
      : !modeIsLiveBacked(trendChangeProvenance)
        ? ["legacy_momentum_includes_mock_or_fallback_trend_change"]
        : ["legacy_momentum_is_degraded_with_search_direction"],
  };
}

function searchEvidence(snapshot: ProductTrendSnapshot): RevenueMvpSearchEvidence {
  const signals = snapshotSignals(snapshot);
  const absoluteDemand = absoluteDemandExposure(snapshot.searchMomentumV1, signals);
  const directionalDemand = directionalDemandExposure(snapshot.searchMomentumV1, signals);
  const legacyMomentum = legacyMomentumExposure(snapshot, directionalDemand);
  const momentumConfidence = finiteNumber(snapshot.searchMomentumV1?.confidence);
  const hasSearchMomentumValue =
    snapshot.searchMomentumV1 &&
    momentumConfidence !== null &&
    (absoluteDemand.state !== "unavailable" || directionalDemand.state !== "unavailable");
  const combinedSearchMomentumState = combineExposureStates([absoluteDemand.state, directionalDemand.state], {
    verifiedWhenAllAvailableVerified: true,
  });
  const searchMomentumState: RevenueMvpExposureState =
    combinedSearchMomentumState === "verified" && snapshot.searchMomentumV1?.evidenceQuality !== "observed"
      ? "degraded"
      : combinedSearchMomentumState;
  const searchMomentum: RevenueMvpExposure<RevenueMvpSearchMomentumValue> = hasSearchMomentumValue
    ? {
        state: searchMomentumState,
        value: {
          direction: snapshot.searchMomentumV1.direction,
          strength: snapshot.searchMomentumV1.strength,
          confidence: momentumConfidence,
          evidenceQuality: snapshot.searchMomentumV1.evidenceQuality,
        },
        reasons: searchMomentumState === "verified"
          ? ["search_momentum_has_verified_absolute_and_directional_evidence"]
          : ["search_momentum_has_partial_or_degraded_live_evidence"],
      }
    : unavailable("no_verified_search_momentum");
  const state = combineExposureStates([searchMomentum.state, absoluteDemand.state, directionalDemand.state], {
    verifiedWhenAllAvailableVerified: true,
  });

  return {
    state,
    searchMomentum,
    absoluteDemand,
    directionalDemand,
    legacyMomentum,
    provenance: {
      measurementScope: "exact",
      query: safeString(snapshot.searchMomentumV1?.provenance.query),
      sources: sortedUnique(snapshot.searchMomentumV1?.provenance.sources ?? []),
    },
    reasons: state === "verified"
      ? ["search_evidence_is_live_backed"]
      : state === "degraded"
        ? ["search_evidence_is_partial_or_baseline_degraded"]
        : ["search_evidence_unavailable"],
  };
}

function combineExposureStates(
  states: readonly RevenueMvpExposureState[],
  options: { verifiedWhenAllAvailableVerified?: boolean } = {}
): RevenueMvpExposureState {
  const availableStates = states.filter((state) => state !== "unavailable");
  if (!availableStates.length) return "unavailable";
  if (availableStates.some((state) => state === "degraded")) return "degraded";
  if (options.verifiedWhenAllAvailableVerified && availableStates.length !== states.length) return "degraded";

  return "verified";
}

function reviewSignals(snapshot: ProductTrendSnapshot): NormalizedTrendSignal[] {
  return snapshotSignals(snapshot).filter((signal) =>
    signal.source === "reviews" &&
    signal.signalType === "reviewQuality" &&
    isLiveBackedSignal(signal)
  );
}

function hasValidatedDetailedReviewEvidence(signal: NormalizedTrendSignal): boolean {
  return (
    metadataString(signal, "validationStatus") === "reviews_validated" &&
    metadataString(signal, "reviewRetrievalStatus") === "reviews_validated"
  );
}

function aggregateReviewExposure(signals: readonly NormalizedTrendSignal[]): RevenueMvpExposure<RevenueMvpAggregateReviewValue> {
  const averageRatingSignal = selectSignal({
    signals,
    source: "reviews",
    signalType: "reviewQuality",
    engineField: "averageRating",
    requireLiveBacked: true,
  });
  const ratingEvidenceSignal = selectSignal({
    signals,
    source: "reviews",
    signalType: "reviewQuality",
    engineField: "ratingEvidenceCount",
    requireLiveBacked: true,
  });
  const averageRating = safeSignalValue(averageRatingSignal);
  if (averageRating === null) return unavailable("no_verified_aggregate_review_rating");

  const ratingEvidenceCount =
    safeSignalValue(ratingEvidenceSignal) ??
    metadataNumber(averageRatingSignal, "ratingEvidenceCount") ??
    safeSignalSampleSize(averageRatingSignal);
  const ratingMax = metadataNumber(averageRatingSignal, "providerRatingMax");
  const value: RevenueMvpAggregateReviewValue = {
    averageRating,
    ratingEvidenceCount: finiteNonNegativeNumber(ratingEvidenceCount),
    ratingMax: finiteNonNegativeNumber(ratingMax),
    evidenceSourceField: metadataString(ratingEvidenceSignal, "sourceMetric") ??
      metadataString(averageRatingSignal, "ratingEvidenceSourceField"),
    evidenceComposition: metadataString(averageRatingSignal, "ratingEvidenceComposition"),
  };

  return {
    state: value.ratingEvidenceCount === null ? "degraded" : "verified",
    value,
    reasons: value.ratingEvidenceCount === null
      ? ["aggregate_rating_has_no_verified_count"]
      : ["aggregate_rating_and_count_are_live_backed"],
  };
}

function ratingConsensusExposure(signals: readonly NormalizedTrendSignal[]): RevenueMvpExposure<RevenueMvpRatingConsensusValue> {
  const signal = selectSignal({
    signals,
    source: "reviews",
    signalType: "reviewQuality",
    engineField: "ratingConsensusQuality",
    requireLiveBacked: true,
  });
  const value = safeSignalValue(signal);
  if (!signal || value === null) return unavailable("no_validated_rating_consensus");

  const status = metadataString(signal, "ratingConsensusQualityStatus");
  if (!hasValidatedDetailedReviewEvidence(signal) || status === null || status === "insufficient") {
    return unavailable("rating_consensus_is_not_identity_validated_and_qualified");
  }
  const exposureValue: RevenueMvpRatingConsensusValue = {
    ratingConsensusQuality: value,
    status,
    reviewsCount: metadataNumber(signal, "ratingConsensusQualityObservationCount"),
    distributionSource: metadataString(signal, "ratingConsensusDistributionSource"),
    distributionScope: metadataString(signal, "ratingConsensusDistributionScope"),
    distributionComposition: metadataString(signal, "ratingConsensusDistributionComposition"),
    mean: metadataNumber(signal, "ratingConsensusMean"),
    standardDeviation: metadataNumber(signal, "ratingConsensusStandardDeviation"),
    variance: metadataNumber(signal, "ratingConsensusVariance"),
    qualityGate: metadataNumber(signal, "ratingConsensusQualityGate"),
    shapeSupport: metadataNumber(signal, "ratingConsensusShapeSupport"),
    lowTailPenalty: metadataNumber(signal, "ratingConsensusLowTailPenalty"),
    aggregateAverageRating: metadataNumber(signal, "ratingConsensusAggregateAverageRating"),
    aggregateRatingDelta: metadataNumber(signal, "ratingConsensusAggregateRatingDelta"),
    aggregateRatingMismatchThreshold: metadataNumber(signal, "ratingConsensusAggregateRatingMismatchThreshold"),
    calculationMethod: metadataString(signal, "ratingConsensusQualityCalculationMethod"),
  };
  const state: RevenueMvpExposureState = status === "derived-live" ? "verified" : "degraded";

  return {
    state,
    value: exposureValue,
    reasons: state === "verified"
      ? ["rating_consensus_uses_identity_validated_distribution"]
      : ["rating_consensus_is_validated_but_not_fully_qualified"],
  };
}

function recentRatingExposure(signals: readonly NormalizedTrendSignal[]): RevenueMvpExposure<RevenueMvpRecentReviewValue> {
  const signal = selectSignal({
    signals,
    source: "reviews",
    signalType: "reviewQuality",
    engineField: "recentAverageRating",
    requireLiveBacked: true,
  });
  const value = safeSignalValue(signal);
  if (!signal || value === null) return unavailable("no_validated_recent_review_rating");

  const status = metadataString(signal, "recentAverageRatingStatus");
  if (
    !hasValidatedDetailedReviewEvidence(signal) ||
    (status !== "derived-live" && status !== "provisional")
  ) {
    return unavailable("recent_review_rating_is_not_identity_validated_and_qualified");
  }
  const exposureValue: RevenueMvpRecentReviewValue = {
    recentAverageRating: value,
    status,
    fetchedReviewCount: metadataNumber(signal, "totalReviewsFetched"),
    qualifyingReviewCount: metadataNumber(signal, "qualifyingRecentReviewCount"),
    sampleScope: metadataString(signal, "textSampleScope"),
    windowStart: metadataString(signal, "recentAverageRatingWindowStart"),
    windowEnd: metadataString(signal, "recentAverageRatingWindowEnd"),
    windowDays: metadataNumber(signal, "recentAverageRatingWindowDays"),
    calculationMethod: metadataString(signal, "recentAverageRatingCalculationMethod"),
    datePrecision: metadataString(signal, "recentAverageRatingDatePrecision"),
  };
  const state: RevenueMvpExposureState = status === "derived-live" ? "verified" : "degraded";

  return {
    state,
    value: exposureValue,
    reasons: state === "verified"
      ? ["recent_review_rating_uses_identity_validated_detailed_reviews"]
      : ["recent_review_rating_is_validated_but_provisional"],
  };
}

function textEvidenceExposure(
  signals: readonly NormalizedTrendSignal[],
  recentRating: RevenueMvpExposure<RevenueMvpRecentReviewValue>
): RevenueMvpExposure<{
  status: string;
  sampleScope: string | null;
  fetchedReviewCount: number | null;
  qualifyingReviewCount: number | null;
}> {
  if (recentRating.state !== "unavailable" && recentRating.value) {
    return {
      state: recentRating.state,
      value: {
        status: recentRating.value.status ?? "derived-live",
        sampleScope: recentRating.value.sampleScope,
        fetchedReviewCount: recentRating.value.fetchedReviewCount,
        qualifyingReviewCount: recentRating.value.qualifyingReviewCount,
      },
      reasons: recentRating.reasons,
    };
  }

  const status = signals
    .filter(hasValidatedDetailedReviewEvidence)
    .map((signal) =>
      metadataString(signal, "textEvidenceStatus") ??
      metadataString(signal, "recentAverageRatingStatus")
    )
    .find((value): value is string => Boolean(value));

  if (status === "provisional") {
    return {
      state: "degraded",
      value: {
        status,
        sampleScope: null,
        fetchedReviewCount: null,
        qualifyingReviewCount: null,
      },
      reasons: ["review_text_evidence_is_provisional"],
    };
  }

  return unavailable(status === "insufficient"
    ? "review_text_evidence_insufficient"
    : "no_validated_text_review_evidence");
}

function reviewEvidence(snapshot: ProductTrendSnapshot): RevenueMvpReviewEvidence {
  const signals = reviewSignals(snapshot);
  const aggregateRating = aggregateReviewExposure(signals);
  const ratingConsensus = ratingConsensusExposure(signals);
  const recentRating = recentRatingExposure(signals);
  const textEvidence = textEvidenceExposure(signals, recentRating);
  const state = combineExposureStates([
    aggregateRating.state,
    ratingConsensus.state,
    recentRating.state,
  ]);

  return {
    state,
    aggregateRating,
    ratingConsensus,
    recentRating,
    textEvidence,
    providerIdsRedacted: true,
    rawReviewBodiesExposed: false,
    reasons: state === "verified"
      ? ["review_evidence_is_identity_validated_or_live_aggregate"]
      : state === "degraded"
        ? ["review_evidence_is_partial_or_missing_text_support"]
        : ["review_evidence_unavailable"],
  };
}

function mockedOrFallbackSignalCount(snapshot: ProductTrendSnapshot): number {
  return snapshotSignals(snapshot).filter((signal) => UNSAFE_SCORE_MODES.has(signalMode(signal))).length;
}

function hasStaticEvidence(input: RevenueMvpProductReferenceInput | null | undefined): boolean {
  if (!input) return false;

  return [
    "trendiqSays",
    "tiktokSays",
    "redditSentiment",
    "bestFor",
    "watchOut",
    "pros",
    "cons",
  ].some((key) => input[key] !== undefined);
}

function hasCommerceEvidence(input: RevenueMvpProductReferenceInput | null | undefined): boolean {
  return input?.commerce !== undefined;
}

function unsupportedEvidence(): RevenueMvpUnsupportedEvidence {
  return {
    social: unavailable("live_social_provider_not_supported"),
    sentiment: unavailable("live_sentiment_provider_not_supported"),
    purchaseIntent: unavailable("live_purchase_intent_provider_not_supported"),
    hypeSustainability: unavailable("live_hype_sustainability_provider_not_supported"),
  };
}

function commerceEvidence(): RevenueMvpCommerceEvidence {
  return {
    price: unavailable("price_intelligence_not_implemented"),
    commerce: unavailable("commerce_or_affiliate_evidence_not_verified"),
  };
}

function staticCopyEvidence(): RevenueMvpStaticCopyEvidence {
  return {
    trendIqTake: unavailable("static_trendiq_take_not_evidence_backed"),
    tiktokRedditCopy: unavailable("static_social_copy_not_evidence_backed"),
    prosCons: unavailable("static_pros_cons_not_evidence_backed"),
  };
}

function isSupportedRevenueMvpFreshnessSignal(signal: NormalizedTrendSignal): boolean {
  if (!isLiveBackedSignal(signal)) return false;

  if (signal.source === "searchWeb") {
    return (
      signal.sourceProvenance.provider === "dataforseo_google_ads" ||
      signal.sourceProvenance.provider === "dataforseo_trends"
    );
  }

  if (signal.source !== "reviews" || signal.signalType !== "reviewQuality") return false;
  const engineField = signalEngineField(signal);
  if (engineField === "averageRating" || engineField === "ratingEvidenceCount") return true;
  if (!hasValidatedDetailedReviewEvidence(signal)) return false;

  if (engineField === "ratingConsensusQuality") {
    const status = metadataString(signal, "ratingConsensusQualityStatus");
    return status === "derived-live" || status === "provisional" || status === "mismatch";
  }

  if (engineField === "recentAverageRating") {
    const status = metadataString(signal, "recentAverageRatingStatus");
    return status === "derived-live" || status === "provisional";
  }

  return false;
}

function newestSupportedLiveBackedTimestamp(signals: readonly NormalizedTrendSignal[]): string | null {
  const newest = signals
    .filter(isSupportedRevenueMvpFreshnessSignal)
    .map((signal) => signal.timestamp)
    .filter((timestamp) => Number.isFinite(Date.parse(timestamp)))
    .sort()
    .at(-1);

  return newest ?? null;
}

function pushDimension(
  groups: {
    verified: RevenueMvpTrustDimension[];
    degraded: RevenueMvpTrustDimension[];
    unavailable: RevenueMvpTrustDimension[];
  },
  dimension: RevenueMvpTrustDimension,
  state: RevenueMvpExposureState
) {
  if (state === "verified") groups.verified.push(dimension);
  else if (state === "degraded") groups.degraded.push(dimension);
  else groups.unavailable.push(dimension);
}

function trustSummary(input: {
  snapshot: ProductTrendSnapshot;
  score: RevenueMvpScoreExposure;
  confidence: RevenueMvpConfidenceExposure;
  search: RevenueMvpSearchEvidence;
  reviews: RevenueMvpReviewEvidence;
  staticEvidenceExcluded: boolean;
  commerceEvidenceExcluded: boolean;
  warnings: string[];
}): RevenueMvpTrustSummary {
  const groups = {
    verified: [] as RevenueMvpTrustDimension[],
    degraded: [] as RevenueMvpTrustDimension[],
    unavailable: [] as RevenueMvpTrustDimension[],
  };

  pushDimension(groups, "score", input.score.state);
  pushDimension(groups, "confidence", input.confidence.state);
  pushDimension(groups, "searchMomentum", input.search.searchMomentum.state);
  pushDimension(groups, "searchDemand", input.search.absoluteDemand.state);
  pushDimension(groups, "searchDirection", input.search.directionalDemand.state);
  pushDimension(groups, "reviews", input.reviews.state);
  pushDimension(groups, "reviewAggregate", input.reviews.aggregateRating.state);
  pushDimension(groups, "ratingConsensus", input.reviews.ratingConsensus.state);
  pushDimension(groups, "recentRating", input.reviews.recentRating.state);
  pushDimension(groups, "social", "unavailable");
  pushDimension(groups, "sentiment", "unavailable");
  pushDimension(groups, "purchaseIntent", "unavailable");
  pushDimension(groups, "hypeSustainability", "unavailable");
  pushDimension(groups, "priceCommerce", "unavailable");
  pushDimension(groups, "staticTrendIqTake", "unavailable");
  pushDimension(groups, "staticProsCons", "unavailable");
  pushDimension(groups, "staticSocialCopy", "unavailable");

  return {
    liveCoveragePercent: input.score.liveCoveragePercent,
    verifiedCoveragePercent: roundTo(
      (CORE_RESULT_DIMENSIONS.filter((dimension) => groups.verified.includes(dimension)).length /
        CORE_RESULT_DIMENSIONS.length) * 100,
      1
    ),
    generatedAt: safeString(input.snapshot.timestamp),
    freshestSignalAt: newestSupportedLiveBackedTimestamp(snapshotSignals(input.snapshot)),
    verifiedDimensions: sortedUnique(groups.verified),
    degradedDimensions: sortedUnique(groups.degraded),
    unavailableDimensions: sortedUnique(groups.unavailable),
    mockFallbackComponentsExcluded: sortedUnique(input.score.excludedMockFallbackComponents),
    mockFallbackSignalCountExcluded: mockedOrFallbackSignalCount(input.snapshot),
    staticEvidenceExcluded: input.staticEvidenceExcluded,
    commerceEvidenceExcluded: input.commerceEvidenceExcluded,
    providerIdentifiersRedacted: true,
    rawReviewBodiesExposed: false,
    warnings: sortedUnique(input.warnings),
  };
}

function resultStatus(input: {
  score: RevenueMvpScoreExposure;
  confidence: RevenueMvpConfidenceExposure;
  search: RevenueMvpSearchEvidence;
  reviews: RevenueMvpReviewEvidence;
}): RevenueMvpResultStatus {
  const states = [
    input.score.state,
    input.confidence.state,
    input.search.state,
    input.reviews.state,
  ];

  if (states.every((state) => state === "unavailable")) return "unavailable";
  if (states.every((state) => state === "verified")) return "usable";

  return "partial";
}

function unavailableResult(input: {
  status: Extract<RevenueMvpResultStatus, "invalid_product_binding" | "malformed_input">;
  product: RevenueMvpProductReference;
  reason: string;
}): RevenueMvpResult {
  const score: RevenueMvpScoreExposure = {
    ...unavailable(input.reason),
    liveCoveragePercent: null,
    totalActiveScoringWeight: null,
    liveBackedScoringWeight: null,
    mockFallbackScoringWeight: null,
    verifiedComponents: [],
    degradedComponents: [],
    unsupportedScoreComponents: [],
    excludedMockFallbackComponents: [],
  };
  const confidence: RevenueMvpConfidenceExposure = {
    ...unavailable(input.reason),
    liveCoveragePercent: null,
  };
  const search: RevenueMvpSearchEvidence = {
    state: "unavailable",
    searchMomentum: unavailable(input.reason),
    absoluteDemand: unavailable(input.reason),
    directionalDemand: unavailable(input.reason),
    legacyMomentum: unavailable(input.reason),
    provenance: {
      measurementScope: "exact",
      query: null,
      sources: [],
    },
    reasons: [input.reason],
  };
  const reviews: RevenueMvpReviewEvidence = {
    state: "unavailable",
    aggregateRating: unavailable(input.reason),
    ratingConsensus: unavailable(input.reason),
    recentRating: unavailable(input.reason),
    textEvidence: unavailable(input.reason),
    providerIdsRedacted: true,
    rawReviewBodiesExposed: false,
    reasons: [input.reason],
  };
  const snapshot = {
    productId: input.product.productId,
    timestamp: null,
    rawSignals: [],
    trendIQScore: {},
    confidence: {},
    trendStatus: {},
  } as unknown as ProductTrendSnapshot;

  return {
    version: "revenue_mvp_result_v1",
    status: input.status,
    product: input.product,
    generatedAt: null,
    score,
    confidence,
    search,
    reviews,
    unsupportedEvidence: unsupportedEvidence(),
    commerce: commerceEvidence(),
    staticCopy: staticCopyEvidence(),
    trust: trustSummary({
      snapshot,
      score,
      confidence,
      search,
      reviews,
      staticEvidenceExcluded: false,
      commerceEvidenceExcluded: false,
      warnings: [input.reason],
    }),
  };
}

export function buildRevenueMvpResult(input: BuildRevenueMvpResultInput): RevenueMvpResult {
  if (!isProductTrendSnapshot(input.snapshot)) {
    return unavailableResult({
      status: "malformed_input",
      product: emptyProduct(input.product),
      reason: "snapshot_input_malformed",
    });
  }

  try {
    const product = productReference(input.snapshot, input.product);
    const requestedProductId = safeString(input.product?.productId);
    if (requestedProductId && requestedProductId !== input.snapshot.productId) {
      return unavailableResult({
        status: "invalid_product_binding",
        product: {
          ...product,
          productId: requestedProductId,
        },
        reason: "product_reference_does_not_match_snapshot",
      });
    }

    const score = scoreExposure(input.snapshot);
    const confidence = confidenceExposure(input.snapshot);
    const search = searchEvidence(input.snapshot);
    const reviews = reviewEvidence(input.snapshot);
    const staticEvidenceExcluded = hasStaticEvidence(input.product);
    const commerceEvidenceExcluded = hasCommerceEvidence(input.product);
    const warnings = [
      ...(input.snapshot.liveDataAudit?.confidenceProvenanceWarningReason
        ? [input.snapshot.liveDataAudit.confidenceProvenanceWarningReason]
        : []),
      ...(staticEvidenceExcluded ? ["static_catalog_copy_excluded_from_revenue_mvp_boundary"] : []),
      ...(commerceEvidenceExcluded ? ["demo_or_unverified_commerce_excluded_from_revenue_mvp_boundary"] : []),
      ...(mockedOrFallbackSignalCount(input.snapshot) > 0 ? ["mock_or_fallback_signals_excluded_as_verified_evidence"] : []),
    ];

    return {
      version: "revenue_mvp_result_v1",
      status: resultStatus({ score, confidence, search, reviews }),
      product,
      generatedAt: safeString(input.snapshot.timestamp),
      score,
      confidence,
      search,
      reviews,
      unsupportedEvidence: unsupportedEvidence(),
      commerce: commerceEvidence(),
      staticCopy: staticCopyEvidence(),
      trust: trustSummary({
        snapshot: input.snapshot,
        score,
        confidence,
        search,
        reviews,
        staticEvidenceExcluded,
        commerceEvidenceExcluded,
        warnings,
      }),
    };
  } catch {
    return unavailableResult({
      status: "malformed_input",
      product: emptyProduct(input.product ?? { productId: input.snapshot.productId }),
      reason: "snapshot_input_malformed",
    });
  }
}
