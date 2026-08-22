import { RAY_BAN_META_PRODUCT_ID } from "../mockProviderSignals";
import type {
  ProductIdentityConfidence,
  ProductIdentityGuardrails,
  ProductProfile,
  ProductProfileSource,
  ProductType,
} from "./types";

export interface CatalogProductLike {
  id: string;
  title: string;
  subtitle?: string;
  category?: string;
}

export interface ProductProfileOverrides {
  source?: ProductProfileSource;
  productId?: string;
  canonicalTitle?: string;
  brand?: string;
  aliases?: string[];
  productType?: ProductType;
  category?: string;
  modelGeneration?: string;
  identityConfidence?: ProductIdentityConfidence;
  providerIds?: Record<string, unknown>;
  guardrails?: ProductIdentityGuardrails;
}

const PRODUCT_TYPE_HINTS: Array<{ pattern: RegExp; productType: ProductType }> = [
  { pattern: /\b(claude|anthropic|chatgpt|gemini|perplexity|software|saas|ai assistant)\b/i, productType: "software_saas" },
  { pattern: /\b(whoop|oura)\b/i, productType: "subscription_hardware" },
  { pattern: /\b(app|ios|android)\b/i, productType: "mobile_app" },
  { pattern: /\b(ray-ban meta|smart glasses|garmin|venu|ninja creami|galaxy ring|bambu|dyson|airwrap|printer|ring|watch)\b/i, productType: "hardware" },
];

const BRAND_HINTS: Array<{ pattern: RegExp; brand: string }> = [
  { pattern: /\bray-?ban\b/i, brand: "Ray-Ban" },
  { pattern: /\bmeta\b/i, brand: "Meta" },
  { pattern: /\bgarmin\b/i, brand: "Garmin" },
  { pattern: /\bninja\b/i, brand: "Ninja" },
  { pattern: /\bsamsung\b/i, brand: "Samsung" },
  { pattern: /\bbambu\b/i, brand: "Bambu Lab" },
  { pattern: /\bdyson\b/i, brand: "Dyson" },
  { pattern: /\boura\b/i, brand: "Oura" },
  { pattern: /\bwhoop\b/i, brand: "WHOOP" },
  { pattern: /\bclaude|anthropic\b/i, brand: "Anthropic" },
];

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "unknown-product";
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

export function inferProductType(input: {
  query?: string;
  title?: string;
  category?: string;
  subtitle?: string;
}): ProductType {
  const haystack = [input.query, input.title, input.category, input.subtitle].filter(Boolean).join(" ");
  const match = PRODUCT_TYPE_HINTS.find((hint) => hint.pattern.test(haystack));
  return match?.productType ?? "unknown";
}

export function inferBrand(value: string): string | undefined {
  return BRAND_HINTS.find((hint) => hint.pattern.test(value))?.brand;
}

export function createUserSearchProductProfile(
  query: string,
  overrides: ProductProfileOverrides = {}
): ProductProfile {
  const cleanedQuery = query.trim();
  const canonicalTitle = overrides.canonicalTitle ?? cleanedQuery;
  const productType = overrides.productType ?? inferProductType({ query: cleanedQuery });

  return {
    productId: overrides.productId ?? `user-search-${slugify(cleanedQuery)}`,
    source: overrides.source ?? "user_search",
    query: cleanedQuery,
    canonicalTitle,
    brand: overrides.brand ?? inferBrand(cleanedQuery),
    aliases: uniqueNonEmpty([canonicalTitle, cleanedQuery, ...(overrides.aliases ?? [])]),
    productType,
    category: overrides.category,
    modelGeneration: overrides.modelGeneration,
    identityConfidence: overrides.identityConfidence ?? "low",
    providerIds: overrides.providerIds,
    guardrails: overrides.guardrails,
  };
}

export function buildProductProfileFromCatalogProduct(
  product: CatalogProductLike,
  overrides: ProductProfileOverrides = {}
): ProductProfile {
  const canonicalTitle = overrides.canonicalTitle ?? product.title;
  const productType = overrides.productType ?? inferProductType({
    query: canonicalTitle,
    title: product.title,
    subtitle: product.subtitle,
    category: product.category,
  });

  return {
    productId: overrides.productId ?? product.id,
    source: overrides.source ?? "catalog",
    query: canonicalTitle,
    canonicalTitle,
    brand: overrides.brand ?? inferBrand(product.title),
    aliases: uniqueNonEmpty([canonicalTitle, product.title, ...(overrides.aliases ?? [])]),
    productType,
    category: overrides.category ?? product.category,
    modelGeneration: overrides.modelGeneration,
    identityConfidence: overrides.identityConfidence ?? "medium",
    providerIds: overrides.providerIds,
    guardrails: overrides.guardrails,
  };
}

export function profileWithProviderIds(
  profile: ProductProfile,
  provider: string,
  providerIds: unknown
): ProductProfile {
  return {
    ...profile,
    providerIds: {
      ...(profile.providerIds ?? {}),
      [provider]: providerIds,
    },
  };
}

