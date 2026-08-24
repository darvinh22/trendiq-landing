import { canUseProvider, evaluateCapability } from "./evaluator";
import type {
  EstimatedCostCategory,
  FutureExecutionEligibility,
  LiveDataCapability,
  LiveProviderId,
  ProductIdentityRequirement,
  ProductProfile,
  ProductResolutionResult,
  ProductType,
  ProviderRoute,
  ProviderRoutingPlan,
  ProviderRoutingReport,
  ProviderUseDecision,
} from "./types";

interface RouteDefinition {
  capability: LiveDataCapability;
  provider: LiveProviderId;
  estimatedPaidRequest: boolean;
  estimatedCostCategory: EstimatedCostCategory;
}

export interface ProviderRoutingOptions {
  dryRun?: true;
  providerClients?: Record<string, unknown>;
}

const ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    capability: "search",
    provider: "dataforseo_trends",
    estimatedPaidRequest: true,
    estimatedCostCategory: "very_low",
  },
  {
    capability: "search",
    provider: "dataforseo_google_ads",
    estimatedPaidRequest: true,
    estimatedCostCategory: "very_low",
  },
  {
    capability: "growth",
    provider: "dataforseo_trends",
    estimatedPaidRequest: true,
    estimatedCostCategory: "very_low",
  },
  {
    capability: "reviews",
    provider: "dataforseo_google_shopping",
    estimatedPaidRequest: true,
    estimatedCostCategory: "low",
  },
  {
    capability: "reviews",
    provider: "dataforseo_google_shopping_reviews",
    estimatedPaidRequest: true,
    estimatedCostCategory: "low",
  },
];

const ROUTED_CAPABILITIES: readonly LiveDataCapability[] = [
  "search",
  "reviews",
  "growth",
  "social",
  "sentiment",
  "purchaseIntent",
];

const REVIEW_PRODUCT_TYPES: ProductType[] = ["hardware", "hybrid", "subscription_hardware"];
const REQUIRED_REVIEW_PROVIDER_ID_FIELDS = ["gid", "productId", "dataDocid"];

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function effectiveProductType(profile: ProductProfile): ProductType {
  return profile.productType ?? "unknown";
}

function providerIdsFor(profile: ProductProfile, provider: LiveProviderId): Record<string, unknown> | undefined {
  const providerIds = profile.providerIds?.[provider];
  return providerIds && typeof providerIds === "object" && !Array.isArray(providerIds)
    ? providerIds as Record<string, unknown>
    : undefined;
}

function hasGoogleShoppingReviewIds(profile: ProductProfile): boolean {
  const ids = providerIdsFor(profile, "dataforseo_google_shopping_reviews");
  return Boolean(ids && REQUIRED_REVIEW_PROVIDER_ID_FIELDS.every((field) => typeof ids[field] === "string" && ids[field]));
}

function addMissingIdentityForRoute(
  profile: ProductProfile,
  definition: RouteDefinition,
  decision: ProviderUseDecision
): ProductIdentityRequirement[] {
  const missing = [...decision.missingRequirements];

  if (
    definition.capability === "reviews" &&
    definition.provider === "dataforseo_google_shopping" &&
    REVIEW_PRODUCT_TYPES.includes(effectiveProductType(profile)) &&
    profile.identityConfidence !== "high"
  ) {
    missing.push("identityConfidence");
  }

  if (
    definition.provider === "dataforseo_google_shopping_reviews" &&
    !hasGoogleShoppingReviewIds(profile)
  ) {
    missing.push("providerSpecificIds");
  }

  return unique(missing);
}

function reviewGuardrailResolved(profile: ProductProfile): boolean {
  const guardrails = profile.guardrails;
  if (!guardrails) return false;

  return Boolean(
    guardrails.excludeAccessories ||
    guardrails.excludeBundles ||
    guardrails.excludeRefurbished ||
    guardrails.excludedTerms?.length
  );
}

function futureEligibility(input: {
  profile: ProductProfile;
  definition: RouteDefinition;
  decision: ProviderUseDecision;
  missingIdentityFields: ProductIdentityRequirement[];
}): FutureExecutionEligibility {
  const { profile, definition, decision, missingIdentityFields } = input;
  const productType = effectiveProductType(profile);

  if (decision.status === "unsupported") return "unsupported";

  if (definition.capability === "reviews" && productType === "software_saas") {
    return "blocked";
  }

  if (decision.status === "blocked" && productType === "unknown") {
    return "needs_identity";
  }

  if (decision.status === "blocked") return "blocked";

  if (missingIdentityFields.includes("variantBundleGuardrails") || missingIdentityFields.includes("hardwareOnlyIdentity")) {
    return "needs_guardrail";
  }

  if (missingIdentityFields.length > 0 || profile.identityConfidence === "low") {
    return "needs_identity";
  }

  if (definition.capability === "reviews") {
    if (!reviewGuardrailResolved(profile)) return "needs_guardrail";
    if (productType === "subscription_hardware") return "needs_guardrail";
  }

  return "eligible";
}

