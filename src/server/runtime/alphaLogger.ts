import type { ProductAnalysisSafeReason } from "../../app/lib/analysis/productAnalysisContract";
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

function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeReason(value: ProductAnalysisSafeReason | undefined): ProductAnalysisSafeReason | undefined {
  return value && SAFE_REASONS.has(value) ? value : undefined;
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
