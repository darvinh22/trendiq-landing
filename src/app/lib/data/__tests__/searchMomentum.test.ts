import { describe, expect, it } from "vitest";
import { calculateConfidenceScore } from "../../scoring/confidenceEngine";
import { calculateTrendMomentum } from "../../scoring/momentumEngine";
import { calculateTrendIQScore } from "../../scoring/scoreEngine";
import type { TrendSignalProvider } from "../types";
import {
  absoluteDemandLevelForNormalizedScore,
  baselineQualityForReadiness,
  buildSearchMomentumV1,
  directionForTrendChangePercent,
  strengthForAbsoluteDemandLevel,
} from "../searchMomentum";
import { aggregateSignals } from "../signalAggregator";
import { buildProductTrendSnapshot } from "../snapshotEngine";
import { buildSearchSignalsFromSeries, buildSearchVolumeSignalsFromSeries } from "../search/signalBuilder";
import type { SearchInterestPoint, SearchInterestSeries, SearchVolumeSeries } from "../search/types";

const PRODUCT_ID = "user-search-garmin-venu-4";
const QUERY = "Garmin Venu 4";
const NOW = new Date("2026-08-27T12:00:00.000Z");
const TIMESTAMP = NOW.toISOString();

function searchVolumeSeries(monthlySearchVolume = 49500): SearchVolumeSeries {
  return {
    provider: "dataforseo",
    productId: PRODUCT_ID,
    aliases: [QUERY],
    locationCode: 2840,
    languageCode: "en",
    fetchedAt: TIMESTAMP,
    cost: 0.09,
    endpoint: "/v3/keywords_data/google_ads/search_volume/live",
    monthlySearchVolume,
    observations: [
      {
        keyword: QUERY,
        locationCode: 2840,
        languageCode: "en",
        monthlySearchVolume,
        monthlySearches: [{ year: 2026, month: 7, searchVolume: monthlySearchVolume }],
      },
    ],
  };
}

function point(dateFrom: string, value: number): SearchInterestPoint {
  return {
    dateFrom,
    dateTo: dateFrom,
    timestamp: Date.parse(`${dateFrom}T00:00:00.000Z`) / 1000,
    valuesByAlias: { [QUERY]: value },
  };
}

function garminTrendsSeries(): SearchInterestSeries {
  const values: Array<[string, number]> = [
    ["2026-07-28", 80],
    ["2026-07-29", 100],
    ["2026-07-30", 17],
    ["2026-07-31", 3],
    ["2026-08-01", 0],
    ["2026-08-02", 0],
    ["2026-08-03", 0],
    ["2026-08-04", 0],
    ["2026-08-05", 0],
    ["2026-08-06", 0],
    ["2026-08-07", 0],
    ["2026-08-08", 0],
    ["2026-08-09", 0],
    ["2026-08-10", 0],
    ["2026-08-11", 0],
    ["2026-08-12", 0],
    ["2026-08-13", 83],
    ["2026-08-14", 14],
    ["2026-08-15", 2],
    ["2026-08-16", 0],
    ["2026-08-17", 0],
    ["2026-08-18", 0],
    ["2026-08-19", 0],
    ["2026-08-20", 0],
    ["2026-08-21", 0],
    ["2026-08-22", 0],
    ["2026-08-23", 0],
    ["2026-08-24", 0],
    ["2026-08-25", 0],
    ["2026-08-26", 0],
    ["2026-08-27", 0],
  ];

  return {
    provider: "dataforseo",
    productId: PRODUCT_ID,
    aliases: [QUERY],
    locationCode: 2840,
    interestType: "web",
    timeRange: "past_30_days",
    fetchedAt: TIMESTAMP,
    cost: 0.0012,
    points: values.map(([date, value]) => point(date, value)),
    averagesByAlias: { [QUERY]: 9.65 },
  };
}

function snapshotForSignals(signals = garminSearchSignals()) {
  const provider: TrendSignalProvider = {
    id: "searchWeb",
    label: "Search fixture",
    getSignals: () => signals,
  };

  return buildProductTrendSnapshot(PRODUCT_ID, [provider], {
    timestamp: TIMESTAMP,
    sourceMode: "live",
  });
}

function garminSearchSignals() {
  return [
    ...buildSearchVolumeSignalsFromSeries({
      productId: PRODUCT_ID,
      series: searchVolumeSeries(),
      now: NOW,
    }),
    ...buildSearchSignalsFromSeries({
      productId: PRODUCT_ID,
      series: garminTrendsSeries(),
      now: NOW,
      minSampleSize: 2,
    }).signals,
  ];
}

