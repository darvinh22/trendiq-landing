import { describe, expect, it, vi } from "vitest";
import {
  InMemorySignalExecutionStateStore,
  buildSignalExecutionPlan,
  createUserSearchProductProfile,
  executeApprovedSignal,
  resolveProductQuery,
} from "../index";
import { createDataForSeoGoogleAdsSearchVolumeExecutionAdapter } from "../dataForSeoGoogleAdsSearchVolumeAdapter";
import type {
  SignalExecutionApproval,
  SignalExecutionPlan,
  SignalExecutionStep,
} from "../types";
import { readSearchProviderConfig } from "../../search/config";
import type { SearchVolumeClient, SearchVolumeSeries } from "../../search/types";

const now = new Date("2026-08-24T12:00:00.000Z");

function searchVolumeStep(plan: SignalExecutionPlan): SignalExecutionStep {
  const step = plan.steps.find((candidate) =>
    candidate.provider === "dataforseo_google_ads" && candidate.signal === "search_volume_google_ads"
  );

  expect(step).toBeDefined();
  return step!;
}

function approval(
  plan: SignalExecutionPlan,
  step: SignalExecutionStep,
  overrides: Partial<SignalExecutionApproval> = {}
): SignalExecutionApproval {
  return {
    approved: true,
    executionId: "phase-3t-google-ads-search-volume",
    planId: plan.planId,
    stepId: step.stepId,
    signal: step.signal,
    provider: step.provider,
    capability: step.capability,
    productId: plan.product.productId,
    canonicalProduct: plan.product.canonicalTitle,
    query: plan.product.query,
    approvedAt: now.toISOString(),
    maxOperations: 1,
    ...overrides,
  };
}

function volumeSeries(input: {
  productId: string;
  aliases: string[];
  locationCode: number;
  languageCode: string;
  monthlySearchVolume?: number;
  observations?: SearchVolumeSeries["observations"];
}): SearchVolumeSeries {
  const monthlySearchVolume = input.monthlySearchVolume ?? 12000;
  const observations = input.observations ?? input.aliases.map((alias) => ({
    keyword: alias,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    monthlySearchVolume,
    monthlySearches: [
      { year: 2026, month: 7, searchVolume: monthlySearchVolume },
    ],
  }));

  return {
    provider: "dataforseo",
    productId: input.productId,
    aliases: input.aliases,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    fetchedAt: now.toISOString(),
    cost: 0.075,
    endpoint: "/v3/keywords_data/google_ads/search_volume/live",
    monthlySearchVolume: observations.reduce((sum, observation) => sum + observation.monthlySearchVolume, 0),
    observations,
  };
}

class FixtureSearchVolumeClient implements SearchVolumeClient {
  readonly calls: Array<{
    productId: string;
    aliases: string[];
    locationCode: number;
    languageCode: string;
  }> = [];

  constructor(private readonly buildSeries = volumeSeries) {}

  async getSearchVolume(input: {
    productId: string;
    aliases: string[];
    locationCode: number;
    languageCode: string;
  }): Promise<SearchVolumeSeries> {
    this.calls.push(input);
    return this.buildSeries(input);
  }
}

function searchConfig() {
  return readSearchProviderConfig({}, {
    mode: "live",
    apiLogin: "login",
    apiPassword: "password",
    now: () => now,
  });
}

