import type { NormalizedTrendSignal } from "../types";

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
export type ProductMeasurementQueryCandidateKind =
  | "exact"
  | "model"
  | "product_family"
  | "alias";
export type ProductMeasurementQuerySourceField =
  | "query"
  | "canonicalTitle"
  | "brand"
  | "modelGeneration"
  | "aliases";

export interface ProductMeasurementQueryCandidate {
  query: string;
  kind: ProductMeasurementQueryCandidateKind;
  sourceFields: ProductMeasurementQuerySourceField[];
  confidence: ProductIdentityConfidence;
  currentlyExecutable: boolean;
  rank: number;
}

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
export type SignalExecutionRequirement =
  | "query_identity"
  | "product_family_identity"
  | "medium_or_higher_identity"
  | "high_confidence_identity"
  | "provider_ids"
  | "explicit_live_approval"
  | "paid_provider_access"
  | "cache_check"
  | "guardrail_pass";
export type SignalExecutionBlockReason =
  | "explicit_live_approval_required"
  | "approval_rejected"
  | "approval_scope_mismatch"
  | "plan_step_scope_mismatch"
  | "execution_state_store_required"
  | "state_persistence_failed"
  | "operation_count_invalid"
  | "operation_budget_exceeded"
  | "operation_safety_violation"
  | "duplicate_execution"
  | "adapter_mismatch"
  | "needs_product_identity"
  | "needs_provider_identity"
  | "needs_guardrail"
  | "blocked_by_provider_policy"
  | "unsupported_capability"
  | "adapter_failed";
export type ProviderFailureCategory =
  | "provider_http_error"
  | "provider_status_error"
  | "provider_response_shape_error"
  | "provider_timeout"
  | "provider_configuration_error"
  | "provider_network_error";

export class ProviderExecutionError extends Error {
  constructor(
    message: string,
    readonly failureCategory: ProviderFailureCategory
  ) {
    super(message);
    this.name = "ProviderExecutionError";
  }
}

export type SignalExecutionIdentityMode = "query" | "product_family" | "provider_ids";
export type SignalExecutionCacheStatus =
  | ProductResolutionCacheStatus
  | ProviderIdentityCacheStatus
  | "not_checked";
export type SignalExecutionStatus = "blocked" | "completed" | "failed";
export type SignalExecutionProvenanceMode =
  | "live"
  | "mock"
  | "fallback"
  | "derived-live"
  | "derived-mixed";
export type TrendIQPlannedSignal =
  | "search_momentum_trends"
  | "search_volume_google_ads"
  | "growth_velocity_trends"
  | "review_quality_google_shopping_aggregate"
  | "review_quality_google_shopping_reviews";
export type SignalExecutionStateStatus = "started" | "completed" | "failed";

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
  measurementQueries?: ProductMeasurementQueryCandidate[];
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
    measurementQueries?: ProductMeasurementQueryCandidate[];
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

export interface SignalExecutionCacheMetadata {
  cacheable: boolean;
  cacheKey?: string;
  cacheStatus: SignalExecutionCacheStatus;
  ttlPolicy?: string;
}

export interface SignalExecutionProviderIdentityState {
  required: boolean;
  identityMode: SignalExecutionIdentityMode;
  providerIdFieldsRequired: string[];
  providerIdFieldsPresent: string[];
  providerIdsPresent: boolean;
}

export interface SignalExecutionStep {
  planId: string;
  stepId: string;
  signal: TrendIQPlannedSignal;
  capability: LiveDataCapability;
  provider: LiveProviderId;
  productId: string;
  canonicalTitle: string;
  query: string;
  aliases: string[];
  identityMode: SignalExecutionIdentityMode;
  providerIdentity: SignalExecutionProviderIdentityState;
  readiness: LiveReadinessStatus;
  futureExecutionEligibility: FutureExecutionEligibility;
  executionAllowed: false;
  blockReason: SignalExecutionBlockReason;
  routeReason: string;
  requiredIdentityFields: ProductIdentityRequirement[];
  missingIdentityFields: ProductIdentityRequirement[];
  requirements: SignalExecutionRequirement[];
  dependencies: SignalExecutionRequirement[];
  cache: SignalExecutionCacheMetadata;
  estimatedPaidRequest: boolean;
  estimatedCostCategory: EstimatedCostCategory;
  warnings: string[];
}

