import { InMemorySignalExecutionStateStore } from "../../app/lib/data/capabilities/signalExecutor";
import type { ProductProfile } from "../../app/lib/data/capabilities/types";
import {
  createScopedSignalExecutionApproval,
  runControlledLiveSearchToScore,
  type ControlledProviderExecutionDiagnostic,
} from "../../app/lib/data/controlledLiveSearchPipeline";
import {
  DataForSeoGoogleShoppingProductsClient,
  DataForSeoGoogleShoppingReviewsClient,
} from "../../app/lib/data/reviews/client";
import { readReviewProviderConfig, shouldUseLiveReviews } from "../../app/lib/data/reviews/config";
import { ReviewQualitySignalProvider } from "../../app/lib/data/providers/reviewsProvider";
import {
  DataForSeoGoogleAdsSearchVolumeClient,
  DataForSeoTrendsClient,
  type FetchLike,
} from "../../app/lib/data/search/client";
import { readSearchProviderConfig, shouldUseLiveSearch } from "../../app/lib/data/search/config";
import type { NormalizedTrendSignal, TrendSignalProvider } from "../../app/lib/data/types";
import { ProviderRequestBudget, type ProviderRequestUsage } from "./providerRequestBudget";
import type { RuntimeEnvironment } from "../runtime/runtimeConfig";
import type { ProcessPaidOperationGuard } from "../runtime/processPaidOperationGuard";
import { NOOP_ALPHA_LOGGER, type AlphaLogger } from "../runtime/alphaLogger";

export type EvidencePathStatus = "completed" | "unavailable";

export interface AnalysisEvidenceCollection {
  productId: string;
  searchStatus: EvidencePathStatus;
  reviewStatus: EvidencePathStatus;
  signals: NormalizedTrendSignal[];
  usage: ProviderRequestUsage;
  processPaidOperationRejected?: boolean;
}

export interface AnalysisExecutionContext {
  canRequest?: () => boolean;
  onUsage?: (usage: ProviderRequestUsage) => void;
}

export interface AnalysisEvidenceCollector {
  collect(
    profile: ProductProfile,
    now: () => Date,
    context?: AnalysisExecutionContext
  ): Promise<AnalysisEvidenceCollection>;
}

const EMPTY_REVIEW_FALLBACK: TrendSignalProvider = {
  id: "reviews",
  label: "No fabricated review fallback",
  getSignals: () => [],
};

function logProviderExecution(
  logger: AlphaLogger,
  diagnostic: ControlledProviderExecutionDiagnostic
): void {
  logger.log({ event: "provider_execution", ...diagnostic });
}

function runtimeFetch(): FetchLike | undefined {
  const fetchImpl = (globalThis as { fetch?: unknown }).fetch;
  return typeof fetchImpl === "function" ? fetchImpl as FetchLike : undefined;
}

export class ProductionAnalysisEvidenceCollector implements AnalysisEvidenceCollector {
  constructor(private readonly options: {
    env?: RuntimeEnvironment;
    fetchImpl?: FetchLike;
    logger?: AlphaLogger;
    processPaidOperationGuard?: ProcessPaidOperationGuard;
  } = {}) {}

  async collect(
    profile: ProductProfile,
    now: () => Date,
    context: AnalysisExecutionContext = {}
  ): Promise<AnalysisEvidenceCollection> {
    const fetchImpl = this.options.fetchImpl ?? runtimeFetch();
    if (!fetchImpl) {
      return {
        productId: profile.productId,
        searchStatus: "unavailable",
        reviewStatus: "unavailable",
        signals: [],
        usage: { httpRequestCount: 0, paidOperationCount: 0, taskPostCount: 0 },
      };
    }

    let processPaidOperationRejected = false;
    const budget = new ProviderRequestBudget(
      fetchImpl,
      undefined,
      undefined,
      undefined,
      {
        canRequest: context.canRequest,
        onProcessPaidOperationRejected: () => {
          processPaidOperationRejected = true;
        },
        onUsage: context.onUsage,
        processPaidOperationGuard: this.options.processPaidOperationGuard,
      }
    );
    const executionState = new InMemorySignalExecutionStateStore();
    const searchConfig = readSearchProviderConfig(this.options.env, { now });
    const reviewBaseConfig = readReviewProviderConfig(this.options.env, { now });
    const reviewConfig = {
      ...reviewBaseConfig,
      taskPollAttempts: Math.min(reviewBaseConfig.taskPollAttempts, 3),
      taskPollIntervalMs: Math.min(reviewBaseConfig.taskPollIntervalMs, 250),
    };
    const signals: NormalizedTrendSignal[] = [];
    let searchStatus: EvidencePathStatus = "unavailable";
    let reviewStatus: EvidencePathStatus = "unavailable";

    if (shouldUseLiveSearch(searchConfig)) {
      try {
        const searchResult = await runControlledLiveSearchToScore({
          query: profile.query,
          stateStore: executionState,
          searchConfig,
          searchClient: new DataForSeoTrendsClient(searchConfig, budget.fetch),
          searchVolumeClient: new DataForSeoGoogleAdsSearchVolumeClient(searchConfig, budget.fetch),
          now,
          onExecutionDiagnostic: (diagnostic) =>
            logProviderExecution(this.options.logger ?? NOOP_ALPHA_LOGGER, diagnostic),
          approve: ({ plan, trendsSteps, googleAdsSearchVolumeStep }) => [
            ...trendsSteps,
            ...(googleAdsSearchVolumeStep ? [googleAdsSearchVolumeStep] : []),
          ]
            .filter((step) => step.futureExecutionEligibility === "eligible")
            .map((step) => createScopedSignalExecutionApproval({ plan, step, maxOperations: 1 })),
        });

        if (
          searchResult.resolution.profile.productId === profile.productId &&
          searchResult.plan.product.productId === profile.productId
        ) {
          signals.push(...searchResult.rawSignals);
          searchStatus = searchResult.executionResults.some((result) => result.status === "completed")
            ? "completed"
            : "unavailable";
        }
      } catch {
        searchStatus = "unavailable";
      }
    }

    if (shouldUseLiveReviews(reviewConfig)) {
      try {
        const reviewProvider = new ReviewQualitySignalProvider(reviewConfig, {
          client: new DataForSeoGoogleShoppingProductsClient(reviewConfig, budget.fetch),
          recentReviewsClient: new DataForSeoGoogleShoppingReviewsClient(reviewConfig, budget.fetch),
          fallbackProvider: EMPTY_REVIEW_FALLBACK,
        });
        const reviewSignals = await reviewProvider.getSignalsForProfile(profile);
        signals.push(...reviewSignals);
        reviewStatus = reviewSignals.some((signal) =>
          signal.source === "reviews" &&
          (signal.sourceProvenance.mode === "live" || signal.sourceProvenance.mode === "derived-live")
        ) ? "completed" : "unavailable";
      } catch {
        reviewStatus = "unavailable";
      }
    }

    return {
      productId: profile.productId,
      searchStatus,
      reviewStatus,
      signals,
      usage: budget.usage(),
      processPaidOperationRejected,
    };
  }
}
