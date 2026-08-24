import { describe, expect, it } from "vitest";
import { ReviewQualitySignalProvider } from "../../providers/reviewsProvider";
import { readReviewProviderConfig, type GoogleShoppingReviewsClient } from "../../reviews";
import {
  InMemoryProductResolutionCache,
  PRODUCT_RESOLUTION_TTL_MS,
  buildProductProfileFromResolution,
  canUseProvider,
  normalizeProductQuery,
  resolveProductQuery,
} from "../index";

const now = new Date("2026-08-24T12:00:00.000Z");

class BlockingReviewClient implements GoogleShoppingReviewsClient {
  readonly calls: string[] = [];

  async getProductReviewAggregate(input: {
    productId: string;
  }): ReturnType<GoogleShoppingReviewsClient["getProductReviewAggregate"]> {
    this.calls.push(input.productId);
    throw new Error("Blocked profiles must not reach this client.");
  }
}

describe("product query resolver", () => {
  it("normalizes arbitrary query text without over-normalizing model names", () => {
    expect(normalizeProductQuery("  garmin   venu 4  ")).toBe("Garmin Venu 4");
    expect(normalizeProductQuery("buy   samsung galaxy ring reviews")).toBe("Samsung Galaxy Ring");
    expect(normalizeProductQuery("WHOOP 5.0")).toBe("WHOOP 5.0");
    expect(normalizeProductQuery("XYZ Quantum Blender 9000")).toBe("XYZ Quantum Blender 9000");
  });

  it("resolves Garmin Venu 4 without a data.ts entry", async () => {
    const result = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const search = result.readiness.capabilities.find((capability) => capability.capability === "search");
    const reviews = result.readiness.capabilities.find((capability) => capability.capability === "reviews");

    expect(result.resolution.matchedCatalogProductId).toBeUndefined();
    expect(result.resolution.inferredProductType).toBe("hardware");
    expect(result.resolution.brand).toBe("Garmin");
    expect(result.resolution.modelGeneration).toBe("Venu 4");
    expect(result.resolution.identityConfidence).toBe("medium");
    expect(search?.status).toBe("ready");
    expect(reviews?.status).toBe("guarded");
    expect(result.profile.providerIds).toBeUndefined();
  });

  it("resolves Ninja Creami Swirl while preserving model identity", async () => {
    const result = await resolveProductQuery("Ninja Creami Swirl", { now: () => now });

    expect(result.resolution.inferredProductType).toBe("hardware");
    expect(result.resolution.brand).toBe("Ninja");
    expect(result.resolution.modelGeneration).toBe("Creami Swirl");
    expect(result.resolution.canonicalTitle).toBe("Ninja Creami Swirl");
    expect(result.profile.productId).toBe("user-search-ninja-creami-swirl");
  });

  it("resolves Samsung Galaxy Ring with a confidently inferred brand", async () => {
    const result = await resolveProductQuery("Samsung Galaxy Ring", { now: () => now });

    expect(result.resolution.inferredProductType).toBe("hardware");
    expect(result.resolution.brand).toBe("Samsung");
    expect(result.resolution.modelGeneration).toBe("Galaxy Ring");
    expect(result.resolution.identityConfidence).toBe("medium");
  });

  it("creates a low-confidence profile for a completely unknown string without crashing", async () => {
    const result = await resolveProductQuery("XYZ Quantum Blender 9000", { now: () => now });
    const reviews = result.readiness.capabilities.find((capability) => capability.capability === "reviews");

    expect(result.profile.productId).toBe("user-search-xyz-quantum-blender-9000");
    expect(result.resolution.inferredProductType).toBe("unknown");
    expect(result.resolution.brand).toBeUndefined();
    expect(result.resolution.identityConfidence).toBe("low");
    expect(reviews?.status).toBe("blocked");
    expect(result.resolution.warnings).toContain("Product type is unknown until classification is resolved.");
  });

  it.each([
    ["Ray-Ban Meta", "ray-ban-meta", "hybrid", "Ray-Ban"],
    ["Oura Ring", "oura-ring-4", "subscription_hardware", "Oura"],
    ["WHOOP", "whoop-5", "subscription_hardware", "WHOOP"],
    ["Bambu Lab A1", "bambu-lab-a1", "hardware", "Bambu Lab"],
    ["Dyson Airwrap", "dyson-airwrap", "hardware", "Dyson"],
    ["Claude", "claude-3-5", "software_saas", "Anthropic"],
  ])("resolves known validation product %s through catalog matching", async (
    query,
    productId,
    productType,
    brand
  ) => {
    const result = await resolveProductQuery(query, { now: () => now });

    expect(result.resolution.resolutionSource).toBe("catalog_match");
    expect(result.resolution.matchedCatalogProductId).toBe(productId);
    expect(result.profile.productId).toBe(productId);
    expect(result.resolution.inferredProductType).toBe(productType);
    expect(result.resolution.brand).toBe(brand);
    expect(result.resolution.identityConfidence).toBe("high");
  });

  it("resolves Ray-Ban aliases to the same canonical catalog product", async () => {
    const noHyphen = await resolveProductQuery("Ray Ban Meta", { now: () => now });
    const withGlasses = await resolveProductQuery("Ray-Ban Meta Glasses", { now: () => now });

    expect(noHyphen.resolution.canonicalTitle).toBe("Ray-Ban Meta");
    expect(withGlasses.resolution.canonicalTitle).toBe("Ray-Ban Meta");
    expect(noHyphen.profile.productId).toBe(withGlasses.profile.productId);
  });

  it("builds a ProductProfile from a resolution even without a catalog match", async () => {
    const { resolution } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const profile = buildProductProfileFromResolution(resolution);

    expect(profile.productId).toBe("user-search-garmin-venu-4");
    expect(profile.source).toBe("user_search");
    expect(profile.productType).toBe("hardware");
  });

  it("uses the resolution cache and preserves ProductProfile data on cache hits", async () => {
    const cache = new InMemoryProductResolutionCache();
    const first = await resolveProductQuery("Garmin Venu 4", {
      cache,
      now: () => now,
    });
    const second = await resolveProductQuery("Garmin Venu 4", {
      cache,
      now: () => new Date(now.getTime() + 60_000),
    });

    expect(first.cacheStatus).toBe("miss");
    expect(second.cacheStatus).toBe("hit");
    expect(second.resolution.resolutionSource).toBe("cached_resolution");
    expect(second.profile).toEqual(first.profile);
  });

  it("recomputes expired resolutions and uses a shorter low-confidence TTL", async () => {
    const cache = new InMemoryProductResolutionCache();
    const low = await resolveProductQuery("XYZ Quantum Blender 9000", {
      cache,
      now: () => now,
    });
    const expired = await resolveProductQuery("XYZ Quantum Blender 9000", {
      cache,
      now: () => new Date(now.getTime() + PRODUCT_RESOLUTION_TTL_MS.low + 1),
    });

    expect(new Date(low.expiresAt ?? "").getTime() - now.getTime()).toBe(PRODUCT_RESOLUTION_TTL_MS.low);
    expect(expired.cacheStatus).toBe("expired");
    expect(expired.resolution.resolutionSource).toBe("local_rules");
  });

  it("keeps medium-confidence resolutions cached longer than low-confidence resolutions", async () => {
    const cache = new InMemoryProductResolutionCache();
    const medium = await resolveProductQuery("Samsung Galaxy Ring", {
      cache,
      now: () => now,
    });
    const low = await resolveProductQuery("XYZ Quantum Blender 9000", {
      cache,
      now: () => now,
    });

    expect(new Date(medium.expiresAt ?? "").getTime() - now.getTime()).toBe(PRODUCT_RESOLUTION_TTL_MS.medium);
    expect(new Date(low.expiresAt ?? "").getTime() - now.getTime()).toBe(PRODUCT_RESOLUTION_TTL_MS.low);
  });

  it("keeps Claude blocked from Google Shopping reviews", async () => {
    const { profile } = await resolveProductQuery("Claude", { now: () => now });
    const decision = canUseProvider(profile, "dataforseo_google_shopping", "reviews");

    expect(decision.allowed).toBe(false);
    expect(decision.status).toBe("blocked");
  });

  it("prevents unknown low-confidence products from reaching review clients", async () => {
    const { profile } = await resolveProductQuery("XYZ Quantum Blender 9000", { now: () => now });
    const client = new BlockingReviewClient();
    const provider = new ReviewQualitySignalProvider(readReviewProviderConfig({}, {
      mode: "live",
      apiLogin: "login",
      apiPassword: "password",
      productIdentities: {},
      productProfiles: {
        [profile.productId]: profile,
      },
      now: () => now,
    }), {
      client,
    });

    expect(await provider.getSignalsForProfile(profile)).toEqual([]);
    expect(client.calls).toEqual([]);
  });
});
