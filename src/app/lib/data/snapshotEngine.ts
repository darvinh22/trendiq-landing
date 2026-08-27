import { calculateConfidenceScore } from "../scoring/confidenceEngine";
import { calculateTrendMomentum } from "../scoring/momentumEngine";
import { calculateTrendIQScore } from "../scoring/scoreEngine";
import { DATA_LAYER_TIMESTAMP } from "./mockProviderSignals";
import { mockTrendSignalProviders } from "./providers";
import { calculateHistoricalMomentum } from "./history";
import { buildTrendIQSnapshotProvenanceSummary } from "./liveDataAudit";
import { buildSearchMomentumV1 } from "./searchMomentum";
import { aggregateSignals } from "./signalAggregator";
import type {
  AsyncTrendSignalProvider,
  HistoricalTrendSnapshot,
  NormalizedTrendSignal,
  ProductTrendSnapshot,
  SnapshotSourceMode,
  TrendSignalProvider,
} from "./types";

export interface BuildProductTrendSnapshotOptions {
  timestamp?: string;
  historicalSnapshots?: HistoricalTrendSnapshot[];
  sourceMode?: SnapshotSourceMode;
}

export function collectProviderSignals(
  productId: string,
  providers: readonly TrendSignalProvider[] = mockTrendSignalProviders
): NormalizedTrendSignal[] {
  return providers.flatMap((provider) => provider.getSignals(productId));
}

function isAsyncProvider(provider: TrendSignalProvider): provider is AsyncTrendSignalProvider {
  return typeof (provider as AsyncTrendSignalProvider).getSignalsAsync === "function";
}

function calculateSnapshotTrendStatus(
  aggregation: ReturnType<typeof aggregateSignals>,
  historicalSnapshots?: HistoricalTrendSnapshot[]
) {
  if (historicalSnapshots?.length) {
    return calculateHistoricalMomentum(historicalSnapshots);
  }

  return calculateTrendMomentum({
    changePercent: aggregation.aggregatedSignals.growthVelocity.trendChangePercent,
    current7dRelativeInterest: aggregation.aggregatedSignals.searchMomentum.current7dRelativeInterest,
    previous7dRelativeInterest: aggregation.aggregatedSignals.searchMomentum.previous7dRelativeInterest,
    hasSearchGrowthContext: aggregation.aggregatedSignals.growthVelocity.hasSearchDerivedVelocity,
    hasLowBaseSearchGrowth: aggregation.aggregatedSignals.searchMomentum.hasLowBaseSearchGrowth,
  });
}

export async function collectProviderSignalsAsync(
  productId: string,
  providers: readonly TrendSignalProvider[] = mockTrendSignalProviders
): Promise<NormalizedTrendSignal[]> {
  const signalGroups = await Promise.all(
    providers.map((provider) =>
      isAsyncProvider(provider)
        ? provider.getSignalsAsync(productId)
        : Promise.resolve(provider.getSignals(productId))
    )
  );

  return signalGroups.flat();
}

export function buildProductTrendSnapshot(
  productId: string,
  providers: readonly TrendSignalProvider[] = mockTrendSignalProviders,
  options: BuildProductTrendSnapshotOptions = {}
): ProductTrendSnapshot {
  const timestamp = options.timestamp ?? DATA_LAYER_TIMESTAMP;
  const sourceMode = options.sourceMode ?? "mock";
  const rawSignals = collectProviderSignals(productId, providers);
  const aggregation = aggregateSignals(productId, rawSignals, timestamp);
  const trendIQScore = calculateTrendIQScore(aggregation.aggregatedSignals);
  const confidence = calculateConfidenceScore(aggregation.confidenceSignals);
  const trendStatus = calculateSnapshotTrendStatus(aggregation, options.historicalSnapshots);
  const liveDataAudit = buildTrendIQSnapshotProvenanceSummary({
    sourceMode,
    rawSignals: aggregation.rawSignals,
    trendIQScore,
    confidence,
    trendStatus,
  });
  const searchMomentumV1 = buildSearchMomentumV1({
    aggregatedSignals: aggregation.aggregatedSignals,
    rawSignals: aggregation.rawSignals,
  });

  return {
    productId,
    timestamp,
    sourceMode,
    rawSignals: aggregation.rawSignals,
    aggregatedSignals: aggregation.aggregatedSignals,
    trendIQScore,
    confidence,
    trendStatus,
    provenance: aggregation.provenance,
    liveDataAudit,
    searchMomentumV1,
  };
}

export async function buildProductTrendSnapshotAsync(
  productId: string,
  providers: readonly TrendSignalProvider[] = mockTrendSignalProviders,
  options: BuildProductTrendSnapshotOptions = {}
): Promise<ProductTrendSnapshot> {
  const timestamp = options.timestamp ?? DATA_LAYER_TIMESTAMP;
  const sourceMode = options.sourceMode ?? "mock";
  const rawSignals = await collectProviderSignalsAsync(productId, providers);
  const aggregation = aggregateSignals(productId, rawSignals, timestamp);
  const trendIQScore = calculateTrendIQScore(aggregation.aggregatedSignals);
  const confidence = calculateConfidenceScore(aggregation.confidenceSignals);
  const trendStatus = calculateSnapshotTrendStatus(aggregation, options.historicalSnapshots);
  const liveDataAudit = buildTrendIQSnapshotProvenanceSummary({
    sourceMode,
    rawSignals: aggregation.rawSignals,
    trendIQScore,
    confidence,
    trendStatus,
  });
  const searchMomentumV1 = buildSearchMomentumV1({
    aggregatedSignals: aggregation.aggregatedSignals,
    rawSignals: aggregation.rawSignals,
  });

  return {
    productId,
    timestamp,
    sourceMode,
    rawSignals: aggregation.rawSignals,
    aggregatedSignals: aggregation.aggregatedSignals,
    trendIQScore,
    confidence,
    trendStatus,
    provenance: aggregation.provenance,
    liveDataAudit,
    searchMomentumV1,
  };
}
