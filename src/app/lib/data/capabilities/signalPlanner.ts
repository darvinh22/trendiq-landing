import {
  CACHE_TTL_CONCEPTS,
  DEFAULT_PRODUCT_RESOLUTION_LOCALE,
  buildSignalExecutionCacheKey,
} from "./cacheContracts";
import { routeProvidersForProfile } from "./router";
import type {
  FutureExecutionEligibility,
  LiveDataCapability,
  LiveProviderId,
  ProductIdentityRequirement,
  ProductProfile,
  ProductType,
  ProviderRoute,
  ProviderRoutingPlan,
  SignalExecutionBlockReason,
  SignalExecutionCacheStatus,
  SignalExecutionIdentityMode,
  SignalExecutionPlan,
  SignalExecutionPlanSummary,
  SignalExecutionProviderIdentityState,
  SignalExecutionReport,
  SignalExecutionRequirement,
  SignalExecutionStep,
  TrendIQPlannedSignal,
} from "./types";

export interface SignalExecutionPlanningOptions {
  routingPlan?: ProviderRoutingPlan;
  locale?: string;
  now?: () => Date;
  cacheStatusByKey?: Record<string, SignalExecutionCacheStatus>;
}

const GOOGLE_SHOPPING_REVIEW_ID_FIELDS = ["productId", "gid", "dataDocid"];

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function productType(profile: ProductProfile): ProductType {
  return profile.productType ?? "unknown";
}

function providerIdFieldsFor(profile: ProductProfile, provider: LiveProviderId): string[] {
  const providerIds = profile.providerIds?.[provider];
  if (!providerIds || typeof providerIds !== "object" || Array.isArray(providerIds)) return [];

  return Object.entries(providerIds)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([field]) => field)
    .sort();
}

function planIdForProfile(profile: ProductProfile, generatedAt: string, locale: string): string {
  return [
    "signal-plan",
    locale.toLowerCase(),
    profile.productId,
    profile.canonicalTitle,
    profile.query,
    profile.productType ?? "unknown",
    profile.identityConfidence,
    generatedAt,
  ].join(":");
}

function stepIdForRoute(planId: string, route: ProviderRoute): string {
  return [
    planId,
    route.provider,
    route.capability,
    signalForRoute(route),
  ].join(":");
}

function signalForRoute(route: ProviderRoute): TrendIQPlannedSignal {
  if (route.provider === "dataforseo_trends" && route.capability === "search") {
    return "search_momentum_trends";
  }

  if (route.provider === "dataforseo_google_ads" && route.capability === "search") {
    return "search_volume_google_ads";
  }

  if (route.provider === "dataforseo_trends" && route.capability === "growth") {
    return "growth_velocity_trends";
  }

  if (route.provider === "dataforseo_google_shopping" && route.capability === "reviews") {
    return "review_quality_google_shopping_aggregate";
  }

  if (route.provider === "dataforseo_google_shopping_reviews" && route.capability === "reviews") {
    return "review_quality_google_shopping_reviews";
  }

  throw new Error(`No Phase 3P signal mapping for ${route.provider}/${route.capability}.`);
}

function identityModeForRoute(route: ProviderRoute): SignalExecutionIdentityMode {
  if (route.provider === "dataforseo_google_shopping_reviews") return "provider_ids";
  if (route.provider === "dataforseo_google_shopping") return "product_family";
  return "query";
}

function providerIdentityState(
  profile: ProductProfile,
  route: ProviderRoute,
  identityMode: SignalExecutionIdentityMode
): SignalExecutionProviderIdentityState {
  const providerIdFieldsRequired = identityMode === "provider_ids" ? GOOGLE_SHOPPING_REVIEW_ID_FIELDS : [];
  const providerIdFieldsPresent = providerIdFieldsFor(profile, route.provider);

  return {
    required: identityMode === "provider_ids",
    identityMode,
    providerIdFieldsRequired,
    providerIdFieldsPresent,
    providerIdsPresent: providerIdFieldsRequired.length > 0 &&
      providerIdFieldsRequired.every((field) => providerIdFieldsPresent.includes(field)),
  };
}

function blockReasonForRoute(route: ProviderRoute): SignalExecutionBlockReason {
  if (route.futureExecutionEligibility === "needs_identity") {
    return route.missingIdentityFields.includes("providerSpecificIds")
      ? "needs_provider_identity"
      : "needs_product_identity";
  }

  if (route.futureExecutionEligibility === "needs_guardrail") return "needs_guardrail";
  if (route.futureExecutionEligibility === "blocked") return "blocked_by_provider_policy";
  if (route.futureExecutionEligibility === "unsupported") return "unsupported_capability";

  return "explicit_live_approval_required";
}

function routeRequiresProductFamily(route: ProviderRoute): boolean {
  return route.requiredIdentityFields.some((field) =>
    field === "canonicalTitle" ||
    field === "brand" ||
    field === "productType" ||
    field === "modelGeneration"
  );
}

