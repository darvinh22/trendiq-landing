import { useCallback, useEffect, useReducer } from "react";
import { ArrowLeft, LoaderCircle, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { ConsumerResultPanel } from "./ConsumerResultPanel";
import {
  productAnalysisClient,
  type ProductAnalysisClientResponse,
  type ProductAnalysisExecutionClient,
} from "../lib/analysis/productAnalysisClient";
import type {
  ControlledProductCatalogItem,
  ProductAnalysisSafeReason,
} from "../lib/analysis/productAnalysisContract";
import type { ConsumerProductResult } from "../lib/data/consumerResult";

export const PRODUCT_ANALYSIS_POLL_INTERVAL_MS = 750;
export const PRODUCT_ANALYSIS_MAX_POLL_ATTEMPTS = 80;

export type ProductAnalysisUiReason = ProductAnalysisSafeReason | "request_failed";

export type ProductAnalysisUiState =
  | { phase: "idle" }
  | { phase: "analyzing" }
  | { phase: "pending"; analysisId: string }
  | { phase: "polling_timeout" }
  | { phase: "completed"; result: ConsumerProductResult }
  | { phase: "unavailable"; reason: ProductAnalysisUiReason }
  | { phase: "error"; reason: ProductAnalysisUiReason };

export type ProductAnalysisUiAction =
  | { type: "analyze" }
  | { type: "response"; response: ProductAnalysisClientResponse }
  | { type: "pollingDeadline" }
  | { type: "retry" };

export function productAnalysisUiReducer(
  state: ProductAnalysisUiState,
  action: ProductAnalysisUiAction
): ProductAnalysisUiState {
  if (action.type === "analyze") return { phase: "analyzing" };
  if (action.type === "retry") return { phase: "idle" };
  if (action.type === "pollingDeadline") return { phase: "polling_timeout" };

  const response = action.response;
  if (response.status === "pending") return { phase: "pending", analysisId: response.analysisId };
  if (response.status === "completed") return { phase: "completed", result: response.result };
  if (response.status === "unavailable") return { phase: "unavailable", reason: response.reason };
  return { phase: "error", reason: response.reason };
}

export type ProductAnalysisPollingOutcome =
  | { status: "settled"; response: Exclude<ProductAnalysisClientResponse, { status: "pending" }> }
  | { status: "deadline" }
  | { status: "cancelled" };

interface ProductAnalysisPollingOptions {
  maxAttempts?: number;
  intervalMs?: number;
  wait?: (delayMs: number) => Promise<void>;
  shouldStop?: () => boolean;
}

function waitFor(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function pollProductAnalysisUntilSettled(
  client: ProductAnalysisExecutionClient,
  analysisId: string,
  options: ProductAnalysisPollingOptions = {}
): Promise<ProductAnalysisPollingOutcome> {
  const maxAttempts = options.maxAttempts ?? PRODUCT_ANALYSIS_MAX_POLL_ATTEMPTS;
  const intervalMs = options.intervalMs ?? PRODUCT_ANALYSIS_POLL_INTERVAL_MS;
  const wait = options.wait ?? waitFor;
  const shouldStop = options.shouldStop ?? (() => false);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await wait(intervalMs);
    if (shouldStop()) return { status: "cancelled" };

    let response: ProductAnalysisClientResponse;
    try {
      response = await client.getStatus(analysisId);
    } catch {
      response = { status: "error", reason: "request_failed" };
    }
    if (shouldStop()) return { status: "cancelled" };
    if (response.status !== "pending") return { status: "settled", response };
  }

  return { status: "deadline" };
}

export async function requestProductAnalysis(
  client: ProductAnalysisExecutionClient,
  productId: string
): Promise<ProductAnalysisClientResponse> {
  try {
    return await client.start(productId);
  } catch {
    return { status: "error", reason: "request_failed" };
  }
}

interface ProductAnalysisViewProps {
  product: ControlledProductCatalogItem;
  state: Exclude<ProductAnalysisUiState, { phase: "completed" }>;
  onAnalyze: () => void;
  onRetry: () => void;
  onBack: () => void;
}

function safeReasonText(reason: ProductAnalysisUiReason): string {
  if (reason === "product_not_supported") return "This product is not available for analysis.";
  if (reason === "evidence_unavailable") {
    return "There is not enough supported evidence to complete this analysis right now.";
  }
  if (reason === "analysis_disabled") return "Analysis is temporarily unavailable.";
  if (reason === "process_paid_operation_ceiling_exhausted") {
    return "The private alpha has reached its analysis limit. No new analysis was started.";
  }
  if (reason === "analysis_deadline_exceeded") {
    return "This analysis took too long to complete. No new analysis was started.";
  }
  if (reason === "runtime_not_ready") return "Analysis is temporarily unavailable. Please come back later.";
  if (reason === "analysis_not_found") return "This analysis is no longer available. You can start a new attempt.";
  if (reason === "invalid_request") return "This analysis request could not be accepted.";
  if (reason === "product_binding_mismatch") return "This result could not be verified for the selected product.";
  if (reason === "request_failed") return "Something interrupted this request. You can try again.";
  return "This analysis could not be completed. Please come back later.";
}

export function canRetryProductAnalysis(state: ProductAnalysisUiState): boolean {
  if (state.phase === "polling_timeout") return true;
  if (state.phase === "error") return state.reason === "request_failed" || state.reason === "analysis_not_found";
  return state.phase === "unavailable" && state.reason === "analysis_not_found";
}

function terminalStateText(state: ProductAnalysisUiState): string | null {
  if (state.phase === "unavailable" || state.phase === "error") return safeReasonText(state.reason);
  if (state.phase === "polling_timeout") {
    return "This analysis is taking longer than expected. You can check again without starting a second analysis.";
  }
  return null;
}

export function ProductAnalysisView({ product, state, onAnalyze, onRetry, onBack }: ProductAnalysisViewProps) {
  const isWorking = state.phase === "analyzing" || state.phase === "pending";
  const canRetry = canRetryProductAnalysis(state);
  const terminalMessage = terminalStateText(state);

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--background)" }}>
      <div className="px-4 pt-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <ArrowLeft size={15} style={{ color: "var(--foreground)" }} />
          <span style={{ color: "var(--foreground)", fontSize: "0.75rem", fontWeight: 700 }}>Back</span>
        </button>
      </div>

      <div className="flex-1 flex flex-col justify-center px-6 pb-12 gap-5">
        <div className="rounded-3xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <h1 style={{ color: "var(--foreground)", fontSize: "1rem", fontWeight: 800 }}>{product.displayName}</h1>
          <p style={{ color: "var(--muted-foreground)", fontSize: "0.75rem", marginTop: 3 }}>
            {product.brand} · {product.category}
          </p>
          <div className="flex items-center gap-2 mt-4">
            <ShieldCheck size={14} style={{ color: "#18D3D1", flexShrink: 0 }} />
            <p style={{ color: "var(--muted-foreground)", fontSize: "0.7rem", lineHeight: 1.5 }}>
              TrendIQ checks supported evidence to help you decide whether this product is worth considering.
            </p>
          </div>
        </div>

        {state.phase === "idle" && (
          <button
            onClick={onAnalyze}
            className="flex items-center justify-center gap-2 rounded-2xl py-3.5"
            style={{ background: "#18D3D1", color: "#041011", fontWeight: 800, fontSize: "0.82rem" }}
          >
            <Sparkles size={16} /> Analyze
          </button>
        )}

        {isWorking && (
          <div className="flex flex-col items-center gap-3 py-4" aria-live="polite">
            <LoaderCircle className="animate-spin" size={24} style={{ color: "#18D3D1" }} />
            <p style={{ color: "var(--foreground)", fontSize: "0.82rem", fontWeight: 700 }}>
              {state.phase === "analyzing" ? "Checking available evidence…" : "Finishing your analysis…"}
            </p>
            <p style={{ color: "var(--muted-foreground)", fontSize: "0.7rem", textAlign: "center" }}>
              This can take a moment. TrendIQ will show only what the available evidence supports.
            </p>
          </div>
        )}

        {terminalMessage && (
          <div className="flex flex-col items-center gap-3 py-4" aria-live="polite">
            <p style={{ color: state.phase === "error" ? "#FF8C8C" : "#FFB547", fontSize: "0.8rem", textAlign: "center" }}>
              {terminalMessage}
            </p>
            {canRetry && (
              <button
                onClick={onRetry}
                className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5"
                style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)", fontSize: "0.76rem", fontWeight: 700 }}
              >
                <RefreshCw size={14} /> Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ControlledProductResultView({
  result,
  productId,
  onBack,
}: {
  result: ConsumerProductResult;
  productId: string;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col h-full" style={{ background: "var(--background)" }}>
      <div className="px-4 pt-4 pb-3 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <ArrowLeft size={15} style={{ color: "var(--foreground)" }} />
          <span style={{ color: "var(--foreground)", fontSize: "0.75rem", fontWeight: 700 }}>Back</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-6" style={{ scrollbarWidth: "none" }}>
        <ConsumerResultPanel consumerResult={result} productId={productId} />
      </div>
    </div>
  );
}

export interface ProductAnalysisScreenProps {
  product: ControlledProductCatalogItem;
  onBack: () => void;
  client?: ProductAnalysisExecutionClient;
  initialState?: ProductAnalysisUiState;
}

export function ProductAnalysisScreen({
  product,
  onBack,
  client = productAnalysisClient,
  initialState = { phase: "idle" },
}: ProductAnalysisScreenProps) {
  const [state, dispatch] = useReducer(productAnalysisUiReducer, initialState);

  const analyze = useCallback(async () => {
    dispatch({ type: "analyze" });
    dispatch({ type: "response", response: await requestProductAnalysis(client, product.productId) });
  }, [client, product.productId]);

  useEffect(() => {
    if (state.phase !== "pending") return;
    let cancelled = false;

    pollProductAnalysisUntilSettled(client, state.analysisId, {
      shouldStop: () => cancelled,
    }).then((outcome) => {
      if (cancelled || outcome.status === "cancelled") return;
      if (outcome.status === "deadline") {
        dispatch({ type: "pollingDeadline" });
      } else {
        dispatch({ type: "response", response: outcome.response });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [client, state]);

  if (state.phase === "completed") {
    return <ControlledProductResultView result={state.result} productId={product.productId} onBack={onBack} />;
  }

  return (
    <ProductAnalysisView
      product={product}
      state={state}
      onAnalyze={analyze}
      onRetry={analyze}
      onBack={onBack}
    />
  );
}
