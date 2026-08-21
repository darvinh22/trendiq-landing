import type {
  ScoreVersion,
  ConfidenceScoreResult,
  ConfidenceSignals,
  TrendIQScoreComponentKey,
  TrendIQScoreResult,
  TrendIQSignalInputs,
  TrendMomentumResult,
} from "../scoring/types";

export type TrendIQDataSource =
  | "searchWeb"
  | "googleTrends"
  | "reddit"
  | "reviews"
  | "social"
  | "merchant"
  | "mockHistorical";

export type TrendIQSignalType = TrendIQScoreComponentKey;
export type SnapshotSourceMode = "mock" | "live";
export type SignalSourceProvenanceMode =
  | "live"
  | "mock"
  | "fallback"
  | "derived-live"
  | "derived-mixed";

export interface SignalSourceProvenance {
  mode: SignalSourceProvenanceMode;
  provider: string;
  providerLabel?: string;
  providerMetric?: string;
  approvalStatus?: "pending" | "approved" | "not-required";
  liveApiRequestMade?: boolean;
  notes?: string;
}

export type SignalMetadataValue = string | number | boolean | null | undefined;

export interface TrendSignalMetadata {
  // engineField and engineValue are the adapter-to-score contract: providers
  // expose their own normalizedValue for QA/provenance, while the aggregator
  // passes raw v1 metrics into the existing score engine unchanged.
  engineField?: string;
  engineValue?: number;
  [key: string]: SignalMetadataValue;
}

export interface NormalizedTrendSignal {
  source: TrendIQDataSource;
  signalType: TrendIQSignalType;
  productId: string;
  sourceProvenance: SignalSourceProvenance;
  value: number;
  // Provider-level normalizedValue is always 0-100. It is not the final
  // component score and must not be weighted inside the data layer.
  normalizedValue: number;
  previousValue?: number;
  percentChange?: number;
  sampleSize?: number;
  timestamp: string;
  // Source confidence is a provider quality estimate on a 0-100 scale.
  confidence: number;
  metadata?: TrendSignalMetadata;
}

export interface TrendSignalProvider {
  id: TrendIQDataSource;
  label: string;
  getSignals(productId: string): NormalizedTrendSignal[];
}

export interface AsyncTrendSignalProvider extends TrendSignalProvider {
  getSignalsAsync(productId: string): Promise<NormalizedTrendSignal[]>;
}

export interface DataSourceProvenance {
  source: TrendIQDataSource;
  label: string;
  signalCount: number;
  lastUpdated: string;
  modes: SignalSourceProvenanceMode[];
}

export interface DataProvenanceSummary {
  generatedAt: string;
  sources: DataSourceProvenance[];
}

export interface ProductMerchant {
  merchantName: string;
  productUrl: string;
  affiliateUrl?: string;
  price?: number;
  currency?: string;
  lastUpdated?: string;
}

export interface ProductCommerce {
  merchants: ProductMerchant[];
}

export interface AggregatedSignalResult {
  productId: string;
  timestamp: string;
  rawSignals: NormalizedTrendSignal[];
  aggregatedSignals: TrendIQSignalInputs;
  confidenceSignals: ConfidenceSignals;
  provenance: DataProvenanceSummary;
}

export interface TrendIQProvenanceFieldSummary {
  component: TrendIQScoreComponentKey;
  engineField: string;
  provenance: SignalSourceProvenanceMode;
  provenanceModes: SignalSourceProvenanceMode[];
  scoreWeight: number;
  liveBackedWeight: number;
  mockFallbackWeight: number;
  contributingSources: TrendIQDataSource[];
  providers: string[];
}

export interface TrendIQComponentProvenanceSummary {
  component: TrendIQScoreComponentKey;
  score: number;
  scoreWeight: number;
  weightedIQContribution: number;
  provenance: SignalSourceProvenanceMode;
  liveBackedWeight: number;
  mockFallbackWeight: number;
  liveCoveragePercent: number;
  fields: TrendIQProvenanceFieldSummary[];
}

export interface RedditProvenanceStatus {
  mode: "mock/fallback";
  approvalStatus: "pending";
  liveApiRequestMade: false;
}

export interface TrendIQSnapshotProvenanceSummary {
  overallTrendIQScore: number;
  weightedComponentScore: number;
  penaltyTotal: number;
  scoreVersion: ScoreVersion;
  confidence: {
    score: number;
    level: ConfidenceScoreResult["level"];
  };
  momentum: TrendMomentumResult;
  liveComponents: TrendIQScoreComponentKey[];
  mockFallbackComponents: TrendIQScoreComponentKey[];
  componentSummaries: TrendIQComponentProvenanceSummary[];
  weightedIQContributionByProvenance: Record<SignalSourceProvenanceMode, number>;
  weightedLiveIQContribution: number;
  weightedMockFallbackIQContribution: number;
  totalActiveScoringWeight: number;
  liveBackedScoringWeight: number;
  mockFallbackScoringWeight: number;
  liveCoveragePercent: number;
  reddit: RedditProvenanceStatus;
}

export interface ProductTrendSnapshot {
  productId: string;
  timestamp: string;
  sourceMode: SnapshotSourceMode;
  rawSignals: NormalizedTrendSignal[];
  aggregatedSignals: TrendIQSignalInputs;
  trendIQScore: TrendIQScoreResult;
  confidence: ConfidenceScoreResult;
  trendStatus: TrendMomentumResult;
  provenance: DataProvenanceSummary;
  liveDataAudit?: TrendIQSnapshotProvenanceSummary;
}

export interface HistoricalTrendSnapshot {
  productId: string;
  timestamp: string;
  sourceMode: SnapshotSourceMode;
  scoreVersion: ScoreVersion;
  trendIQScore: number;
  confidenceScore: number;
  trendStatus?: TrendMomentumResult;
}
