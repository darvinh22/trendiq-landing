import { normalizeInverseLinear, normalizeLinear, roundTo } from "../../scoring/normalization";
import { DATA_LAYER_TIMESTAMP, RAY_BAN_META_PRODUCT_ID, RAY_BAN_META_SIGNAL_INPUTS } from "../mockProviderSignals";
import { InMemoryRedditCache, type RedditCache } from "../reddit/cache";
import { RedditOAuthClient, type RedditApiClient } from "../reddit/client";
import { readRedditProviderConfig, shouldUseLiveReddit, type RedditProviderConfig } from "../reddit/config";
import { buildRedditSignalsFromPosts, type RedditSignalSummary } from "../reddit/signalBuilder";
import type { AsyncTrendSignalProvider, NormalizedTrendSignal, TrendSignalProvider } from "../types";

const source = "reddit" as const;
const label = "Reddit discussions";
const mockProvider = "mock_reddit_pending_approval";

interface RedditLiveCacheValue {
  signals: NormalizedTrendSignal[];
  summary: RedditSignalSummary;
}

export interface RedditTrendSignalProviderDependencies {
  client?: RedditApiClient;
  cache?: RedditCache<RedditLiveCacheValue>;
  fallbackProvider?: TrendSignalProvider;
}

function normalize(value: number): number {
  return roundTo(value, 2);
}

export const mockRedditProvider: TrendSignalProvider = {
  id: source,
  label,
  getSignals(productId: string): NormalizedTrendSignal[] {
    if (productId !== RAY_BAN_META_PRODUCT_ID) return [];

    const sentiment = RAY_BAN_META_SIGNAL_INPUTS.sentiment;
    const purchaseIntent = RAY_BAN_META_SIGNAL_INPUTS.purchaseIntent;
    const social = RAY_BAN_META_SIGNAL_INPUTS.socialMomentum;

    return [
      {
        source,
        signalType: "sentiment",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider: mockProvider,
          providerLabel: label,
          providerMetric: "positiveDiscussionShare",
          approvalStatus: "pending",
          liveApiRequestMade: false,
        },
        value: sentiment.positiveMentionPercent,
        // Positive discussion below 30% is weak; 90% is capped as exceptional
        // because even beloved products attract some criticism.
        normalizedValue: normalize(normalizeLinear(sentiment.positiveMentionPercent, 30, 90)),
        sampleSize: 2800,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 88,
        metadata: {
          provider: mockProvider,
          providerMetric: "positiveDiscussionShare",
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
          provider: mockProvider,
          providerLabel: label,
          providerMetric: "negativeDiscussionShare",
          approvalStatus: "pending",
          liveApiRequestMade: false,
        },
        value: sentiment.negativeMentionPercent,
        // Negative discussion is inverse-normalized: 5% is excellent, while
        // 45% is severe enough to bottom out this provider-level signal.
        normalizedValue: normalize(normalizeInverseLinear(sentiment.negativeMentionPercent, 5, 45)),
        sampleSize: 2800,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 86,
        metadata: {
          provider: mockProvider,
          providerMetric: "negativeDiscussionShare",
          engineField: "negativeMentionPercent",
          engineValue: sentiment.negativeMentionPercent,
        },
      },
      {
        source,
        signalType: "purchaseIntent",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider: mockProvider,
          providerLabel: label,
          providerMetric: "recommendationAndBuyingLanguage",
          approvalStatus: "pending",
          liveApiRequestMade: false,
        },
        value: purchaseIntent.buyingKeywordSharePercent,
        // Buying-language share starts at 2% because casual mentions are common;
        // 35%+ indicates unusually direct purchase consideration.
        normalizedValue: normalize(normalizeLinear(purchaseIntent.buyingKeywordSharePercent, 2, 35)),
        sampleSize: 1200,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 84,
        metadata: {
          provider: mockProvider,
          providerMetric: "recommendationAndBuyingLanguage",
          engineField: "buyingKeywordSharePercent",
          engineValue: purchaseIntent.buyingKeywordSharePercent,
        },
      },
      {
        source,
        signalType: "socialMomentum",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider: mockProvider,
          providerLabel: label,
          providerMetric: "communityMentionGrowth",
          approvalStatus: "pending",
          liveApiRequestMade: false,
        },
        value: social.mentionGrowthPercent,
        // Community mention growth uses the v1 social momentum range where
        // -25% is clearly cooling and +150% is a breakout discussion spike.
        normalizedValue: normalize(normalizeLinear(social.mentionGrowthPercent, -25, 150)),
        previousValue: 1707,
        percentChange: social.mentionGrowthPercent,
        sampleSize: 2800,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 83,
        metadata: {
          provider: mockProvider,
          providerMetric: "communityMentionGrowth",
          engineField: "mentionGrowthPercent",
          engineValue: social.mentionGrowthPercent,
        },
      },
    ];
  },
};

