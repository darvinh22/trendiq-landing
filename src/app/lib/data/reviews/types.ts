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
  recentReviewsDepth: number;
  recentReviewsWindowDays: number;
  recentReviewsMinimumScoringSampleSize: number;
  recentReviewsProvisionalSampleSize: number;
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
  writtenReviewCount?: number;
  ratingVoteCount?: number;
  ratingCount?: number;
  ratingEvidenceCount?: number;
  ratingEvidenceSourceField?: string;
  ratingEvidenceComposition?: string;
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
  writtenReviewCount?: number;
  ratingVoteCount?: number;
  ratingCount?: number;
  ratingEvidenceCount?: number;
  ratingEvidenceSourceField?: string;
  ratingEvidenceComposition?: string;
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

export interface GoogleShoppingReviewItemObservation {
  rating: number;
  publicationDate: string;
  rawPublicationDate?: string;
  providedBy?: string;
  url?: string;
  rankGroup?: number;
  rankAbsolute?: number;
}

export type RecentAverageRatingStatus = "derived-live" | "provisional" | "insufficient";

export interface GoogleShoppingRecentReviewsObservation {
  provider: ReviewProviderVendor;
  productId: string;
  identifiers: GoogleShoppingProductIdentifier;
  locationCode: number;
  languageCode: string;
  fetchedAt: string;
  sourceDatetime?: string;
  endpoint: string;
  snapshotTimestamp: string;
  windowStart: string;
  windowEnd: string;
  windowDays: number;
  status: RecentAverageRatingStatus;
  recentAverageRating?: number;
  provisionalRecentAverageRating?: number;
  totalReviewsFetched: number;
  datedReviewCount: number;
  qualifyingReviewCount: number;
  excludedReviewCount: number;
  undatedReviewCount: number;
  invalidRatingCount: number;
  outsideWindowReviewCount: number;
  totalReviewsAvailable?: number;
  sourceDomains: string[];
  reviews: GoogleShoppingReviewItemObservation[];
  calculationMethod: string;
  datePrecision: string;
  cost?: number;
}

export interface GoogleShoppingRecentReviewsClient {
  getRecentProductReviews(input: {
    productId: string;
    identity: ReviewProductIdentityConfig;
    identifiers?: GoogleShoppingProductIdentifier;
    locationCode: number;
    languageCode: string;
    snapshotTimestamp: string;
  }): Promise<GoogleShoppingRecentReviewsObservation>;
}

export interface ReviewSignalBuildResult {
  signals: NormalizedTrendSignal[];
  observation: GoogleShoppingReviewObservation;
  recentReviews?: GoogleShoppingRecentReviewsObservation;
}
