import { describe, expect, it } from "vitest";
import {
  InMemoryProviderIdentityCache,
  PROVIDER_IDENTITY_CACHE_VERSION,
  buildProviderIdentityCacheKey,
} from "../cacheContracts";
import { VALIDATION_PRODUCT_PROFILES } from "../profiles";

describe("InMemoryProviderIdentityCache", () => {
  it("retrieves an entry with the same provider/cache-key shape used by set", async () => {
    const profile = VALIDATION_PRODUCT_PROFILES["ray-ban-meta"];
    const provider = "dataforseo_trends" as const;
    const cache = new InMemoryProviderIdentityCache();
    const entry = {
      cacheKey: buildProviderIdentityCacheKey(profile, provider),
      productId: profile.productId,
      provider,
      providerIds: { family: "opaque-test-id" },
      identityConfidence: profile.identityConfidence,
      canonicalTitle: profile.canonicalTitle,
      brand: profile.brand,
      modelGeneration: profile.modelGeneration,
      warnings: [],
      evidence: [],
      resolvedAt: "2026-09-02T12:00:00.000Z",
      expiresAt: "2026-09-03T12:00:00.000Z",
      version: PROVIDER_IDENTITY_CACHE_VERSION,
      locale: "en-US",
    };

    await cache.set(entry);
    await expect(cache.get(entry.cacheKey, provider)).resolves.toEqual(entry);
  });
});
