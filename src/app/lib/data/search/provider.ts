import { InMemorySearchCache, type SearchCache } from "./cache";
import { DataForSeoGoogleAdsSearchVolumeClient, DataForSeoTrendsClient } from "./client";
import { readSearchProviderConfig, shouldUseLiveSearch } from "./config";
import { mockSearchProvider } from "./mockSearchProvider";
import { buildSearchWindows } from "./normalization";
import { buildSearchSignalsFromSeries, buildSearchVolumeSignalsFromSeries } from "./signalBuilder";
import type { SearchInterestClient, SearchProviderConfig, SearchSignalBuildResult, SearchVolumeClient } from "./types";
import { canUseProvider, createUserSearchProductProfile, type ProductProfile } from "../capabilities";
import type { AsyncTrendSignalProvider, NormalizedTrendSignal, TrendSignalProvider } from "../types";

const source = "searchWeb" as const;
const label = "Search/Web interest";

export interface SearchTrendSignalProviderDependencies {
  client?: SearchInterestClient;
  volumeClient?: SearchVolumeClient;
  cache?: SearchCache<SearchSignalBuildResult>;
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
      notes: signal.sourceProvenance.notes ?? "Mock search field retained because live DataForSEO did not supply this engine field.",
    },
  };
}

export function mergeLiveSignalsWithMockFallback(
  liveSignals: NormalizedTrendSignal[],
  mockSignals: NormalizedTrendSignal[]
): NormalizedTrendSignal[] {
  const liveEngineKeys = new Set(liveSignals.map(engineKey).filter((key): key is string => Boolean(key)));
  const untouchedMockSignals = mockSignals.filter((signal) => {
    const key = engineKey(signal);
    return !key || !liveEngineKeys.has(key);
  }).map(asLiveFallbackSignal);

  return [...untouchedMockSignals, ...liveSignals];
}

export class SearchTrendSignalProvider implements AsyncTrendSignalProvider {
  readonly id = source;
  readonly label = label;
  private readonly cache: SearchCache<SearchSignalBuildResult>;
  private readonly fallbackProvider: TrendSignalProvider;
  private readonly debugSummaries = new Map<string, SearchSignalBuildResult["summary"]>();

  constructor(
    private readonly config: SearchProviderConfig = readSearchProviderConfig(),
    private readonly dependencies: SearchTrendSignalProviderDependencies = {}
  ) {
    this.cache = dependencies.cache ?? new InMemorySearchCache<SearchSignalBuildResult>();
    this.fallbackProvider = dependencies.fallbackProvider ?? mockSearchProvider;
  }

  getSignals(productId: string): NormalizedTrendSignal[] {
    const profile = this.profileForProductId(productId);
    if (!profile) return [];

    const cached = this.cache.get(this.cacheKey(productId), this.config.now().getTime());
    if (this.config.mode === "live" && cached?.summary.hasSufficientData) {
      return mergeLiveSignalsWithMockFallback(cached.signals, this.fallbackProvider.getSignals(productId));
    }

    return this.fallbackProvider.getSignals(productId);
  }

  async getSignalsAsync(productId: string): Promise<NormalizedTrendSignal[]> {
    const profile = this.profileForProductId(productId);
    if (!profile) return [];

    return this.getSignalsForProfile(profile);
  }

  async getSignalsForProfile(profile: ProductProfile): Promise<NormalizedTrendSignal[]> {
    if (!shouldUseLiveSearch(this.config)) {
      return this.fallbackProvider.getSignals(profile.productId);
    }

    const productConfig = this.productConfigForProfile(profile);
    const providerDecision = canUseProvider(profile, "dataforseo_trends", "search");
    if (!providerDecision.allowed) {
      return this.fallbackProvider.getSignals(profile.productId);
    }

    const cacheKey = this.cacheKey(profile.productId);
    const cached = this.cache.get(cacheKey, this.config.now().getTime());
    if (cached?.summary.hasSufficientData) {
      return mergeLiveSignalsWithMockFallback(cached.signals, this.fallbackProvider.getSignals(profile.productId));
    }

    try {
      const now = this.config.now();
      const client = this.dependencies.client ?? new DataForSeoTrendsClient(this.config);
      const series = await client.getSearchInterest({
        productId: profile.productId,
        aliases: productConfig.aliases,
        locationCode: this.config.locationCode,
        interestType: this.config.interestType,
        timeRange: this.config.timeRange,
      });
      const result = buildSearchSignalsFromSeries({
        productId: profile.productId,
        series,
        now,
        minSampleSize: this.config.minSampleSize,
      });

      this.debugSummaries.set(profile.productId, result.summary);

      if (!result.summary.hasSufficientData) {
        return this.fallbackProvider.getSignals(profile.productId);
      }

      const volumeSignals = await this.getVolumeSignals(profile, productConfig.aliases, now);
      const resultWithVolume: SearchSignalBuildResult = {
        ...result,
        signals: [...result.signals, ...volumeSignals],
      };

      this.cache.set(cacheKey, resultWithVolume, this.config.cacheTtlMs, this.config.now().getTime());
      return mergeLiveSignalsWithMockFallback(resultWithVolume.signals, this.fallbackProvider.getSignals(profile.productId));
    } catch {
      return this.fallbackProvider.getSignals(profile.productId);
    }
  }

  getDebugSummary(productId: string): SearchSignalBuildResult["summary"] | undefined {
    return this.debugSummaries.get(productId);
  }

  private cacheKey(productId: string): string {
    const profile = this.profileForProductId(productId);
    const productConfig = profile ? this.productConfigForProfile(profile) : this.config.productQueries[productId];
    const windows = buildSearchWindows(this.config.now());
    return [
      "search",
      this.config.provider,
      productId,
      productConfig?.aliases.join("|") ?? "",
      this.config.locationCode,
      this.config.languageCode,
      this.config.interestType,
      this.config.timeRange,
      windows.dateFrom,
      windows.dateTo,
    ].join(":");
  }

  private async getVolumeSignals(
    profile: ProductProfile,
    aliases: string[],
    now: Date
  ): Promise<NormalizedTrendSignal[]> {
    try {
      const providerDecision = canUseProvider(profile, "dataforseo_google_ads", "search");
      if (!providerDecision.allowed) return [];

      const volumeClient = this.dependencies.volumeClient ?? new DataForSeoGoogleAdsSearchVolumeClient(this.config);
      const series = await volumeClient.getSearchVolume({
        productId: profile.productId,
        aliases,
        locationCode: this.config.locationCode,
        languageCode: this.config.languageCode,
      });

      return buildSearchVolumeSignalsFromSeries({
        productId: profile.productId,
        series,
        now,
      });
    } catch {
      return [];
    }
  }

  private profileForProductId(productId: string): ProductProfile | undefined {
    const queryConfig = this.config.productQueries[productId];
    if (queryConfig) {
      return createUserSearchProductProfile(queryConfig.aliases[0] ?? productId, {
        productId,
        aliases: queryConfig.aliases,
        source: "resolved_provider",
        identityConfidence: "medium",
      });
    }

    return this.config.productProfiles?.[productId];
  }

  private productConfigForProfile(profile: ProductProfile) {
    return {
      productId: profile.productId,
      aliases: profile.aliases.length ? profile.aliases : [profile.query],
    };
  }
}

export function createSearchTrendSignalProvider(
  config: SearchProviderConfig = readSearchProviderConfig(),
  dependencies: SearchTrendSignalProviderDependencies = {}
): SearchTrendSignalProvider {
  return new SearchTrendSignalProvider(config, dependencies);
}

export const searchProvider = createSearchTrendSignalProvider();
