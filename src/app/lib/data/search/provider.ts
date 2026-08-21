import { InMemorySearchCache, type SearchCache } from "./cache";
import { DataForSeoTrendsClient } from "./client";
import { readSearchProviderConfig, shouldUseLiveSearch } from "./config";
import { mockSearchProvider } from "./mockSearchProvider";
import { buildSearchWindows } from "./normalization";
import { buildSearchSignalsFromSeries } from "./signalBuilder";
import type { SearchInterestClient, SearchProviderConfig, SearchSignalBuildResult } from "./types";
import type { AsyncTrendSignalProvider, NormalizedTrendSignal, TrendSignalProvider } from "../types";

const source = "searchWeb" as const;
const label = "Search/Web interest";

export interface SearchTrendSignalProviderDependencies {
  client?: SearchInterestClient;
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
    const productConfig = this.config.productQueries[productId];
    if (!productConfig) return [];

    const cached = this.cache.get(this.cacheKey(productId), this.config.now().getTime());
    if (this.config.mode === "live" && cached?.summary.hasSufficientData) {
      return mergeLiveSignalsWithMockFallback(cached.signals, this.fallbackProvider.getSignals(productId));
    }

    return this.fallbackProvider.getSignals(productId);
  }

  async getSignalsAsync(productId: string): Promise<NormalizedTrendSignal[]> {
    const productConfig = this.config.productQueries[productId];
    if (!productConfig) return [];

    if (!shouldUseLiveSearch(this.config)) {
      return this.fallbackProvider.getSignals(productId);
    }

    const cacheKey = this.cacheKey(productId);
    const cached = this.cache.get(cacheKey, this.config.now().getTime());
    if (cached?.summary.hasSufficientData) {
      return mergeLiveSignalsWithMockFallback(cached.signals, this.fallbackProvider.getSignals(productId));
    }

    try {
      const now = this.config.now();
      const client = this.dependencies.client ?? new DataForSeoTrendsClient(this.config);
      const series = await client.getSearchInterest({
        productId,
        aliases: productConfig.aliases,
        locationCode: this.config.locationCode,
        interestType: this.config.interestType,
        timeRange: this.config.timeRange,
      });
      const result = buildSearchSignalsFromSeries({
        productId,
        series,
        now,
        minSampleSize: this.config.minSampleSize,
      });

      this.debugSummaries.set(productId, result.summary);

      if (!result.summary.hasSufficientData) {
        return this.fallbackProvider.getSignals(productId);
      }

      this.cache.set(cacheKey, result, this.config.cacheTtlMs, this.config.now().getTime());
      return mergeLiveSignalsWithMockFallback(result.signals, this.fallbackProvider.getSignals(productId));
    } catch {
      return this.fallbackProvider.getSignals(productId);
    }
  }

  getDebugSummary(productId: string): SearchSignalBuildResult["summary"] | undefined {
    return this.debugSummaries.get(productId);
  }

  private cacheKey(productId: string): string {
    const productConfig = this.config.productQueries[productId];
    const windows = buildSearchWindows(this.config.now());
    return [
      "search",
      this.config.provider,
      productId,
      productConfig?.aliases.join("|") ?? "",
      this.config.locationCode,
      this.config.interestType,
      this.config.timeRange,
      windows.dateFrom,
      windows.dateTo,
    ].join(":");
  }
}

export function createSearchTrendSignalProvider(
  config: SearchProviderConfig = readSearchProviderConfig(),
  dependencies: SearchTrendSignalProviderDependencies = {}
): SearchTrendSignalProvider {
  return new SearchTrendSignalProvider(config, dependencies);
}

export const searchProvider = createSearchTrendSignalProvider();
