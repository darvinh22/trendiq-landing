import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { RAY_BAN_META_PRODUCT_ID } from "../../mockProviderSignals";
import {
  buildSignalExecutionCacheKey,
  buildSignalExecutionPlan,
  buildSignalExecutionReport,
  resolveProductQuery,
  routeProvidersForProfile,
} from "../index";
import type {
  LiveDataCapability,
  LiveProviderId,
  SignalExecutionPlan,
  SignalExecutionStep,
} from "../types";

const now = new Date("2026-08-24T12:00:00.000Z");

function step(
  plan: SignalExecutionPlan,
  provider: LiveProviderId,
  capability: LiveDataCapability
): SignalExecutionStep {
  const match = plan.steps.find((candidate) =>
    candidate.provider === provider && candidate.capability === capability
  );

  expect(match).toBeDefined();
  return match!;
}

function expectNoExecution(plan: SignalExecutionPlan): void {
  expect(plan.executionAllowed).toBe(false);
  expect(plan.steps.every((candidate) => candidate.executionAllowed === false)).toBe(true);
  expect(plan.summary.paidLiveOperationsPerformed).toBe(0);
}

describe("signal execution planner dry run", () => {
  it("plans Garmin query-based signals as future eligible without catalog membership", async () => {
    const resolved = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const plan = buildSignalExecutionPlan(resolved.profile, { now: () => now });
    const trendsSearch = step(plan, "dataforseo_trends", "search");
    const adsSearch = step(plan, "dataforseo_google_ads", "search");
    const growth = step(plan, "dataforseo_trends", "growth");

    expect(resolved.resolution.matchedCatalogProductId).toBeUndefined();
    expect(plan.product.source).toBe("user_search");
    expect(plan.product.identityConfidence).toBe("medium");
    expect(trendsSearch.signal).toBe("search_momentum_trends");
    expect(adsSearch.signal).toBe("search_volume_google_ads");
    expect(growth.signal).toBe("growth_velocity_trends");
    expect(trendsSearch.identityMode).toBe("query");
    expect(adsSearch.identityMode).toBe("query");
    expect(growth.identityMode).toBe("query");
    expect(trendsSearch.futureExecutionEligibility).toBe("eligible");
    expect(adsSearch.futureExecutionEligibility).toBe("eligible");
    expect(growth.futureExecutionEligibility).toBe("eligible");
    expectNoExecution(plan);
  });

  it("keeps Garmin provider-ID-dependent Google Shopping Reviews at needs_identity", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const plan = buildSignalExecutionPlan(profile, { now: () => now });
    const detailedReviews = step(plan, "dataforseo_google_shopping_reviews", "reviews");

    expect(detailedReviews.signal).toBe("review_quality_google_shopping_reviews");
    expect(detailedReviews.identityMode).toBe("provider_ids");
    expect(detailedReviews.futureExecutionEligibility).toBe("needs_identity");
    expect(detailedReviews.blockReason).toBe("needs_provider_identity");
    expect(detailedReviews.providerIdentity.required).toBe(true);
    expect(detailedReviews.providerIdentity.providerIdsPresent).toBe(false);
    expect(detailedReviews.providerIdentity.providerIdFieldsPresent).toEqual([]);
    expect(detailedReviews.missingIdentityFields).toContain("providerSpecificIds");
    expect(detailedReviews.requirements).toContain("provider_ids");
    expectNoExecution(plan);
  });

  it("preserves Policy C by allowing product-family planning but not detailed reviews", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const plan = buildSignalExecutionPlan(profile, { now: () => now });
    const aggregateShopping = step(plan, "dataforseo_google_shopping", "reviews");
    const detailedReviews = step(plan, "dataforseo_google_shopping_reviews", "reviews");

    expect(aggregateShopping.identityMode).toBe("product_family");
    expect(aggregateShopping.futureExecutionEligibility).toBe("needs_identity");
    expect(aggregateShopping.requirements).toContain("high_confidence_identity");
    expect(detailedReviews.identityMode).toBe("provider_ids");
    expect(detailedReviews.futureExecutionEligibility).toBe("needs_identity");
    expect(detailedReviews.requirements).toContain("provider_ids");
    expectNoExecution(plan);
  });

  it.each(["Ninja Creami Swirl", "Samsung Galaxy Ring"])(
    "plans %s as a dynamic hardware product without catalog dependency",
    async (query) => {
      const resolved = await resolveProductQuery(query, { now: () => now });
      const plan = buildSignalExecutionPlan(resolved.profile, { now: () => now });

      expect(resolved.resolution.matchedCatalogProductId).toBeUndefined();
      expect(plan.product.productType).toBe("hardware");
      expect(step(plan, "dataforseo_trends", "search").futureExecutionEligibility).toBe("eligible");
      expect(step(plan, "dataforseo_google_ads", "search").futureExecutionEligibility).toBe("eligible");
      expect(step(plan, "dataforseo_google_shopping_reviews", "reviews").futureExecutionEligibility)
        .toBe("needs_identity");
      expectNoExecution(plan);
    }
  );

  it("keeps unknown low-confidence products guarded or identity-blocked", async () => {
    const resolved = await resolveProductQuery("XYZ Quantum Blender 9000", { now: () => now });
    const plan = buildSignalExecutionPlan(resolved.profile, { now: () => now });
    const trendsSearch = step(plan, "dataforseo_trends", "search");
    const shoppingAggregate = step(plan, "dataforseo_google_shopping", "reviews");

    expect(plan.product.identityConfidence).toBe("low");
    expect(plan.product.productType).toBe("unknown");
    expect(trendsSearch.readiness).toBe("guarded");
    expect(trendsSearch.futureExecutionEligibility).toBe("needs_identity");
    expect(trendsSearch.blockReason).toBe("needs_product_identity");
    expect(shoppingAggregate.readiness).toBe("blocked");
    expect(shoppingAggregate.futureExecutionEligibility).toBe("needs_identity");
    expectNoExecution(plan);
  });

  it("blocks Claude from Google Shopping review signals while preserving query-based search planning", async () => {
    const resolved = await resolveProductQuery("Claude", { now: () => now });
    const plan = buildSignalExecutionPlan(resolved.profile, { now: () => now });
    const shoppingAggregate = step(plan, "dataforseo_google_shopping", "reviews");
    const detailedReviews = step(plan, "dataforseo_google_shopping_reviews", "reviews");

    expect(plan.product.productType).toBe("software_saas");
    expect(step(plan, "dataforseo_trends", "search").futureExecutionEligibility).toBe("eligible");
    expect(shoppingAggregate.futureExecutionEligibility).toBe("blocked");
    expect(shoppingAggregate.blockReason).toBe("blocked_by_provider_policy");
    expect(detailedReviews.futureExecutionEligibility).toBe("blocked");
    expect(detailedReviews.blockReason).toBe("blocked_by_provider_policy");
    expectNoExecution(plan);
  });

  it("does not fabricate provider identity for dynamically resolved products", async () => {
    const { profile } = await resolveProductQuery("Samsung Galaxy Ring", { now: () => now });
    const plan = buildSignalExecutionPlan(profile, { now: () => now });
    const detailedReviews = step(plan, "dataforseo_google_shopping_reviews", "reviews");

    expect(profile.providerIds).toBeUndefined();
    expect(detailedReviews.providerIdentity.providerIdFieldsPresent).toEqual([]);
    expect(detailedReviews.providerIdentity.providerIdsPresent).toBe(false);
    expect(detailedReviews.futureExecutionEligibility).toBe("needs_identity");
  });

  it("consumes a supplied routing result instead of bypassing existing router decisions", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const routingPlan = routeProvidersForProfile(profile);
    const overridden = {
      ...routingPlan,
      routes: routingPlan.routes.map((route) =>
        route.provider === "dataforseo_trends" && route.capability === "search"
          ? {
              ...route,
              status: "blocked" as const,
              futureExecutionEligibility: "blocked" as const,
              reason: "Injected router decision for planner regression.",
            }
          : route
      ),
    };
    const plan = buildSignalExecutionPlan(profile, {
      routingPlan: overridden,
      now: () => now,
    });

    expect(step(plan, "dataforseo_trends", "search").futureExecutionEligibility).toBe("blocked");
    expect(step(plan, "dataforseo_trends", "search").routeReason)
      .toBe("Injected router decision for planner regression.");
  });

  it("does not invoke fetch or provider clients during planning", async () => {
    const { profile } = await resolveProductQuery("Ninja Creami Swirl", { now: () => now });
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(() => {
      throw new Error("fetch must not run during signal planning");
    });
    const providerClient = {
      discoverCandidates: vi.fn(() => {
        throw new Error("provider clients must not run during signal planning");
      }),
      task_post: vi.fn(() => {
        throw new Error("task_post must not run during signal planning");
      }),
      task_get: vi.fn(() => {
        throw new Error("task_get must not run during signal planning");
      }),
    };

    Object.defineProperty(globalThis, "fetch", {
      value: fetchSpy,
      configurable: true,
    });

    try {
      const plan = buildSignalExecutionPlan(profile, { now: () => now });

      expect(plan.steps).toHaveLength(5);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(providerClient.discoverCandidates).not.toHaveBeenCalled();
      expect(providerClient.task_post).not.toHaveBeenCalled();
      expect(providerClient.task_get).not.toHaveBeenCalled();
      expectNoExecution(plan);
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        value: originalFetch,
        configurable: true,
      });
    }
  });

  it("keeps provider HTTP imports and endpoint operations out of the planner module", () => {
    const source = readFileSync(new URL("../signalPlanner.ts", import.meta.url), "utf8");

    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("task_post");
    expect(source).not.toContain("task_get");
    expect(source).not.toContain("../providers");
    expect(source).not.toContain("../reviews");
    expect(source).not.toContain("../search");
    expect(source).not.toContain("../reddit");
  });

  it("reports cache metadata without implying execution", async () => {
    const { profile } = await resolveProductQuery("Ray-Ban Meta", { now: () => now });
    const cacheKey = buildSignalExecutionCacheKey(profile, "dataforseo_trends", "search");
    const plan = buildSignalExecutionPlan(profile, {
      now: () => now,
      cacheStatusByKey: {
        [cacheKey]: "hit",
      },
    });
    const trendsSearch = step(plan, "dataforseo_trends", "search");

    expect(trendsSearch.cache.cacheable).toBe(true);
    expect(trendsSearch.cache.cacheStatus).toBe("hit");
    expect(trendsSearch.futureExecutionEligibility).toBe("eligible");
    expect(trendsSearch.executionAllowed).toBe(false);
    expectNoExecution(plan);
  });

  it("keeps eligible distinct from executed and requires explicit approval", async () => {
    const { profile } = await resolveProductQuery("Ray-Ban Meta", { now: () => now });
    const plan = buildSignalExecutionPlan(profile, { now: () => now });
    const detailedReviews = step(plan, "dataforseo_google_shopping_reviews", "reviews");

    expect(detailedReviews.futureExecutionEligibility).toBe("eligible");
    expect(detailedReviews.executionAllowed).toBe(false);
    expect(detailedReviews.blockReason).toBe("explicit_live_approval_required");
    expect(detailedReviews.requirements).toContain("explicit_live_approval");
    expect(detailedReviews.requirements).toContain("paid_provider_access");
    expectNoExecution(plan);
  });

  it("preserves provider-ID requirements after product-family resolution", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const plan = buildSignalExecutionPlan(profile, { now: () => now });
    const detailedReviews = step(plan, "dataforseo_google_shopping_reviews", "reviews");

    expect(profile.identityConfidence).toBe("medium");
    expect(profile.canonicalTitle).toBe("Garmin Venu 4");
    expect(detailedReviews.requiredIdentityFields).toContain("providerSpecificIds");
    expect(detailedReviews.missingIdentityFields).toContain("providerSpecificIds");
    expect(detailedReviews.providerIdentity.required).toBe(true);
    expect(detailedReviews.providerIdentity.providerIdsPresent).toBe(false);
  });

  it("keeps Ray-Ban profile behavior compatible with existing provider identities", async () => {
    const { profile } = await resolveProductQuery("Ray-Ban Meta", { now: () => now });
    const plan = buildSignalExecutionPlan(profile, { now: () => now });
    const report = buildSignalExecutionReport(plan);
    const detailedReviews = step(plan, "dataforseo_google_shopping_reviews", "reviews");

    expect(plan.product.productId).toBe(RAY_BAN_META_PRODUCT_ID);
    expect(plan.steps).toHaveLength(5);
    expect(report.summary.plannedSignals).toBe(5);
    expect(report.summary.eligible).toBe(5);
    expect(detailedReviews.providerIdentity.providerIdsPresent).toBe(true);
    expect(detailedReviews.providerIdentity.providerIdFieldsPresent).toEqual([
      "dataDocid",
      "gid",
      "productId",
    ]);
    expectNoExecution(plan);
  });

  it("builds a readable report with route counts", async () => {
    const { profile } = await resolveProductQuery("Claude", { now: () => now });
    const report = buildSignalExecutionReport(buildSignalExecutionPlan(profile, { now: () => now }));

    expect(report.dryRun).toBe(true);
    expect(report.rows).toHaveLength(5);
    expect(report.summary.plannedSignals).toBe(5);
    expect(report.summary.eligible).toBe(3);
    expect(report.summary.blocked).toBe(2);
    expect(report.rows.every((row) => row.executionAllowed === false)).toBe(true);
  });
});