function routeWarnings(input: {
  profile: ProductProfile;
  definition: RouteDefinition;
  decision: ProviderUseDecision;
  missingIdentityFields: ProductIdentityRequirement[];
  futureExecutionEligibility: FutureExecutionEligibility;
}): string[] {
  const { profile, definition, decision, missingIdentityFields, futureExecutionEligibility } = input;
  const warnings = [...decision.warnings];
  const productType = effectiveProductType(profile);

  if (profile.identityConfidence === "low") warnings.push("Identity confidence is low.");
  if ((productType === "hardware" || productType === "hybrid" || productType === "subscription_hardware") && !profile.modelGeneration) {
    warnings.push("Product generation is unknown or ambiguous.");
  }
  if (profile.guardrails?.notes?.length) warnings.push(...profile.guardrails.notes);
  if (profile.guardrails?.excludeBundles || profile.guardrails?.excludeRefurbished) {
    warnings.push("Bundle, variant, or refurbished listing risk must be guarded.");
  }
  if (profile.guardrails?.excludeAccessories) warnings.push("Accessory listings must be excluded before provider execution.");
  if (productType === "subscription_hardware") {
    warnings.push("Subscription, app, or service experience may contaminate review signals.");
  }
  if (productType === "software_saas" && definition.capability === "reviews") {
    warnings.push("Google Shopping review providers are not semantically valid for software/SaaS products.");
  }
  if (missingIdentityFields.includes("providerSpecificIds")) {
    warnings.push("Provider product identifiers are missing.");
  }
  if (futureExecutionEligibility === "needs_identity") {
    warnings.push("Additional identity resolution is required before future execution.");
  }
  if (futureExecutionEligibility === "needs_guardrail") {
    warnings.push("Guardrail review is required before future execution.");
  }
  if (definition.estimatedPaidRequest) warnings.push("Route may create a paid provider request if executed later.");

  return unique(warnings);
}

function routeForDefinition(profile: ProductProfile, definition: RouteDefinition): ProviderRoute {
  const decision = canUseProvider(profile, definition.provider, definition.capability);
  const missingIdentityFields = addMissingIdentityForRoute(profile, definition, decision);
  const eligibility = futureEligibility({ profile, definition, decision, missingIdentityFields });
  const warnings = routeWarnings({
    profile,
    definition,
    decision,
    missingIdentityFields,
    futureExecutionEligibility: eligibility,
  });

  return {
    capability: definition.capability,
    provider: definition.provider,
    status: decision.status,
    reason: decision.reason,
    requiredIdentityFields: decision.requiredIdentityFields,
    missingIdentityFields,
    estimatedPaidRequest: definition.estimatedPaidRequest,
    estimatedCostCategory: definition.estimatedCostCategory,
    executionAllowed: false,
    futureExecutionEligibility: eligibility,
    warnings,
  };
}

function planWarnings(routes: ProviderRoute[]): string[] {
  return unique(routes.flatMap((route) => route.warnings));
}

export function routeProvidersForProfile(
  profile: ProductProfile,
  _options: ProviderRoutingOptions = {}
): ProviderRoutingPlan {
  const routes = ROUTE_DEFINITIONS.map((definition) => routeForDefinition(profile, definition));
  const unsupportedCapabilities = ROUTED_CAPABILITIES.filter((capability) =>
    evaluateCapability(profile, capability).status === "unsupported"
  );

  return {
    profile,
    routes,
    blockedRoutes: routes.filter((route) =>
      route.status === "blocked" || route.futureExecutionEligibility === "blocked"
    ),
    guardedRoutes: routes.filter((route) =>
      route.status === "guarded" ||
      route.futureExecutionEligibility === "needs_identity" ||
      route.futureExecutionEligibility === "needs_guardrail"
    ),
    unsupportedCapabilities,
    warnings: planWarnings(routes),
    dryRun: true,
  };
}

function routesByEligibility(routes: ProviderRoute[]): Record<FutureExecutionEligibility, ProviderRoute[]> {
  return {
    eligible: routes.filter((route) => route.futureExecutionEligibility === "eligible"),
    needs_identity: routes.filter((route) => route.futureExecutionEligibility === "needs_identity"),
    needs_guardrail: routes.filter((route) => route.futureExecutionEligibility === "needs_guardrail"),
    blocked: routes.filter((route) => route.futureExecutionEligibility === "blocked"),
    unsupported: routes.filter((route) => route.futureExecutionEligibility === "unsupported"),
  };
}

function reportProductType(profile: ProductProfile): ProductType {
  return profile.productType ?? "unknown";
}

export function buildProviderRoutingReport(
  input: ProductResolutionResult | ProductProfile | ProviderRoutingPlan
): ProviderRoutingReport {
  const plan = "routes" in input && "dryRun" in input
    ? input
    : routeProvidersForProfile("profile" in input ? input.profile : input);
  const profile = plan.profile;
  const productType = reportProductType(profile);
  const paidRoutes = plan.routes.filter((route) => route.estimatedPaidRequest);

  return {
    product: {
      productId: profile.productId,
      source: profile.source,
      canonicalTitle: profile.canonicalTitle,
      productType,
      identityConfidence: profile.identityConfidence,
    },
    type: productType,
    identityConfidence: profile.identityConfidence,
    providerRoutes: plan.routes,
    blockedProviders: unique(plan.blockedRoutes.map((route) => route.provider)),
    guardedProviders: unique(plan.guardedRoutes.map((route) => route.provider)),
    missingIdentity: unique(plan.routes.flatMap((route) => route.missingIdentityFields)),
    paidRouteWarnings: paidRoutes.map((route) =>
      `${route.provider}/${route.capability} may create a paid provider request if executed later.`
    ),
    futureExecutionEligibility: routesByEligibility(plan.routes),
    warnings: plan.warnings,
    dryRun: true,
  };
}
