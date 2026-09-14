import type { ProductAnalysisSafeReason } from "../../app/lib/analysis/productAnalysisContract";
import type {
  LiveProviderId,
  SignalExecutionBlockReason,
  SignalExecutionStatus,
  TrendIQPlannedSignal,
} from "../../app/lib/data/capabilities/types";
import type { ProviderRequestUsage } from "../analysis/providerRequestBudget";

export type AlphaLogEvent =
  | {
      event: "analysis_started";
      analysisId: string;
      productId: string;
      jobState: "pending";
      startedAt: string;
    }
  | ({
      event: "analysis_settled";
      analysisId: string;
      productId: string;
      jobState: "settled";
      startedAt: string;
      completedAt: string;
      durationMs: number;
      finalStatus: "completed" | "unavailable" | "error";
      reason?: ProductAnalysisSafeReason;
    } & ProviderRequestUsage)
  | {
      event: "analysis_rejected";
      productId: string;
      jobState: "rejected";
      startedAt: string;
      finalStatus: "unavailable";
      reason: ProductAnalysisSafeReason;
    }
  | {
      event: "provider_execution";
      provider: LiveProviderId;
      signal: TrendIQPlannedSignal;
      executionStatus: SignalExecutionStatus;
      blockReason?: SignalExecutionBlockReason;
      emittedSignalCount: number;
      warningCount: number;
    };

export interface AlphaLogger {
  log(event: AlphaLogEvent): void;
}

export type AlphaLogWriter = (serializedEvent: string) => void;

const SAFE_REASONS = new Set<ProductAnalysisSafeReason>([
  "analysis_deadline_exceeded",
  "analysis_disabled",
  "analysis_failed",
  "analysis_not_found",
  "evidence_unavailable",
  "invalid_request",
  "process_paid_operation_ceiling_exhausted",
  "product_binding_mismatch",
  "product_not_supported",
  "runtime_not_ready",
]);

const SAFE_PROVIDERS = new Set<LiveProviderId>([
  "dataforseo_trends",
  "dataforseo_google_ads",
  "dataforseo_google_shopping",
  "dataforseo_google_shopping_reviews",
  "reddit",
]);

const SAFE_SIGNALS = new Set<TrendIQPlannedSignal>([
  "search_momentum_trends",
  "search_volume_google_ads",
  "growth_velocity_trends",
  "review_quality_google_shopping_aggregate",
  "review_quality_google_shopping_reviews",
]);

const SAFE_EXECUTION_STATUSES = new Set<SignalExecutionStatus>([
  "blocked",
  "completed",
  "failed",
]);

const SAFE_BLOCK_REASONS = new Set<SignalExecutionBlockReason>([
  "explicit_live_approval_required",
  "approval_rejected",
  "approval_scope_mismatch",
  "plan_step_scope_mismatch",
  "execution_state_store_required",
  "state_persistence_failed",
  "operation_count_invalid",
  "operation_budget_exceeded",
  "operation_safety_violation",
  "duplicate_execution",
  "adapter_mismatch",
  "needs_product_identity",
  "needs_provider_identity",
  "needs_guardrail",
  "blocked_by_provider_policy",
  "unsupported_capability",
  "adapter_failed",
]);

function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeReason(value: ProductAnalysisSafeReason | undefined): ProductAnalysisSafeReason | undefined {
  return value && SAFE_REASONS.has(value) ? value : undefined;
}

function safeProvider(value: LiveProviderId): LiveProviderId | undefined {
  return SAFE_PROVIDERS.has(value) ? value : undefined;
}

function safeSignal(value: TrendIQPlannedSignal): TrendIQPlannedSignal | undefined {
  return SAFE_SIGNALS.has(value) ? value : undefined;
}

function safeExecutionStatus(value: SignalExecutionStatus): SignalExecutionStatus | undefined {
  return SAFE_EXECUTION_STATUSES.has(value) ? value : undefined;
}

function safeBlockReason(value: SignalExecutionBlockReason | undefined): SignalExecutionBlockReason | undefined {
  return value && SAFE_BLOCK_REASONS.has(value) ? value : undefined;
}

function projectSafeEvent(event: AlphaLogEvent): Record<string, unknown> | null {
  if (event.event === "analysis_started") {
    return {
      event: "analysis_started",
      analysisId: event.analysisId,
      productId: event.productId,
      jobState: "pending",
      startedAt: event.startedAt,
    };
  }

  if (event.event === "analysis_settled") {
    const reason = safeReason(event.reason);
    return {
      event: "analysis_settled",
      analysisId: event.analysisId,
      productId: event.productId,
      jobState: "settled",
      startedAt: event.startedAt,
      completedAt: event.completedAt,
      durationMs: safeCount(event.durationMs),
      httpRequestCount: safeCount(event.httpRequestCount),
      paidOperationCount: safeCount(event.paidOperationCount),
      taskPostCount: safeCount(event.taskPostCount),
      finalStatus: event.finalStatus,
      ...(reason ? { reason } : {}),
    };
  }

  if (event.event === "analysis_rejected") {
    return {
      event: "analysis_rejected",
      productId: event.productId,
      jobState: "rejected",
      startedAt: event.startedAt,
      finalStatus: "unavailable",
      reason: safeReason(event.reason) ?? "analysis_failed",
    };
  }

  if (event.event === "provider_execution") {
    const provider = safeProvider(event.provider);
    const signal = safeSignal(event.signal);
    const executionStatus = safeExecutionStatus(event.executionStatus);
    if (!provider || !signal || !executionStatus) return null;

    const blockReason = executionStatus === "completed"
      ? undefined
      : safeBlockReason(event.blockReason);
    return {
      event: "provider_execution",
      provider,
      signal,
      executionStatus,
      ...(blockReason ? { blockReason } : {}),
      emittedSignalCount: safeCount(event.emittedSignalCount),
      warningCount: safeCount(event.warningCount),
    };
  }

  return null;
}

export class SanitizedAlphaLogger implements AlphaLogger {
  constructor(private readonly write: AlphaLogWriter = (line) => console.log(line)) {}

  log(event: AlphaLogEvent): void {
    try {
      const safeEvent = projectSafeEvent(event);
      if (safeEvent) this.write(JSON.stringify(safeEvent));
    } catch {
      // Logging must never change the analysis result or expose a secondary error.
    }
  }
}

export const NOOP_ALPHA_LOGGER: AlphaLogger = { log: () => undefined };
