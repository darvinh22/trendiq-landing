import type { NormalizedTrendSignal } from "../types";

export type SearchProviderMode = "mock" | "live";
export type SearchProviderVendor = "dataforseo";
export type SearchInterestType = "web" | "news" | "ecommerce";
export type SearchInterestTimeRange =
  | "past_4_hours"
  | "past_day"
  | "past_7_days"
  | "past_30_days"
  | "past_90_days"
  | "past_12_months"
  | "past_5_years";

export interface SearchProductQueryConfig {
  productId: string;
  aliases: string[];
}

export interface SearchProviderConfig {
  mode: SearchProviderMode;
  provider: SearchProviderVendor;
  apiLogin?: string;
  apiPassword?: string;
  apiBaseUrl: string;
  cacheTtlMs: number;
  minSampleSize: number;
  locationCode: number;
  languageCode: string;
  interestType: SearchInterestType;
  timeRange: SearchInterestTimeRange;
  productQueries: Record<string, SearchProductQueryConfig>;
  now: () => Date;
}

export interface SearchInterestWindow {
  dateFrom: string;
  dateTo: string;
}

export interface SearchInterestPoint {
  dateFrom: string;
  dateTo: string;
  timestamp: number;
  valuesByAlias: Record<string, number>;
  missingData?: boolean;
}

export interface SearchInterestSeries {
  provider: SearchProviderVendor;
  productId: string;
  aliases: string[];
  locationCode: number;
  interestType: SearchInterestType;
  timeRange?: SearchInterestTimeRange;
  fetchedAt: string;
  cost?: number;
  points: SearchInterestPoint[];
  averagesByAlias: Record<string, number>;
}

export interface SearchVolumeMonthlyPoint {
  year: number;
  month: number;
  searchVolume: number;
}

export interface SearchVolumeObservation {
  keyword: string;
  locationCode: number;
  languageCode?: string;
  monthlySearchVolume: number;
  monthlySearches: SearchVolumeMonthlyPoint[];
}

export interface SearchVolumeSeries {
  provider: SearchProviderVendor;
  productId: string;
  aliases: string[];
  locationCode: number;
  languageCode?: string;
  fetchedAt: string;
  cost?: number;
  endpoint: string;
  monthlySearchVolume: number;
  observations: SearchVolumeObservation[];
}

export interface SearchSignalSummary {
  productId: string;
  provider: SearchProviderVendor;
  mode: SearchProviderMode;
  locationCode: number;
  timestamp: string;
  aliasesUsed: string[];
  queriesMatched: number;
  current7dInterest: number;
  previous7dInterest: number;
  prior7dInterest?: number;
  change7dPercent: number;
  previous7dChangePercent?: number;
  current30dInterest?: number;
  previous30dInterest?: number;
  change30dPercent?: number;
  accelerationPercent?: number;
  consecutiveGrowthDays?: number;
  baselineReadiness: number;
  lowBaseGrowth: boolean;
  observationCount: number;
  aliasCoveragePercent: number;
  freshnessHours: number;
  confidence: number;
  hasSufficientData: boolean;
  windows: {
    current7d: SearchInterestWindow;
    previous7d: SearchInterestWindow;
    prior7d: SearchInterestWindow;
    current30d: SearchInterestWindow;
    previous30d: SearchInterestWindow;
  };
}

export interface SearchSignalBuildResult {
  signals: NormalizedTrendSignal[];
  summary: SearchSignalSummary;
}

export interface SearchInterestClient {
  getSearchInterest(input: {
    productId: string;
    aliases: string[];
    locationCode: number;
    interestType: SearchInterestType;
    timeRange: SearchInterestTimeRange;
  }): Promise<SearchInterestSeries>;
}

export interface SearchVolumeClient {
  getSearchVolume(input: {
    productId: string;
    aliases: string[];
    locationCode: number;
    languageCode: string;
  }): Promise<SearchVolumeSeries>;
}
