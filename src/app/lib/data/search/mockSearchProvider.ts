import { normalizeLinear, normalizeLogScale, roundTo } from "../../scoring/normalization";
import { DATA_LAYER_TIMESTAMP, RAY_BAN_META_PRODUCT_ID, RAY_BAN_META_SIGNAL_INPUTS } from "../mockProviderSignals";
import type { NormalizedTrendSignal, TrendSignalProvider } from "../types";

const source = "searchWeb" as const;
const label = "Search/Web interest";
const provider = "mock_search_web";

function normalize(value: number): number {
  return roundTo(value, 2);
}

export const mockSearchProvider: TrendSignalProvider = {
  id: source,
  label,
  getSignals(productId: string): NormalizedTrendSignal[] {
    if (productId !== RAY_BAN_META_PRODUCT_ID) return [];

    const search = RAY_BAN_META_SIGNAL_INPUTS.searchMomentum;
    const growth = RAY_BAN_META_SIGNAL_INPUTS.growthVelocity;

    return [
      {
        source,
        signalType: "searchMomentum",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "weeklySearchVolume",
        },
        value: search.searchVolume7d,
        // This remains a mock absolute search-volume proxy. Live DataForSEO
        // Trends data replaces search-interest growth, not absolute volume.
        normalizedValue: normalize(normalizeLogScale(search.searchVolume7d, 100, 250000)),
        previousValue: 126712,
        percentChange: search.searchGrowthPercent,
        sampleSize: search.searchVolume7d,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 94,
        metadata: {
          provider,
          providerMetric: "weeklySearchVolume",
          engineField: "searchVolume7d",
          engineValue: search.searchVolume7d,
        },
      },
      {
        source,
        signalType: "searchMomentum",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "searchGrowthPercent",
        },
        value: search.searchGrowthPercent,
        // Search acceleration maps -20% to no momentum and +120% to breakout
        // discovery, matching the scale expected by TrendIQ Score v1.
        normalizedValue: normalize(normalizeLinear(search.searchGrowthPercent, -20, 120)),
        previousValue: 31.5,
        percentChange: search.searchGrowthPercent,
        sampleSize: search.searchVolume7d,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 92,
        metadata: {
          provider,
          providerMetric: "searchGrowthPercent",
          engineField: "searchGrowthPercent",
          engineValue: search.searchGrowthPercent,
        },
      },
      {
        source,
        signalType: "searchMomentum",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "categoryQueryShare",
        },
        value: search.queryShareOfCategoryPercent,
        // Category share remains mocked until a real provider supplies a
        // defensible category denominator for TrendIQ's product taxonomy.
        normalizedValue: normalize(normalizeLinear(search.queryShareOfCategoryPercent, 0, 25)),
        sampleSize: search.searchVolume7d,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 90,
        metadata: {
          provider,
          providerMetric: "categoryQueryShare",
          engineField: "queryShareOfCategoryPercent",
          engineValue: search.queryShareOfCategoryPercent,
        },
      },
      {
        source,
        signalType: "growthVelocity",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "searchTrendChangePercent",
        },
        value: growth.trendChangePercent,
        // Mock seven-day search change is replaced by live Search Interest
        // change when DataForSEO live mode has enough data.
        normalizedValue: normalize(normalizeLinear(growth.trendChangePercent, -20, 80)),
        percentChange: growth.trendChangePercent,
        sampleSize: search.searchVolume7d,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 91,
        metadata: {
          provider,
          providerMetric: "searchTrendChangePercent",
          engineField: "trendChangePercent",
          engineValue: growth.trendChangePercent,
        },
      },
    ];
  },
};
