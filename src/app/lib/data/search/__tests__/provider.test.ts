import { describe, expect, it } from "vitest";
import { merchantProvider, redditProvider, reviewsProvider, socialProvider } from "../../providers";
import { buildProductTrendSnapshotAsync } from "../../snapshotEngine";
import { RAY_BAN_META_PRODUCT_ID } from "../../mockProviderSignals";
import { readSearchProviderConfig, SEARCH_RAY_BAN_ALIASES } from "../config";
import { mockSearchProvider } from "../mockSearchProvider";
import { SearchTrendSignalProvider } from "../provider";
import type {
  SearchInterestClient,
  SearchInterestPoint,
  SearchInterestSeries,
  SearchVolumeClient,
  SearchVolumeSeries,
} from "../types";

const now = new Date("2026-08-12T00:00:00.000Z");

function point(dateFrom: string, dateTo: string, values: number[]): SearchInterestPoint {
  return {
    dateFrom,
    dateTo,
    timestamp: Date.parse(`${dateFrom}T00:00:00.000Z`) / 1000,
    valuesByAlias: SEARCH_RAY_BAN_ALIASES.reduce<Record<string, number>>((mapped, alias, index) => {
      mapped[alias] = values[index] ?? 0;
      return mapped;
    }, {}),
  };
}

function fixtureSeries(points: SearchInterestPoint[]): SearchInterestSeries {
  return {
    provider: "dataforseo",
    productId: RAY_BAN_META_PRODUCT_ID,
    aliases: [...SEARCH_RAY_BAN_ALIASES],
    locationCode: 2840,
    interestType: "web",
    timeRange: "past_30_days",
    fetchedAt: now.toISOString(),
    points,
    averagesByAlias: {},
  };
}

const diagnosticValues: Array<[string, number]> = [
  ["2026-07-13", 22],
  ["2026-07-14", 15],
  ["2026-07-15", 15],
  ["2026-07-16", 25],
  ["2026-07-17", 21],
  ["2026-07-18", 6],
  ["2026-07-19", 9],
  ["2026-07-20", 8],
  ["2026-07-21", 18],
  ["2026-07-22", 20],
  ["2026-07-23", 14],
  ["2026-07-24", 15],
  ["2026-07-25", 50],
  ["2026-07-26", 8],
  ["2026-07-27", 38],
  ["2026-07-28", 32],
  ["2026-07-29", 5],
  ["2026-07-30", 32],
  ["2026-07-31", 15],
  ["2026-08-01", 48],
  ["2026-08-02", 100],
  ["2026-08-03", 72],
  ["2026-08-04", 25],
  ["2026-08-05", 4],
  ["2026-08-06", 1],
  ["2026-08-07", 0],
  ["2026-08-08", 0],
  ["2026-08-09", 0],
  ["2026-08-10", 42],
  ["2026-08-11", 7],
  ["2026-08-12", 1],
];

function successfulDiagnosticSeries(): SearchInterestSeries {
  return fixtureSeries(diagnosticValues.map(([date, value]) => point(date, date, [value])));
}

class FixtureSearchClient implements SearchInterestClient {
  readonly calls: Array<{ aliases: string[]; timeRange: string }> = [];

  constructor(private readonly series: SearchInterestSeries) {}

  async getSearchInterest(input: {
    aliases: string[];
    timeRange: string;
  }): Promise<SearchInterestSeries> {
    this.calls.push({
      aliases: input.aliases,
      timeRange: input.timeRange,
    });

    return this.series;
  }
}

function fixtureVolumeSeries(monthlySearchVolume = 30000): SearchVolumeSeries {
  return {
    provider: "dataforseo",
    productId: RAY_BAN_META_PRODUCT_ID,
    aliases: [...SEARCH_RAY_BAN_ALIASES],
    locationCode: 2840,
    languageCode: "en",
    fetchedAt: now.toISOString(),
    cost: 0.075,
    endpoint: "/v3/keywords_data/google_ads/search_volume/live",
    monthlySearchVolume,
    observations: [
      {
        keyword: "Ray-Ban Meta",
        locationCode: 2840,
        languageCode: "en",
        monthlySearchVolume,
        monthlySearches: [
          { year: 2026, month: 7, searchVolume: monthlySearchVolume },
        ],
      },
    ],
  };
}

class FixtureVolumeClient implements SearchVolumeClient {
  readonly calls: Array<{ aliases: string[]; locationCode: number; languageCode: string }> = [];

  constructor(
    private readonly series?: SearchVolumeSeries,
    private readonly error?: Error
  ) {}

  async getSearchVolume(input: {
    aliases: string[];
    locationCode: number;
    languageCode: string;
  }): Promise<SearchVolumeSeries> {
    this.calls.push({
      aliases: input.aliases,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
    });

    if (this.error) throw this.error;
    if (!this.series) throw new Error("volume unavailable");

    return this.series;
  }
}

function unavailableVolumeClient(): FixtureVolumeClient {
  return new FixtureVolumeClient(undefined, new Error("volume unavailable"));
}

