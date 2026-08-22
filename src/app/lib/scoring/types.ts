export const LEGACY_SCORE_VERSION_V1 = "v1" as const;
export const SCORE_VERSION = "v1.1" as const;

export type ScoreVersion = typeof LEGACY_SCORE_VERSION_V1 | typeof SCORE_VERSION;

export type TrendStatus = "Exploding" | "Rising" | "Stable" | "Cooling";
export type ConfidenceLevel = "Low" | "Developing" | "Good" | "High";

export interface TrendPoint {
  day: string;
  value: number;
}

export type TrendIQScoreComponentKey =
  | "socialMomentum"
  | "searchMomentum"
  | "sentiment"
  | "reviewQuality"
  | "purchaseIntent"
  | "growthVelocity"
  | "hypeSustainability";

export type TrendIQScoreComponents = Record<TrendIQScoreComponentKey, number>;

export type ConfidenceComponentKey =
  | "dataVolume"
  | "sourceDiversity"
  | "dataRecency"
  | "signalAgreement"
  | "dataCompleteness";

export type ConfidenceComponents = Record<ConfidenceComponentKey, number>;

export interface SocialMomentumSignals {
  mentions7d: number;
  mentionGrowthPercent: number;
  engagementRatePercent: number;
  creatorPostCount: number;
}

export interface SearchMomentumSignals {
  searchVolume7d: number;
  searchGrowthPercent: number;
  queryShareOfCategoryPercent: number;
  current7dRelativeInterest?: number;
  previous7dRelativeInterest?: number;
  searchGrowthBaselineReadiness?: number;
  hasLowBaseSearchGrowth?: boolean;
}

export interface SentimentSignals {
  positiveMentionPercent: number;
  negativeMentionPercent: number;
}

export interface ReviewQualitySignals {
  averageRating: number;
  ratingEvidenceCount: number;
  verifiedPurchasePercent: number;
  recentAverageRating: number;
}

export interface PurchaseIntentSignals {
  buyingKeywordSharePercent: number;
  addToCartRatePercent: number;
  affiliateClickThroughRatePercent: number;
  saveRatePercent: number;
}

export interface GrowthVelocitySignals {
  trendChangePercent: number;
  accelerationPercent: number;
  consecutiveGrowthDays: number;
  searchDerivedTrendChangePercent?: number;
  searchDerivedAccelerationPercent?: number;
  nonSearchTrendChangePercent?: number;
  nonSearchAccelerationPercent?: number;
  searchGrowthBaselineReadiness?: number;
  hasSearchDerivedVelocity?: boolean;
  hasLowBaseSearchGrowth?: boolean;
}

export interface HypeSustainabilitySignals {
  repeatMentionRatePercent: number;
  sourceHalfLifeDays: number;
  creatorConcentrationPercent: number;
  evergreenInterestPercent: number;
}

export interface ConfidenceSignals {
  observationCount: number;
  sourceCount: number;
  newestSignalAgeHours: number;
  agreeingSignalCount: number;
  totalSignalCount: number;
  completeSignalCount: number;
  expectedSignalCount: number;
  lowBaselineGrowthSignalCount?: number;
  growthInterpretationQuality?: number;
}

export interface TrendIQSignalInputs {
  socialMomentum: SocialMomentumSignals;
  searchMomentum: SearchMomentumSignals;
  sentiment: SentimentSignals;
  reviewQuality: ReviewQualitySignals;
  purchaseIntent: PurchaseIntentSignals;
  growthVelocity: GrowthVelocitySignals;
  hypeSustainability: HypeSustainabilitySignals;
  confidence: ConfidenceSignals;
}

export interface ScorePenalty {
  id: string;
  label: string;
  points: number;
  reason: string;
}

export interface TrendIQScoreResult {
  scoreVersion: ScoreVersion;
  score: number;
  weightedComponentScore: number;
  components: TrendIQScoreComponents;
  penalties: ScorePenalty[];
  penaltyTotal: number;
}

export interface ConfidenceScoreResult {
  scoreVersion: ScoreVersion;
  score: number;
  level: ConfidenceLevel;
  components: ConfidenceComponents;
}

export interface TrendMomentumResult {
  changePercent: number;
  status: TrendStatus;
  isProvisional?: boolean;
  reason?: string;
}
