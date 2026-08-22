import type { NormalizedTrendSignal } from "../types";

export type ReviewProviderMode = "mock" | "live";
export type ReviewProviderVendor = "dataforseo";
export type ProductMatchConfidence = "high" | "medium" | "low" | "rejected";

export interface GoogleShoppingProductIdentifier {
  productId?: string;
  dataDocid?: string;
  gid?: string;
}

export interface ReviewProductIdentityConfig {
  productId: string;
  canonicalSearchQuery: string;
  productTitle: string;
  brand: string;
  generation?: string;
  acceptedSellers?: string[];
  providerProductIds?: GoogleShoppingProductIdentifier & {
    observedAt?: string;
    matchConfidence?: ProductMatchConfidence;
  };
}

export interface ReviewProviderConfig {
  mode: ReviewProviderMode;
  provider: ReviewProviderVendor;
  apiLogin?: string;
  apiPassword?: string;
  apiBaseUrl: string;
  cacheTtlMs: number;
  locationCode: number;
  languageCode: string;
  taskDepth: number;
  taskPollAttempts: number;
  taskPollIntervalMs: number;
  minimumMatchConfidence: ProductMatchConfidence;
  productIdentities: Record<string, ReviewProductIdentityConfig>;
  now: () => Date;
}

export interface GoogleShoppingProductCandidate {
  title: string;
  seller?: string;
  identifiers: GoogleShoppingProductIdentifier;
  averageRating?: number;
  ratingMax?: number;
  providerReviewCount?: number;
  rankGroup?: number;
  rankAbsolute?: number;
  isBestMatch?: boolean;
}

export interface ProductMatchResult {
  confidence: ProductMatchConfidence;
  score: number;
  reasons: string[];
}

export interface GoogleShoppingReviewObservation {
  provider: ReviewProviderVendor;
  productId: string;
  searchQuery: string;
  locationCode: number;
  languageCode: string;
  fetchedAt: string;
  sourceDatetime?: string;
  endpoint: string;
  matchedProductTitle: string;
  seller?: string;
  identifiers: GoogleShoppingProductIdentifier;
  averageRating: number;
  ratingMax?: number;
  providerReviewCount?: number;
  matchConfidence: Exclude<ProductMatchConfidence, "rejected">;
  matchScore: number;
  matchReasons: string[];
  providerVariantGrouping: string;
  rankGroup?: number;
  rankAbsolute?: number;
  isBestMatch?: boolean;
  cost?: number;
}

export interface GoogleShoppingReviewsClient {
  getProductReviewAggregate(input: {
    productId: string;
    identity: ReviewProductIdentityConfig;
    locationCode: number;
    languageCode: string;
  }): Promise<GoogleShoppingReviewObservation>;
}

export interface ReviewSignalBuildResult {
  signals: NormalizedTrendSignal[];
  observation: GoogleShoppingReviewObservation;
}
