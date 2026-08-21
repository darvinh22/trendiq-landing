import { calculateConfidenceScore } from "../scoring/confidenceEngine";
import { calculateTrendMomentum } from "../scoring/momentumEngine";
import { calculateTrendIQScore } from "../scoring/scoreEngine";
import { RAY_BAN_META_PRODUCT_ID } from "./mockProviderSignals";
import { merchantProvider } from "./providers/merchantProvider";
import { mockRedditProvider } from "./providers/redditProvider";
import { reviewsProvider } from "./providers/reviewsProvider";
import { socialProvider } from "./providers/socialProvider";
import { aggregateSignals } from "./signalAggregator";
import { buildTrendIQSnapshotProvenanceSummary } from "./liveDataAudit";
import { mapDataForSeoTrendsResponse } from "./search/client";
import { readSearchProviderConfig } from "./search/config";
import { mockSearchProvider } from "./search/mockSearchProvider";
import { mergeLiveSignalsWithMockFallback } from "./search/provider";
import { buildSearchSignalsFromSeries } from "./search/signalBuilder";
import { createLocalTrendSnapshotStore } from "./snapshotStore";
import type { ProductTrendSnapshot } from "./types";

export const VALIDATED_RAY_BAN_META_LIVE_TIMESTAMP = "2026-08-12T00:00:00.000Z";

// Sanitized fixture captured from the first successful DataForSEO Trends
// Explore Live validation. This is development-only persistence; no API
// credentials, Authorization headers, or browser-exposed secrets are stored.
export const VALIDATED_RAY_BAN_META_DATAFORSEO_RESPONSE = {
  status_code: 20000,
  status_message: "Ok.",
  tasks_error: 0,
  tasks: [
    {
      status_code: 20000,
      status_message: "Ok.",
      cost: 0.0012,
      result_count: 1,
      result: [
        {
          keywords: ["Ray-Ban Meta"],
          location_code: 2840,
          datetime: "2026-08-12 00:00:00 +00:00",
          items: [
            {
              type: "dataforseo_trends_graph",
              keywords: ["Ray-Ban Meta"],
              averages: [22],
              data: [
                { date_from: "2026-07-13", date_to: "2026-07-13", timestamp: 1783900800, values: [22] },
                { date_from: "2026-07-14", date_to: "2026-07-14", timestamp: 1783987200, values: [15] },
                { date_from: "2026-07-15", date_to: "2026-07-15", timestamp: 1784073600, values: [15] },
                { date_from: "2026-07-16", date_to: "2026-07-16", timestamp: 1784160000, values: [25] },
                { date_from: "2026-07-17", date_to: "2026-07-17", timestamp: 1784246400, values: [21] },
                { date_from: "2026-07-18", date_to: "2026-07-18", timestamp: 1784332800, values: [6] },
                { date_from: "2026-07-19", date_to: "2026-07-19", timestamp: 1784419200, values: [9] },
                { date_from: "2026-07-20", date_to: "2026-07-20", timestamp: 1784505600, values: [8] },
                { date_from: "2026-07-21", date_to: "2026-07-21", timestamp: 1784592000, values: [18] },
                { date_from: "2026-07-22", date_to: "2026-07-22", timestamp: 1784678400, values: [20] },
                { date_from: "2026-07-23", date_to: "2026-07-23", timestamp: 1784764800, values: [14] },
                { date_from: "2026-07-24", date_to: "2026-07-24", timestamp: 1784851200, values: [15] },
                { date_from: "2026-07-25", date_to: "2026-07-25", timestamp: 1784937600, values: [50] },
                { date_from: "2026-07-26", date_to: "2026-07-26", timestamp: 1785024000, values: [8] },
                { date_from: "2026-07-27", date_to: "2026-07-27", timestamp: 1785110400, values: [38] },
                { date_from: "2026-07-28", date_to: "2026-07-28", timestamp: 1785196800, values: [32] },
                { date_from: "2026-07-29", date_to: "2026-07-29", timestamp: 1785283200, values: [5] },
                { date_from: "2026-07-30", date_to: "2026-07-30", timestamp: 1785369600, values: [32] },
                { date_from: "2026-07-31", date_to: "2026-07-31", timestamp: 1785456000, values: [15] },
                { date_from: "2026-08-01", date_to: "2026-08-01", timestamp: 1785542400, values: [48] },
                { date_from: "2026-08-02", date_to: "2026-08-02", timestamp: 1785628800, values: [100] },
                { date_from: "2026-08-03", date_to: "2026-08-03", timestamp: 1785715200, values: [72] },
                { date_from: "2026-08-04", date_to: "2026-08-04", timestamp: 1785801600, values: [25] },
                { date_from: "2026-08-05", date_to: "2026-08-05", timestamp: 1785888000, values: [4] },
                { date_from: "2026-08-06", date_to: "2026-08-06", timestamp: 1785974400, values: [1] },
                { date_from: "2026-08-07", date_to: "2026-08-07", timestamp: 1786060800, values: [0] },
                { date_from: "2026-08-08", date_to: "2026-08-08", timestamp: 1786147200, values: [0] },
                { date_from: "2026-08-09", date_to: "2026-08-09", timestamp: 1786233600, values: [0] },
                { date_from: "2026-08-10", date_to: "2026-08-10", timestamp: 1786320000, values: [42] },
                { date_from: "2026-08-11", date_to: "2026-08-11", timestamp: 1786406400, values: [7] },
                { date_from: "2026-08-12", date_to: "2026-08-12", timestamp: 1786492800, values: [1] },
              ],
            },
          ],
        },
      ],
    },
  ],
} as const;

