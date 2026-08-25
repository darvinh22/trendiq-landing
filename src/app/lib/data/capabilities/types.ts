export type ProductProfileSource = "catalog" | "user_search" | "resolved_provider";
export type ProductResolutionSource =
  | "catalog_match"
  | "local_rules"
  | "cached_resolution"
  | "provider_resolution";

export type ProductResolutionCacheStatus = "hit" | "miss" | "expired" | "disabled";

export type ProductType =
  | "hardware"
  | "subscription_hardware"
  | "software_saas"
  | "mobile_app"
  | "hybrid"
  | "unknown";

export type ProductIdentityConfidence = "high" | "medium" | "low";

export type LiveDataCapability =
  | "search"
  | "reviews"
  | "growth"
  | "social"
  | "sentiment"
  | "purchaseIntent";

export type LiveReadinessStatus = "ready" | "guarded" | "blocked" | "unsupported";
export type ProviderPolicy = "allowed" | "guarded" | "blocked";
export type EstimatedCostCategory = "free" | "very_low" | "low" | "medium" | "unknown";
export type FutureExecutionEligibility =
  | "eligible"
  | "needs_identity"
  | "needs_guardrail"
  | "blocked"
  | "unsupported";
export type ProviderIdentityDiscoveryStatus =
  | "resolved"
  | "ambiguous"
  | "not_found"
  | "blocked"
  | "error";
export type ProviderIdentityCacheStatus = "hit" | "miss" | "expired" | "disabled";
export type CanonicalIdentityLevel = "product_family" | "size_variant";
export type ProviderIdentityCandidateBucket =
  | "canonical-product-equivalent"
  | "legitimate-variant"
  | "different-size"
  | "different-generation/model"
  | "bundle/kit"
  | "accessory"
  | "refurbished/used"
  | "incomplete-provider-identity"
  | "brand/title-conflict"
  | "unrelated";
export type ProviderIdentityBundleStatus = "standalone" | "bundle" | "accessory";
export type ProviderIdentityCondition = "new" | "refurbished" | "used" | "unknown";
export type ProviderIdentityListingType =
  | "canonical_product"
  | "retailer_listing"
  | "marketplace_duplicate"
  | "variant_listing"
  | "bundle"
  | "accessory"
  | "condition_variant"
  | "unrelated";
export type ProviderIdGroupScope =
  | "product_family"
  | "size_variant"
  | "listing_specific"
  | "mixed_or_unclear";
export type ProviderIdentityCompleteness = "complete" | "incomplete";

export type LiveProviderId =
  | "dataforseo_trends"
  | "dataforseo_google_ads"
  | "dataforseo_google_shopping"
  | "dataforseo_google_shopping_reviews"
  | "reddit";

export type ProductIdentityRequirement =
  | "query"
  | "canonicalTitle"
  | "brand"
  | "aliases"
  | "productType"
  | "modelGeneration"
  | "identityConfidence"
  | "providerSpecificIds"
  | "variantBundleGuardrails"
  | "hardwareOnlyIdentity";

export interface ProductIdentityGuardrails {
  requireExactBrandMatch?: boolean;
  requireModelGenerationMatch?: boolean;
  requireHardwareOnlyMatch?: boolean;
  excludeAccessories?: boolean;
  excludeBundles?: boolean;
  excludeRefurbished?: boolean;
  excludeSubscriptionOnlyListings?: boolean;
  acceptedProductTerms?: string[];
  excludedTerms?: string[];
  notes?: string[];
}

export interface ProductProfile {
  productId: string;
  source: ProductProfileSource;
  query: string;
  canonicalTitle: string;
  brand?: string;
  aliases: string[];
  productType?: ProductType;
  category?: string;
  modelGeneration?: string;
  identityConfidence: ProductIdentityConfidence;
  providerIds?: Record<string, unknown>;
  guardrails?: ProductIdentityGuardrails;
}

