import { describe, expect, it } from "vitest";
import { RAY_BAN_META_PRODUCT_ID } from "../../mockProviderSignals";
import { ReviewQualitySignalProvider } from "../../providers/reviewsProvider";
import { readReviewProviderConfig, type GoogleShoppingReviewsClient } from "../../reviews";
import { readSearchProviderConfig } from "../../search/config";
import { SearchTrendSignalProvider } from "../../search/provider";
import type {
  SearchInterestClient,
  SearchInterestPoint,
  SearchInterestSeries,
  SearchVolumeClient,
  SearchVolumeSeries,
} from "../../search/types";
import {
  VALIDATION_PRODUCT_PROFILES,
  buildDynamicProductReadinessReport,
  buildProductProfileFromCatalogProduct,
  canUseProvider,
  createUserSearchProductProfile,
} from "../index";

const now = new Date("2026-08-12T00:00:00.000Z");

function point(date: string, value: number, aliases: string[]): SearchInterestPoint {
  return {
    dateFrom: date,
    dateTo: date,
    timestamp: Date.parse(`${date}T00:00:00.000Z`) / 1000,
    valuesByAlias: aliases.reduce<Record<string, number>>((mapped, alias) => {
      mapped[alias] = value;
      return mapped;
    }, {}),
  };
}

function dynamicSearchSeries(productId: string, aliases: string[]): SearchInterestSeries {
  const values = Array.from({ length: 31 }, (_, index) => 20 + index);

  return {
    provider: "dataforseo",
    productId,
    aliases,
    locationCode: 2840,
    interestType: "web",
    timeRange: "past_30_days",
    fetchedAt: now.toISOString(),
    points: values.map((value, index) => {
      const date = new Date(Date.UTC(2026, 6, 13 + index)).toISOString().slice(0, 10);
      return point(date, value, aliases);
    }),
    averagesByAlias: {},
  };
}

class FixtureSearchClient implements SearchInterestClient {
  readonly calls: Array<{ productId: string; aliases: string[] }> = [];

  async getSearchInterest(input: { productId: string; aliases: string[] }): Promise<SearchInterestSeries> {
    this.calls.push({
      productId: input.productId,
      aliases: input.aliases,
    });

    return dynamicSearchSeries(input.productId, input.aliases);
  }
}

class NoopVolumeClient implements SearchVolumeClient {
  async getSearchVolume(): Promise<SearchVolumeSeries> {
    throw new Error("No volume fixture in this capability-routing test.");
  }
}

class BlockingReviewClient implements GoogleShoppingReviewsClient {
  readonly calls: string[] = [];

  async getProductReviewAggregate(input: { productId: string }): ReturnType<GoogleShoppingReviewsClient["getProductReviewAggregate"]> {
    this.calls.push(input.productId);
    throw new Error("This client should not be reached for blocked profiles.");
  }
}

