import type { NormalizedTrendSignal, SignalSourceProvenanceMode } from "../types";
import type { ProductProfile } from "../capabilities";

export type ReviewProviderMode = "mock" | "live";
export type ReviewProviderVendor = "dataforseo";
export type ProductMatchConfidence = "high" | "medium" | "low" | "rejected";
export type ReviewIdentityDecision = "match" | "needs_identity" | "reject";

export interface GoogleShoppingProductIdentifier {
  productId?: string;
  dataDocid?: string;
  gid?: string;
}

export type EphemeralProviderIdentitySource = "google_shopping_aggregate_candidate";
export type EphemeralProviderIdentityStatus = "ready" | "identity_not_ready" | "identity_inconclusive";

export interface EphemeralProviderIdentityEvidence {
  source: EphemeralProviderIdentitySource;
  matchDecision: "match";
  matchConfidence: "high";
  matchedProductTitle: string;
  seller?: string;
  matchReasons: string[];
  observedAt: string;
}

export interface EphemeralProviderIdentity {
  provider: ReviewProviderVendor;
  productId: string;
  identifiers: {
    gid: string;
    productId?: string;
    dataDocid?: string;
  };
  evidence: EphemeralProviderIdentityEvidence;
}

export type EphemeralProviderIdentityResult =
  | {
      status: "ready";
      identity: EphemeralProviderIdentity;
    }
  | {
      status: "identity_not_ready" | "identity_inconclusive";
      reason: string;
      identity?: never;
    };

export interface GoogleShoppingDetailedReviewsRequestPlan {
  provider: ReviewProviderVendor;
  providerCapability: "dataforseo_google_shopping_reviews";
  method: "POST";
  endpointPath: string;
  networkAllowed: false;
  product: {
    productId: string;
    canonicalSearchQuery: string;
    productTitle: string;
    brand: string;
    generation?: string;
  };
  requiredProviderIds: {
    gid: string;
    productId?: string;
    dataDocid?: string;
  };
  identityEvidence: EphemeralProviderIdentityEvidence;
  requestPayload: Array<{
    gid: string;
    product_id?: string;
    data_docid?: string;
    location_code: number;
    language_code: string;
    depth: number;
    priority: 1;
    tag: string;
  }>;
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
  productProfiles?: Record<string, ProductProfile>;
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
  identityDecision: ReviewIdentityDecision;
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

export type RatingDistributionSource = "provider_rating_groups" | "review_items";
export type RatingDistributionScope = "full_provider_distribution" | "fetched_review_sample";
export type RatingConsensusQualityStatus = "derived-live" | "provisional" | "insufficient" | "mismatch";

export interface RatingDistributionInput {
  star1Count: number;
  star2Count: number;
  star3Count: number;
  star4Count: number;
  star5Count: number;
  distributionSource: RatingDistributionSource;
  distributionScope: RatingDistributionScope;
  distributionComposition: string;
}

export interface RatingConsensusQualityResult extends RatingDistributionInput {
  totalDistributionCount: number;
  mean: number;
  standardDeviation: number;
  variance: number;
  qualityGate: number;
  shapeSupport: number;
  lowTailPenalty: number;
  status: RatingConsensusQualityStatus;
  ratingConsensusQuality?: number;
  provisionalRatingConsensusQuality?: number;
  aggregateAverageRating?: number;
  aggregateRatingDelta?: number;
  aggregateRatingMismatchThreshold?: number;
  calculationMethod: string;
}

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
  ratingConsensus?: RatingConsensusQualityResult;
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
    aggregateAverageRating?: number;
  }): Promise<GoogleShoppingRecentReviewsObservation>;
}

export type ValidatedDetailedReviewEvidenceStatus =
  | "reviews_validated"
  | "identity_inconclusive"
  | "provider_pending"
  | "provider_no_result"
  | "provider_error"
  | "malformed_response";

export type ReviewEvidenceProviderMode = Extract<SignalSourceProvenanceMode, "live" | "derived-live">;
export type ReviewDistributionEvidenceStatus =
  | "usable"
  | "provisional"
  | "insufficient"
  | "mismatch"
  | "unavailable";