export const VALIDATION_PRODUCT_PROFILES: Record<string, ProductProfile> = {
  [RAY_BAN_META_PRODUCT_ID]: buildProductProfileFromCatalogProduct({
    id: RAY_BAN_META_PRODUCT_ID,
    title: "Ray-Ban Meta Glasses",
    subtitle: "Smart glasses with built-in AI",
    category: "Tech",
  }, {
    canonicalTitle: "Ray-Ban Meta",
    brand: "Ray-Ban",
    aliases: ["Ray-Ban Meta", "Ray Ban Meta", "Meta smart glasses", "Ray-Ban smart glasses"],
    productType: "hybrid",
    modelGeneration: "Meta",
    identityConfidence: "high",
    providerIds: {
      dataforseo_google_shopping: {
        productId: "11716803554991446550",
        dataDocid: "4690297997048968068",
        gid: "11193998885220934472",
        observedAt: "2026-08-21T23:47:20.000Z",
        matchConfidence: "high",
      },
      dataforseo_google_shopping_reviews: {
        productId: "11716803554991446550",
        dataDocid: "4690297997048968068",
        gid: "11193998885220934472",
      },
    },
    guardrails: {
      requireExactBrandMatch: true,
      requireModelGenerationMatch: true,
      excludeAccessories: true,
      excludeBundles: true,
      acceptedProductTerms: ["ray-ban", "meta", "smart glasses"],
      excludedTerms: ["case", "charger", "replacement lenses", "accessory"],
      notes: ["Google Shopping may group frame and lens variants."],
    },
  }),
  "bambu-lab-a1": buildProductProfileFromCatalogProduct({
    id: "bambu-lab-a1",
    title: "Bambu Lab A1 Mini",
    subtitle: "Best-value consumer 3D printer",
    category: "Gadgets",
  }, {
    brand: "Bambu Lab",
    aliases: ["Bambu Lab A1 Mini", "Bambu Lab A1", "Bambu A1 Mini"],
    productType: "hardware",
    modelGeneration: "A1 Mini",
    identityConfidence: "medium",
    guardrails: {
      requireExactBrandMatch: true,
      requireModelGenerationMatch: true,
      excludeAccessories: true,
      excludeBundles: true,
      acceptedProductTerms: ["bambu", "a1", "mini", "3d printer"],
      excludedTerms: ["filament", "nozzle", "plate", "ams", "bundle", "accessory"],
      notes: ["A1, A1 Mini, AMS bundles, and accessories need explicit filtering."],
    },
  }),
  "oura-ring-4": buildProductProfileFromCatalogProduct({
    id: "oura-ring-4",
    title: "Oura Ring 4",
    subtitle: "Smart ring for health tracking",
    category: "Fitness",
  }, {
    brand: "Oura",
    aliases: ["Oura Ring 4", "Oura Ring"],
    productType: "subscription_hardware",
    modelGeneration: "Ring 4",
    identityConfidence: "medium",
    guardrails: {
      requireExactBrandMatch: true,
      requireModelGenerationMatch: true,
      excludeAccessories: true,
      excludeSubscriptionOnlyListings: true,
      acceptedProductTerms: ["oura", "ring 4"],
      excludedTerms: ["sizing kit", "charger", "membership", "subscription"],
      notes: ["Hardware ratings may be contaminated by subscription and app experience."],
    },
  }),
  "whoop-5": buildProductProfileFromCatalogProduct({
    id: "whoop-5",
    title: "WHOOP 5.0",
    subtitle: "Advanced fitness & recovery tracker",
    category: "Fitness",
  }, {
    brand: "WHOOP",
    aliases: ["WHOOP 5.0", "WHOOP 5", "WHOOP"],
    productType: "subscription_hardware",
    modelGeneration: "5.0",
    identityConfidence: "medium",
    guardrails: {
      requireExactBrandMatch: true,
      requireModelGenerationMatch: true,
      requireHardwareOnlyMatch: true,
      excludeAccessories: true,
      excludeSubscriptionOnlyListings: true,
      acceptedProductTerms: ["whoop", "5.0"],
      excludedTerms: ["membership", "subscription", "band", "strap", "accessory"],
      notes: ["Hardware, app, coaching, and subscription reviews are likely mixed."],
    },
  }),
  "dyson-airwrap": buildProductProfileFromCatalogProduct({
    id: "dyson-airwrap",
    title: "Dyson Airwrap 2025",
    subtitle: "Multi-styler with Coanda effect",
    category: "Home",
  }, {
    brand: "Dyson",
    aliases: ["Dyson Airwrap 2025", "Dyson Airwrap"],
    productType: "hardware",
    modelGeneration: "2025",
    identityConfidence: "medium",
    guardrails: {
      requireExactBrandMatch: true,
      requireModelGenerationMatch: true,
      excludeBundles: true,
      excludeRefurbished: true,
      acceptedProductTerms: ["dyson", "airwrap", "2025"],
      excludedTerms: ["refurbished", "renewed", "attachment", "bundle", "case"],
      notes: ["Generation, attachments, bundles, and refurbished listings need filtering."],
    },
  }),
  "claude-3-5": buildProductProfileFromCatalogProduct({
    id: "claude-3-5",
    title: "Claude (Anthropic)",
    subtitle: "AI assistant for thinking & writing",
    category: "AI Products",
  }, {
    canonicalTitle: "Claude",
    brand: "Anthropic",
    aliases: ["Claude", "Claude AI", "Anthropic Claude"],
    productType: "software_saas",
    identityConfidence: "medium",
  }),
};