describe("dynamic product capabilities", () => {
  it("creates a preliminary ProductProfile for an arbitrary user query absent from the catalog", () => {
    const profile = createUserSearchProductProfile("Garmin Venu 4");

    expect(profile.productId).toBe("user-search-garmin-venu-4");
    expect(profile.source).toBe("user_search");
    expect(profile.query).toBe("Garmin Venu 4");
    expect(profile.canonicalTitle).toBe("Garmin Venu 4");
    expect(profile.productType).toBe("hardware");
    expect(profile.identityConfidence).toBe("low");
  });

  it("does not reject unknown products merely because they are absent from data.ts", () => {
    const profile = createUserSearchProductProfile("Ninja Creami Swirl");
    const report = buildDynamicProductReadinessReport(profile);
    const search = report.capabilities.find((capability) => capability.capability === "search");

    expect(profile.productId).toBe("user-search-ninja-creami-swirl");
    expect(search?.status).toBe("guarded");
    expect(search?.allowedProviders).toContain("dataforseo_trends");
    expect(canUseProvider(profile, "dataforseo_trends", "search").allowed).toBe(true);
  });

  it("lets a dynamically classified hardware profile become search-ready", () => {
    const profile = createUserSearchProductProfile("Samsung Galaxy Ring", {
      productType: "hardware",
      brand: "Samsung",
      identityConfidence: "medium",
    });
    const search = buildDynamicProductReadinessReport(profile).capabilities.find((capability) =>
      capability.capability === "search"
    );

    expect(search?.status).toBe("ready");
    expect(canUseProvider(profile, "dataforseo_google_ads", "search").allowed).toBe(true);
  });

  it("routes dynamic search profiles without requiring SEARCH_PRODUCT_QUERIES membership", async () => {
    const profile = createUserSearchProductProfile("Samsung Galaxy Ring", {
      productType: "hardware",
      brand: "Samsung",
      identityConfidence: "medium",
    });
    const client = new FixtureSearchClient();
    const provider = new SearchTrendSignalProvider(readSearchProviderConfig({}, {
      mode: "live",
      apiLogin: "login",
      apiPassword: "password",
      productQueries: {},
      productProfiles: {},
      minSampleSize: 2,
      now: () => now,
    }), {
      client,
      volumeClient: new NoopVolumeClient(),
    });

    await provider.getSignalsForProfile(profile);

    expect(client.calls).toEqual([{
      productId: profile.productId,
      aliases: profile.aliases,
    }]);
  });

  it("blocks Google Shopping reviews for software/SaaS profiles", () => {
    const claude = VALIDATION_PRODUCT_PROFILES["claude-3-5"];
    const decision = canUseProvider(claude, "dataforseo_google_shopping", "reviews");

    expect(decision.allowed).toBe(false);
    expect(decision.status).toBe("blocked");
    expect(decision.policy).toBe("blocked");
    expect(decision.reason).toContain("software/SaaS");
  });

  it("keeps subscription hardware review readiness guarded", () => {
    const oura = buildDynamicProductReadinessReport(VALIDATION_PRODUCT_PROFILES["oura-ring-4"]);
    const whoop = buildDynamicProductReadinessReport(VALIDATION_PRODUCT_PROFILES["whoop-5"]);

    expect(oura.capabilities.find((capability) => capability.capability === "reviews")?.status).toBe("guarded");
    expect(whoop.capabilities.find((capability) => capability.capability === "reviews")?.status).toBe("guarded");
    expect(whoop.capabilities.find((capability) => capability.capability === "reviews")?.warnings.join(" "))
      .toContain("subscription");
  });

  it("requires bundle, accessory, generation, or variant guardrails for Bambu and Dyson review routing", () => {
    const bambuWithoutGuardrails = {
      ...VALIDATION_PRODUCT_PROFILES["bambu-lab-a1"],
      guardrails: undefined,
    };
    const dysonWithoutGeneration = {
      ...VALIDATION_PRODUCT_PROFILES["dyson-airwrap"],
      modelGeneration: undefined,
    };

    expect(canUseProvider(bambuWithoutGuardrails, "dataforseo_google_shopping", "reviews").missingRequirements)
      .toContain("variantBundleGuardrails");
    expect(canUseProvider(bambuWithoutGuardrails, "dataforseo_google_shopping", "reviews").allowed).toBe(false);
    expect(canUseProvider(dysonWithoutGeneration, "dataforseo_google_shopping", "reviews").missingRequirements)
      .toContain("modelGeneration");
  });

  it("keeps Ray-Ban review capability guarded but usable with pre-resolved identity metadata", () => {
    const rayBan = VALIDATION_PRODUCT_PROFILES[RAY_BAN_META_PRODUCT_ID];
    const aggregateDecision = canUseProvider(rayBan, "dataforseo_google_shopping", "reviews");
    const reviewsDecision = canUseProvider(rayBan, "dataforseo_google_shopping_reviews", "reviews");

    expect(aggregateDecision.allowed).toBe(true);
    expect(aggregateDecision.policy).toBe("guarded");
    expect(reviewsDecision.allowed).toBe(true);
    expect(reviewsDecision.missingRequirements).toEqual([]);
  });

  it("prevents blocked review profiles from reaching a network-backed client", async () => {
    const claude = VALIDATION_PRODUCT_PROFILES["claude-3-5"];
    const client = new BlockingReviewClient();
    const provider = new ReviewQualitySignalProvider(readReviewProviderConfig({}, {
      mode: "live",
      apiLogin: "login",
      apiPassword: "password",
      productIdentities: {},
      productProfiles: {
        [claude.productId]: claude,
      },
      now: () => now,
    }), {
      client,
    });

    expect(await provider.getSignalsForProfile(claude)).toEqual([]);
    expect(client.calls).toEqual([]);
  });

  it("preserves catalog adapter behavior as an example path rather than a requirement", () => {
    const profile = buildProductProfileFromCatalogProduct({
      id: "catalog-ray-ban",
      title: "Ray-Ban Meta Glasses",
      subtitle: "Smart glasses with built-in AI",
      category: "Tech",
    }, {
      canonicalTitle: "Ray-Ban Meta",
      identityConfidence: "high",
    });

    expect(profile.productId).toBe("catalog-ray-ban");
    expect(profile.source).toBe("catalog");
    expect(profile.aliases).toContain("Ray-Ban Meta");
    expect(profile.productType).toBe("hardware");
  });
});
