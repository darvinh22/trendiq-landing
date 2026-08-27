import {
  DEFAULT_PRODUCT_RESOLUTION_LOCALE,
  PRODUCT_RESOLUTION_CACHE_VERSION,
  PRODUCT_RESOLUTION_TTL_MS,
  buildProductResolutionCacheKey,
  type ProductResolutionCache,
} from "./cacheContracts";
import { buildDynamicProductReadinessReport } from "./evaluator";
import { VALIDATION_PRODUCT_PROFILES, inferBrand, inferProductType } from "./profiles";
import { withMeasurementQueryCandidates } from "./queryMeasurement";
import type {
  ProductIdentityConfidence,
  ProductIdentityGuardrails,
  ProductProfile,
  ProductResolution,
  ProductResolutionResult,
  ProductType,
} from "./types";

const SEARCH_NOISE_PREFIXES = new Set(["buy", "shop", "best"]);
const SEARCH_NOISE_SUFFIXES = new Set(["review", "reviews", "price", "prices", "deal", "deals"]);

const BRAND_CASING: Record<string, string> = {
  ai: "AI",
  whoop: "WHOOP",
  oura: "Oura",
  garmin: "Garmin",
  venu: "Venu",
  ninja: "Ninja",
  creami: "Creami",
  swirl: "Swirl",
  samsung: "Samsung",
  galaxy: "Galaxy",
  ring: "Ring",
  ray: "Ray",
  ban: "Ban",
  meta: "Meta",
  bambu: "Bambu",
  lab: "Lab",
  dyson: "Dyson",
  airwrap: "Airwrap",
  claude: "Claude",
  anthropic: "Anthropic",
};

const LOCAL_PRODUCT_TYPE_HINTS: Array<{ pattern: RegExp; productType: ProductType }> = [
  { pattern: /\b(claude|anthropic|software|saas|ai assistant)\b/i, productType: "software_saas" },
  { pattern: /\b(whoop|oura)\b/i, productType: "subscription_hardware" },
  { pattern: /\b(garmin\s+venu|ninja\s+creami|samsung\s+galaxy\s+ring|ray[-\s]?ban\s+meta|bambu\s+lab|dyson\s+airwrap)\b/i, productType: "hardware" },
];

const CATALOG_ALIAS_OVERRIDES: Record<string, string[]> = {
  "ray-ban-meta": ["Ray Ban Meta", "Ray Ban Meta Glasses", "Ray-Ban Meta Glasses"],
  "oura-ring-4": ["Oura Ring"],
  "whoop-5": ["WHOOP"],
  "bambu-lab-a1": ["Bambu Lab A1"],
  "dyson-airwrap": ["Dyson Airwrap"],
  "claude-3-5": ["Claude", "Claude AI"],
};

const LOCAL_MODEL_PATTERNS: Array<{ brand: string; pattern: RegExp }> = [
  { brand: "Garmin", pattern: /\bgarmin\s+(.+)$/i },
  { brand: "Ninja", pattern: /\bninja\s+(.+)$/i },
  { brand: "Samsung", pattern: /\bsamsung\s+(.+)$/i },
];

