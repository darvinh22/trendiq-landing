import { describe, expect, it, vi } from "vitest";
import {
  InMemoryProviderIdentityCache,
  buildProviderIdentityGroups,
  buildProviderIdentityDiscoveryReport,
  classifyProviderIdentityCandidate,
  discoverProviderIdentity,
  enrichProductProfileWithProviderIdentity,
  resolveProductQuery,
  routeProvidersForProfile,
} from "../index";
import type {
  LiveDataCapability,
  LiveProviderId,
  ProviderIdentityCandidate,
  ProviderIdentityDiscoveryClient,
  ProviderRoute,
} from "../types";

const now = new Date("2026-08-24T12:00:00.000Z");

const garminProviderIds = {
  productId: "garmin-venu-4-product-id",
  gid: "garmin-venu-4-gid",
  dataDocid: "garmin-venu-4-data-docid",
};

function candidate(overrides: Partial<ProviderIdentityCandidate> = {}): ProviderIdentityCandidate {
  return {
    provider: "dataforseo_google_shopping",
    title: "Garmin Venu 4 GPS Smartwatch",
    brand: "Garmin",
    seller: "Garmin",
    providerIds: garminProviderIds,
    rankAbsolute: 1,
    rankGroup: 1,
    isBestMatch: true,
    ...overrides,
  };
}

function stableProviderIdCandidates(): ProviderIdentityCandidate[] {
  return [
    candidate({ seller: "Best Buy", rankAbsolute: 1 }),
    candidate({ seller: "Garmin", rankAbsolute: 2 }),
  ];
}

function route(
  routes: ProviderRoute[],
  provider: LiveProviderId,
  capability: LiveDataCapability
): ProviderRoute {
  const match = routes.find((candidateRoute) =>
    candidateRoute.provider === provider && candidateRoute.capability === capability
  );

  expect(match).toBeDefined();
  return match!;
}