export type ReviewTextEvidenceStatus = RecentAverageRatingStatus | "unavailable";
export type ReviewTextSampleScope = "trailing_window_dated_reviews" | "none";

export interface NormalizedRatingGroupEvidence {
  star: 1 | 2 | 3 | 4 | 5;
  count: number;
}

export interface NormalizedReviewCostProvenance {
  taskCost: number | null;
  observationCost: number | null;
  sourceCostCompatibleValue: number | null;
}

export interface NormalizedReviewDistributionEvidence {
  status: ReviewDistributionEvidenceStatus;
  reviewsCount: number | null;
  ratingGroups: NormalizedRatingGroupEvidence[];
  ratingConsensusStatus: RatingConsensusQualityStatus | null;
  ratingConsensusQuality: number | null;
  provisionalRatingConsensusQuality: number | null;
  distributionSource: RatingDistributionSource | null;
  distributionScope: RatingDistributionScope | null;
  distributionComposition: string | null;
}

export interface NormalizedTextReviewEvidence {
  status: ReviewTextEvidenceStatus;
  fetchedReviewCount: number;
  qualifyingReviewCount: number;
  recentAverageRating: number | null;
  provisionalRecentAverageRating: number | null;
  sourceDomains: string[];
  sampleScope: ReviewTextSampleScope;
  windowStart: string | null;
  windowEnd: string | null;
  windowDays: number | null;
  calculationMethod: string | null;
  datePrecision: string | null;
}

interface NormalizedValidatedReviewEvidenceBase {
  canonicalProductId: string;
  provider: ReviewProviderVendor;
  providerEvidenceMode: ReviewEvidenceProviderMode;
  totalReviewsAvailable: number | null;
  fetchedReviewCount: number;
  qualifyingReviewCount: number;
  sourceDomains: string[];
  observedAt: string | null;
  cost: NormalizedReviewCostProvenance;
  distributionEvidence: NormalizedReviewDistributionEvidence;
  textEvidence: NormalizedTextReviewEvidence;
  distributionEvidenceStatus: ReviewDistributionEvidenceStatus;
  textEvidenceStatus: ReviewTextEvidenceStatus;
  reviewRetrievalStatus: ValidatedDetailedReviewEvidenceStatus;
  validationStatus: ValidatedDetailedReviewEvidenceStatus;
  recentAverageRating: number | null;
  ratingConsensusStatus: RatingConsensusQualityStatus | null;
  ratingConsensusQuality: number | null;
  distributionSource: RatingDistributionSource | null;
  distributionScope: RatingDistributionScope | null;
  textSampleScope: ReviewTextSampleScope;
  reason?: string;
}

export interface NormalizedReviewsValidatedEvidence extends NormalizedValidatedReviewEvidenceBase {
  status: "reviews_validated";
  validationStatus: "reviews_validated";
  reviewRetrievalStatus: "reviews_validated";
}

export interface NormalizedDegradedReviewEvidence extends NormalizedValidatedReviewEvidenceBase {
  status: Exclude<ValidatedDetailedReviewEvidenceStatus, "reviews_validated">;
  validationStatus: Exclude<ValidatedDetailedReviewEvidenceStatus, "reviews_validated">;
  reviewRetrievalStatus: Exclude<ValidatedDetailedReviewEvidenceStatus, "reviews_validated">;
  distributionEvidenceStatus: "unavailable";
  textEvidenceStatus: "unavailable";
  recentAverageRating: null;
  ratingConsensusStatus: null;
  ratingConsensusQuality: null;
  distributionSource: null;
  distributionScope: null;
  textSampleScope: "none";
}

export type NormalizedValidatedReviewEvidence =
  | NormalizedReviewsValidatedEvidence
  | NormalizedDegradedReviewEvidence;

export interface ReviewSignalBuildResult {
  signals: NormalizedTrendSignal[];
  observation: GoogleShoppingReviewObservation;
  recentReviews?: GoogleShoppingRecentReviewsObservation;
}