export interface ResolveProductQueryOptions {
  locale?: string;
  cache?: ProductResolutionCache;
  now?: () => Date;
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function stripSafeSearchNoise(value: string): string {
  const tokens = collapseWhitespace(value).split(" ");

  while (tokens.length > 1 && SEARCH_NOISE_PREFIXES.has(tokens[0].toLowerCase())) {
    tokens.shift();
  }

  while (tokens.length > 1 && SEARCH_NOISE_SUFFIXES.has(tokens[tokens.length - 1].toLowerCase())) {
    tokens.pop();
  }

  return tokens.join(" ");
}

function titleCaseToken(token: string): string {
  if (/^[A-Z0-9]+$/.test(token) && /[A-Z]/.test(token) && token.length > 1) return token;

  const lower = token.toLowerCase();
  if (BRAND_CASING[lower]) return BRAND_CASING[lower];
  if (/^[a-z]+[0-9]+$/i.test(token) || /^[a-z]+[.-]?[0-9]/i.test(token)) {
    return token.toUpperCase();
  }
  if (/^[0-9]+([.][0-9]+)?$/.test(token)) return token;

  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function normalizeProductQuery(query: string): string {
  const cleaned = stripSafeSearchNoise(collapseWhitespace(query));

  return cleaned
    .split(" ")
    .map((token) => token.split("-").map(titleCaseToken).join("-"))
    .join(" ");
}

function matchKey(value: string): string {
  return normalizeProductQuery(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function catalogAliases(profile: ProductProfile): string[] {
  return uniqueNonEmpty([
    profile.query,
    profile.canonicalTitle,
    ...profile.aliases,
    ...(CATALOG_ALIAS_OVERRIDES[profile.productId] ?? []),
  ]);
}

function findCatalogProfile(normalizedQuery: string): ProductProfile | undefined {
  const key = matchKey(normalizedQuery);

  return Object.values(VALIDATION_PRODUCT_PROFILES).find((profile) =>
    catalogAliases(profile).some((alias) => matchKey(alias) === key)
  );
}

function inferLocalProductType(normalizedQuery: string): ProductType {
  return LOCAL_PRODUCT_TYPE_HINTS.find((hint) => hint.pattern.test(normalizedQuery))?.productType ??
    inferProductType({ query: normalizedQuery });
}

function inferModelGeneration(normalizedQuery: string, brand?: string): string | undefined {
  if (!brand) return undefined;

  const match = LOCAL_MODEL_PATTERNS
    .find((entry) => entry.brand === brand)
    ?.pattern.exec(normalizedQuery);

  return match?.[1] ? normalizeProductQuery(match[1]) : undefined;
}

function resolutionWarnings(input: {
  normalizedQuery: string;
  brand?: string;
  productType: ProductType;
  modelGeneration?: string;
  identityConfidence: ProductIdentityConfidence;
}): string[] {
  const warnings: string[] = [];

  if (!input.brand) warnings.push("Brand could not be inferred confidently from local rules.");
  if (input.productType === "unknown") warnings.push("Product type is unknown until classification is resolved.");
  if (input.productType === "hardware" && !input.modelGeneration) {
    warnings.push("Model or generation is missing or ambiguous.");
  }
  if (input.productType === "subscription_hardware") {
    warnings.push("Subscription, app, or service experience may contaminate product review signals.");
  }
  if (input.productType === "software_saas") {
    warnings.push("Software/SaaS products require software review providers; Google Shopping reviews are blocked.");
  }
  if (/\b(bundle|kit|case|charger|strap|accessory|refurbished|renewed)\b/i.test(input.normalizedQuery)) {
    warnings.push("Query may describe a bundle, accessory, or refurbished listing.");
  }
  if (input.identityConfidence === "low") {
    warnings.push("Identity confidence is low; guarded providers must not run without additional identity resolution.");
  }

  return warnings;
}

function identityConfidenceForLocal(input: {
  brand?: string;
  productType: ProductType;
  modelGeneration?: string;
}): ProductIdentityConfidence {
  if (input.brand && input.productType !== "unknown" && input.modelGeneration) return "medium";
  return "low";
}

function buildCatalogResolution(
  originalQuery: string,
  normalizedQuery: string,
  profile: ProductProfile
): ProductResolution {
  return {
    originalQuery,
    normalizedQuery,
    canonicalTitle: profile.canonicalTitle,
    brand: profile.brand,
    inferredProductType: profile.productType ?? "unknown",
    category: profile.category,
    modelGeneration: profile.modelGeneration,
    aliases: catalogAliases(profile),
    identityConfidence: "high",
    resolutionSource: "catalog_match",
    matchedCatalogProductId: profile.productId,
    warnings: profile.guardrails?.notes ?? [],
  };
}

function buildLocalResolution(originalQuery: string, normalizedQuery: string): ProductResolution {
  const brand = inferBrand(normalizedQuery);
  const productType = inferLocalProductType(normalizedQuery);
  const modelGeneration = inferModelGeneration(normalizedQuery, brand);
  const identityConfidence = identityConfidenceForLocal({ brand, productType, modelGeneration });

  return {
    originalQuery,
    normalizedQuery,
    canonicalTitle: normalizedQuery,
    brand,
    inferredProductType: productType,
    modelGeneration,
    aliases: uniqueNonEmpty([normalizedQuery]),
    identityConfidence,
    resolutionSource: "local_rules",
    warnings: resolutionWarnings({
      normalizedQuery,
      brand,
      productType,
      modelGeneration,
      identityConfidence,
    }),
  };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "unknown-product";
}

function guardrailsFromResolution(resolution: ProductResolution): ProductIdentityGuardrails | undefined {
  if (resolution.matchedCatalogProductId) {
    return VALIDATION_PRODUCT_PROFILES[resolution.matchedCatalogProductId]?.guardrails;
  }

  if (resolution.inferredProductType === "software_saas" || resolution.inferredProductType === "unknown") {
    return undefined;
  }

  return {
    requireExactBrandMatch: Boolean(resolution.brand),
    requireModelGenerationMatch: Boolean(resolution.modelGeneration),
    excludeAccessories: true,
    excludeBundles: true,
    excludeRefurbished: true,
    excludedTerms: ["bundle", "case", "charger", "strap", "accessory", "refurbished", "renewed"],
    notes: resolution.warnings,
  };
}

export function buildProductProfileFromResolution(resolution: ProductResolution): ProductProfile {
  const matchedProfile = resolution.matchedCatalogProductId
    ? VALIDATION_PRODUCT_PROFILES[resolution.matchedCatalogProductId]
    : undefined;

  const profile: ProductProfile = {
    productId: matchedProfile?.productId ?? `user-search-${slugify(resolution.canonicalTitle)}`,
    source: matchedProfile ? "catalog" : "user_search",
    query: resolution.normalizedQuery,
    canonicalTitle: resolution.canonicalTitle,
    brand: resolution.brand,
    aliases: resolution.aliases,
    productType: resolution.inferredProductType,
    category: resolution.category,
    modelGeneration: resolution.modelGeneration,
    identityConfidence: resolution.identityConfidence,
    providerIds: matchedProfile?.providerIds,
    guardrails: guardrailsFromResolution(resolution),
  };

  return withMeasurementQueryCandidates(profile);
}

function expiresAtForConfidence(
  now: Date,
  identityConfidence: ProductIdentityConfidence
): string {
  return new Date(now.getTime() + PRODUCT_RESOLUTION_TTL_MS[identityConfidence]).toISOString();
}

function cachedResolution(entry: Awaited<ReturnType<ProductResolutionCache["getByQuery"]>>): ProductResolution {
  return {
    ...entry!.resolution,
    resolutionSource: "cached_resolution",
  };
}

export async function resolveProductQuery(
  query: string,
  options: ResolveProductQueryOptions = {}
): Promise<ProductResolutionResult> {
  const originalQuery = query;
  const normalizedQuery = normalizeProductQuery(query);
  const locale = options.locale ?? DEFAULT_PRODUCT_RESOLUTION_LOCALE;
  const now = options.now?.() ?? new Date();
  const cacheKey = buildProductResolutionCacheKey(normalizedQuery, locale);

  if (options.cache) {
    const cached = await options.cache.getByQuery(normalizedQuery, locale);
    if (cached) {
      const expired = Date.parse(cached.expiresAt) <= now.getTime();
      if (!expired) {
        const resolution = cachedResolution(cached);
        const profile = withMeasurementQueryCandidates(cached.profile);

        return {
          resolution,
          profile,
          readiness: buildDynamicProductReadinessReport(profile),
          cacheStatus: "hit",
          cacheKey,
          expiresAt: cached.expiresAt,
        };
      }
    }
  }

  const catalogProfile = findCatalogProfile(normalizedQuery);
  const resolution = catalogProfile
    ? buildCatalogResolution(originalQuery, normalizedQuery, catalogProfile)
    : buildLocalResolution(originalQuery, normalizedQuery);
  const profile = buildProductProfileFromResolution(resolution);
  const expiresAt = expiresAtForConfidence(now, resolution.identityConfidence);
  const cacheStatus = options.cache
    ? (await options.cache.getByQuery(normalizedQuery, locale) ? "expired" : "miss")
    : "disabled";

  if (options.cache) {
    await options.cache.set({
      cacheKey,
      query: normalizedQuery,
      locale,
      resolution,
      profile,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt,
      version: PRODUCT_RESOLUTION_CACHE_VERSION,
      identityConfidence: resolution.identityConfidence,
    });
  }

  return {
    resolution,
    profile,
    readiness: buildDynamicProductReadinessReport(profile),
    cacheStatus,
    cacheKey,
    expiresAt,
  };
}