export interface ProductResolution {
  originalQuery: string;
  normalizedQuery: string;
  canonicalTitle: string;
  brand?: string;
  inferredProductType: ProductType;
  category?: string;
  modelGeneration?: string;
  aliases: string[];
  identityConfidence: ProductIdentityConfidence;
  resolutionSource: ProductResolutionSource;
  matchedCatalogProductId?: string;
  warnings: string[];
}

export interface CapabilityEvaluation {
  capability: LiveDataCapability;
  status: LiveReadinessStatus;
  reason: string;
  missingRequirements: ProductIdentityRequirement[];
  allowedProviders: LiveProviderId[];
  blockedProviders: LiveProviderId[];
  requiredIdentityFields: ProductIdentityRequirement[];
  warnings: string[];
}

export interface ProviderUseDecision extends CapabilityEvaluation {
  provider: LiveProviderId;
  allowed: boolean;
  policy: ProviderPolicy;
}

export interface ProviderRoute {
  capability: LiveDataCapability;
  provider: LiveProviderId;
  status: LiveReadinessStatus;
  reason: string;
  requiredIdentityFields: ProductIdentityRequirement[];
  missingIdentityFields: ProductIdentityRequirement[];
  estimatedPaidRequest: boolean;
  estimatedCostCategory: EstimatedCostCategory;
  executionAllowed: false;
  futureExecutionEligibility: FutureExecutionEligibility;
  warnings: string[];
}

export type ProviderRouteDecision = ProviderRoute;

export interface ProviderRoutingPlan {
  profile: ProductProfile;
  routes: ProviderRoute[];
  blockedRoutes: ProviderRouteDecision[];
  guardedRoutes: ProviderRouteDecision[];
  unsupportedCapabilities: LiveDataCapability[];
  warnings: string[];
  dryRun: true;
}

export interface ProviderRoutingReport {
  product: {
    productId: string;
    source: ProductProfileSource;
    canonicalTitle: string;
    productType: ProductType;
    identityConfidence: ProductIdentityConfidence;
  };
  type: ProductType;
  identityConfidence: ProductIdentityConfidence;
  providerRoutes: ProviderRoute[];
  blockedProviders: LiveProviderId[];
  guardedProviders: LiveProviderId[];
  missingIdentity: ProductIdentityRequirement[];
  paidRouteWarnings: string[];
  futureExecutionEligibility: Record<FutureExecutionEligibility, ProviderRoute[]>;
  warnings: string[];
  dryRun: true;
}

export interface ProviderIdentityEvidence {
  field: string;
  expected?: string | string[];
  observed?: string | string[];
  score?: number;
  passed: boolean;
  reason: string;
}

export interface ProviderIdentityCandidate {
  provider: LiveProviderId;
  title: string;
  brand?: string;
  seller?: string;
  productType?: ProductType;
  providerIds: Record<string, string>;
  canonicalProductFamily?: string;
  modelGeneration?: string;
  sizeVariant?: string;
  colorVariant?: string;
  bundleStatus?: ProviderIdentityBundleStatus;
  condition?: ProviderIdentityCondition;
  listingType?: ProviderIdentityListingType;
  matchedVariant?: string;
  rankGroup?: number;
  rankAbsolute?: number;
  isBestMatch?: boolean;
}

export interface ProviderIdentityCandidateClassification {
  candidate: ProviderIdentityCandidate;
  bucket: ProviderIdentityCandidateBucket;
  canonicalProductFamily: string;
  modelGeneration?: string;
  sizeVariant?: string;
  colorVariant?: string;
  bundleStatus: ProviderIdentityBundleStatus;
  condition: ProviderIdentityCondition;
  listingType: ProviderIdentityListingType;
  groupKey: string;
  providerIdComplete: boolean;
  providerIdSignature?: string;
  evidence: ProviderIdentityEvidence[];
  warnings: string[];
}

