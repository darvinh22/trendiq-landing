import { normalizeInverseLinear, normalizeLinear, normalizeLogScale, roundTo } from "../../scoring/normalization";
import { DATA_LAYER_TIMESTAMP, RAY_BAN_META_PRODUCT_ID, RAY_BAN_META_SIGNAL_INPUTS } from "../mockProviderSignals";
import type { NormalizedTrendSignal, TrendSignalProvider } from "../types";

const source = "reviews" as const;
const label = "Product reviews";
const provider = "mock_reviews";

function normalize(value: number): number {
  return roundTo(value, 2);
}

export const reviewsProvider: TrendSignalProvider = {
  id: source,
  label,
  getSignals(productId: string): NormalizedTrendSignal[] {
    if (productId !== RAY_BAN_META_PRODUCT_ID) return [];

    const reviews = RAY_BAN_META_SIGNAL_INPUTS.reviewQuality;
    const sentiment = RAY_BAN_META_SIGNAL_INPUTS.sentiment;

    return [
      {
        source,
        signalType: "reviewQuality",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "averageRating",
        },
        value: reviews.averageRating,
        // Ratings below 3.2 are treated as weak for consumer products; 4.8+
        // is capped because review volume and freshness decide the rest.
        normalizedValue: normalize(normalizeLinear(reviews.averageRating, 3.2, 4.8)),
        sampleSize: reviews.reviewCount,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 90,
        metadata: {
          provider,
          providerMetric: "averageRating",
          engineField: "averageRating",
          engineValue: reviews.averageRating,
        },
      },
      {
        source,
        signalType: "reviewQuality",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "reviewCount",
        },
        value: reviews.reviewCount,
        // Review count is log-scaled from 20 to 20,000 so early credibility
        // rises quickly without letting large catalogs dominate.
        normalizedValue: normalize(normalizeLogScale(reviews.reviewCount, 20, 20000)),
        sampleSize: reviews.reviewCount,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 91,
        metadata: {
          provider,
          providerMetric: "reviewCount",
          engineField: "reviewCount",
          engineValue: reviews.reviewCount,
        },
      },
      {
        source,
        signalType: "reviewQuality",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "verifiedPurchaseShare",
        },
        value: reviews.verifiedPurchasePercent,
        // Verified-purchase share below 30% is fragile; 95%+ is excellent and
        // capped for the mock provider layer.
        normalizedValue: normalize(normalizeLinear(reviews.verifiedPurchasePercent, 30, 95)),
        sampleSize: reviews.reviewCount,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 88,
        metadata: {
          provider,
          providerMetric: "verifiedPurchaseShare",
          engineField: "verifiedPurchasePercent",
          engineValue: reviews.verifiedPurchasePercent,
        },
      },
      {
        source,
        signalType: "reviewQuality",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "recentAverageRating",
        },
        value: reviews.recentAverageRating,
        // Recent ratings use a 3.0-4.8 range to reveal deteriorating product
        // quality faster than long-lived all-time averages.
        normalizedValue: normalize(normalizeLinear(reviews.recentAverageRating, 3.0, 4.8)),
        sampleSize: 720,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 86,
        metadata: {
          provider,
          providerMetric: "recentAverageRating",
          engineField: "recentAverageRating",
          engineValue: reviews.recentAverageRating,
        },
      },
      {
        source,
        signalType: "sentiment",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "positiveReviewLanguage",
        },
        value: sentiment.positiveMentionPercent,
        normalizedValue: normalize(normalizeLinear(sentiment.positiveMentionPercent, 30, 90)),
        sampleSize: 720,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 84,
        metadata: {
          provider,
          providerMetric: "positiveReviewLanguage",
          engineField: "positiveMentionPercent",
          engineValue: sentiment.positiveMentionPercent,
        },
      },
      {
        source,
        signalType: "sentiment",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "negativeReviewLanguage",
        },
        value: sentiment.negativeMentionPercent,
        normalizedValue: normalize(normalizeInverseLinear(sentiment.negativeMentionPercent, 5, 45)),
        sampleSize: 720,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 84,
        metadata: {
          provider,
          providerMetric: "negativeReviewLanguage",
          engineField: "negativeMentionPercent",
          engineValue: sentiment.negativeMentionPercent,
        },
      },
    ];
  },
};
