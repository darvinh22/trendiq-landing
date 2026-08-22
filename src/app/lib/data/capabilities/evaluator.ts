import { roundTo } from "../../scoring/normalization";
import type {
  CapabilityEvaluation,
  LiveDataCapability,
  LiveProviderId,
  LiveReadinessStatus,
  ProductIdentityRequirement,
  ProductProfile,
  ProductReadinessReport,
  ProductType,
  ProviderPolicy,
  ProviderUseDecision,
} from "./types";

export const CONFIDENCE_PROVENANCE_WARNING_THRESHOLD_PERCENT = 50;

const ALL_CAPABILITIES: readonly LiveDataCapability[] = [
  "search",
  "reviews",
  "growth",
  "social",
  "sentiment",
  "purchaseIntent",
];

const SEARCH_PROVIDERS: LiveProviderId[] = ["dataforseo_trends", "dataforseo_google_ads"];
const REVIEW_PROVIDERS: LiveProviderId[] = [
  "dataforseo_google_shopping",
  "dataforseo_google_shopping_reviews",
];

function effectiveProductType(profile: ProductProfile): ProductType {
  return profile.productType ?? "unknown";
}

function hasValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null;
}

function hasProviderIds(profile: ProductProfile, provider?: LiveProviderId): boolean {
  if (!profile.providerIds) return false;
  if (provider) return hasValue(profile.providerIds[provider]);
  return Object.keys(profile.providerIds).length > 0;
}

function requirementMissing(
  profile: ProductProfile,
  requirement: ProductIdentityRequirement,
  provider?: LiveProviderId
): boolean {
  switch (requirement) {
    case "query":
      return !hasValue(profile.query);
    case "canonicalTitle":
      return !hasValue(profile.canonicalTitle);
    case "brand":
      return !hasValue(profile.brand);
    case "aliases":
      return !hasValue(profile.aliases);
    case "productType":
      return effectiveProductType(profile) === "unknown";
    case "modelGeneration":
      return !hasValue(profile.modelGeneration);
    case "identityConfidence":
      return profile.identityConfidence === "low";
    case "providerSpecificIds":
      return !hasProviderIds(profile, provider);
    case "variantBundleGuardrails":
      return !profile.guardrails || (
        !profile.guardrails.excludeAccessories &&
        !profile.guardrails.excludeBundles &&
        !profile.guardrails.excludeRefurbished &&
        !profile.guardrails.excludedTerms?.length
      );
    case "hardwareOnlyIdentity":
      return profile.guardrails?.requireHardwareOnlyMatch !== true;
    default:
      return false;
  }
}