export function buildValidatedRayBanMetaLiveSnapshot(): ProductTrendSnapshot {
  const timestamp = VALIDATED_RAY_BAN_META_LIVE_TIMESTAMP;
  const now = new Date(timestamp);
  const config = readSearchProviderConfig({}, {
    mode: "live",
    now: () => now,
  });
  const series = mapDataForSeoTrendsResponse({
    response: VALIDATED_RAY_BAN_META_DATAFORSEO_RESPONSE,
    productId: RAY_BAN_META_PRODUCT_ID,
    aliases: config.productQueries[RAY_BAN_META_PRODUCT_ID].aliases,
    locationCode: config.locationCode,
    interestType: config.interestType,
    timeRange: config.timeRange,
    fetchedAt: timestamp,
  });
  const liveSearchResult = buildSearchSignalsFromSeries({
    productId: RAY_BAN_META_PRODUCT_ID,
    series,
    now,
    minSampleSize: config.minSampleSize,
  });
  const searchSignals = mergeLiveSignalsWithMockFallback(
    liveSearchResult.signals,
    mockSearchProvider.getSignals(RAY_BAN_META_PRODUCT_ID)
  );
  const rawSignals = [
    ...searchSignals,
    ...mockRedditProvider.getSignals(RAY_BAN_META_PRODUCT_ID),
    ...reviewsProvider.getSignals(RAY_BAN_META_PRODUCT_ID),
    ...socialProvider.getSignals(RAY_BAN_META_PRODUCT_ID),
    ...merchantProvider.getSignals(RAY_BAN_META_PRODUCT_ID),
  ];
  const aggregation = aggregateSignals(RAY_BAN_META_PRODUCT_ID, rawSignals, timestamp);
  const trendIQScore = calculateTrendIQScore(aggregation.aggregatedSignals);
  const confidence = calculateConfidenceScore(aggregation.confidenceSignals);
  const trendStatus = calculateTrendMomentum({
    changePercent: aggregation.aggregatedSignals.growthVelocity.trendChangePercent,
    current7dRelativeInterest: aggregation.aggregatedSignals.searchMomentum.current7dRelativeInterest,
    previous7dRelativeInterest: aggregation.aggregatedSignals.searchMomentum.previous7dRelativeInterest,
    hasSearchGrowthContext: aggregation.aggregatedSignals.growthVelocity.hasSearchDerivedVelocity,
    hasLowBaseSearchGrowth: aggregation.aggregatedSignals.searchMomentum.hasLowBaseSearchGrowth,
  });
  const liveDataAudit = buildTrendIQSnapshotProvenanceSummary({
    sourceMode: "live",
    rawSignals: aggregation.rawSignals,
    trendIQScore,
    confidence,
    trendStatus,
  });

  return {
    productId: RAY_BAN_META_PRODUCT_ID,
    timestamp,
    sourceMode: "live",
    rawSignals: aggregation.rawSignals,
    aggregatedSignals: aggregation.aggregatedSignals,
    trendIQScore,
    confidence,
    trendStatus,
    provenance: aggregation.provenance,
    liveDataAudit,
  };
}

export const VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT = buildValidatedRayBanMetaLiveSnapshot();
export const VALIDATED_LIVE_PRODUCT_SNAPSHOTS = [VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT] as const;

export function createDevelopmentTrendSnapshotStore() {
  return createLocalTrendSnapshotStore([...VALIDATED_LIVE_PRODUCT_SNAPSHOTS]);
}