export interface SignalExecutionPlanSummary {
  plannedSignals: number;
  eligible: number;
  needsIdentity: number;
  needsGuardrail: number;
  blocked: number;
  unsupported: number;
  paidLiveOperationsPerformed: 0;
}

export interface SignalExecutionPlan {
  planId: string;
  product: {
    productId: string;
    source: ProductProfileSource;
    canonicalTitle: string;
    query: string;
    productType: ProductType;
    identityConfidence: ProductIdentityConfidence;
    measurementQueries?: ProductMeasurementQueryCandidate[];
  };
  routingPlan: ProviderRoutingPlan;
  steps: SignalExecutionStep[];
  summary: SignalExecutionPlanSummary;
  dryRun: true;
  executionAllowed: false;
  generatedAt: string;
  warnings: string[];
}

export interface SignalExecutionReportRow {
  signal: TrendIQPlannedSignal;
  provider: LiveProviderId;
  readiness: LiveReadinessStatus;
  identityRequirement: SignalExecutionIdentityMode;
  futureExecutionEligibility: FutureExecutionEligibility;
  executionAllowed: false;
  blockReason: SignalExecutionBlockReason;
}

export interface SignalExecutionReport {
  product: SignalExecutionPlan["product"];
  rows: SignalExecutionReportRow[];
  summary: SignalExecutionPlanSummary;
  warnings: string[];
  dryRun: true;
}

export interface SignalExecutionResult {
  executionId: string;
  planId: string;
  stepId: string;
  provider: LiveProviderId;
  capability: LiveDataCapability;
  signal: TrendIQPlannedSignal;
  status: SignalExecutionStatus;
  blockReason?: SignalExecutionBlockReason;
  failureCategory?: ProviderFailureCategory;
  canonicalProduct: string;
  query: string;
  provenance: {
    mode: SignalExecutionProvenanceMode;
    provider: LiveProviderId;
    observedAt: string;
    notes?: string;
  };
  observedAt: string;
  cacheState: SignalExecutionCacheMetadata;
  operationCount: number;
  httpRequestCount: number;
  paidLiveOperationsPerformed: number;
  reportedProviderCost?: number;
  providerOperationId?: string;
  warnings: string[];
  signals: NormalizedTrendSignal[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface SignalExecutor {
  execute(plan: SignalExecutionPlan): Promise<SignalExecutionResult[]>;
}

export interface SignalExecutionApproval {
  approved: boolean;
  executionId: string;
  planId: string;
  stepId: string;
  signal: TrendIQPlannedSignal;
  provider: LiveProviderId;
  capability: LiveDataCapability;
  productId: string;
  canonicalProduct: string;
  query: string;
  approvedAt: string;
  maxOperations: number;
}

export interface SignalExecutionAdapterOutput {
  provenance: SignalExecutionResult["provenance"];
  observedAt?: string;
  cacheState?: SignalExecutionCacheMetadata;
  operationCount?: number;
  httpRequestCount?: number;
  paidLiveOperationsPerformed?: number;
  reportedProviderCost?: number;
  providerOperationId?: string;
  warnings?: string[];
  signals?: NormalizedTrendSignal[];
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

export interface ProviderExecutionAdapter {
  provider: LiveProviderId;
  capability: LiveDataCapability;
  signal: TrendIQPlannedSignal;
  logicalOperationCount: number;
  expectedHttpRequestCount: number;
  execute(input: {
    step: SignalExecutionStep;
    approval: SignalExecutionApproval;
  }): Promise<SignalExecutionAdapterOutput>;
}

export interface SignalExecutionState {
  executionId: string;
  planId: string;
  stepId: string;
  provider: LiveProviderId;
  capability: LiveDataCapability;
  signal: TrendIQPlannedSignal;
  status: SignalExecutionStateStatus;
  startedAt: string;
  completedAt?: string;
  operationCount: number;
}

export interface SignalExecutionStateStore {
  get(executionId: string): Promise<SignalExecutionState | undefined>;
  reserveStarted(state: SignalExecutionState): Promise<{
    reserved: boolean;
    existing?: SignalExecutionState;
  }>;
  setCompleted(state: SignalExecutionState): Promise<void>;
  setFailed(state: SignalExecutionState): Promise<void>;
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