function missingRequirements(
  profile: ProductProfile,
  requirements: readonly ProductIdentityRequirement[],
  provider?: LiveProviderId
): ProductIdentityRequirement[] {
  return requirements.filter((requirement) => requirementMissing(profile, requirement, provider));
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function evaluation(input: {
  capability: LiveDataCapability;
  status: LiveReadinessStatus;
  reason: string;
  requiredIdentityFields: ProductIdentityRequirement[];
  allowedProviders?: LiveProviderId[];
  blockedProviders?: LiveProviderId[];
  warnings?: string[];
  profile: ProductProfile;
}): CapabilityEvaluation {
  return {
    capability: input.capability,
    status: input.status,
    reason: input.reason,
    requiredIdentityFields: input.requiredIdentityFields,
    missingRequirements: missingRequirements(input.profile, input.requiredIdentityFields),
    allowedProviders: input.allowedProviders ?? [],
    blockedProviders: input.blockedProviders ?? [],
    warnings: input.warnings ?? [],
  };
}

function reviewEvaluation(profile: ProductProfile): CapabilityEvaluation {
  const productType = effectiveProductType(profile);
  const baseRequired: ProductIdentityRequirement[] = [
    "query",
    "canonicalTitle",
    "brand",
    "aliases",
    "productType",
    "identityConfidence",
    "variantBundleGuardrails",
  ];
  const modelRequired = profile.guardrails?.requireModelGenerationMatch
    ? ["modelGeneration" as const]
    : [];

  if (productType === "software_saas") {
    return evaluation({
      capability: "reviews",
      status: "blocked",
      reason: "Google Shopping review providers are not semantically valid for software/SaaS products.",
      requiredIdentityFields: ["query", "canonicalTitle", "productType"],
      blockedProviders: REVIEW_PROVIDERS,
      warnings: ["Use a software/app review source before scoring review quality for SaaS products."],
      profile,
    });
  }

  if (productType === "mobile_app") {
    return evaluation({
      capability: "reviews",
      status: "blocked",
      reason: "Mobile app review signals require app-store providers rather than Google Shopping product reviews.",
      requiredIdentityFields: ["query", "canonicalTitle", "productType"],
      blockedProviders: REVIEW_PROVIDERS,
      warnings: ["App Store or Google Play review sources are required for mobile apps."],
      profile,
    });
  }

  if (productType === "unknown") {
    return evaluation({
      capability: "reviews",
      status: "blocked",
      reason: "Review providers are blocked until product classification and identity confidence are resolved.",
      requiredIdentityFields: baseRequired,
      blockedProviders: REVIEW_PROVIDERS,
      warnings: ["Unknown products may be hardware, software, services, accessories, or bundles."],
      profile,
    });
  }

  if (productType === "subscription_hardware") {
    const required = profile.guardrails?.requireHardwareOnlyMatch
      ? [...baseRequired, ...modelRequired, "hardwareOnlyIdentity" as const]
      : [...baseRequired, ...modelRequired];

    return evaluation({
      capability: "reviews",
      status: "guarded",
      reason: "Subscription hardware reviews can mix hardware quality with app, service, or membership experience.",
      requiredIdentityFields: required,
      allowedProviders: REVIEW_PROVIDERS,
      warnings: ["Keep hardware, subscription, app, and service experience separate in provenance."],
      profile,
    });
  }

  return evaluation({
    capability: "reviews",
    status: productType === "hybrid" ? "guarded" : "guarded",
    reason: "Google Shopping reviews are usable only after product identity, variants, bundles, and accessories are guarded.",
    requiredIdentityFields: [...baseRequired, ...modelRequired],
    allowedProviders: REVIEW_PROVIDERS,
    warnings: productType === "hybrid"
      ? ["Hybrid products may mix hardware and software experience in review text."]
      : [],
    profile,
  });
}

export function evaluateCapability(
  profile: ProductProfile,
  capability: LiveDataCapability
): CapabilityEvaluation {
  const productType = effectiveProductType(profile);

  switch (capability) {
    case "search": {
      const status = productType === "unknown" || profile.identityConfidence === "low" ? "guarded" : "ready";
      return evaluation({
        capability,
        status,
        reason: status === "ready"
          ? "Search can run from the product profile query and aliases."
          : "Search can run as a guarded discovery signal while classification or identity confidence is incomplete.",
        requiredIdentityFields: ["query", "aliases"],
        allowedProviders: SEARCH_PROVIDERS,
        profile,
      });
    }
    case "growth":
      return evaluation({
        capability,
        status: productType === "unknown" || profile.identityConfidence === "low" ? "guarded" : "ready",
        reason: "Growth velocity can be derived from the same DataForSEO Trends series used for search momentum.",
        requiredIdentityFields: ["query", "aliases"],
        allowedProviders: ["dataforseo_trends"],
        profile,
      });
    case "reviews":
      return reviewEvaluation(profile);
    case "social":
      return evaluation({
        capability,
        status: "unsupported",
        reason: "No approved live social provider is enabled in Phase 3L.",
        requiredIdentityFields: ["query", "aliases"],
        blockedProviders: ["reddit"],
        warnings: ["Reddit remains approvalStatus=pending and must not be used."],
        profile,
      });
    case "sentiment":
      return evaluation({
        capability,
        status: "unsupported",
        reason: "Live sentiment needs an approved source with text or rating-language observations.",
        requiredIdentityFields: ["query", "aliases"],
        blockedProviders: ["reddit"],
        profile,
      });
    case "purchaseIntent":
      return evaluation({
        capability,
        status: "unsupported",
        reason: "No live purchase-intent provider is implemented yet.",
        requiredIdentityFields: ["query", "aliases"],
        profile,
      });
    default:
      return evaluation({
        capability,
        status: "unsupported",
        reason: "Capability is not implemented.",
        requiredIdentityFields: [],
        profile,
      });
  }
}

function providerSpecificRequirements(
  provider: LiveProviderId,
  capability: LiveDataCapability
): ProductIdentityRequirement[] {
  if (capability === "reviews" && provider === "dataforseo_google_shopping_reviews") {
    return ["providerSpecificIds"];
  }

  return [];
}

export function canUseProvider(
  profile: ProductProfile,
  provider: LiveProviderId,
  capability: LiveDataCapability
): ProviderUseDecision {
  const base = evaluateCapability(profile, capability);
  const blocked = base.blockedProviders.includes(provider);
  const providerAllowed = base.allowedProviders.includes(provider);
  const requiredIdentityFields = unique([
    ...base.requiredIdentityFields,
    ...providerSpecificRequirements(provider, capability),
  ]);
  const missing = missingRequirements(profile, requiredIdentityFields, provider);
  const statusBlocks = base.status === "blocked" || base.status === "unsupported";
  const allowed = !statusBlocks && providerAllowed && !blocked && missing.length === 0;
  const policy: ProviderPolicy = blocked || statusBlocks
    ? "blocked"
    : base.status === "guarded" || missing.length > 0
      ? "guarded"
      : "allowed";

  return {
    ...base,
    provider,
    allowed,
    policy,
    requiredIdentityFields,
    missingRequirements: missing,
    reason: !providerAllowed && !blocked
      ? `${provider} is not configured for ${capability}.`
      : base.reason,
  };
}

export function buildDynamicProductReadinessReport(profile: ProductProfile): ProductReadinessReport {
  const capabilities = ALL_CAPABILITIES.map((capability) => evaluateCapability(profile, capability));

  return {
    productId: profile.productId,
    source: profile.source,
    query: profile.query,
    canonicalTitle: profile.canonicalTitle,
    productType: effectiveProductType(profile),
    identityConfidence: profile.identityConfidence,
    capabilities,
    missingIdentityRequirements: unique(capabilities.flatMap((capability) => capability.missingRequirements)),
    blockedProviders: unique(capabilities.flatMap((capability) => capability.blockedProviders)),
  };
}

export function hasConfidenceProvenanceWarning(input: {
  confidenceLevel: string;
  liveCoveragePercent: number;
  thresholdPercent?: number;
}): boolean {
  const threshold = input.thresholdPercent ?? CONFIDENCE_PROVENANCE_WARNING_THRESHOLD_PERCENT;
  return input.confidenceLevel === "High" && input.liveCoveragePercent < threshold;
}

export function confidenceProvenanceWarningReason(input: {
  confidenceLevel: string;
  liveCoveragePercent: number;
  thresholdPercent?: number;
}): string | undefined {
  if (!hasConfidenceProvenanceWarning(input)) return undefined;

  const threshold = input.thresholdPercent ?? CONFIDENCE_PROVENANCE_WARNING_THRESHOLD_PERCENT;
  return `Confidence is ${input.confidenceLevel}, but liveCoveragePercent is ${roundTo(input.liveCoveragePercent, 1)}%, below the ${threshold}% provenance-warning threshold.`;
}
