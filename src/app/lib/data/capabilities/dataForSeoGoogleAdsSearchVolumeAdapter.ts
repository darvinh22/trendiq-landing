import { DataForSeoGoogleAdsSearchVolumeClient } from "../search/client";
import { readSearchProviderConfig } from "../search/config";
import { buildSearchVolumeSignalsFromSeries } from "../search/signalBuilder";
import type { SearchProviderConfig, SearchVolumeClient, SearchVolumeSeries } from "../search/types";
import type { NormalizedTrendSignal } from "../types";
import type {
  ProviderExecutionAdapter,
  SignalExecutionApproval,
  SignalExecutionStep,
} from "./types";

function exactQueryForStep(step: SignalExecutionStep): string[] {
  const query = step.query.trim();
  return query ? [query] : [];
}

function queryKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function scopedSeriesForApprovedQuery(input: {
  series: SearchVolumeSeries;
  approvedQueries: string[];
}): {
  series: SearchVolumeSeries;
  warnings: string[];
} {
  const approvedQueryKeys = new Set(input.approvedQueries.map(queryKey));
  const observations = input.series.observations.filter((observation) =>
    approvedQueryKeys.has(queryKey(observation.keyword))
  );
  const ignoredObservationCount = input.series.observations.length - observations.length;
  const warnings = [
    ...(ignoredObservationCount > 0
      ? ["DataForSEO Google Ads returned keyword observations outside the approved exact query scope; they were not emitted."]
      : []),
    ...(!observations.length
      ? ["DataForSEO Google Ads returned no usable observation for the approved exact query."]
      : []),
  ];

  return {
    series: {
      ...input.series,
      aliases: input.approvedQueries,
      observations,
      monthlySearchVolume: observations.reduce((sum, observation) => sum + observation.monthlySearchVolume, 0),
    },
    warnings,
  };
}

function controlledNotes(): string {
  return "Produced by controlled DataForSEO Google Ads Search Volume execution for planned signal search_volume_google_ads.";
}

function withControlledProvenance(
  signal: NormalizedTrendSignal,
  approval: SignalExecutionApproval
): NormalizedTrendSignal {
  const existingNotes = signal.sourceProvenance.notes;

  return {
    ...signal,
    sourceProvenance: {
      ...signal.sourceProvenance,
      approvalStatus: "approved",
      liveApiRequestMade: true,
      notes: existingNotes
        ? `${existingNotes} ${controlledNotes()}`
        : controlledNotes(),
    },
    metadata: {
      ...signal.metadata,
      controlledExecutionId: approval.executionId,
      controlledPlanId: approval.planId,
      controlledStepId: approval.stepId,
      controlledApprovedSignal: approval.signal,
      controlledProducedSignal: "search_volume_google_ads",
      controlledApprovedAt: approval.approvedAt,
    },
  };
}

function emittedSignalSummary(signals: NormalizedTrendSignal[]): string {
  return signals.length ? "search_volume_google_ads" : "";
}

export interface CreateDataForSeoGoogleAdsSearchVolumeExecutionAdapterOptions {
  step: SignalExecutionStep;
  client?: SearchVolumeClient;
  config?: SearchProviderConfig;
  now?: () => Date;
}

export function createDataForSeoGoogleAdsSearchVolumeExecutionAdapter(
  options: CreateDataForSeoGoogleAdsSearchVolumeExecutionAdapterOptions
): ProviderExecutionAdapter {
  if (
    options.step.provider !== "dataforseo_google_ads" ||
    options.step.capability !== "search" ||
    options.step.signal !== "search_volume_google_ads"
  ) {
    throw new Error("DataForSEO Google Ads Search Volume adapter requires a dataforseo_google_ads search-volume plan step.");
  }

  const config = options.config ?? readSearchProviderConfig();
  const client = options.client ?? new DataForSeoGoogleAdsSearchVolumeClient(config);
  const now = options.now ?? config.now;

  return {
    provider: "dataforseo_google_ads",
    capability: options.step.capability,
    signal: options.step.signal,
    logicalOperationCount: 1,
    expectedHttpRequestCount: 1,
    async execute({ step, approval }) {
      const aliases = exactQueryForStep(step);
      if (!aliases.length) {
        throw new Error("DataForSEO Google Ads Search Volume execution requires a non-empty planned exact query.");
      }

      const series = await client.getSearchVolume({
        productId: step.productId,
        aliases,
        locationCode: config.locationCode,
        languageCode: config.languageCode,
      });
      const scoped = scopedSeriesForApprovedQuery({ series, approvedQueries: aliases });
      const signals = scoped.series.observations.length
        ? buildSearchVolumeSignalsFromSeries({
            productId: step.productId,
            series: scoped.series,
            now: now(),
          }).map((signal) => withControlledProvenance(signal, approval))
        : [];
      const weeklySignal = signals.find((signal) => signal.metadata?.engineField === "searchVolume7d");

      return {
        provenance: {
          mode: "live",
          provider: "dataforseo_google_ads",
          observedAt: series.fetchedAt,
          notes: "Controlled DataForSEO Google Ads Search Volume execution completed.",
        },
        observedAt: series.fetchedAt,
        operationCount: 1,
        httpRequestCount: 1,
        paidLiveOperationsPerformed: 1,
        reportedProviderCost: series.cost,
        signals,
        warnings: scoped.warnings,
        metadata: {
          provider: "dataforseo_google_ads",
          adapter: "dataforseo_google_ads_search_volume",
          approvedSignal: approval.signal,
          producedSignals: emittedSignalSummary(signals),
          emittedSignalCount: signals.length,
          approvedExactQuery: aliases[0],
          approvedQueryCount: aliases.length,
          observationsReturned: series.observations.length,
          observationsEmitted: scoped.series.observations.length,
          sourceEndpoint: series.endpoint,
          sourceCost: series.cost,
          monthlySearchVolume: scoped.series.monthlySearchVolume,
          estimated7dSearchVolume: weeklySignal?.value,
          locationCode: series.locationCode,
          languageCode: series.languageCode ?? config.languageCode,
          matchedKeywords: scoped.series.observations.map((observation) => observation.keyword).join(","),
        },
      };
    },
  };
}
