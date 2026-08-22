import { normalizeInverseLinear, normalizeLinear, normalizeLogScale, roundTo } from "../../scoring/normalization";
import { DATA_LAYER_TIMESTAMP, RAY_BAN_META_PRODUCT_ID, RAY_BAN_META_SIGNAL_INPUTS } from "../mockProviderSignals";
import { canUseProvider, createUserSearchProductProfile, profileWithProviderIds, type ProductProfile } from "../capabilities";
import { InMemorySearchCache, type SearchCache } from "../search/cache";
import {
  DataForSeoGoogleShoppingReviewsClient,
  DataForSeoGoogleShoppingProductsClient,
  buildReviewProductIdentityFromProfile,
  buildReviewQualitySignalsFromObservation,
  readReviewProviderConfig,
  shouldUseLiveReviews,
  type GoogleShoppingRecentReviewsClient,
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
          providerMetric: "ratingConsensusQuality",
        },
        value: reviews.ratingConsensusQuality,
        // Fallback ratingConsensusQuality is already normalized to 0-100 under
        // the distribution-adjusted consensus semantics.
        normalizedValue: normalize(reviews.ratingConsensusQuality),
        sampleSize: reviews.ratingEvidenceCount,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 88,
        metadata: {
          provider,
          providerMetric: "ratingConsensusQuality",
          distributionScope: "fallback",
          distributionComposition: "fallback_numeric_equivalent",
          engineField: "ratingConsensusQuality",
          engineValue: reviews.ratingConsensusQuality,
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
  recentReviewsClient?: GoogleShoppingRecentReviewsClient;
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
    const profile = this.profileForProductId(productId);
    if (!profile) return [];

    const cached = this.cache.get(this.cacheKey(productId), this.config.now().getTime());
    if (this.config.mode === "live" && cached?.signals.length) {
      return mergeLiveReviewSignalsWithMockFallback(cached.signals, this.fallbackProvider.getSignals(productId));
    }

    return this.fallbackProvider.getSignals(productId);
  }

  async getSignalsAsync(productId: string): Promise<NormalizedTrendSignal[]> {
    const profile = this.profileForProductId(productId);
    if (!profile) return [];

    return this.getSignalsForProfile(profile);
  }

  async getSignalsForProfile(profile: ProductProfile): Promise<NormalizedTrendSignal[]> {
    if (!shouldUseLiveReviews(this.config)) {
      return this.fallbackProvider.getSignals(profile.productId);
    }

    const aggregateDecision = canUseProvider(profile, "dataforseo_google_shopping", "reviews");
    if (!aggregateDecision.allowed) {
      return this.fallbackProvider.getSignals(profile.productId).map(asLiveFallbackSignal);
    }

    const productId = profile.productId;
    const identity = this.identityForProfile(profile);
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
      const recentReviews = await this.getRecentReviews({
        productId,
        identity,
        profile,
        observation,
      });
      const result = buildReviewQualitySignalsFromObservation({
        productId,
        observation,
        recentReviews,
      });

      this.cache.set(cacheKey, result, this.config.cacheTtlMs, this.config.now().getTime());
      return mergeLiveReviewSignalsWithMockFallback(result.signals, this.fallbackProvider.getSignals(productId));
    } catch {
      return this.fallbackProvider.getSignals(productId).map(asLiveFallbackSignal);
    }
  }

  private cacheKey(productId: string): string {
    const profile = this.profileForProductId(productId);
    const identity = profile ? this.identityForProfile(profile) : this.config.productIdentities[productId];

    return [
      "reviews",
      this.config.provider,
      productId,
      identity?.canonicalSearchQuery ?? "",
      this.config.locationCode,
      this.config.languageCode,
      this.config.recentReviewsDepth,
      this.config.recentReviewsWindowDays,
      this.config.recentReviewsMinimumScoringSampleSize,
      this.config.recentReviewsProvisionalSampleSize,
    ].join(":");
  }

  private async getRecentReviews(input: {
    productId: string;
    identity: NonNullable<ReviewProviderConfig["productIdentities"][string]>;
    profile: ProductProfile;
    observation: Awaited<ReturnType<GoogleShoppingReviewsClient["getProductReviewAggregate"]>>;
  }) {
    try {
      const enrichedProfile = profileWithProviderIds(
        input.profile,
        "dataforseo_google_shopping_reviews",
        input.observation.identifiers
      );
      const reviewsDecision = canUseProvider(
        enrichedProfile,
        "dataforseo_google_shopping_reviews",
        "reviews"
      );
      if (!reviewsDecision.allowed) return undefined;

      const client = this.dependencies.recentReviewsClient
        ?? new DataForSeoGoogleShoppingReviewsClient(this.config);

      return await client.getRecentProductReviews({
        productId: input.productId,
        identity: input.identity,
        identifiers: input.observation.identifiers,
        locationCode: this.config.locationCode,
        languageCode: this.config.languageCode,
        snapshotTimestamp: this.config.now().toISOString(),
        aggregateAverageRating: input.observation.averageRating,
      });
    } catch {
      return undefined;
    }
  }

  private profileForProductId(productId: string): ProductProfile | undefined {
    const configuredProfile = this.config.productProfiles?.[productId];
    if (configuredProfile) return configuredProfile;

    const identity = this.config.productIdentities[productId];
    if (!identity) return undefined;

    return createUserSearchProductProfile(identity.canonicalSearchQuery, {
      productId,
      source: "resolved_provider",
      canonicalTitle: identity.productTitle,
      brand: identity.brand,
      aliases: [identity.canonicalSearchQuery, identity.productTitle],
      modelGeneration: identity.generation,
      identityConfidence: identity.providerProductIds?.matchConfidence === "high" ? "high" : "medium",
      providerIds: identity.providerProductIds ? {
        dataforseo_google_shopping: identity.providerProductIds,
        dataforseo_google_shopping_reviews: identity.providerProductIds,
      } : undefined,
      guardrails: {
        requireExactBrandMatch: true,
        requireModelGenerationMatch: Boolean(identity.generation),
        excludeAccessories: true,
        excludeBundles: true,
      },
    });
  }

  private identityForProfile(profile: ProductProfile) {
    return this.config.productIdentities[profile.productId] ?? buildReviewProductIdentityFromProfile(profile);
  }
}

export function createReviewQualitySignalProvider(
  config: ReviewProviderConfig = readReviewProviderConfig(),
  dependencies: ReviewQualitySignalProviderDependencies = {}
): ReviewQualitySignalProvider {
  return new ReviewQualitySignalProvider(config, dependencies);
}

export const reviewsProvider = createReviewQualitySignalProvider();
