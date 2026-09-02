import { useCallback, useEffect, useReducer } from "react";
import { ArrowLeft, LoaderCircle, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import type { Product } from "./data";
import { ProductDetail } from "./ProductDetail";
import {
  productAnalysisClient,
  type ProductAnalysisClient,
} from "../lib/analysis/productAnalysisClient";
import type {
  ProductAnalysisResponse,
  ProductAnalysisSafeReason,
} from "../lib/analysis/productAnalysisContract";
import type { ConsumerProductResult } from "../lib/data/consumerResult";

export type ProductAnalysisUiState =
  | { phase: "idle" }
  | { phase: "analyzing" }
  | { phase: "pending"; analysisId: string }
  | { phase: "completed"; result: ConsumerProductResult }
  | { phase: "unavailable"; reason: ProductAnalysisSafeReason }
  | { phase: "error"; reason: ProductAnalysisSafeReason };

export type ProductAnalysisUiAction =
  | { type: "analyze" }
  | { type: "response"; response: ProductAnalysisResponse }
  | { type: "retry" };

export function productAnalysisUiReducer(
  state: ProductAnalysisUiState,
  action: ProductAnalysisUiAction
): ProductAnalysisUiState {
  if (action.type === "analyze") return { phase: "analyzing" };
  if (action.type === "retry") return { phase: "idle" };

  const response = action.response;
  if (response.status === "pending") return { phase: "pending", analysisId: response.analysisId };
  if (response.status === "completed") return { phase: "completed", result: response.result };
  if (response.status === "unavailable") return { phase: "unavailable", reason: response.reason };
  return { phase: "error", reason: response.reason };
}

interface ProductAnalysisViewProps {
  product: Pick<Product, "id" | "title" | "subtitle" | "emoji">;
  state: Exclude<ProductAnalysisUiState, { phase: "completed" }>;
  onAnalyze: () => void;
  onRetry: () => void;
  onBack: () => void;
}

function safeReasonText(reason: ProductAnalysisSafeReason): string {
  if (reason === "product_not_supported") return "This product is not enabled for controlled analysis.";
  if (reason === "evidence_unavailable") return "Qualified live evidence is unavailable right now.";
  return "The analysis could not be completed safely.";
}

export function ProductAnalysisView({ product, state, onAnalyze, onRetry, onBack }: ProductAnalysisViewProps) {
  const isWorking = state.phase === "analyzing" || state.phase === "pending";
  const canRetry = state.phase === "unavailable" || state.phase === "error";

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
        <div
          className="rounded-3xl p-5"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-3 mb-3">
            <span style={{ fontSize: "2rem" }}>{product.emoji}</span>
            <div>
              <h1 style={{ color: "var(--foreground)", fontSize: "1rem", fontWeight: 800 }}>{product.title}</h1>
              <p style={{ color: "var(--muted-foreground)", fontSize: "0.75rem" }}>{product.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} style={{ color: "#18D3D1" }} />
            <p style={{ color: "var(--muted-foreground)", fontSize: "0.7rem", lineHeight: 1.5 }}>
              TrendIQ will use only controlled, server-validated evidence for this result.
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
              {state.phase === "analyzing" ? "Analyzing controlled evidence…" : "Analysis pending…"}
            </p>
            <p style={{ color: "var(--muted-foreground)", fontSize: "0.7rem", textAlign: "center" }}>
              Review evidence may require a short bounded provider poll.
            </p>
          </div>
        )}

        {canRetry && (
          <div className="flex flex-col items-center gap-3 py-4" aria-live="polite">
            <p style={{ color: state.phase === "error" ? "#FF8C8C" : "#FFB547", fontSize: "0.8rem", textAlign: "center" }}>
              {state.phase === "unavailable" ? safeReasonText(state.reason) : "A safe application error occurred."}
            </p>
            <button
              onClick={onRetry}
              className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5"
              style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)", fontSize: "0.76rem", fontWeight: 700 }}
            >
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export interface ProductAnalysisScreenProps {
  product: Product;
  onBack: () => void;
  client?: ProductAnalysisClient;
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
    dispatch({ type: "response", response: await client.start(product.id) });
  }, [client, product.id]);

  useEffect(() => {
    if (state.phase !== "pending") return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      const response = await client.getStatus(state.analysisId);
      if (cancelled) return;
      if (response.status === "pending") {
        timeoutId = setTimeout(poll, 750);
      } else {
        dispatch({ type: "response", response });
      }
    };
    timeoutId = setTimeout(poll, 750);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [client, state]);

  if (state.phase === "completed") {
    return <ProductDetail consumerResult={state.result} productId={product.id} onBack={onBack} />;
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
