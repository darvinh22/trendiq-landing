import type { ProductTrendSnapshot } from "../types";
import type { LiveProviderId, ProductIdentityConfidence, ProductProfile, ProductResolution } from "./types";

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
  productId: string;
  provider: LiveProviderId;
  providerIds: Record<string, unknown>;
  identityConfidence: ProductProfile["identityConfidence"];
  resolvedAt: string;
  expiresAt: string;
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
export const DEFAULT_PRODUCT_RESOLUTION_LOCALE = "en-US";

export const PRODUCT_RESOLUTION_TTL_MS: Record<ProductIdentityConfidence, number> = {
  high: 30 * 24 * 60 * 60 * 1000,
  medium: 7 * 24 * 60 * 60 * 1000,
  low: 24 * 60 * 60 * 1000,
};

export const PROVIDER_IDENTITY_CACHE_KEY = "provider-identity:{productId}:{provider}";
export const SNAPSHOT_CACHE_KEY = "snapshot:{productId}:{scoreVersion}:{utcDay}";

export const CACHE_TTL_CONCEPTS = {
  productResolution: "High-confidence: 30 days; medium-confidence: 7 days; low-confidence: 1 day.",
  providerIdentity: "30-90 days; invalidate when provider match confidence, title, generation, or variant grouping changes.",
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