function liveConfig() {
  return readSearchProviderConfig({}, {
    mode: "live",
    apiLogin: "login",
    apiPassword: "password",
    now: () => now,
  });
}

describe("SearchTrendSignalProvider", () => {
  it("falls back to mock when credentials are missing", async () => {
    const client = new FixtureSearchClient(successfulDiagnosticSeries());
    const volumeClient = new FixtureVolumeClient(fixtureVolumeSeries());
    const provider = new SearchTrendSignalProvider(readSearchProviderConfig({}, {
      mode: "live",
      now: () => now,
    }), {
      client,
      volumeClient,
    });

    expect(await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID)).toEqual(
      mockSearchProvider.getSignals(RAY_BAN_META_PRODUCT_ID)
    );
    expect(client.calls).toEqual([]);
    expect(volumeClient.calls).toEqual([]);
  });

  it("uses aliases and returns live search-interest fields with mock fallback fields", async () => {
    const client = new FixtureSearchClient(successfulDiagnosticSeries());
    const provider = new SearchTrendSignalProvider(liveConfig(), {
      client,
      volumeClient: unavailableVolumeClient(),
    });
    const signals = await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    const byEngineField = new Map(signals.map((signal) => [signal.metadata?.engineField, signal]));

    expect(client.calls[0].aliases).toEqual([...SEARCH_RAY_BAN_ALIASES]);
    expect(client.calls[0].timeRange).toBe("past_30_days");
    expect(byEngineField.get("searchVolume7d")?.metadata?.provider).toBe("mock_search_web");
    expect(byEngineField.get("queryShareOfCategoryPercent")?.metadata?.provider).toBe("mock_search_web");
    expect(byEngineField.get("searchGrowthPercent")?.metadata?.provider).toBe("dataforseo_trends");
    expect(byEngineField.get("trendChangePercent")?.metadata?.provider).toBe("dataforseo_trends");
    expect(byEngineField.get("accelerationPercent")?.metadata?.provider).toBe("dataforseo_trends");
    expect(byEngineField.get("consecutiveGrowthDays")?.metadata?.provider).toBe("dataforseo_trends");
    expect(byEngineField.get("consecutiveGrowthDays")?.sourceProvenance.mode).toBe("derived-live");
    expect(provider.getDebugSummary(RAY_BAN_META_PRODUCT_ID)?.current7dInterest).toBe(7.29);
  });

  it("uses live monthly search volume as an explicit derived-live 7-day estimate", async () => {
    const client = new FixtureSearchClient(successfulDiagnosticSeries());
    const volumeClient = new FixtureVolumeClient(fixtureVolumeSeries(30000));
    const provider = new SearchTrendSignalProvider(liveConfig(), {
      client,
      volumeClient,
    });
    const signals = await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    const byEngineField = new Map(signals.map((signal) => [signal.metadata?.engineField, signal]));
    const searchVolume = byEngineField.get("searchVolume7d");

    expect(volumeClient.calls[0]).toEqual({
      aliases: [...SEARCH_RAY_BAN_ALIASES],
      locationCode: 2840,
      languageCode: "en",
    });
    expect(searchVolume?.sourceProvenance.mode).toBe("derived-live");
    expect(searchVolume?.metadata?.provider).toBe("dataforseo_google_ads");
    expect(searchVolume?.metadata?.providerMonthlySearchVolume).toBe(30000);
    expect(searchVolume?.metadata?.monthlyTo7dFormula).toBe("monthlySearchVolume * (7 / 30.4375)");
    expect(searchVolume?.value).toBe(6899);
    expect(byEngineField.get("queryShareOfCategoryPercent")?.sourceProvenance.mode).toBe("fallback");
    expect(byEngineField.get("searchGrowthPercent")?.value).toBe(-82.8);
    expect(byEngineField.get("searchGrowthPercent")?.sourceProvenance.mode).toBe("derived-live");
  });

  it("uses the cache for repeated async live calls", async () => {
    const client = new FixtureSearchClient(successfulDiagnosticSeries());
    const volumeClient = new FixtureVolumeClient(fixtureVolumeSeries());
    const provider = new SearchTrendSignalProvider(liveConfig(), {
      client,
      volumeClient,
    });

    await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);

    expect(client.calls).toHaveLength(1);
    expect(volumeClient.calls).toHaveLength(1);
  });

  it("falls back to mock when returned data is insufficient", async () => {
    const client = new FixtureSearchClient(fixtureSeries([
      point("2026-08-06", "2026-08-12", [70, 0, 0, 0]),
    ]));
    const volumeClient = new FixtureVolumeClient(fixtureVolumeSeries());
    const provider = new SearchTrendSignalProvider(readSearchProviderConfig({}, {
      ...liveConfig(),
      minSampleSize: 8,
    }), {
      client,
      volumeClient,
    });

    expect(await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID)).toEqual(
      mockSearchProvider.getSignals(RAY_BAN_META_PRODUCT_ID)
    );
    expect(provider.getDebugSummary(RAY_BAN_META_PRODUCT_ID)?.hasSufficientData).toBe(false);
    expect(volumeClient.calls).toEqual([]);
  });

  it("integrates live Search Interest with the aggregator and Score Engine without replacing other providers", async () => {
    const client = new FixtureSearchClient(successfulDiagnosticSeries());
    const searchProvider = new SearchTrendSignalProvider(liveConfig(), {
      client,
      volumeClient: unavailableVolumeClient(),
    });
    const snapshot = await buildProductTrendSnapshotAsync(
      RAY_BAN_META_PRODUCT_ID,
      [searchProvider, redditProvider, reviewsProvider, socialProvider, merchantProvider],
      { timestamp: now.toISOString() }
    );

    expect(snapshot.aggregatedSignals.searchMomentum.searchVolume7d).toBe(185000);
    expect(snapshot.aggregatedSignals.searchMomentum.searchGrowthPercent).toBe(-82.8);
    expect(snapshot.aggregatedSignals.growthVelocity.trendChangePercent).toBe(-82.8);
    expect(snapshot.aggregatedSignals.growthVelocity.accelerationPercent).toBe(-165.6);
    expect(snapshot.aggregatedSignals.growthVelocity.consecutiveGrowthDays).toBe(0);
    expect(snapshot.aggregatedSignals.growthVelocity.nonSearchAccelerationPercent).toBeUndefined();
    expect(snapshot.aggregatedSignals.sentiment.positiveMentionPercent).toBe(74);
    expect(snapshot.aggregatedSignals.reviewQuality.averageRating).toBe(4.4);
    expect(snapshot.aggregatedSignals.purchaseIntent.buyingKeywordSharePercent).toBe(26);
    expect(snapshot.trendIQScore.scoreVersion).toBe("v1.1");
    expect(snapshot.trendIQScore.score).toBeGreaterThan(0);

    const growthComponent = snapshot.liveDataAudit?.componentSummaries.find((component) =>
      component.component === "growthVelocity"
    );
    expect(growthComponent?.fields.every((field) => field.provenance === "derived-live")).toBe(true);
    expect(growthComponent?.liveCoveragePercent).toBe(100);
  });

  it("integrates live Search Volume without changing DataForSEO Trends growth or category-share fallback", async () => {
    const client = new FixtureSearchClient(successfulDiagnosticSeries());
    const searchProvider = new SearchTrendSignalProvider(liveConfig(), {
      client,
      volumeClient: new FixtureVolumeClient(fixtureVolumeSeries(30000)),
    });
    const snapshot = await buildProductTrendSnapshotAsync(
      RAY_BAN_META_PRODUCT_ID,
      [searchProvider, redditProvider, reviewsProvider, socialProvider, merchantProvider],
      { timestamp: now.toISOString() }
    );
    const searchComponent = snapshot.liveDataAudit?.componentSummaries.find((component) =>
      component.component === "searchMomentum"
    );

    expect(snapshot.aggregatedSignals.searchMomentum.searchVolume7d).toBe(6899);
    expect(snapshot.aggregatedSignals.searchMomentum.searchGrowthPercent).toBe(-82.8);
    expect(snapshot.aggregatedSignals.searchMomentum.queryShareOfCategoryPercent).toBe(18);
    expect(snapshot.trendIQScore.scoreVersion).toBe("v1.1");
    expect(searchComponent?.fields.find((field) =>
      field.engineField === "searchVolume7d"
    )?.provenance).toBe("derived-live");
    expect(searchComponent?.fields.find((field) =>
      field.engineField === "searchGrowthPercent"
    )?.provenance).toBe("derived-live");
    expect(searchComponent?.fields.find((field) =>
      field.engineField === "queryShareOfCategoryPercent"
    )?.provenance).toBe("fallback");
  });

  it("keeps mock Growth Velocity fields when live Search Interest is insufficient", async () => {
    const client = new FixtureSearchClient(fixtureSeries([
      point("2026-08-06", "2026-08-12", [70, 0, 0, 0]),
    ]));
    const searchProvider = new SearchTrendSignalProvider(readSearchProviderConfig({}, {
      ...liveConfig(),
      minSampleSize: 8,
    }), {
      client,
      volumeClient: new FixtureVolumeClient(fixtureVolumeSeries()),
    });
    const snapshot = await buildProductTrendSnapshotAsync(
      RAY_BAN_META_PRODUCT_ID,
      [searchProvider, redditProvider, reviewsProvider, socialProvider, merchantProvider],
      { timestamp: now.toISOString() }
    );

    expect(snapshot.aggregatedSignals.growthVelocity.trendChangePercent).toBe(34.2);
    expect(snapshot.aggregatedSignals.growthVelocity.accelerationPercent).toBe(18);
    expect(snapshot.aggregatedSignals.growthVelocity.consecutiveGrowthDays).toBe(5);

    const growthComponent = snapshot.liveDataAudit?.componentSummaries.find((component) =>
      component.component === "growthVelocity"
    );
    expect(growthComponent?.provenance).toBe("mock");
    expect(growthComponent?.liveCoveragePercent).toBe(0);
  });
});
