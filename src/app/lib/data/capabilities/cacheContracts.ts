import type { ProductTrendSnapshot } from "../types";
import type {
  LiveProviderId,
  ProductIdentityConfidence,
  ProductProfile,
  ProductResolution,
  ProviderIdentityEvidence,
} from "./types";

export interface ProductResolutionCacheEntry {
  cacheKey: string;
  query: string;
  locale: string;
  resolution: ProductResolution;
  profile: ProductProfile;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  version: string;
  identityConfidence: ProductIdentityConfidence;
}

export interface ProviderIdentityCacheEntry {
  cacheKey: string;
  productId: string;
  provider: LiveProviderId;
  providerIds: Record<string, string>;
  identityConfidence: ProductProfile["identityConfidence"];
  canonicalTitle?: string;
  brand?: string;
  modelGeneration?: string;
  matchedVariant?: string;
  warnings: string[];
  evidence: ProviderIdentityEvidence[];
  resolvedAt: string;
  expiresAt: string;
  version: string;
  locale: string;
}

export interface ProductResolutionCache {
  getByQuery(query: string, locale?: string): Promise<ProductResolutionCacheEntry | undefined>;
  set(entry: ProductResolutionCacheEntry): Promise<void>;
}

export interface ProviderIdentityCache {
  get(productId: string, provider: LiveProviderId): Promise<ProviderIdentityCacheEntry | undefined>;
  set(entry: ProviderIdentityCacheEntry): Promise<void>;
}

export interface SnapshotCache {
  get(productId: string, utcDay: string): Promise<ProductTrendSnapshot | undefined>;
  set(snapshot: ProductTrendSnapshot): Promise<void>;
}

export const PRODUCT_RESOLUTION_CACHE_KEY = "product-resolution:{normalizedQuery}";
export const PRODUCT_RESOLUTION_CACHE_VERSION = "product_resolution_v1";
export const PROVIDER_IDENTITY_CACHE_VERSION = "provider_identity_v1";
export const DEFAULT_PRODUCT_RESOLUTION_LOCALE = "en-US";

export const PRODUCT_RESOLUTION_TTL_MS: Record<ProductIdentityConfidence, number> = {
  high: 30 * 24 * 60 * 60 * 1000,
  medium: 7 * 24 * 60 * 60 * 1000,
  low: 24 * 60 * 60 * 1000,
};

export const PROVIDER_IDENTITY_TTL_MS: Record<ProductIdentityConfidence, number> = {
  high: 30 * 24 * 60 * 60 * 1000,
  medium: 7 * 24 * 60 * 60 * 1000,
  low: 60 * 60 * 1000,
};

export const PROVIDER_IDENTITY_CACHE_KEY = "provider-identity:{productId}:{provider}";
export const SNAPSHOT_CACHE_KEY = "snapshot:{productId}:{scoreVersion}:{utcDay}";

export const CACHE_TTL_CONCEPTS = {
  productResolution: "High-confidence: 30 days; medium-confidence: 7 days; low-confidence: 1 day.",
  providerIdentity: "High-confidence: 30 days; medium-confidence: 7 days; ambiguous/low-confidence identities are not canonical.",
  snapshot: "Immutable by productId, scoreVersion, and UTC day once saved.",
} as const;

function normalizeCacheQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildProductResolutionCacheKey(
  normalizedQuery: string,
  locale = DEFAULT_PRODUCT_RESOLUTION_LOCALE
): string {
  return `product-resolution:${locale.toLowerCase()}:${normalizeCacheQuery(normalizedQuery)}`;
}

export function buildProviderIdentityCacheKey(
  profile: ProductProfile,
  provider: LiveProviderId,
  locale = DEFAULT_PRODUCT_RESOLUTION_LOCALE
): string {
  const identityParts = [
    provider,
    locale.toLowerCase(),
    profile.brand,
    profile.canonicalTitle,
    profile.modelGeneration,
    profile.productType,
  ].filter((value): value is string => Boolean(value));

  return `provider-identity:${identityParts.map(normalizeCacheQuery).join(":")}`;
}

export class InMemoryProductResolutionCache implements ProductResolutionCache {
  private readonly entries = new Map<string, ProductResolutionCacheEntry>();

  async getByQuery(
    query: string,
    locale = DEFAULT_PRODUCT_RESOLUTION_LOCALE
  ): Promise<ProductResolutionCacheEntry | undefined> {
    return this.entries.get(buildProductResolutionCacheKey(query, locale));
  }

  async set(entry: ProductResolutionCacheEntry): Promise<void> {
    this.entries.set(entry.cacheKey, entry);
  }

  clear(): void {
    this.entries.clear();
  }
}

export class InMemoryProviderIdentityCache implements ProviderIdentityCache {
  private readonly entries = new Map<string, ProviderIdentityCacheEntry>();

  async get(productId: string, provider: LiveProviderId): Promise<ProviderIdentityCacheEntry | undefined> {
    return this.entries.get(`${provider}:${productId}`);
  }

  async set(entry: ProviderIdentityCacheEntry): Promise<void> {
    this.entries.set(`${entry.provider}:${entry.cacheKey}`, entry);
  }

  clear(): void {
    this.entries.clear();
  }
}
