import { describe, expect, it } from "vitest";
import { merchantProvider, redditProvider, reviewsProvider, socialProvider } from "../../providers";
import { buildProductTrendSnapshotAsync } from "../../snapshotEngine";
import { RAY_BAN_META_PRODUCT_ID } from "../../mockProviderSignals";
import { readSearchProviderConfig, SEARCH_RAY_BAN_ALIASES } from "../config";
import { mockSearchProvider } from "../mockSearchProvider";
import { SearchTrendSignalProvider } from "../provider";
import type { SearchInterestClient, SearchInterestPoint, SearchInterestSeries } from "../types";

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
    const provider = new SearchTrendSignalProvider(readSearchProviderConfig({}, {
      mode: "live",
      now: () => now,
    }), {
      client,
    });

    expect(await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID)).toEqual(
      mockSearchProvider.getSignals(RAY_BAN_META_PRODUCT_ID)
    );
    expect(client.calls).toEqual([]);
  });

  it("uses aliases and returns live search-interest fields with mock fallback fields", async () => {
    const client = new FixtureSearchClient(successfulDiagnosticSeries());
    const provider = new SearchTrendSignalProvider(liveConfig(), {
      client,
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
    expect(provider.getDebugSummary(RAY_BAN_META_PRODUCT_ID)?.current7dInterest).toBe(7.29);
  });

  it("uses the cache for repeated async live calls", async () => {
    const client = new FixtureSearchClient(successfulDiagnosticSeries());
    const provider = new SearchTrendSignalProvider(liveConfig(), {
      client,
    });

    await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);

    expect(client.calls).toHaveLength(1);
  });

  it("falls back to mock when returned data is insufficient", async () => {
    const client = new FixtureSearchClient(fixtureSeries([
      point("2026-08-06", "2026-08-12", [70, 0, 0, 0]),
    ]));
    const provider = new SearchTrendSignalProvider(readSearchProviderConfig({}, {
      ...liveConfig(),
      minSampleSize: 8,
    }), {
      client,
    });

    expect(await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID)).toEqual(
      mockSearchProvider.getSignals(RAY_BAN_META_PRODUCT_ID)
    );
    expect(provider.getDebugSummary(RAY_BAN_META_PRODUCT_ID)?.hasSufficientData).toBe(false);
  });

  it("integrates live Search Interest with the aggregator and Score Engine without replacing other providers", async () => {
    const client = new FixtureSearchClient(successfulDiagnosticSeries());
    const searchProvider = new SearchTrendSignalProvider(liveConfig(), {
      client,
    });
    const snapshot = await buildProductTrendSnapshotAsync(
      RAY_BAN_META_PRODUCT_ID,
      [searchProvider, redditProvider, reviewsProvider, socialProvider, merchantProvider],
      { timestamp: now.toISOString() }
    );

    expect(snapshot.aggregatedSignals.searchMomentum.searchVolume7d).toBe(185000);
    expect(snapshot.aggregatedSignals.searchMomentum.searchGrowthPercent).toBe(-82.8);
    expect(snapshot.aggregatedSignals.sentiment.positiveMentionPercent).toBe(74);
    expect(snapshot.aggregatedSignals.reviewQuality.averageRating).toBe(4.4);
    expect(snapshot.aggregatedSignals.purchaseIntent.buyingKeywordSharePercent).toBe(26);
    expect(snapshot.trendIQScore.scoreVersion).toBe("v1.1");
    expect(snapshot.trendIQScore.score).toBeGreaterThan(0);
  });
});
