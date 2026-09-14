import { DataForSeoTrendsClient } from "../search/client";
import { readSearchProviderConfig } from "../search/config";
import { buildSearchSignalsFromSeries } from "../search/signalBuilder";
import type {
  SearchInterestClient,
  SearchProviderConfig,
  SearchSignalBuildResult,
} from "../search/types";
import type { NormalizedTrendSignal } from "../types";
import type {
  ProviderExecutionAdapter,
  SignalExecutionApproval,
  SignalExecutionStep,
  TrendIQPlannedSignal,
} from "./types";

type DataForSeoTrendsPlannedSignal =
  | "search_momentum_trends"
  | "growth_velocity_trends";

export interface CreateDataForSeoTrendsExecutionAdapterOptions {
  step: SignalExecutionStep;
  client?: SearchInterestClient;
  config?: SearchProviderConfig;
  producedSignals?: readonly TrendIQPlannedSignal[];
  now?: () => Date;
  minSampleSize?: number;
}

function isDataForSeoTrendsPlannedSignal(value: TrendIQPlannedSignal): value is DataForSeoTrendsPlannedSignal {
  return value === "search_momentum_trends" || value === "growth_velocity_trends";
}

function plannedSignalForNormalizedSignal(
  signal: NormalizedTrendSignal
): DataForSeoTrendsPlannedSignal | undefined {
  if (signal.signalType === "searchMomentum") return "search_momentum_trends";
  if (signal.signalType === "growthVelocity") return "growth_velocity_trends";
  return undefined;
}

function producedSignalSet(
  step: SignalExecutionStep,
  producedSignals: readonly TrendIQPlannedSignal[] | undefined
): Set<DataForSeoTrendsPlannedSignal> {
  const requested = producedSignals?.length ? producedSignals : [step.signal];
  const scoped = requested.filter(isDataForSeoTrendsPlannedSignal);
  return new Set(scoped.length ? scoped : [step.signal].filter(isDataForSeoTrendsPlannedSignal));
}

function controlledNotes(signal: DataForSeoTrendsPlannedSignal): string {
  return `Produced by controlled DataForSEO Trends execution for planned signal ${signal}.`;
}

function withControlledProvenance(
  signal: NormalizedTrendSignal,
  approval: SignalExecutionApproval,
  producedSignal: DataForSeoTrendsPlannedSignal
): NormalizedTrendSignal {
  const existingNotes = signal.sourceProvenance.notes;

  return {
    ...signal,
    sourceProvenance: {
      ...signal.sourceProvenance,
      approvalStatus: "approved",
      liveApiRequestMade: true,
      notes: existingNotes
        ? `${existingNotes} ${controlledNotes(producedSignal)}`
        : controlledNotes(producedSignal),
    },
    metadata: {
      ...signal.metadata,
      controlledExecutionId: approval.executionId,
      controlledPlanId: approval.planId,
      controlledStepId: approval.stepId,
      controlledApprovedSignal: approval.signal,
      controlledProducedSignal: producedSignal,
      controlledApprovedAt: approval.approvedAt,
    },
  };
}

function filterAndAnnotateSignals(input: {
  result: SearchSignalBuildResult;
  approval: SignalExecutionApproval;
  allowedProducedSignals: Set<DataForSeoTrendsPlannedSignal>;
}): NormalizedTrendSignal[] {
  return input.result.signals.flatMap((signal) => {
    const producedSignal = plannedSignalForNormalizedSignal(signal);
    if (!producedSignal || !input.allowedProducedSignals.has(producedSignal)) return [];

    return [withControlledProvenance(signal, input.approval, producedSignal)];
  });
}

function emittedSignalSummary(signals: NormalizedTrendSignal[]): string {
  return [...new Set(signals.map((signal) => signal.metadata?.controlledProducedSignal))]
    .filter((value): value is string => typeof value === "string")
    .sort()
    .join(",");
}

export function createDataForSeoTrendsExecutionAdapter(
  options: CreateDataForSeoTrendsExecutionAdapterOptions
): ProviderExecutionAdapter {
  if (options.step.provider !== "dataforseo_trends" || !isDataForSeoTrendsPlannedSignal(options.step.signal)) {
    throw new Error("DataForSEO Trends adapter requires a dataforseo_trends search or growth plan step.");
  }

  const config = options.config ?? readSearchProviderConfig();
  const client = options.client ?? new DataForSeoTrendsClient(config);
  const now = options.now ?? config.now;
  const minSampleSize = options.minSampleSize ?? config.minSampleSize;
  const allowedProducedSignals = producedSignalSet(options.step, options.producedSignals);

  return {
    provider: "dataforseo_trends",
    capability: options.step.capability,
    signal: options.step.signal,
    logicalOperationCount: 1,
    expectedHttpRequestCount: 1,
    async execute({ step, approval }) {
      const series = await client.getSearchInterest({
        productId: step.productId,
        aliases: [step.query],
        locationCode: config.locationCode,
        interestType: config.interestType,
        timeRange: config.timeRange,
      });
      const result = buildSearchSignalsFromSeries({
        productId: step.productId,
        series,
        now: now(),
        minSampleSize,
      });
      const signals = filterAndAnnotateSignals({ result, approval, allowedProducedSignals });
      const warnings = [
        ...(!result.summary.hasSufficientData
          ? ["DataForSEO Trends returned insufficient evidence for supported 7-day percent-change scoring signals."]
          : []),
        ...(signals.length < result.signals.length
          ? ["DataForSEO Trends signals outside the explicitly approved planned signal scope were not emitted."]
          : []),
      ];

      return {
        provenance: {
          mode: "live",
          provider: "dataforseo_trends",
          observedAt: series.fetchedAt,
          notes: "Controlled DataForSEO Trends execution completed.",
        },
        observedAt: series.fetchedAt,
        operationCount: 1,
        httpRequestCount: 1,
        paidLiveOperationsPerformed: 1,
        reportedProviderCost: series.cost,
        signals,
        warnings,
        metadata: {
          provider: "dataforseo_trends",
          adapter: "dataforseo_trends_search_interest",
          approvedSignal: approval.signal,
          producedSignals: emittedSignalSummary(signals),
          emittedSignalCount: signals.length,
          hasSufficientData: result.summary.hasSufficientData,
          evidenceQuality: result.summary.evidenceQuality,
          current7dEvidenceQuality: result.summary.current7dEvidenceQuality,
          previous7dEvidenceQuality: result.summary.previous7dEvidenceQuality,
          prior7dEvidenceQuality: result.summary.prior7dEvidenceQuality,
          change7dEvidenceQuality: result.summary.change7dEvidenceQuality,
          previous7dChangeEvidenceQuality: result.summary.previous7dChangeEvidenceQuality,
          accelerationEvidenceQuality: result.summary.accelerationEvidenceQuality,
          aliasesUsed: result.summary.aliasesUsed.join(","),
          queriesMatched: result.summary.queriesMatched,
          current7dInterest: result.summary.current7dInterest,
          previous7dInterest: result.summary.previous7dInterest,
          change7dPercent: result.summary.change7dPercent,
          observationCount: result.summary.observationCount,
          missingValueCount: result.summary.missingValueCount,
          current7dObservedValueCount: result.summary.current7dObservedValueCount,
          previous7dObservedValueCount: result.summary.previous7dObservedValueCount,
          prior7dObservedValueCount: result.summary.prior7dObservedValueCount,
          aliasCoveragePercent: result.summary.aliasCoveragePercent,
        },
      };
    },
  };
}