export interface ProviderIdentityProviderIdGroup {
  signature: string;
  providerIds: Record<string, string>;
  canonicalProductFamily: string;
  modelGeneration?: string;
  sizeVariant?: string;
  sizeVariants: string[];
  colorVariants: string[];
  sellers: string[];
  candidateCount: number;
  bestRank?: number;
  ranks: number[];
  titles: string[];
  bundleStatuses: ProviderIdentityBundleStatus[];
  conditions: ProviderIdentityCondition[];
  listingTypes: ProviderIdentityListingType[];
  titleConsistency: ProductIdentityConfidence;
  sellerDiversity: number;
  identityCompleteness: ProviderIdentityCompleteness;
  variantConsistency: ProductIdentityConfidence;
  scope: ProviderIdGroupScope;
  evidenceScore: number;
  identityConfidence: ProductIdentityConfidence;
  providerIdsSafeToPersist: boolean;
  persistenceReason: string;
  warnings: string[];
}

export interface ProviderIdentityGroup {
  groupKey: string;
  canonicalProductFamily: string;
  modelGeneration?: string;
  sizeVariant?: string;
  sizeVariants: string[];
  colorVariants: string[];
  members: ProviderIdentityCandidateClassification[];
  strongestCandidate: ProviderIdentityCandidate;
  score: number;
  identityConfidence: ProductIdentityConfidence;
  providerIds: Record<string, string>;
  providerIdsSafeToPersist: boolean;
  providerIdPersistenceReason: string;
  providerIdConfidence: ProductIdentityConfidence;
  providerIdGroups: ProviderIdentityProviderIdGroup[];
  selectedProviderIdGroup?: ProviderIdentityProviderIdGroup;
  sellerCount: number;
  warnings: string[];
  evidence: ProviderIdentityEvidence[];
}

export interface ProviderIdentityDiscoveryRequest {
  profile: ProductProfile;
  provider: LiveProviderId;
  capability: LiveDataCapability;
  locale?: string;
  market?: string;
}

export interface ProviderIdentityDiscoveryResult {
  provider: LiveProviderId;
  status: ProviderIdentityDiscoveryStatus;
  identityConfidence: ProductIdentityConfidence;
  providerIds: Record<string, string>;
  canonicalTitle?: string;
  brand?: string;
  modelGeneration?: string;
  matchedVariant?: string;
  warnings: string[];
  evidence: ProviderIdentityEvidence[];
  selectedCandidate?: ProviderIdentityCandidate;
  selectedGroup?: ProviderIdentityGroup;
  candidateCount: number;
  identityGroupCount?: number;
  discoveredAt: string;
  cacheStatus: ProviderIdentityCacheStatus;
  cacheKey?: string;
}

export interface ProviderIdentityDiscoveryReport {
  originalQuery: string;
  canonicalProduct: string;
  provider: LiveProviderId;
  candidateCount: number;
  identityGroupCount?: number;
  selectedCandidate?: ProviderIdentityCandidate;
  selectedGroup?: ProviderIdentityGroup;
  confidence: ProductIdentityConfidence;
  providerIds: Record<string, string>;
  warnings: string[];
  cacheStatus: ProviderIdentityCacheStatus;
  identityResolutionStatus: ProviderIdentityDiscoveryStatus;
  routingBefore: ProviderRoutingPlan;
  routingAfter: ProviderRoutingPlan;
  executionAllowed: false;
}

export interface ProductReadinessReport {
  productId: string;
  source: ProductProfileSource;
  query: string;
  canonicalTitle: string;
  productType: ProductType;
  identityConfidence: ProductIdentityConfidence;
  capabilities: CapabilityEvaluation[];
  missingIdentityRequirements: ProductIdentityRequirement[];
  blockedProviders: LiveProviderId[];
}

export interface ProductResolutionResult {
  resolution: ProductResolution;
  profile: ProductProfile;
  readiness: ProductReadinessReport;
  cacheStatus: ProductResolutionCacheStatus;
  cacheKey: string;
  expiresAt?: string;
}
