import type { ConsumerProductResult } from "../lib/data/consumerResult";
import type { ConsumerEvidenceStatus } from "../lib/data/consumerResult";
import { buildConsumerResultViewModel } from "../lib/presentation/consumerResultViewModel";

type Recommendation = ConsumerProductResult["decision"]["recommendation"];

export interface ConsumerResultPanelProps {
  consumerResult: ConsumerProductResult | unknown;
  productId: string;
}

function recommendationColor(recommendation: Recommendation): string {
  if (recommendation === "BUY") return "#18D3D1";
  if (recommendation === "WAIT") return "#FFB547";
  if (recommendation === "SKIP") return "#FF4D6D";
  return "#A7ACB8";
}

function statusColor(status: ConsumerEvidenceStatus): string {
  if (status === "verified") return "#4CAF82";
  if (status === "degraded") return "#FFB547";
  return "#A7ACB8";
}

function EvidenceStatus({ status, label }: { status: ConsumerEvidenceStatus; label: string }) {
  const color = statusColor(status);
  return (
    <span
      className="inline-flex items-center px-2 py-1 rounded-full"
      style={{
        color,
        background: `${color}14`,
        border: `1px solid ${color}35`,
        fontSize: "0.65rem",
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}

function MetricCard({
  label,
  value,
  status,
  statusLabel,
  explanation,
  context,
}: {
  label: string;
  value: string;
  status: ConsumerEvidenceStatus;
  statusLabel: string;
  explanation: string;
  context?: string;
}) {
  return (
    <section
      className="rounded-xl p-3"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
      aria-label={label}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span style={{ color: "var(--muted-foreground)", fontSize: "0.67rem", fontWeight: 700 }}>
          {label.toUpperCase()}
        </span>
        <EvidenceStatus status={status} label={statusLabel} />
      </div>
      <p style={{ color: "var(--foreground)", fontSize: "1rem", fontWeight: 800 }}>{value}</p>
      <p style={{ color: "var(--muted-foreground)", fontSize: "0.68rem", lineHeight: 1.45, marginTop: 4 }}>
        {explanation}
      </p>
      {context && (
        <p style={{ color: "var(--foreground)", fontSize: "0.66rem", lineHeight: 1.45, marginTop: 5 }}>
          {context}
        </p>
      )}
    </section>
  );
}

export function ConsumerResultPanel({ consumerResult, productId }: ConsumerResultPanelProps) {
  const view = buildConsumerResultViewModel({ consumerResult, productId });
  const decisionColor = recommendationColor(view.decision.recommendation);
  const scoreCoverageContext =
    view.score.liveCoveragePercent !== null &&
    (view.score.status === "degraded" || view.score.liveCoveragePercent < 100)
      ? `Live evidence coverage: ${view.score.liveCoveragePercent}%`
      : undefined;

  return (
    <article className="flex flex-col gap-4" data-consumer-result-version={view.version}>
      <header>
        <p style={{ color: "#18D3D1", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.1em" }}>
          TRENDIQ RESULT
        </p>
        <h1 style={{ color: "var(--foreground)", fontSize: "1.35rem", fontWeight: 800, marginTop: 4 }}>
          {view.product.name}
        </h1>
        {(view.product.brand || view.product.category) && (
          <p style={{ color: "var(--muted-foreground)", fontSize: "0.75rem", marginTop: 2 }}>
            {[view.product.brand, view.product.category].filter(Boolean).join(" · ")}
          </p>
        )}
      </header>

      <section
        className="rounded-2xl p-4"
        style={{ background: `${decisionColor}0D`, border: `1px solid ${decisionColor}40` }}
        aria-label="Recommendation"
      >
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span
            className="px-3 py-1 rounded-full"
            style={{ color: decisionColor, background: `${decisionColor}18`, fontSize: "0.78rem", fontWeight: 900 }}
          >
            {view.decision.recommendationLabel}
          </span>
          <EvidenceStatus status={view.decision.status} label={view.decision.statusLabel} />
        </div>
        <h2 style={{ color: "var(--foreground)", fontSize: "1rem", fontWeight: 800 }}>
          {view.decision.headline}
        </h2>
        <p style={{ color: "var(--foreground)", fontSize: "0.82rem", lineHeight: 1.55, opacity: 0.88, marginTop: 5 }}>
          {view.decision.summary}
        </p>
        <p style={{ color: "var(--muted-foreground)", fontSize: "0.7rem", lineHeight: 1.45, marginTop: 8 }}>
          {view.decision.trustMessage}
        </p>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          label="TrendIQ Score"
          value={view.score.valueLabel}
          status={view.score.status}
          statusLabel={view.score.statusLabel}
          explanation={view.score.explanation}
          context={scoreCoverageContext}
        />
        <MetricCard
          label="Evidence Confidence"
          value={view.confidence.valueLabel}
          status={view.confidence.status}
          statusLabel={view.confidence.statusLabel}
          explanation={view.confidence.explanation}
          context="Confidence measures evidence quality. It is not the probability that the recommendation is correct."
        />
        <MetricCard
          label="Search Momentum"
          value={view.momentum.valueLabel}
          status={view.momentum.status}
          statusLabel={view.momentum.statusLabel}
          explanation={view.momentum.explanation}
        />
      </div>

      <section
        className="rounded-2xl p-4"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        aria-label="Review evidence"
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 style={{ color: "var(--foreground)", fontSize: "0.85rem", fontWeight: 800 }}>Review evidence</h2>
          <EvidenceStatus status={view.reviews.status} label={view.reviews.statusLabel} />
        </div>
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt style={{ color: "var(--muted-foreground)", fontSize: "0.65rem" }}>Aggregate rating</dt>
            <dd style={{ color: "var(--foreground)", fontSize: "0.82rem", fontWeight: 700 }}>
              {view.reviews.aggregate.averageRatingLabel}
            </dd>
            <dd style={{ color: "var(--muted-foreground)", fontSize: "0.65rem" }}>
              {view.reviews.aggregate.reviewCountLabel}
            </dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted-foreground)", fontSize: "0.65rem" }}>Rating consensus</dt>
            <dd style={{ color: "var(--foreground)", fontSize: "0.82rem", fontWeight: 700 }}>
              {view.reviews.ratingConsensus.qualityLabel}
            </dd>
            <dd style={{ color: "var(--muted-foreground)", fontSize: "0.65rem" }}>
              Distribution mean: {view.reviews.ratingConsensus.averageRatingLabel}
            </dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted-foreground)", fontSize: "0.65rem" }}>Recent rating</dt>
            <dd style={{ color: "var(--foreground)", fontSize: "0.82rem", fontWeight: 700 }}>
              {view.reviews.recentRating.averageRatingLabel}
            </dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted-foreground)", fontSize: "0.65rem" }}>Review text</dt>
            <dd style={{ color: "var(--foreground)", fontSize: "0.7rem", lineHeight: 1.45 }}>
              {view.reviews.textEvidence.message}
            </dd>
          </div>
        </dl>
      </section>

      {view.take.reasons.length > 0 && (
        <section
          className="rounded-2xl p-4"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          aria-label="Why TrendIQ reached this result"
        >
          <h2 style={{ color: "var(--foreground)", fontSize: "0.85rem", fontWeight: 800, marginBottom: 8 }}>
            Why this result
          </h2>
          <ul className="space-y-2">
            {view.take.reasons.map((reason) => (
              <li key={reason.code} style={{ color: "var(--foreground)", fontSize: "0.75rem", lineHeight: 1.5 }}>
                {reason.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.take.watchOuts.length > 0 && (
        <section
          className="rounded-2xl p-4"
          style={{ background: "rgba(255,181,71,0.05)", border: "1px solid rgba(255,181,71,0.2)" }}
          aria-label="Watch outs"
        >
          <h2 style={{ color: "#FFB547", fontSize: "0.78rem", fontWeight: 800, marginBottom: 7 }}>WATCH OUT</h2>
          <ul className="space-y-1.5">
            {view.take.watchOuts.map((warning) => (
              <li key={warning} style={{ color: "var(--foreground)", fontSize: "0.74rem", lineHeight: 1.5 }}>
                {warning}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.take.missingEvidence.length > 0 && (
        <section
          className="rounded-2xl p-4"
          style={{ background: "rgba(255,181,71,0.05)", border: "1px solid rgba(255,181,71,0.2)" }}
          aria-label="Missing evidence"
        >
          <h2 style={{ color: "#FFB547", fontSize: "0.78rem", fontWeight: 800, marginBottom: 7 }}>
            MISSING EVIDENCE
          </h2>
          <ul className="space-y-1.5">
            {view.take.missingEvidence.map((item) => (
              <li key={item.key} style={{ color: "var(--foreground)", fontSize: "0.74rem", lineHeight: 1.5 }}>
                {item.label} unavailable
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        className="rounded-2xl p-4"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        aria-label="Evidence availability"
      >
        <h2 style={{ color: "var(--foreground)", fontSize: "0.82rem", fontWeight: 800, marginBottom: 8 }}>
          Evidence availability
        </h2>
        <ul className="space-y-1.5">
          <li style={{ color: "var(--muted-foreground)", fontSize: "0.72rem" }}>{view.availability.bestFor.label}</li>
          <li style={{ color: "var(--muted-foreground)", fontSize: "0.72rem" }}>
            {view.availability.socialAndHype.label}
          </li>
          <li style={{ color: "var(--muted-foreground)", fontSize: "0.72rem" }}>
            {view.availability.priceAndCommerce.label}
          </li>
          <li style={{ color: "var(--muted-foreground)", fontSize: "0.72rem" }}>
            {view.availability.reviewTextIntelligence.label}
          </li>
        </ul>
      </section>

      <footer
        className="rounded-xl p-3"
        style={{ background: "rgba(255,255,255,0.025)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between gap-2">
          <span style={{ color: "var(--muted-foreground)", fontSize: "0.67rem", fontWeight: 700 }}>EVIDENCE TRUST</span>
          <EvidenceStatus status={view.trust.status} label={view.trust.statusLabel} />
        </div>
        <p style={{ color: "var(--muted-foreground)", fontSize: "0.68rem", lineHeight: 1.45, marginTop: 7 }}>
          {view.trust.summary}
        </p>
        <dl className="grid grid-cols-1 gap-1 mt-3">
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--muted-foreground)", fontSize: "0.66rem" }}>Evaluated</dt>
            <dd style={{ color: "var(--foreground)", fontSize: "0.66rem", fontWeight: 700 }}>
              {view.trust.evaluatedAtLabel}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--muted-foreground)", fontSize: "0.66rem" }}>Evidence freshness</dt>
            <dd style={{ color: "var(--foreground)", fontSize: "0.66rem", fontWeight: 700 }}>
              {view.trust.freshnessStatusLabel} · {view.trust.freshnessAgeLabel}
            </dd>
          </div>
        </dl>
      </footer>
    </article>
  );
}
