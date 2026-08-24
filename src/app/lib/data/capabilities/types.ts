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