describe("provider identity discovery", () => {
  it("discovers high-confidence Google Shopping identity for dynamic Garmin Venu 4", async () => {
    const resolved = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const beforePlan = routeProvidersForProfile(resolved.profile);

    expect(resolved.resolution.matchedCatalogProductId).toBeUndefined();
    expect(resolved.profile.brand).toBe("Garmin");
    expect(resolved.profile.productType).toBe("hardware");
    expect(route(beforePlan.routes, "dataforseo_google_shopping_reviews", "reviews").futureExecutionEligibility)
      .toBe("needs_identity");

    const discovery = await discoverProviderIdentity({
      profile: resolved.profile,
      provider: "dataforseo_google_shopping",
      capability: "reviews",
    }, {
      candidates: stableProviderIdCandidates(),
      now: () => now,
    });
    const enriched = enrichProductProfileWithProviderIdentity(resolved.profile, discovery);
    const afterPlan = routeProvidersForProfile(enriched);

    expect(discovery.status).toBe("resolved");
    expect(discovery.identityConfidence).toBe("high");
    expect(discovery.providerIds).toEqual(garminProviderIds);
    expect(discovery.selectedGroup?.selectedProviderIdGroup?.sellerDiversity).toBe(2);
    expect(enriched.providerIds?.dataforseo_google_shopping).toMatchObject(garminProviderIds);
    expect(enriched.providerIds?.dataforseo_google_shopping_reviews).toMatchObject(garminProviderIds);
    expect(route(afterPlan.routes, "dataforseo_google_shopping_reviews", "reviews").futureExecutionEligibility)
      .toBe("eligible");
    expect(afterPlan.routes.every((providerRoute) => providerRoute.executionAllowed === false)).toBe(true);
  });

  it("rejects Garmin accessory candidates and does not persist provider IDs", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const cache = new InMemoryProviderIdentityCache();

    const discovery = await discoverProviderIdentity({
      profile,
      provider: "dataforseo_google_shopping",
      capability: "reviews",
    }, {
      cache,
      candidates: [
        candidate({
          title: "Garmin Venu 4 charging cable accessory",
          providerIds: {
            productId: "accessory-product-id",
            gid: "accessory-gid",
            dataDocid: "accessory-data-docid",
          },
        }),
      ],
      now: () => now,
    });

    expect(discovery.status).toBe("ambiguous");
    expect(discovery.providerIds).toEqual({});
    expect(discovery.evidence.some((item) => item.reason.startsWith("excluded_accessory:"))).toBe(true);
    expect(enrichProductProfileWithProviderIdentity(profile, discovery)).toEqual(profile);
  });

  it("collapses duplicate retailer listings into one canonical identity group", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const groups = buildProviderIdentityGroups({
      profile,
      provider: "dataforseo_google_shopping",
      candidates: [
        candidate({ title: "Garmin Venu 4 GPS Smartwatch", seller: "Best Buy", rankAbsolute: 1 }),
        candidate({ title: "Garmin Venu 4 GPS Smartwatch", seller: "Garmin", rankAbsolute: 2 }),
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].sellerCount).toBe(2);
  });

  it("raises provider-ID confidence when the same ID set appears across multiple sellers", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const groups = buildProviderIdentityGroups({
      profile,
      provider: "dataforseo_google_shopping",
      candidates: stableProviderIdCandidates(),
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].providerIdGroups).toHaveLength(1);
    expect(groups[0].selectedProviderIdGroup?.identityConfidence).toBe("high");
    expect(groups[0].selectedProviderIdGroup?.providerIdsSafeToPersist).toBe(true);
    expect(groups[0].providerIdsSafeToPersist).toBe(true);
    expect(groups[0].providerIds).toEqual(garminProviderIds);
  });

  it("keeps seller-specific ID sets out of canonical provider identity persistence", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const discovery = await discoverProviderIdentity({
      profile,
      provider: "dataforseo_google_shopping",
      capability: "reviews",
    }, {
      candidates: [
        candidate({ seller: "Best Buy", rankAbsolute: 1 }),
        candidate({
          seller: "Garmin",
          rankAbsolute: 2,
          providerIds: {
            productId: "seller-specific-product-id",
            gid: "seller-specific-gid",
            dataDocid: "seller-specific-data-docid",
          },
        }),
      ],
      now: () => now,
    });

    expect(discovery.status).toBe("resolved");
    expect(discovery.identityConfidence).toBe("medium");
    expect(discovery.providerIds).toEqual({});
    expect(discovery.selectedGroup?.providerIdGroups).toHaveLength(2);
    expect(discovery.selectedGroup?.providerIdsSafeToPersist).toBe(false);
    expect(discovery.selectedGroup?.providerIdPersistenceReason)
      .toBe("provider_id_set_not_confirmed_across_independent_sellers");
  });

  it("groups color and finish variants at product-family identity level", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const groups = buildProviderIdentityGroups({
      profile,
      provider: "dataforseo_google_shopping",
      candidates: [
        candidate({ title: "Garmin Venu 4 41mm Smartwatch Slate Black", rankAbsolute: 1 }),
        candidate({ title: "Garmin Venu 4 41mm Smartwatch Silver Periwinkle", rankAbsolute: 2 }),
      ],
      canonicalIdentityLevel: "product_family",
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].colorVariants.join("/")).toContain("black");
    expect(groups[0].colorVariants.join("/")).toContain("silver");
  });

  it("keeps different sizes separate when size is identity-material", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const groups = buildProviderIdentityGroups({
      profile,
      provider: "dataforseo_google_shopping",
      candidates: [
        candidate({ title: "Garmin Venu 4 41mm Smartwatch", rankAbsolute: 1 }),
        candidate({
          title: "Garmin Venu 4 45mm Smartwatch",
          providerIds: {
            productId: "garmin-venu-4-45-product-id",
            gid: "garmin-venu-4-45-gid",
            dataDocid: "garmin-venu-4-45-data-docid",
          },
          rankAbsolute: 2,
        }),
      ],
      canonicalIdentityLevel: "size_variant",
    });

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.sizeVariant).sort()).toEqual(["41mm", "45mm"]);
  });

  it("separates provider-ID groups for different sizes inside one product family", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const groups = buildProviderIdentityGroups({
      profile,
      provider: "dataforseo_google_shopping",
      candidates: [
        candidate({ title: "Garmin Venu 4 41mm Smartwatch", rankAbsolute: 1 }),
        candidate({
          title: "Garmin Venu 4 45mm Smartwatch",
          providerIds: {
            productId: "garmin-venu-4-45-product-id",
            gid: "garmin-venu-4-45-gid",
            dataDocid: "garmin-venu-4-45-data-docid",
          },
          rankAbsolute: 2,
        }),
      ],
      canonicalIdentityLevel: "product_family",
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].sizeVariants.sort()).toEqual(["41mm", "45mm"]);
    expect(groups[0].providerIdGroups).toHaveLength(2);
    expect(groups[0].providerIdGroups.map((group) => group.sizeVariant).sort()).toEqual(["41mm", "45mm"]);
    expect(groups[0].providerIdsSafeToPersist).toBe(false);
  });

  it("guards provider IDs when one ID set has conflicting size scope", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const groups = buildProviderIdentityGroups({
      profile,
      provider: "dataforseo_google_shopping",
      candidates: [
        candidate({ title: "Garmin Venu 4 41mm Smartwatch", seller: "Best Buy", rankAbsolute: 1 }),
        candidate({ title: "Garmin Venu 4 45mm Smartwatch", seller: "Garmin", rankAbsolute: 2 }),
      ],
      canonicalIdentityLevel: "product_family",
    });

    expect(groups[0].providerIdGroups).toHaveLength(1);
    expect(groups[0].selectedProviderIdGroup?.variantConsistency).toBe("low");
    expect(groups[0].selectedProviderIdGroup?.persistenceReason)
      .toBe("conflicting_size_scope_for_provider_id_set");
    expect(groups[0].providerIdsSafeToPersist).toBe(false);
  });

  it("persists one dominant stable provider-ID group when competing groups are weaker", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const discovery = await discoverProviderIdentity({
      profile,
      provider: "dataforseo_google_shopping",
      capability: "reviews",
    }, {
      candidates: [
        ...stableProviderIdCandidates(),
        candidate({ seller: "Target", rankAbsolute: 3 }),
        candidate({
          seller: "Marketplace",
          rankAbsolute: 18,
          providerIds: {
            productId: "weak-competing-product-id",
            gid: "weak-competing-gid",
            dataDocid: "weak-competing-data-docid",
          },
        }),
      ],
      now: () => now,
    });

    expect(discovery.status).toBe("resolved");
    expect(discovery.identityConfidence).toBe("high");
    expect(discovery.providerIds).toEqual(garminProviderIds);
    expect(discovery.selectedGroup?.providerIdGroups).toHaveLength(2);
    expect(discovery.selectedGroup?.selectedProviderIdGroup?.sellerDiversity).toBe(3);
  });

  it("keeps multiple plausible provider-ID groups in needs-identity state", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const discovery = await discoverProviderIdentity({
      profile,
      provider: "dataforseo_google_shopping",
      capability: "reviews",
    }, {
      candidates: [
        candidate({ seller: "Best Buy", rankAbsolute: 1 }),
        candidate({ seller: "Garmin", rankAbsolute: 2 }),
        candidate({
          seller: "Target",
          rankAbsolute: 3,
          providerIds: {
            productId: "competing-product-id",
            gid: "competing-gid",
            dataDocid: "competing-data-docid",
          },
        }),
        candidate({
          seller: "Walmart",
          rankAbsolute: 4,
          providerIds: {
            productId: "competing-product-id",
            gid: "competing-gid",
            dataDocid: "competing-data-docid",
          },
        }),
      ],
      now: () => now,
    });
    const enriched = enrichProductProfileWithProviderIdentity(profile, discovery);
    const afterPlan = routeProvidersForProfile(enriched);

    expect(discovery.status).toBe("resolved");
    expect(discovery.identityConfidence).toBe("medium");
    expect(discovery.providerIds).toEqual({});
    expect(discovery.selectedGroup?.providerIdPersistenceReason)
      .toBe("multiple_high_confidence_provider_id_groups_in_identity_group");
    expect(route(afterPlan.routes, "dataforseo_google_shopping_reviews", "reviews").futureExecutionEligibility)
      .toBe("needs_identity");
  });

  it("marks a wrong Garmin model as ambiguous and withholds IDs", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });

    const discovery = await discoverProviderIdentity({
      profile,
      provider: "dataforseo_google_shopping",
      capability: "reviews",
    }, {
      candidates: [
        candidate({
          title: "Garmin Venu 3 GPS Smartwatch",
          providerIds: {
            productId: "garmin-venu-3-product-id",
            gid: "garmin-venu-3-gid",
            dataDocid: "garmin-venu-3-data-docid",
          },
        }),
      ],
      now: () => now,
    });

    expect(discovery.status).toBe("ambiguous");
    expect(discovery.providerIds).toEqual({});
    expect(discovery.evidence.map((item) => item.reason)).toContain("model_generation_mismatch");
  });

  it("keeps Garmin bundle candidates ambiguous unless canonical identity is clear", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });

    const discovery = await discoverProviderIdentity({
      profile,
      provider: "dataforseo_google_shopping",
      capability: "reviews",
    }, {
      candidates: [
        candidate({
          title: "Garmin Venu 4 GPS Smartwatch bundle with charger",
        }),
      ],
      now: () => now,
    });

    expect(discovery.status).toBe("ambiguous");
    expect(discovery.providerIds).toEqual({});
    expect(discovery.warnings.join(" ")).toContain("Bundle candidate requires manual identity review");
  });

  it("separates refurbished listings from canonical identity groups", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const classification = classifyProviderIdentityCandidate({
      profile,
      candidate: candidate({ title: "Garmin Venu 4 GPS Smartwatch refurbished" }),
    });

    expect(classification.bucket).toBe("refurbished/used");
    expect(classification.listingType).toBe("condition_variant");
  });

  it("separates wrong generations from the canonical product family", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const classification = classifyProviderIdentityCandidate({
      profile,
      candidate: candidate({ title: "Garmin Venu Smartwatch" }),
    });

    expect(classification.bucket).toBe("different-generation/model");
  });

  it("blocks Claude before provider client access", async () => {
    const { profile } = await resolveProductQuery("Claude", { now: () => now });
    const client: ProviderIdentityDiscoveryClient = {
      discoverCandidates: vi.fn(async () => {
        throw new Error("Claude must not reach Google Shopping identity discovery.");
      }),
    };

    const discovery = await discoverProviderIdentity({
      profile,
      provider: "dataforseo_google_shopping",
      capability: "reviews",
    }, {
      client,
      now: () => now,
    });

    expect(discovery.status).toBe("blocked");
    expect(discovery.warnings.join(" ")).toContain("Software/SaaS products are blocked");
    expect(client.discoverCandidates).not.toHaveBeenCalled();
  });

  it("blocks low-confidence unknown products before discovery execution", async () => {
    const { profile } = await resolveProductQuery("XYZ Quantum Blender 9000", { now: () => now });
    const client: ProviderIdentityDiscoveryClient = {
      discoverCandidates: vi.fn(async () => [candidate()]),
    };

    const discovery = await discoverProviderIdentity({
      profile,
      provider: "dataforseo_google_shopping",
      capability: "reviews",
    }, {
      client,
      now: () => now,
    });

    expect(profile.identityConfidence).toBe("low");
    expect(discovery.status).toBe("blocked");
    expect(client.discoverCandidates).not.toHaveBeenCalled();
  });

  it("reuses cached high-confidence provider identity without another discovery request", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const cache = new InMemoryProviderIdentityCache();
    const first = await discoverProviderIdentity({
      profile,
      provider: "dataforseo_google_shopping",
      capability: "reviews",
    }, {
      cache,
      candidates: stableProviderIdCandidates(),
      now: () => now,
    });
    const client: ProviderIdentityDiscoveryClient = {
      discoverCandidates: vi.fn(async () => {
        throw new Error("Cached identity should prevent a second discovery call.");
      }),
    };
    const second = await discoverProviderIdentity({
      profile,
      provider: "dataforseo_google_shopping",
      capability: "reviews",
    }, {
      cache,
      client,
      now: () => new Date(now.getTime() + 60_000),
    });

    expect(first.status).toBe("resolved");
    expect(second.status).toBe("resolved");
    expect(second.cacheStatus).toBe("hit");
    expect(second.providerIds).toEqual(garminProviderIds);
    expect(client.discoverCandidates).not.toHaveBeenCalled();
  });

  it("does not persist ambiguous provider IDs to the provider identity cache", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const cache = new InMemoryProviderIdentityCache();
    const ambiguous = await discoverProviderIdentity({
      profile,
      provider: "dataforseo_google_shopping",
      capability: "reviews",
    }, {
      cache,
      candidates: [
        candidate({ title: "Garmin Venu 4 41mm GPS Smartwatch", rankAbsolute: 1 }),
        candidate({
          title: "Garmin Venu 4 45mm Fitness Smartwatch",
          providerIds: {
            productId: "garmin-venu-4-alt-product-id",
            gid: "garmin-venu-4-alt-gid",
            dataDocid: "garmin-venu-4-alt-data-docid",
          },
          rankAbsolute: 2,
        }),
      ],
      canonicalIdentityLevel: "size_variant",
      now: () => now,
    });
    const client: ProviderIdentityDiscoveryClient = {
      discoverCandidates: vi.fn(async () => [candidate()]),
    };
    const followUp = await discoverProviderIdentity({
      profile,
      provider: "dataforseo_google_shopping",
      capability: "reviews",
    }, {
      cache,
      client,
      now: () => new Date(now.getTime() + 60_000),
    });

    expect(ambiguous.status).toBe("ambiguous");
    expect(ambiguous.providerIds).toEqual({});
    expect(client.discoverCandidates).toHaveBeenCalledTimes(1);
    expect(followUp.status).toBe("resolved");
  });

  it("does not invoke a provider client in dry-run mode", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const client: ProviderIdentityDiscoveryClient = {
      discoverCandidates: vi.fn(async () => {
        throw new Error("Dry-run discovery must not invoke clients.");
      }),
    };

    const discovery = await discoverProviderIdentity({
      profile,
      provider: "dataforseo_google_shopping",
      capability: "reviews",
    }, {
      dryRun: true,
      client,
      now: () => now,
    });

    expect(discovery.status).toBe("blocked");
    expect(discovery.warnings.join(" ")).toContain("Dry-run identity discovery cannot invoke provider clients");
    expect(client.discoverCandidates).not.toHaveBeenCalled();
  });

  it("reports search providers as query-based identity without fake provider IDs", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });

    const discovery = await discoverProviderIdentity({
      profile,
      provider: "dataforseo_trends",
      capability: "search",
    }, {
      now: () => now,
    });

    expect(discovery.status).toBe("resolved");
    expect(discovery.providerIds).toEqual({});
    expect(discovery.warnings.join(" ")).toContain("no provider product IDs are required");
  });

  it("builds a discovery report with routing before and after enrichment", async () => {
    const resolved = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const beforePlan = routeProvidersForProfile(resolved.profile);
    const discovery = await discoverProviderIdentity({
      profile: resolved.profile,
      provider: "dataforseo_google_shopping",
      capability: "reviews",
    }, {
      candidates: stableProviderIdCandidates(),
      now: () => now,
    });
    const enrichedProfile = enrichProductProfileWithProviderIdentity(resolved.profile, discovery);
    const report = buildProviderIdentityDiscoveryReport({
      originalQuery: resolved.resolution.originalQuery,
      profile: resolved.profile,
      provider: "dataforseo_google_shopping",
      discovery,
      routingBefore: beforePlan,
      enrichedProfile,
    });

    expect(report.originalQuery).toBe("Garmin Venu 4");
    expect(report.canonicalProduct).toBe("Garmin Venu 4");
    expect(report.candidateCount).toBe(2);
    expect(report.selectedCandidate?.title).toBe("Garmin Venu 4 GPS Smartwatch");
    expect(report.identityResolutionStatus).toBe("resolved");
    expect(report.executionAllowed).toBe(false);
    expect(route(report.routingBefore.routes, "dataforseo_google_shopping_reviews", "reviews").futureExecutionEligibility)
      .toBe("needs_identity");
    expect(route(report.routingAfter.routes, "dataforseo_google_shopping_reviews", "reviews").futureExecutionEligibility)
      .toBe("eligible");
  });
});
