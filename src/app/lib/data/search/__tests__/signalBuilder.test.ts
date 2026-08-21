import { describe, expect, it } from "vitest";
import { SEARCH_RAY_BAN_ALIASES } from "../config";
import { buildSearchSignalsFromSeries } from "../signalBuilder";
import type { SearchInterestPoint, SearchInterestSeries } from "../types";

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

function series(points: SearchInterestPoint[]): SearchInterestSeries {
  return {
    provider: "dataforseo",
    productId: "ray-ban-meta",
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

function diagnosticSeries(): SearchInterestSeries {
  return series(diagnosticValues.map(([date, value]) => point(date, date, [value])));
}

describe("search signal builder", () => {
  it("builds Search Interest signals for search momentum and growth velocity", () => {
    const result = buildSearchSignalsFromSeries({
      productId: "ray-ban-meta",
      series: diagnosticSeries(),
      now,
      minSampleSize: 2,
    });
    const searchGrowth = result.signals.find((signal) => signal.metadata?.engineField === "searchGrowthPercent");
    const trendChange = result.signals.find((signal) => signal.metadata?.engineField === "trendChangePercent");
    const acceleration = result.signals.find((signal) => signal.metadata?.engineField === "accelerationPercent");
    const consecutiveGrowthDays = result.signals.find((signal) =>
      signal.metadata?.engineField === "consecutiveGrowthDays"
    );

    expect(result.summary.current7dInterest).toBe(7.29);
    expect(result.summary.previous7dInterest).toBe(42.29);
    expect(result.summary.prior7dInterest).toBe(23.14);
    expect(result.summary.change7dPercent).toBe(-82.8);
    expect(result.summary.baselineReadiness).toBe(1);
    expect(result.summary.lowBaseGrowth).toBe(false);
    expect(result.summary.previous7dChangePercent).toBe(82.8);
    expect(result.summary.change30dPercent).toBeUndefined();
    expect(result.summary.accelerationPercent).toBeCloseTo(-165.6);
    expect(result.summary.consecutiveGrowthDays).toBe(0);
    expect(result.summary.hasSufficientData).toBe(true);
    expect(searchGrowth?.metadata?.engineValue).toBe(-82.8);
    expect(searchGrowth?.metadata?.providerMetric).toBe("searchInterestGrowth7d");
    expect(trendChange?.metadata?.engineValue).toBe(-82.8);
    expect(trendChange?.metadata?.searchDerived).toBe(true);
    expect(acceleration?.metadata?.engineValue).toBeCloseTo(-165.6);
    expect(acceleration?.metadata?.searchDerived).toBe(true);
    expect(consecutiveGrowthDays?.metadata?.engineValue).toBe(0);
    expect(consecutiveGrowthDays?.metadata?.providerMetric).toBe("searchInterestConsecutiveGrowthDays");
    expect(consecutiveGrowthDays?.sourceProvenance.mode).toBe("derived-live");
    expect(consecutiveGrowthDays?.metadata?.searchDerived).toBe(true);

    for (const signal of result.signals) {
      expect(signal.source).toBe("searchWeb");
      expect(signal.normalizedValue).toBeGreaterThanOrEqual(0);
      expect(signal.normalizedValue).toBeLessThanOrEqual(100);
      expect(signal.metadata?.provider).toBe("dataforseo_trends");
      expect(signal.metadata?.aliasesUsed).toContain("Ray-Ban Meta");
    }
  });

  it("calculates trailing consecutive growth days from the live daily series", () => {
    const result = buildSearchSignalsFromSeries({
      productId: "ray-ban-meta",
      series: series([
        ...["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"]
          .map((date, index) => point(date, date, [index + 1])),
        ...["2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12"]
          .map((date, index) => point(date, date, [index + 8])),
      ]),
      now,
      minSampleSize: 2,
    });
    const consecutiveGrowthDays = result.signals.find((signal) =>
      signal.metadata?.providerMetric === "searchInterestConsecutiveGrowthDays"
    );

    expect(result.summary.consecutiveGrowthDays).toBe(7);
    expect(consecutiveGrowthDays?.metadata?.engineField).toBe("consecutiveGrowthDays");
    expect(consecutiveGrowthDays?.metadata?.engineValue).toBe(7);
    expect(consecutiveGrowthDays?.normalizedValue).toBe(100);
  });

  it("omits live acceleration when the prior 7-day window is unavailable", () => {
    const result = buildSearchSignalsFromSeries({
      productId: "ray-ban-meta",
      series: series([
        point("2026-07-30", "2026-07-30", [32]),
        point("2026-07-31", "2026-07-31", [15]),
        point("2026-08-01", "2026-08-01", [48]),
        point("2026-08-02", "2026-08-02", [100]),
        point("2026-08-03", "2026-08-03", [72]),
        point("2026-08-04", "2026-08-04", [25]),
        point("2026-08-05", "2026-08-05", [4]),
        point("2026-08-06", "2026-08-06", [1]),
        point("2026-08-07", "2026-08-07", [0]),
        point("2026-08-08", "2026-08-08", [0]),
        point("2026-08-09", "2026-08-09", [0]),
        point("2026-08-10", "2026-08-10", [42]),
        point("2026-08-11", "2026-08-11", [7]),
        point("2026-08-12", "2026-08-12", [1]),
      ]),
      now,
      minSampleSize: 2,
    });

    expect(result.summary.hasSufficientData).toBe(true);
    expect(result.summary.accelerationPercent).toBeUndefined();
    expect(result.summary.consecutiveGrowthDays).toBe(0);
    expect(result.signals.some((signal) => signal.metadata?.engineField === "accelerationPercent")).toBe(false);
    expect(result.signals.some((signal) => signal.metadata?.engineField === "trendChangePercent")).toBe(true);
    expect(result.signals.some((signal) => signal.metadata?.engineField === "consecutiveGrowthDays")).toBe(true);
  });

  it("marks Ray-Ban low-base growth as provisional and reduces provider-normalized growth credit", () => {
    const result = buildSearchSignalsFromSeries({
      productId: "ray-ban-meta",
      series: series([
        ...["2026-07-23", "2026-07-24", "2026-07-25", "2026-07-26", "2026-07-27", "2026-07-28", "2026-07-29"]
          .map((date) => point(date, date, [1.29])),
        ...["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"]
          .map((date) => point(date, date, [1.71])),
        ...["2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12"]
          .map((date) => point(date, date, [18])),
      ]),
      now,
      minSampleSize: 2,
    });
    const growth = result.signals.find((signal) => signal.metadata?.providerMetric === "searchInterestGrowth7d");

    expect(result.summary.previous7dInterest).toBe(1.71);
    expect(result.summary.current7dInterest).toBe(18);
    expect(result.summary.change7dPercent).toBe(952.6);
    expect(result.summary.baselineReadiness).toBe(0.171);
    expect(result.summary.lowBaseGrowth).toBe(true);
    expect(growth?.metadata?.rawNormalizedGrowthScore).toBe(100);
    expect(growth?.normalizedValue).toBe(17.1);
    expect(growth?.metadata?.current7dRelativeInterest).toBe(18);
    expect(growth?.metadata?.previous7dRelativeInterest).toBe(1.71);
  });

  it("keeps full baseline readiness at and above the threshold", () => {
    const result = buildSearchSignalsFromSeries({
      productId: "ray-ban-meta",
      series: series([
        ...["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"]
          .map((date) => point(date, date, [10])),
        ...["2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12"]
          .map((date) => point(date, date, [20])),
      ]),
      now,
      minSampleSize: 2,
    });

    expect(result.summary.previous7dInterest).toBe(10);
    expect(result.summary.baselineReadiness).toBe(1);
    expect(result.summary.lowBaseGrowth).toBe(false);
  });

  it("preserves strong growth from a meaningful baseline", () => {
    const result = buildSearchSignalsFromSeries({
      productId: "ray-ban-meta",
      series: series([
        ...["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"]
          .map((date) => point(date, date, [30])),
        ...["2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12"]
          .map((date) => point(date, date, [60])),
      ]),
      now,
      minSampleSize: 2,
    });
    const growth = result.signals.find((signal) => signal.metadata?.providerMetric === "searchInterestGrowth7d");

    expect(result.summary.change7dPercent).toBe(100);
    expect(result.summary.baselineReadiness).toBe(1);
    expect(growth?.normalizedValue).toBeGreaterThan(80);
  });

  it("marks low-data responses as insufficient and low confidence", () => {
    const result = buildSearchSignalsFromSeries({
      productId: "ray-ban-meta",
      series: series([
        point("2026-08-06", "2026-08-12", [70, 0, 0, 0]),
      ]),
      now,
      minSampleSize: 8,
    });

    expect(result.summary.hasSufficientData).toBe(false);
    expect(result.summary.confidence).toBeLessThan(25);
  });
});