function requirementsForRoute(
  route: ProviderRoute,
  identityMode: SignalExecutionIdentityMode
): SignalExecutionRequirement[] {
  const requirements: SignalExecutionRequirement[] = ["explicit_live_approval", "cache_check"];

  if (route.estimatedPaidRequest) requirements.push("paid_provider_access");
  if (identityMode === "query" || route.requiredIdentityFields.includes("query") || route.requiredIdentityFields.includes("aliases")) {
    requirements.push("query_identity");
  }
  if (identityMode === "product_family" || routeRequiresProductFamily(route)) {
    requirements.push("product_family_identity");
  }
  if (identityMode === "provider_ids" || route.requiredIdentityFields.includes("providerSpecificIds")) {
    requirements.push("provider_ids");
  }
  if (route.requiredIdentityFields.includes("identityConfidence")) {
    requirements.push(route.provider === "dataforseo_google_shopping"
      ? "high_confidence_identity"
      : "medium_or_higher_identity");
  }
  if (
    route.requiredIdentityFields.includes("variantBundleGuardrails") ||
    route.requiredIdentityFields.includes("hardwareOnlyIdentity")
  ) {
    requirements.push("guardrail_pass");
  }

  return unique(requirements);
}

function stepForRoute(input: {
  planId: string;
  profile: ProductProfile;
  route: ProviderRoute;
  locale: string;
  cacheStatusByKey?: Record<string, SignalExecutionCacheStatus>;
}): SignalExecutionStep {
  const { profile, route, locale } = input;
  const identityMode = identityModeForRoute(route);
  const cacheKey = buildSignalExecutionCacheKey(profile, route.provider, route.capability, locale);
  const requirements = requirementsForRoute(route, identityMode);

  return {
    planId: input.planId,
    stepId: stepIdForRoute(input.planId, route),
    signal: signalForRoute(route),
    capability: route.capability,
    provider: route.provider,
    productId: profile.productId,
    canonicalTitle: profile.canonicalTitle,
    query: profile.query,
    aliases: profile.aliases,
    identityMode,
    providerIdentity: providerIdentityState(profile, route, identityMode),
    readiness: route.status,
    futureExecutionEligibility: route.futureExecutionEligibility,
    executionAllowed: false,
    blockReason: blockReasonForRoute(route),
    routeReason: route.reason,
    requiredIdentityFields: route.requiredIdentityFields,
    missingIdentityFields: route.missingIdentityFields,
    requirements,
    dependencies: requirements,
    cache: {
      cacheable: true,
      cacheKey,
      cacheStatus: input.cacheStatusByKey?.[cacheKey] ?? "not_checked",
      ttlPolicy: CACHE_TTL_CONCEPTS.signalExecutionPlan,
    },
    estimatedPaidRequest: route.estimatedPaidRequest,
    estimatedCostCategory: route.estimatedCostCategory,
    warnings: route.warnings,
  };
}

function summaryForSteps(steps: SignalExecutionStep[]): SignalExecutionPlanSummary {
  const count = (status: FutureExecutionEligibility): number =>
    steps.filter((step) => step.futureExecutionEligibility === status).length;

  return {
    plannedSignals: steps.length,
    eligible: count("eligible"),
    needsIdentity: count("needs_identity"),
    needsGuardrail: count("needs_guardrail"),
    blocked: count("blocked"),
    unsupported: count("unsupported"),
    paidLiveOperationsPerformed: 0,
  };
}

export function buildSignalExecutionPlan(
  profile: ProductProfile,
  options: SignalExecutionPlanningOptions = {}
): SignalExecutionPlan {
  const locale = options.locale ?? DEFAULT_PRODUCT_RESOLUTION_LOCALE;
  const routingPlan = options.routingPlan ?? routeProvidersForProfile(profile);
  const generatedAt = (options.now?.() ?? new Date()).toISOString();
  const planId = planIdForProfile(profile, generatedAt, locale);
  const steps = routingPlan.routes.map((route) =>
    stepForRoute({
      planId,
      profile,
      route,
      locale,
      cacheStatusByKey: options.cacheStatusByKey,
    })
  );

  return {
    planId,
    product: {
      productId: profile.productId,
      source: profile.source,
      canonicalTitle: profile.canonicalTitle,
      query: profile.query,
      productType: productType(profile),
      identityConfidence: profile.identityConfidence,
    },
    routingPlan,
    steps,
    summary: summaryForSteps(steps),
    dryRun: true,
    executionAllowed: false,
    generatedAt,
    warnings: unique(routingPlan.warnings),
  };
}

export function buildSignalExecutionReport(plan: SignalExecutionPlan): SignalExecutionReport {
  return {
    product: plan.product,
    rows: plan.steps.map((step) => ({
      signal: step.signal,
      provider: step.provider,
      readiness: step.readiness,
      identityRequirement: step.identityMode,
      futureExecutionEligibility: step.futureExecutionEligibility,
      executionAllowed: false,
      blockReason: step.blockReason,
    })),
    summary: plan.summary,
    warnings: plan.warnings,
    dryRun: true,
  };
}
