import { describe, expect, it, vi } from "vitest";
import { RAY_BAN_META_PRODUCT_ID } from "../../mockProviderSignals";
import {
  VALIDATION_PRODUCT_PROFILES,
  buildProviderRoutingReport,
  resolveProductQuery,
  routeProvidersForProfile,
} from "../index";
import type { LiveDataCapability, LiveProviderId, ProviderRoute } from "../types";

const now = new Date("2026-08-24T12:00:00.000Z");

function route(
  routes: ProviderRoute[],
  provider: LiveProviderId,
  capability: LiveDataCapability
): ProviderRoute {
  const match = routes.find((candidate) =>
    candidate.provider === provider && candidate.capability === capability
  );

  expect(match).toBeDefined();
  return match!;
}

function expectNoExecution(routes: ProviderRoute[]): void {
  expect(routes.every((candidate) => candidate.executionAllowed === false)).toBe(true);
}

describe("dynamic provider router dry run", () => {
  it("routes Garmin Venu 4 without requiring catalog membership", async () => {
    const result = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const plan = routeProvidersForProfile(result.profile);

    expect(result.resolution.matchedCatalogProductId).toBeUndefined();
    expect(plan.dryRun).toBe(true);
    expectNoExecution(plan.routes);
    expect(route(plan.routes, "dataforseo_trends", "search").status).toBe("ready");
    expect(route(plan.routes, "dataforseo_google_ads", "search").status).toBe("ready");

    const aggregateReviews = route(plan.routes, "dataforseo_google_shopping", "reviews");
    const detailedReviews = route(plan.routes, "dataforseo_google_shopping_reviews", "reviews");

    expect(aggregateReviews.status).toBe("guarded");
    expect(aggregateReviews.futureExecutionEligibility).toBe("needs_identity");
    expect(aggregateReviews.missingIdentityFields).toContain("identityConfidence");
    expect(detailedReviews.futureExecutionEligibility).toBe("needs_identity");
    expect(detailedReviews.missingIdentityFields).toContain("providerSpecificIds");
  });

  it.each(["Ninja Creami Swirl", "Samsung Galaxy Ring"])(
    "routes %s as hardware with guarded reviews and no network execution",
    async (query) => {
      const result = await resolveProductQuery(query, { now: () => now });
      const plan = routeProvidersForProfile(result.profile);

      expect(result.profile.productType).toBe("hardware");
      expect(route(plan.routes, "dataforseo_trends", "search").status).toBe("ready");
      expect(route(plan.routes, "dataforseo_google_ads", "search").status).toBe("ready");
      expect(route(plan.routes, "dataforseo_google_shopping", "reviews").status).toBe("guarded");
      expect(route(plan.routes, "dataforseo_google_shopping", "reviews").futureExecutionEligibility)
        .toBe("needs_identity");
      expectNoExecution(plan.routes);
    }
  );

  it("keeps an unknown low-confidence product guarded or blocked without crashing", async () => {
    const result = await resolveProductQuery("XYZ Quantum Blender 9000", { now: () => now });
    const plan = routeProvidersForProfile(result.profile);

    expect(result.profile.identityConfidence).toBe("low");
    expect(result.profile.productType).toBe("unknown");
    expect(route(plan.routes, "dataforseo_trends", "search").status).toBe("guarded");
    expect(route(plan.routes, "dataforseo_trends", "search").futureExecutionEligibility).toBe("needs_identity");
    expect(route(plan.routes, "dataforseo_google_shopping", "reviews").status).toBe("blocked");
    expect(route(plan.routes, "dataforseo_google_shopping", "reviews").futureExecutionEligibility)
      .toBe("needs_identity");
    expect(route(plan.routes, "dataforseo_google_shopping_reviews", "reviews").missingIdentityFields)
      .toContain("providerSpecificIds");
    expectNoExecution(plan.routes);
  });

  it("routes Ray-Ban Meta provider identities while keeping execution disabled", async () => {
    const result = await resolveProductQuery("Ray-Ban Meta", { now: () => now });
    const plan = routeProvidersForProfile(result.profile);

    expect(result.profile.productId).toBe(RAY_BAN_META_PRODUCT_ID);
    expect(route(plan.routes, "dataforseo_trends", "search").futureExecutionEligibility).toBe("eligible");
    expect(route(plan.routes, "dataforseo_google_ads", "search").futureExecutionEligibility).toBe("eligible");
    expect(route(plan.routes, "dataforseo_google_shopping", "reviews").futureExecutionEligibility).toBe("eligible");
    expect(route(plan.routes, "dataforseo_google_shopping_reviews", "reviews").futureExecutionEligibility)
      .toBe("eligible");
    expect(route(plan.routes, "dataforseo_google_shopping_reviews", "reviews").missingIdentityFields)
      .toEqual([]);
    expectNoExecution(plan.routes);
  });

  it("blocks Claude from Google Shopping review providers", async () => {
    const result = await resolveProductQuery("Claude", { now: () => now });
    const plan = routeProvidersForProfile(result.profile);

    expect(result.profile.productType).toBe("software_saas");
    expect(route(plan.routes, "dataforseo_trends", "search").futureExecutionEligibility).toBe("eligible");
    expect(route(plan.routes, "dataforseo_google_shopping", "reviews").status).toBe("blocked");
    expect(route(plan.routes, "dataforseo_google_shopping", "reviews").futureExecutionEligibility).toBe("blocked");
    expect(route(plan.routes, "dataforseo_google_shopping_reviews", "reviews").status).toBe("blocked");
    expect(plan.warnings.join(" ")).toContain("software/SaaS");
    expectNoExecution(plan.routes);
  });

  it("provides a debuggable routing report from a product resolution result", async () => {
    const result = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const report = buildProviderRoutingReport(result);

    expect(report.dryRun).toBe(true);
    expect(report.product.productId).toBe("user-search-garmin-venu-4");
    expect(report.product.identityConfidence).toBe("medium");
    expect(report.providerRoutes).toHaveLength(5);
    expect(report.guardedProviders).toContain("dataforseo_google_shopping");
    expect(report.missingIdentity).toContain("identityConfidence");
    expect(report.missingIdentity).toContain("providerSpecificIds");
    expect(report.paidRouteWarnings.length).toBe(5);
    expect(report.futureExecutionEligibility.needs_identity.length).toBeGreaterThan(0);
  });

  it("uses static paid-route metadata and never marks dry-run routes executable", () => {
    const plan = routeProvidersForProfile(VALIDATION_PRODUCT_PROFILES[RAY_BAN_META_PRODUCT_ID]);

    expect(plan.routes.every((candidate) => candidate.estimatedPaidRequest)).toBe(true);
    expect(plan.routes.map((candidate) => candidate.estimatedCostCategory)).toEqual([
      "very_low",
      "very_low",
      "very_low",
      "low",
      "low",
    ]);
    expectNoExecution(plan.routes);
  });

  it("does not invoke fetch or supplied provider clients while routing", async () => {
    const result = await resolveProductQuery("Samsung Galaxy Ring", { now: () => now });
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(() => {
      throw new Error("fetch must not be called during provider routing");
    });
    const client = {
      task_post: vi.fn(() => {
        throw new Error("task_post must not be called during provider routing");
      }),
      task_get: vi.fn(() => {
        throw new Error("task_get must not be called during provider routing");
      }),
    };

    Object.defineProperty(globalThis, "fetch", {
      value: fetchSpy,
      configurable: true,
    });

    try {
      const plan = routeProvidersForProfile(result.profile, {
        providerClients: {
          dataforseo_google_shopping_reviews: client,
        },
      });

      expectNoExecution(plan.routes);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(client.task_post).not.toHaveBeenCalled();
      expect(client.task_get).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        value: originalFetch,
        configurable: true,
      });
    }
  });
});
