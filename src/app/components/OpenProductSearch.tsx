import { useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { ConsumerResultPanel } from "./ConsumerResultPanel";
import {
  pollProductAnalysisUntilSettled,
  type ProductAnalysisClientResponse,
} from "./ProductAnalysisScreen";
import type { ProductResolveClientResponse } from "../lib/analysis/productAnalysisClient";
import type { ProductResolveResponse } from "../lib/analysis/productAnalysisContract";
import type { ConsumerProductResult } from "../lib/data/consumerResult";

export interface OpenProductSearchClient {
  resolve(query: string): Promise<ProductResolveClientResponse>;
  startResolved(input: { resolutionId: string; candidateId?: string }): Promise<ProductAnalysisClientResponse>;
  getStatus(analysisId: string): Promise<ProductAnalysisClientResponse>;
}

export type OpenProductSearchState =
  | { phase: "form"; query: string; notice?: string }
  | { phase: "working" }
  | { phase: "resolved"; response: Extract<ProductResolveResponse, { status: "resolved" }> }
  | { phase: "ambiguous"; response: Extract<ProductResolveResponse, { status: "ambiguous" }> }
  | { phase: "abstain"; message: string }
  | { phase: "notice"; message: string }
  | { phase: "completed"; result: ConsumerProductResult; evidenceDate: string | null };

interface OpenProductSearchViewProps {
  state: OpenProductSearchState;
  onQueryChange: (query: string) => void;
  onResolve: () => void;
  onConfirm: () => void;
  onChoose: (candidateId: string) => void;
  onBack: () => void;
}

function evidenceLines(response: Extract<ProductResolveResponse, { status: "resolved" }>): string[] {
  const lines = [`Evidence date: ${response.evidenceDate}`];
  if (response.priceStatus === "fresh" && response.priceEvidenceDate) {
    lines.push(`Price and availability evidence date: ${response.priceEvidenceDate}`);
  } else if (response.priceStatus === "stale") {
    lines.push("Price and availability evidence is older than 24 hours and is not shown.");
  }
  return lines;
}

export function OpenProductSearchView({
  state,
  onQueryChange,
  onResolve,
  onConfirm,
  onChoose,
  onBack,
}: OpenProductSearchViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: "var(--background)" }}>
      <div className="px-4 pt-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <ArrowLeft size={15} style={{ color: "var(--foreground)" }} />
          <span style={{ color: "var(--foreground)", fontSize: "0.75rem", fontWeight: 700 }}>Back</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={14} style={{ color: "#18D3D1" }} />
          <p style={{ color: "var(--muted-foreground)", fontSize: "0.7rem", lineHeight: 1.45 }}>
            Type a product name. TrendIQ checks the identity before any analysis starts.
          </p>
        </div>
        {state.phase === "form" || state.phase === "working" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onResolve();
            }}
          >
            <input
              aria-label="Product name"
              value={state.phase === "form" ? state.query : ""}
              disabled={state.phase === "working"}
              onChange={(event) => onQueryChange(event.target.value)}
              className="w-full rounded-2xl px-3 py-3"
              style={{ background: "var(--secondary)", color: "var(--foreground)", border: "1px solid var(--border)" }}
            />
            <button
              type="submit"
              disabled={state.phase === "working"}
              className="mt-3 rounded-xl px-3 py-2"
              style={{ background: "#18D3D1", color: "#04120F", fontWeight: 800, fontSize: "0.75rem" }}
            >
              {state.phase === "working" ? "Checking the product name…" : "Find this product"}
            </button>
            {state.phase === "form" && state.notice ? (
              <p className="mt-3" style={{ color: "var(--foreground)", fontSize: "0.75rem", lineHeight: 1.45 }}>{state.notice}</p>
            ) : null}
          </form>
        ) : null}
        {state.phase === "resolved" ? (
          <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <p style={{ color: "var(--foreground)", fontSize: "0.85rem", fontWeight: 800 }}>
              We found: {state.response.title}
              {state.response.brand ? ` · ${state.response.brand}` : ""}
              {state.response.model ? ` · ${state.response.model}` : ""}
              . Analyze?
            </p>
            {evidenceLines(state.response).map((line) => (
              <p key={line} className="mt-2" style={{ color: "var(--muted-foreground)", fontSize: "0.72rem" }}>{line}</p>
            ))}
            <button
              type="button"
              onClick={onConfirm}
              className="mt-4 rounded-xl px-3 py-2"
              style={{ background: "#18D3D1", color: "#04120F", fontWeight: 800, fontSize: "0.75rem" }}
            >
              Analyze this product
            </button>
          </div>
        ) : null}
        {state.phase === "ambiguous" ? (
          <div>
            <p style={{ color: "var(--foreground)", fontSize: "0.85rem", fontWeight: 800 }}>Which product did you mean?</p>
            <p className="mt-2 mb-3" style={{ color: "var(--muted-foreground)", fontSize: "0.75rem" }}>
              Nothing is analyzed until you choose.
            </p>
            <p style={{ color: "var(--muted-foreground)", fontSize: "0.72rem" }}>Evidence date: {state.response.evidenceDate}</p>
            <div className="flex flex-col gap-2 mt-3">
              {state.response.candidates.map((candidate) => (
                <button
                  key={candidate.candidateId}
                  type="button"
                  onClick={() => onChoose(candidate.candidateId)}
                  className="rounded-2xl p-3 text-left"
                  style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)" }}
                >
                  {candidate.title}{candidate.brand ? ` · ${candidate.brand}` : ""}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {state.phase === "abstain" || state.phase === "notice" ? (
          <p style={{ color: "var(--foreground)", fontSize: "0.8rem", lineHeight: 1.5 }}>{state.message}</p>
        ) : null}
        {state.phase === "completed" ? (
          <div>
            {state.evidenceDate ? (
              <p className="mb-3" style={{ color: "var(--muted-foreground)", fontSize: "0.72rem" }}>
                Evidence date: {state.evidenceDate}
              </p>
            ) : null}
            <ConsumerResultPanel consumerResult={state.result} productId={state.result.product.id} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function noticeFor(response: ProductResolveClientResponse): string {
  if (response.status === "unavailable") {
    if (response.reason === "open_analysis_disabled") return "Analysis of a product by name is not available right now.";
    if (response.reason === "daily_capacity_reached") return "Today's analysis capacity has been reached.";
    if (response.reason === "rate_limited") return "Too many name checks were requested.";
    return "Analysis is temporarily unavailable. Please come back later.";
  }
  if (response.status === "error") {
    return response.reason === "request_failed"
      ? "Something interrupted this request. You can try again."
      : "This request could not be completed. Please come back later.";
  }
  return "This request could not be completed. Please come back later.";
}

export function OpenProductSearch({ client, onBack }: { client: OpenProductSearchClient; onBack: () => void }) {
  const [state, setState] = useState<OpenProductSearchState>({ phase: "form", query: "" });
  const [evidenceDate, setEvidenceDate] = useState<string | null>(null);

  async function resolveQuery() {
    if (state.phase !== "form") return;
    const query = state.query;
    setState({ phase: "working" });
    const response = await client.resolve(query);
    if (response.status === "resolved") {
      setEvidenceDate(response.evidenceDate);
      setState({ phase: "resolved", response });
      return;
    }
    if (response.status === "ambiguous") {
      setEvidenceDate(response.evidenceDate);
      setState({ phase: "ambiguous", response });
      return;
    }
    if (response.status === "abstain") {
      setState({ phase: "abstain", message: response.message });
      return;
    }
    setState({ phase: "form", query, notice: noticeFor(response) });
  }

  async function start(input: { resolutionId: string; candidateId?: string }) {
    setState({ phase: "working" });
    const started = await client.startResolved(input);
    if (started.status === "completed") {
      setState({ phase: "completed", result: started.result, evidenceDate });
      return;
    }
    if (started.status !== "pending") {
      const message = started.reason === "daily_capacity_reached"
        ? "Today's analysis capacity has been reached. No new analysis was started."
        : started.reason === "rate_limited"
          ? "Too many analyses were requested. No new analysis was started."
          : "This analysis could not be completed. Please come back later.";
      setState({ phase: "notice", message });
      return;
    }
    const polled = await pollProductAnalysisUntilSettled(client, started.analysisId);
    if (polled.status === "settled" && polled.response.status === "completed") {
      setState({ phase: "completed", result: polled.response.result, evidenceDate });
      return;
    }
    setState({ phase: "notice", message: "This analysis could not be completed. Please come back later." });
  }

  return (
    <OpenProductSearchView
      state={state}
      onQueryChange={(query) => setState({ phase: "form", query })}
      onResolve={() => { void resolveQuery(); }}
      onConfirm={() => {
        if (state.phase === "resolved") void start({ resolutionId: state.response.resolutionId });
      }}
      onChoose={(candidateId) => {
        if (state.phase === "ambiguous") {
          void start({ resolutionId: state.response.resolutionId, candidateId });
        }
      }}
      onBack={onBack}
    />
  );
}