describe("DataForSEO Google Ads Search Volume controlled adapter", () => {
  it("executes an approved Garmin search-volume step through the injected client exactly once", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const plan = buildSignalExecutionPlan(profile, { now: () => now });
    const step = searchVolumeStep(plan);
    const client = new FixtureSearchVolumeClient();
    const adapter = createDataForSeoGoogleAdsSearchVolumeExecutionAdapter({
      step,
      client,
      config: searchConfig(),
      now: () => now,
    });
    const result = await executeApprovedSignal({
      plan,
      step,
      approval: approval(plan, step),
      adapter,
      stateStore: new InMemorySignalExecutionStateStore(),
      now: () => now,
    });
    const searchVolume7d = result.signals.find((signal) => signal.metadata?.engineField === "searchVolume7d");

    expect(client.calls).toEqual([
      {
        productId: "user-search-garmin-venu-4",
        aliases: ["Garmin Venu 4"],
        locationCode: 2840,
        languageCode: "en",
      },
    ]);
    expect(result.status).toBe("completed");
    expect(result.provider).toBe("dataforseo_google_ads");
    expect(result.signal).toBe("search_volume_google_ads");
    expect(result.operationCount).toBe(1);
    expect(result.httpRequestCount).toBe(1);
    expect(result.paidLiveOperationsPerformed).toBe(1);
    expect(result.reportedProviderCost).toBe(0.075);
    expect(result.signals).toHaveLength(2);
    expect(result.signals.every((signal) => signal.sourceProvenance.provider === "dataforseo_google_ads")).toBe(true);
    expect(result.signals.every((signal) => signal.sourceProvenance.approvalStatus === "approved")).toBe(true);
    expect(searchVolume7d?.value).toBe(2760);
    expect(searchVolume7d?.metadata?.controlledExecutionId).toBe("phase-3t-google-ads-search-volume");
    expect(result.metadata).toMatchObject({
      provider: "dataforseo_google_ads",
      adapter: "dataforseo_google_ads_search_volume",
      approvedSignal: "search_volume_google_ads",
      approvedExactQuery: "Garmin Venu 4",
      approvedQueryCount: 1,
      observationsEmitted: 1,
      monthlySearchVolume: 12000,
      estimated7dSearchVolume: 2760,
    });
  });

  it("does not execute broader measurement candidates as hidden query fan-out", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const plan = buildSignalExecutionPlan(profile, { now: () => now });
    const step = searchVolumeStep(plan);
    const client = new FixtureSearchVolumeClient();
    const adapter = createDataForSeoGoogleAdsSearchVolumeExecutionAdapter({
      step,
      client,
      config: searchConfig(),
      now: () => now,
    });

    await executeApprovedSignal({
      plan,
      step,
      approval: approval(plan, step),
      adapter,
      stateStore: new InMemorySignalExecutionStateStore(),
      now: () => now,
    });

    expect(plan.product.measurementQueries?.map((candidate) => candidate.query)).toEqual([
      "Garmin Venu 4",
      "Venu 4",
      "Garmin Venu",
    ]);
    expect(client.calls[0].aliases).toEqual(["Garmin Venu 4"]);
    expect(client.calls[0].aliases).not.toContain("Venu 4");
    expect(client.calls[0].aliases).not.toContain("Garmin Venu");
  });

  it("ignores provider-returned observations outside the approved exact query scope", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const plan = buildSignalExecutionPlan(profile, { now: () => now });
    const step = searchVolumeStep(plan);
    const client = new FixtureSearchVolumeClient((input) => volumeSeries({
      ...input,
      observations: [
        {
          keyword: "Garmin Venu",
          locationCode: input.locationCode,
          languageCode: input.languageCode,
          monthlySearchVolume: 99000,
          monthlySearches: [
            { year: 2026, month: 7, searchVolume: 99000 },
          ],
        },
      ],
    }));
    const adapter = createDataForSeoGoogleAdsSearchVolumeExecutionAdapter({
      step,
      client,
      config: searchConfig(),
      now: () => now,
    });

    const result = await executeApprovedSignal({
      plan,
      step,
      approval: approval(plan, step),
      adapter,
      stateStore: new InMemorySignalExecutionStateStore(),
      now: () => now,
    });

    expect(result.status).toBe("completed");
    expect(result.paidLiveOperationsPerformed).toBe(1);
    expect(result.signals).toEqual([]);
    expect(result.metadata?.observationsReturned).toBe(1);
    expect(result.metadata?.observationsEmitted).toBe(0);
    expect(result.metadata?.monthlySearchVolume).toBe(0);
    expect(result.warnings).toContain(
      "DataForSEO Google Ads returned keyword observations outside the approved exact query scope; they were not emitted."
    );
    expect(result.warnings).toContain(
      "DataForSEO Google Ads returned no usable observation for the approved exact query."
    );
  });

  it("rejects non-Google Ads search-volume plan steps before a client is provided", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const plan = buildSignalExecutionPlan(profile, { now: () => now });
    const trendsStep = plan.steps.find((candidate) => candidate.provider === "dataforseo_trends");

    expect(trendsStep).toBeDefined();
    expect(() =>
      createDataForSeoGoogleAdsSearchVolumeExecutionAdapter({
        step: trendsStep!,
        client: new FixtureSearchVolumeClient(),
        config: searchConfig(),
      })
    ).toThrow("dataforseo_google_ads search-volume plan step");
  });

  it("does not invoke fetch when an injected search-volume client is used", async () => {
    const profile = createUserSearchProductProfile("Acme Widget 3", {
      brand: "Acme",
      productType: "hardware",
      modelGeneration: "Widget 3",
      identityConfidence: "medium",
    });
    const plan = buildSignalExecutionPlan(profile, { now: () => now });
    const step = searchVolumeStep(plan);
    const client = new FixtureSearchVolumeClient();
    const fetchSpy = vi.fn(() => {
      throw new Error("fetch must not run when the adapter receives an injected client");
    });
    const originalFetch = globalThis.fetch;

    Object.defineProperty(globalThis, "fetch", {
      value: fetchSpy,
      configurable: true,
    });

    try {
      const adapter = createDataForSeoGoogleAdsSearchVolumeExecutionAdapter({
        step,
        client,
        config: searchConfig(),
        now: () => now,
      });

      await executeApprovedSignal({
        plan,
        step,
        approval: approval(plan, step),
        adapter,
        stateStore: new InMemorySignalExecutionStateStore(),
        now: () => now,
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(client.calls).toHaveLength(1);
      expect(client.calls[0].aliases).toEqual(["Acme Widget 3"]);
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        value: originalFetch,
        configurable: true,
      });
    }
  });
});