export class RedditTrendSignalProvider implements AsyncTrendSignalProvider {
  readonly id = source;
  readonly label = label;
  private readonly cache: RedditCache<RedditLiveCacheValue>;
  private readonly fallbackProvider: TrendSignalProvider;
  private readonly debugSummaries = new Map<string, RedditSignalSummary>();

  constructor(
    private readonly config: RedditProviderConfig = readRedditProviderConfig(),
    private readonly dependencies: RedditTrendSignalProviderDependencies = {}
  ) {
    this.cache = dependencies.cache ?? new InMemoryRedditCache<RedditLiveCacheValue>();
    this.fallbackProvider = dependencies.fallbackProvider ?? mockRedditProvider;
  }

  getSignals(productId: string): NormalizedTrendSignal[] {
    const productConfig = this.config.productQueries[productId];
    if (!productConfig) return [];

    const cached = this.cache.get(this.cacheKey(productId), this.config.now().getTime());
    if (shouldUseLiveReddit(this.config) && cached) {
      return cached.signals;
    }

    return this.fallbackProvider.getSignals(productId);
  }

  async getSignalsAsync(productId: string): Promise<NormalizedTrendSignal[]> {
    const productConfig = this.config.productQueries[productId];
    if (!productConfig) return [];

    if (!shouldUseLiveReddit(this.config)) {
      return this.fallbackProvider.getSignals(productId);
    }

    const cacheKey = this.cacheKey(productId);
    const cached = this.cache.get(cacheKey, this.config.now().getTime());
    if (cached) return cached.signals;

    try {
      const client = this.dependencies.client ?? new RedditOAuthClient(this.config);
      const postsByAlias = await Promise.all(
        productConfig.aliases.map((alias) =>
          client.searchPosts(alias, {
            limit: this.config.maxPostsPerAlias,
          })
        )
      );
      const result = buildRedditSignalsFromPosts({
        productId,
        aliases: productConfig.aliases,
        posts: postsByAlias.flat(),
        now: this.config.now(),
        minSampleSize: this.config.minSampleSize,
      });

      this.debugSummaries.set(productId, result.summary);

      if (!result.summary.hasSufficientSample) {
        return this.fallbackProvider.getSignals(productId);
      }

      this.cache.set(cacheKey, result, this.config.cacheTtlMs, this.config.now().getTime());
      return result.signals;
    } catch {
      // Production/commercial use must comply with current Reddit Developer
      // Terms and Data API Terms. Fail closed into mock signals so the UI and
      // score engine continue working when OAuth, policy, or rate limits block.
      return this.fallbackProvider.getSignals(productId);
    }
  }

  getDebugSummary(productId: string): RedditSignalSummary | undefined {
    return this.debugSummaries.get(productId);
  }

  private cacheKey(productId: string): string {
    const aliases = this.config.productQueries[productId]?.aliases.join("|") ?? "";
    return `reddit:${productId}:${aliases}:v1`;
  }
}

export function createRedditTrendSignalProvider(
  config: RedditProviderConfig = readRedditProviderConfig(),
  dependencies: RedditTrendSignalProviderDependencies = {}
): RedditTrendSignalProvider {
  return new RedditTrendSignalProvider(config, dependencies);
}

export const redditProvider = createRedditTrendSignalProvider();
