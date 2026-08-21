import { normalizeLinear, normalizeLogScale, roundTo } from "../../scoring/normalization";
import { DATA_LAYER_TIMESTAMP, RAY_BAN_META_PRODUCT_ID, RAY_BAN_META_SIGNAL_INPUTS } from "../mockProviderSignals";
import type { NormalizedTrendSignal, TrendSignalProvider } from "../types";

const source = "googleTrends" as const;
const label = "Google Search Trends";
const provider = "mock_google_trends";

function normalize(value: number): number {
  return roundTo(value, 2);
}

export const googleTrendsProvider: TrendSignalProvider = {
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
        // Search demand uses the same niche-to-mainstream range as v1 scoring:
        // 100 weekly searches is emerging; 250,000 is capped as mainstream.
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
        // Category share is capped at 25% because above that the product already
        // owns a large portion of category curiosity for v1 trend reads.
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
        // Seven-day trend change below -20% is cooling hard; +80% is capped as
        // extremely rapid growth for the current consumer-products MVP.
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