function directionalDemandFor(input: {
  current7dRelativeInterest: number;
  previous7dRelativeInterest: number;
  trendChangePercent: number;
}) {
  const readiness = Math.min(1, Math.max(0, input.previous7dRelativeInterest / 10));
  const trendSignal = {
    source: "searchWeb" as const,
    signalType: "growthVelocity" as const,
    productId: PRODUCT_ID,
    sourceProvenance: {
      mode: "derived-live" as const,
      provider: "dataforseo_trends",
      providerMetric: "searchInterestTrendChange7d",
      liveApiRequestMade: true,
    },
    value: input.trendChangePercent,
    normalizedValue: 50,
    previousValue: input.previous7dRelativeInterest,
    percentChange: input.trendChangePercent,
    sampleSize: 21,
    timestamp: TIMESTAMP,
    confidence: 85,
    metadata: {
      provider: "dataforseo_trends",
      engineField: "trendChangePercent",
      engineValue: input.trendChangePercent,
      current7dRelativeInterest: input.current7dRelativeInterest,
      previous7dRelativeInterest: input.previous7dRelativeInterest,
      searchGrowthBaselineReadiness: readiness,
      lowBaseSearchGrowth: input.previous7dRelativeInterest < 10,
      change7dEvidenceQuality: "observed",
      aliasesUsed: QUERY,
    },
  };
  const aggregation = aggregateSignals(PRODUCT_ID, [trendSignal], TIMESTAMP);

  return buildSearchMomentumV1({
    aggregatedSignals: aggregation.aggregatedSignals,
    rawSignals: aggregation.rawSignals,
  }).directionalDemand;
}

