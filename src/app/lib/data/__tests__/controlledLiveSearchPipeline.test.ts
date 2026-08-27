import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  InMemorySignalExecutionStateStore,
  type SignalExecutionPlan,
  type SignalExecutionStep,
} from "../capabilities";
import {
  createScopedSignalExecutionApproval,
  runControlledLiveSearchToScore,
} from "../controlledLiveSearchPipeline";
import { readSearchProviderConfig } from "../search/config";
import type {
  SearchInterestClient,
  SearchInterestSeries,
  SearchInterestType,
  SearchInterestTimeRange,
} from "../search/types";

const now = new Date("2026-08-12T00:00:00.000Z");

function isoDate(offsetDays: number): string {
  const date = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function fixtureSeries(input: {
  productId: string;
  aliases: string[];
  locationCode: number;
  interestType: SearchInterestType;
  timeRange: SearchInterestTimeRange;
}): SearchInterestSeries {
  const points = Array.from({ length: 21 }, (_, index) => {
    const offset = -20 + index;
    const date = isoDate(offset);
    const value = offset <= -14
      ? 18 + index
      : offset <= -7
        ? 30 + (index % 3)
        : 64 + index;

    return {
      dateFrom: date,
      dateTo: date,
      timestamp: Date.parse(`${date}T00:00:00.000Z`) / 1000,
      valuesByAlias: Object.fromEntries(input.aliases.map((alias) => [alias, value])),
    };
  });

  return {
    provider: "dataforseo",
    productId: input.productId,
    aliases: input.aliases,
    locationCode: input.locationCode,
    interestType: input.interestType,
    timeRange: input.timeRange,
    fetchedAt: now.toISOString(),
    cost: 0.0012,
    points,
    averagesByAlias: Object.fromEntries(input.aliases.map((alias) => [alias, 42])),
  };
}

function sparseCurrentZeroSeries(input: {
  productId: string;
  aliases: string[];
  locationCode: number;
  interestType: SearchInterestType;
  timeRange: SearchInterestTimeRange;
}): SearchInterestSeries {
  const previous = Array.from({ length: 7 }, (_, index) => {
    const date = isoDate(-13 + index);

    return {
      dateFrom: date,
      dateTo: date,
      timestamp: Date.parse(`${date}T00:00:00.000Z`) / 1000,
      valuesByAlias: Object.fromEntries(input.aliases.map((alias) => [alias, 50])),
    };
  });
  const currentDate = isoDate(0);

  return {
    provider: "dataforseo",
    productId: input.productId,
    aliases: input.aliases,
    locationCode: input.locationCode,
    interestType: input.interestType,
    timeRange: input.timeRange,
    fetchedAt: now.toISOString(),
    cost: 0.0012,
    points: [
      ...previous,
      {
        dateFrom: currentDate,
        dateTo: currentDate,
        timestamp: Date.parse(`${currentDate}T00:00:00.000Z`) / 1000,
        valuesByAlias: Object.fromEntries(input.aliases.map((alias) => [alias, 0])),
      },
    ],
    averagesByAlias: Object.fromEntries(input.aliases.map((alias) => [alias, 42])),
  };
}

class FixtureTrendsClient implements SearchInterestClient {
  readonly calls: Array<{
    productId: string;
    aliases: string[];
    locationCode: number;
    interestType: SearchInterestType;
    timeRange: SearchInterestTimeRange;
  }> = [];

  constructor(private readonly buildSeries = fixtureSeries) {}

  async getSearchInterest(input: {
    productId: string;
    aliases: string[];
    locationCode: number;
    interestType: SearchInterestType;
    timeRange: SearchInterestTimeRange;
  }): Promise<SearchInterestSeries> {
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

function approvalsFor(
  plan: SignalExecutionPlan,
  steps: SignalExecutionStep[],
  prefix = "exec"
) {
  return steps.map((step) =>
    createScopedSignalExecutionApproval({
      plan,
      step,
      executionId: `${prefix}:${step.signal}`,
      approvedAt: now.toISOString(),
      maxOperations: 1,
    })
  );
}

describe("controlled live search-to-score pipeline", () => {
  it("resolves a never-seen Garmin product and scores controlled DataForSEO Trends search and growth signals", async () => {
    const client = new FixtureTrendsClient();
    const result = await runControlledLiveSearchToScore({
      query: "Garmin Venu 4",
      searchClient: client,
      searchConfig: searchConfig(),
      stateStore: new InMemorySignalExecutionStateStore(),
      now: () => now,
      approve: ({ plan, trendsSteps }) => approvalsFor(plan, trendsSteps),
    });
    const execution = result.executionResults[0];
    const sources = result.snapshot.provenance.sources.map((source) => source.source);
    const detailedReviews = result.plan.steps.find((step) =>
      step.provider === "dataforseo_google_shopping_reviews"
    );

    expect(result.resolution.profile.source).toBe("user_search");
    expect(result.resolution.profile.productId).toBe("user-search-garmin-venu-4");
    expect(result.identity.status).toBe("resolved");
    expect(result.identity.providerIds).toEqual({});
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].productId).toBe("user-search-garmin-venu-4");
    expect(client.calls[0].aliases).toEqual(["Garmin Venu 4"]);
    expect(execution.status).toBe("completed");
    expect(execution.operationCount).toBe(1);
    expect(execution.paidLiveOperationsPerformed).toBe(1);
    expect(result.rawSignals.some((signal) => signal.signalType === "searchMomentum")).toBe(true);
    expect(result.rawSignals.some((signal) => signal.signalType === "growthVelocity")).toBe(true);
    expect(result.rawSignals.every((signal) => signal.source !== "reddit")).toBe(true);
    expect(result.rawSignals.every((signal) => signal.sourceProvenance.provider === "dataforseo_trends")).toBe(true);
    expect(result.rawSignals.every((signal) => signal.sourceProvenance.approvalStatus === "approved")).toBe(true);
    expect(result.rawSignals.every((signal) => signal.sourceProvenance.liveApiRequestMade === true)).toBe(true);
    expect(sources).toEqual(["searchWeb"]);
    expect(result.snapshot.trendIQScore.scoreVersion).toBe("v1.1");
    expect(result.snapshot.trendIQScore.score).toBeGreaterThan(0);
    expect(result.snapshot.confidence.score).toBeGreaterThan(0);
    expect(result.snapshot.trendStatus.changePercent).toBeGreaterThan(0);
    expect(result.snapshot.liveDataAudit?.liveComponents).toEqual(["searchMomentum", "growthVelocity"]);
    expect(result.snapshot.liveDataAudit?.liveCoveragePercent).toBeGreaterThan(0);
    expect(detailedReviews?.futureExecutionEligibility).toBe("needs_identity");
    expect(detailedReviews?.blockReason).toBe("needs_provider_identity");
  });

  it("does not emit growth signals from a Trends request unless the growth plan step is explicitly approved", async () => {
    const client = new FixtureTrendsClient();
    const result = await runControlledLiveSearchToScore({
      query: "Garmin Venu 4",
      searchClient: client,
      searchConfig: searchConfig(),
      stateStore: new InMemorySignalExecutionStateStore(),
      now: () => now,
      approve: ({ plan, primaryStep }) => approvalsFor(plan, [primaryStep]),
    });

    expect(client.calls).toHaveLength(1);
    expect(result.producedSteps.map((step) => step.signal)).toEqual(["search_momentum_trends"]);
    expect(result.rawSignals.every((signal) => signal.signalType === "searchMomentum")).toBe(true);
    expect(result.rawSignals.some((signal) => signal.signalType === "growthVelocity")).toBe(false);
    expect(result.snapshot.trendStatus.changePercent).toBe(0);
  });

  it("blocks missing approval before invoking the DataForSEO client and still returns an honest empty scored snapshot", async () => {
    const client = new FixtureTrendsClient();
    const result = await runControlledLiveSearchToScore({
      query: "Garmin Venu 4",
      searchClient: client,
      searchConfig: searchConfig(),
      stateStore: new InMemorySignalExecutionStateStore(),
      now: () => now,
    });

    expect(result.executionResults[0].status).toBe("blocked");
    expect(result.executionResults[0].blockReason).toBe("explicit_live_approval_required");
    expect(client.calls).toHaveLength(0);
    expect(result.rawSignals).toEqual([]);
    expect(result.snapshot.rawSignals).toEqual([]);
    expect(result.snapshot.trendIQScore.scoreVersion).toBe("v1.1");
    expect(result.snapshot.provenance.sources).toEqual([]);
  });

  it("blocks approved execution without state-store duplicate protection before invoking the client", async () => {
    const client = new FixtureTrendsClient();
    const result = await runControlledLiveSearchToScore({
      query: "Garmin Venu 4",
      searchClient: client,
      searchConfig: searchConfig(),
      now: () => now,
      approve: ({ plan, primaryStep }) => approvalsFor(plan, [primaryStep]),
    });

    expect(result.executionResults[0].status).toBe("blocked");
    expect(result.executionResults[0].blockReason).toBe("execution_state_store_required");
    expect(client.calls).toHaveLength(0);
  });

  it("prevents duplicate approved executions from invoking the DataForSEO client twice", async () => {
    const client = new FixtureTrendsClient();
    const stateStore = new InMemorySignalExecutionStateStore();
    const options = {
      query: "Garmin Venu 4",
      searchClient: client,
      searchConfig: searchConfig(),
      stateStore,
      now: () => now,
      approve: ({ plan, primaryStep }: { plan: SignalExecutionPlan; primaryStep: SignalExecutionStep }) =>
        approvalsFor(plan, [primaryStep], "duplicate"),
    };

    const first = await runControlledLiveSearchToScore(options);
    const second = await runControlledLiveSearchToScore(options);

    expect(first.executionResults[0].status).toBe("completed");
    expect(second.executionResults[0].status).toBe("blocked");
    expect(second.executionResults[0].blockReason).toBe("duplicate_execution");
    expect(client.calls).toHaveLength(1);
  });

  it("keeps Reddit unavailable for unseen products without fabricating community signals", async () => {
    const client = new FixtureTrendsClient();
    const result = await runControlledLiveSearchToScore({
      query: "Garmin Venu 4",
      searchClient: client,
      searchConfig: searchConfig(),
      stateStore: new InMemorySignalExecutionStateStore(),
      now: () => now,
      approve: ({ plan, trendsSteps }) => approvalsFor(plan, trendsSteps),
    });

    expect(result.rawSignals.some((signal) => signal.source === "reddit")).toBe(false);
    expect(result.snapshot.provenance.sources.some((source) => source.source === "reddit")).toBe(false);
    expect(result.snapshot.confidence.components.sourceDiversity).toBe(0);
    expect(result.snapshot.confidence.components.dataCompleteness).toBeLessThan(25);
    expect(result.snapshot.liveDataAudit?.reddit).toEqual({
      mode: "mock/fallback",
      approvalStatus: "pending",
      liveApiRequestMade: false,
    });
  });

  it("does not score sparse zero Trends evidence as a confirmed live decline", async () => {
    const client = new FixtureTrendsClient(sparseCurrentZeroSeries);
    const result = await runControlledLiveSearchToScore({
      query: "Garmin Venu 4",
      searchClient: client,
      searchConfig: searchConfig(),
      stateStore: new InMemorySignalExecutionStateStore(),
      now: () => now,
      approve: ({ plan, trendsSteps }) => approvalsFor(plan, trendsSteps),
    });
    const execution = result.executionResults[0];

    expect(execution.status).toBe("completed");
    expect(execution.operationCount).toBe(1);
    expect(execution.paidLiveOperationsPerformed).toBe(1);
    expect(execution.metadata?.current7dEvidenceQuality).toBe("sparse");
    expect(execution.metadata?.change7dEvidenceQuality).toBe("sparse");
    expect(execution.metadata?.hasSufficientData).toBe(false);
    expect(result.rawSignals.some((signal) => signal.value === -100)).toBe(false);
    expect(result.rawSignals.some((signal) => signal.metadata?.engineField === "searchGrowthPercent")).toBe(false);
    expect(result.rawSignals.some((signal) => signal.metadata?.engineField === "trendChangePercent")).toBe(false);
    expect(result.rawSignals.some((signal) => signal.metadata?.engineField === "accelerationPercent")).toBe(false);
    expect(result.snapshot.aggregatedSignals.searchMomentum.searchGrowthPercent).toBe(0);
    expect(result.snapshot.aggregatedSignals.growthVelocity.trendChangePercent).toBe(0);
    expect(result.snapshot.aggregatedSignals.growthVelocity.searchDerivedTrendChangePercent).toBeUndefined();
  });

  it("keeps the controlled executor provider-agnostic while the Trends adapter owns provider imports", () => {
    const executorSource = readFileSync(new URL("../capabilities/signalExecutor.ts", import.meta.url), "utf8");
    const adapterSource = readFileSync(new URL("../capabilities/dataForSeoTrendsAdapter.ts", import.meta.url), "utf8");

    expect(executorSource).not.toContain("DataForSeo");
    expect(executorSource).not.toContain("../search");
    expect(executorSource).not.toContain("fetch(");
    expect(adapterSource).toContain("DataForSeoTrendsClient");
    expect(adapterSource).toContain("buildSearchSignalsFromSeries");
  });
});
