import type { ProductTrendSnapshot } from "../types";
import type { LiveProviderId, ProductProfile } from "./types";

export interface ProductResolutionCacheEntry {
  query: string;
  profile: ProductProfile;
  resolvedAt: string;
  expiresAt: string;
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
  getByQuery(query: string): Promise<ProductResolutionCacheEntry | undefined>;
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
export const PROVIDER_IDENTITY_CACHE_KEY = "provider-identity:{productId}:{provider}";
export const SNAPSHOT_CACHE_KEY = "snapshot:{productId}:{scoreVersion}:{utcDay}";

export const CACHE_TTL_CONCEPTS = {
  productResolution: "7-30 days; shorter when identityConfidence is low.",
  providerIdentity: "30-90 days; invalidate when provider match confidence, title, generation, or variant grouping changes.",
  snapshot: "Immutable by productId, scoreVersion, and UTC day once saved.",
} as const;
