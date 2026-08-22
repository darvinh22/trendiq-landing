import { normalizeInverseLinear, normalizeLinear, normalizeLogScale, roundTo } from "../../scoring/normalization";
import { DATA_LAYER_TIMESTAMP, RAY_BAN_META_PRODUCT_ID, RAY_BAN_META_SIGNAL_INPUTS } from "../mockProviderSignals";
import { InMemorySearchCache, type SearchCache } from "../search/cache";
import {
  DataForSeoGoogleShoppingProductsClient,
  buildReviewQualitySignalsFromObservation,
  readReviewProviderConfig,
  shouldUseLiveReviews,
  type GoogleShoppingReviewsClient,
  type ReviewProviderConfig,
  type ReviewSignalBuildResult,
} from "../reviews";
import type { AsyncTrendSignalProvider, NormalizedTrendSignal, TrendSignalProvider } from "../types";

const source = "reviews" as const;
const label = "Product reviews";
const provider = "mock_reviews";

function normalize(value: number): number {
  return roundTo(value, 2);
}

export const mockReviewsProvider: TrendSignalProvider = {
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
        sampleSize: reviews.ratingEvidenceCount,
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
          providerMetric: "ratingEvidenceCount",
        },
        value: reviews.ratingEvidenceCount,
        // Rating evidence is log-scaled from 20 to 20,000 so early credibility
        // rises quickly without letting large products dominate.
        normalizedValue: normalize(normalizeLogScale(reviews.ratingEvidenceCount, 20, 20000)),
        sampleSize: reviews.ratingEvidenceCount,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 91,
        metadata: {
          provider,
          providerMetric: "ratingEvidenceCount",
          ratingEvidenceComposition: "fallback_rating_review_evidence",
          fallbackReviewCountEquivalent: reviews.ratingEvidenceCount,
          engineField: "ratingEvidenceCount",
          engineValue: reviews.ratingEvidenceCount,
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
        sampleSize: reviews.ratingEvidenceCount,
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

export interface ReviewQualitySignalProviderDependencies {
  client?: GoogleShoppingReviewsClient;
  cache?: SearchCache<ReviewSignalBuildResult>;
  fallbackProvider?: TrendSignalProvider;
}

function engineKey(signal: NormalizedTrendSignal): string | undefined {
  const field = signal.metadata?.engineField;
  return field ? `${signal.signalType}.${field}` : undefined;
}

function asLiveFallbackSignal(signal: NormalizedTrendSignal): NormalizedTrendSignal {
  return {
    ...signal,
    sourceProvenance: {
      ...signal.sourceProvenance,
      mode: "fallback",
      notes: signal.sourceProvenance.notes
        ?? "Mock review field retained because live DataForSEO Google Shopping did not supply this engine field.",
    },
  };
}

export function mergeLiveReviewSignalsWithMockFallback(
  liveSignals: NormalizedTrendSignal[],
  mockSignals: NormalizedTrendSignal[]
): NormalizedTrendSignal[] {
  const liveEngineKeys = new Set(liveSignals.map(engineKey).filter((key): key is string => Boolean(key)));
  const untouchedMockSignals = mockSignals
    .filter((signal) => {
      const key = engineKey(signal);
      return !key || !liveEngineKeys.has(key);
    })
    .map(asLiveFallbackSignal);

  return [...untouchedMockSignals, ...liveSignals];
}

export class ReviewQualitySignalProvider implements AsyncTrendSignalProvider {
  readonly id = source;
  readonly label = label;
  private readonly cache: SearchCache<ReviewSignalBuildResult>;
  private readonly fallbackProvider: TrendSignalProvider;

  constructor(
    private readonly config: ReviewProviderConfig = readReviewProviderConfig(),
    private readonly dependencies: ReviewQualitySignalProviderDependencies = {}
  ) {
    this.cache = dependencies.cache ?? new InMemorySearchCache<ReviewSignalBuildResult>();
    this.fallbackProvider = dependencies.fallbackProvider ?? mockReviewsProvider;
  }

  getSignals(productId: string): NormalizedTrendSignal[] {
    const identity = this.config.productIdentities[productId];
    if (!identity) return [];

    const cached = this.cache.get(this.cacheKey(productId), this.config.now().getTime());
    if (this.config.mode === "live" && cached?.signals.length) {
      return mergeLiveReviewSignalsWithMockFallback(cached.signals, this.fallbackProvider.getSignals(productId));
    }

    return this.fallbackProvider.getSignals(productId);
  }

  async getSignalsAsync(productId: string): Promise<NormalizedTrendSignal[]> {
    const identity = this.config.productIdentities[productId];
    if (!identity) return [];

    if (!shouldUseLiveReviews(this.config)) {
      return this.fallbackProvider.getSignals(productId);
    }

    const cacheKey = this.cacheKey(productId);
    const cached = this.cache.get(cacheKey, this.config.now().getTime());
    if (cached?.signals.length) {
      return mergeLiveReviewSignalsWithMockFallback(cached.signals, this.fallbackProvider.getSignals(productId));
    }

    try {
      const client = this.dependencies.client ?? new DataForSeoGoogleShoppingProductsClient(this.config);
      const observation = await client.getProductReviewAggregate({
        productId,
        identity,
        locationCode: this.config.locationCode,
        languageCode: this.config.languageCode,
      });
      const result = buildReviewQualitySignalsFromObservation({
        productId,
        observation,
      });

      this.cache.set(cacheKey, result, this.config.cacheTtlMs, this.config.now().getTime());
      return mergeLiveReviewSignalsWithMockFallback(result.signals, this.fallbackProvider.getSignals(productId));
    } catch {
      return this.fallbackProvider.getSignals(productId).map(asLiveFallbackSignal);
    }
  }

  private cacheKey(productId: string): string {
    const identity = this.config.productIdentities[productId];

    return [
      "reviews",
      this.config.provider,
      productId,
      identity?.canonicalSearchQuery ?? "",
      this.config.locationCode,
      this.config.languageCode,
    ].join(":");
  }
}

export function createReviewQualitySignalProvider(
  config: ReviewProviderConfig = readReviewProviderConfig(),
  dependencies: ReviewQualitySignalProviderDependencies = {}
): ReviewQualitySignalProvider {
  return new ReviewQualitySignalProvider(config, dependencies);
}

export const reviewsProvider = createReviewQualitySignalProvider();