describe("SearchMomentumV1", () => {
  it("builds Garmin absolute and directional demand without changing legacy snapshot outputs", () => {
    const snapshot = snapshotForSignals();
    const directAggregation = aggregateSignals(PRODUCT_ID, snapshot.rawSignals, TIMESTAMP);
    const expectedLegacyScore = calculateTrendIQScore(directAggregation.aggregatedSignals);
    const expectedLegacyConfidence = calculateConfidenceScore(directAggregation.confidenceSignals);
    const expectedLegacyMomentum = calculateTrendMomentum({
      changePercent: directAggregation.aggregatedSignals.growthVelocity.trendChangePercent,
      current7dRelativeInterest: directAggregation.aggregatedSignals.searchMomentum.current7dRelativeInterest,
      previous7dRelativeInterest: directAggregation.aggregatedSignals.searchMomentum.previous7dRelativeInterest,
      hasSearchGrowthContext: directAggregation.aggregatedSignals.growthVelocity.hasSearchDerivedVelocity,
      hasLowBaseSearchGrowth: directAggregation.aggregatedSignals.searchMomentum.hasLowBaseSearchGrowth,
    });

    expect(snapshot.trendIQScore).toEqual(expectedLegacyScore);
    expect(snapshot.confidence).toEqual(expectedLegacyConfidence);
    expect(snapshot.trendStatus).toEqual(expectedLegacyMomentum);
    expect(snapshot.searchMomentumV1).toMatchObject({
      version: "search_momentum_v1",
      direction: "Cooling",
      strength: "Medium",
      evidenceQuality: "observed",
      provenance: {
        measurementScope: "exact",
        query: QUERY,
        sources: [
          "absoluteDemand:dataforseo_google_ads",
          "directionalDemand:dataforseo_trends",
        ],
      },
    });
    expect(snapshot.searchMomentumV1?.absoluteDemand).toMatchObject({
      monthlySearchVolume: 49500,
      searchVolume7d: 11384,
      normalizedDemandScore: 60.47,
      level: "Medium",
      strength: "Medium",
      confidence: 88,
      evidenceQuality: "observed",
    });
    expect(snapshot.searchMomentumV1?.directionalDemand).toMatchObject({
      current7dRelativeInterest: 0,
      previous7dRelativeInterest: 2.29,
      searchGrowthPercent: -100,
      trendChangePercent: -100,
      consecutiveGrowthDays: 0,
      direction: "Cooling",
      evidenceQuality: "observed",
      baselineReadiness: 0.229,
      baselineQuality: "weak",
      confidence: 38.25,
    });
    expect(snapshot.searchMomentumV1?.confidence).toBe(60.64);
  });

  it("calibrates absolute demand levels and strengths independently from direction", () => {
    expect(absoluteDemandLevelForNormalizedScore(0)).toBe("Very Low");
    expect(absoluteDemandLevelForNormalizedScore(19.99)).toBe("Very Low");
    expect(absoluteDemandLevelForNormalizedScore(20)).toBe("Low");
    expect(absoluteDemandLevelForNormalizedScore(39.99)).toBe("Low");
    expect(absoluteDemandLevelForNormalizedScore(40)).toBe("Medium");
    expect(absoluteDemandLevelForNormalizedScore(64.99)).toBe("Medium");
    expect(absoluteDemandLevelForNormalizedScore(65)).toBe("High");
    expect(absoluteDemandLevelForNormalizedScore(84.99)).toBe("High");
    expect(absoluteDemandLevelForNormalizedScore(85)).toBe("Very High");
    expect(strengthForAbsoluteDemandLevel("Very Low")).toBe("Low");
    expect(strengthForAbsoluteDemandLevel("Low")).toBe("Low");
    expect(strengthForAbsoluteDemandLevel("Medium")).toBe("Medium");
    expect(strengthForAbsoluteDemandLevel("High")).toBe("High");
    expect(strengthForAbsoluteDemandLevel("Very High")).toBe("High");
  });

  it("preserves legacy direction thresholds and search-supported Exploding gates", () => {
    expect(directionForTrendChangePercent({ trendChangePercent: -50 })).toBe("Cooling");
    expect(directionForTrendChangePercent({ trendChangePercent: -10 })).toBe("Cooling");
    expect(directionForTrendChangePercent({ trendChangePercent: -9.9 })).toBe("Stable");
    expect(directionForTrendChangePercent({ trendChangePercent: 0 })).toBe("Stable");
    expect(directionForTrendChangePercent({ trendChangePercent: 10 })).toBe("Rising");
    expect(directionForTrendChangePercent({ trendChangePercent: 49.9 })).toBe("Rising");
    expect(directionForTrendChangePercent({
      trendChangePercent: 50,
      current7dRelativeInterest: 30,
      previous7dRelativeInterest: 12,
    })).toBe("Exploding");
    expect(directionForTrendChangePercent({
      trendChangePercent: 100,
      current7dRelativeInterest: 5,
      previous7dRelativeInterest: 0.1,
      hasLowBaseSearchGrowth: true,
    })).toBe("Rising");
  });

  it("keeps baseline quality separate from observed evidence quality", () => {
    expect(baselineQualityForReadiness(0.229)).toBe("weak");
    expect(baselineQualityForReadiness(0.4)).toBe("moderate");
    expect(baselineQualityForReadiness(0.8)).toBe("strong");
    expect(snapshotForSignals().searchMomentumV1?.directionalDemand).toMatchObject({
      evidenceQuality: "observed",
      baselineQuality: "weak",
      confidence: 38.25,
    });
  });

  it("calibrates baseline cases without rewriting raw percentages", () => {
    expect(directionalDemandFor({
      current7dRelativeInterest: 0,
      previous7dRelativeInterest: 2.29,
      trendChangePercent: -100,
    })).toMatchObject({
      direction: "Cooling",
      trendChangePercent: -100,
      baselineReadiness: 0.229,
      baselineQuality: "weak",
      evidenceQuality: "observed",
      confidence: 38.25,
    });
    expect(directionalDemandFor({
      current7dRelativeInterest: 0,
      previous7dRelativeInterest: 80,
      trendChangePercent: -100,
    })).toMatchObject({
      direction: "Cooling",
      trendChangePercent: -100,
      baselineReadiness: 1,
      baselineQuality: "strong",
      evidenceQuality: "observed",
      confidence: 85,
    });
    expect(directionalDemandFor({
      current7dRelativeInterest: 0,
      previous7dRelativeInterest: 0,
      trendChangePercent: 0,
    })).toMatchObject({
      direction: "Stable",
      trendChangePercent: 0,
      baselineQuality: "weak",
    });
    expect(directionalDemandFor({
      current7dRelativeInterest: 5,
      previous7dRelativeInterest: 0,
      trendChangePercent: 100,
    })).toMatchObject({
      direction: "Rising",
      trendChangePercent: 100,
      baselineQuality: "weak",
    });
    expect(directionalDemandFor({
      current7dRelativeInterest: 12,
      previous7dRelativeInterest: 0.1,
      trendChangePercent: 11900,
    })).toMatchObject({
      direction: "Rising",
      trendChangePercent: 11900,
      baselineQuality: "weak",
    });
  });

  it.each([
    { monthlySearchVolume: 500000, trendChangePercent: -25, direction: "Cooling", strength: "High" },
    { monthlySearchVolume: 500000, trendChangePercent: 25, direction: "Rising", strength: "High" },
    { monthlySearchVolume: 100, trendChangePercent: 75, direction: "Exploding", strength: "Low" },
    { monthlySearchVolume: 100, trendChangePercent: 0, direction: "Stable", strength: "Low" },
  ])("combines $strength absolute demand with $direction directional demand", (input) => {
    const searchVolumeSignals = buildSearchVolumeSignalsFromSeries({
      productId: PRODUCT_ID,
      series: searchVolumeSeries(input.monthlySearchVolume),
      now: NOW,
    });
    const trendSignal = {
      source: "searchWeb" as const,
      signalType: "growthVelocity" as const,
      productId: PRODUCT_ID,
      sourceProvenance: {
        mode: "derived-live" as const,
        provider: "dataforseo_trends",
        providerMetric: "searchInterestTrendChange7d",
        liveApiRequestMade: true,
      },
      value: input.trendChangePercent,
      normalizedValue: 50,
      previousValue: 12,
      percentChange: input.trendChangePercent,
      sampleSize: 21,
      timestamp: TIMESTAMP,
      confidence: 85,
      metadata: {
        provider: "dataforseo_trends",
        engineField: "trendChangePercent",
        engineValue: input.trendChangePercent,
        current7dRelativeInterest: input.trendChangePercent >= 50 ? 30 : 12,
        previous7dRelativeInterest: 12,
        searchGrowthBaselineReadiness: 1,
        lowBaseSearchGrowth: false,
        change7dEvidenceQuality: "observed",
        aliasesUsed: QUERY,
      },
    };
    const aggregation = aggregateSignals(PRODUCT_ID, [...searchVolumeSignals, trendSignal], TIMESTAMP);
    const model = buildSearchMomentumV1({
      aggregatedSignals: aggregation.aggregatedSignals,
      rawSignals: aggregation.rawSignals,
    });

    expect(model.strength).toBe(input.strength);
    expect(model.direction).toBe(input.direction);
  });

  it("reports missing dimensions without fabricating direction or demand", () => {
    const googleOnly = snapshotForSignals(buildSearchVolumeSignalsFromSeries({
      productId: PRODUCT_ID,
      series: searchVolumeSeries(),
      now: NOW,
    }));
    const trendsOnly = snapshotForSignals(buildSearchSignalsFromSeries({
      productId: PRODUCT_ID,
      series: garminTrendsSeries(),
      now: NOW,
      minSampleSize: 2,
    }).signals);
    const empty = snapshotForSignals([]);

    expect(googleOnly.searchMomentumV1).toMatchObject({
      direction: "Stable",
      strength: "Medium",
      confidence: 39.6,
      evidenceQuality: "insufficient",
    });
    expect(googleOnly.searchMomentumV1?.absoluteDemand).toBeDefined();
    expect(googleOnly.searchMomentumV1?.directionalDemand).toBeUndefined();
    expect(trendsOnly.searchMomentumV1).toMatchObject({
      direction: "Cooling",
      strength: "Low",
      confidence: 21.04,
      evidenceQuality: "observed",
    });
    expect(trendsOnly.searchMomentumV1?.absoluteDemand).toBeUndefined();
    expect(trendsOnly.searchMomentumV1?.directionalDemand).toBeDefined();
    expect(empty.searchMomentumV1).toMatchObject({
      direction: "Stable",
      strength: "Low",
      confidence: 0,
      evidenceQuality: "missing",
      provenance: {
        measurementScope: "exact",
        sources: [],
      },
    });
    expect(googleOnly.trendIQScore.score).toBe(14);
    expect(googleOnly.confidence).toMatchObject({
      score: 65,
      level: "Good",
    });
    expect(googleOnly.trendStatus).toMatchObject({
      status: "Stable",
    });
    expect(trendsOnly.trendIQScore.score).toBe(9);
    expect(trendsOnly.confidence).toMatchObject({
      score: 22,
      level: "Low",
    });
    expect(trendsOnly.trendStatus).toMatchObject({
      status: "Cooling",
    });
  });
});
