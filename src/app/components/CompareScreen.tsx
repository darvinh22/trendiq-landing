import { X, ChevronDown } from "lucide-react";
import { useState } from "react";
import { PRODUCTS, type Product } from "./data";
import { ScoreBadge } from "./ScoreBadge";
import { formatFinalIQ, formatIQ, getLeadExplanation } from "../lib/compare/leadExplanation";

function getScoreColor(score: number) {
  if (score >= 85) return "#18D3D1";
  if (score >= 70) return "#A78BFA";
  return "#FFB547";
}

function CompareSlot({
  product,
  onPick,
  onClear,
  side,
}: {
  product: Product | null;
  onPick: () => void;
  onClear: () => void;
  side: "left" | "right";
}) {
  if (!product) {
    return (
      <button
        onClick={onPick}
        className="flex-1 flex flex-col items-center justify-center gap-2 rounded-2xl"
        style={{
          background: "var(--secondary)",
          border: "2px dashed rgba(255,255,255,0.1)",
          minHeight: 120,
        }}
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: "rgba(24,211,209,0.1)", border: "1px solid rgba(24,211,209,0.2)" }}
        >
          <span style={{ color: "#18D3D1", fontSize: "1.2rem", lineHeight: 1 }}>+</span>
        </div>
        <span style={{ color: "var(--muted-foreground)", fontSize: "0.72rem" }}>Add product</span>
      </button>
    );
  }

  return (
    <div
      className="flex-1 rounded-2xl p-3 flex flex-col items-center gap-2 relative"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <button
        onClick={onClear}
        className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
        style={{ background: "rgba(255,255,255,0.08)" }}
      >
        <X size={10} style={{ color: "var(--muted-foreground)" }} />
      </button>
      <img
        src={product.imageUrl}
        alt={product.title}
        className="w-full h-16 object-cover rounded-xl"
      />
      <ScoreBadge score={product.score} size="md" animate />
      <p
        className="text-center"
        style={{ color: "var(--foreground)", fontWeight: 700, fontSize: "0.75rem", lineHeight: 1.3 }}
      >
        {product.title}
      </p>
    </div>
  );
}

const METRICS: { key: keyof Product | string; label: string; render: (p: Product) => string | number }[] = [
  { key: "score", label: "TrendIQ Score", render: (p) => p.score },
  { key: "tiktokScore", label: "TikTok Score", render: (p) => p.tiktokScore },
  { key: "redditScore", label: "Reddit Score", render: (p) => p.redditScore },
  { key: "pros", label: "Pros count", render: (p) => p.pros.length },
  { key: "cons", label: "Cons count", render: (p) => p.cons.length },
  { key: "bestFor", label: "Use cases", render: (p) => p.bestFor.join(", ") },
];

function PickerModal({ onSelect, onClose }: { onSelect: (p: Product) => void; onClose: () => void }) {
  return (
    <div
      className="absolute inset-0 flex flex-col z-20"
      style={{ background: "rgba(8,9,14,0.95)", backdropFilter: "blur(8px)" }}
    >
      <div className="flex items-center justify-between px-4 py-4 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        <span style={{ color: "var(--foreground)", fontWeight: 700, fontSize: "0.95rem" }}>Pick a product</span>
        <button onClick={onClose}>
          <X size={18} style={{ color: "var(--muted-foreground)" }} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{ scrollbarWidth: "none" }}>
        {PRODUCTS.map((p) => (
          <button
            key={p.id}
            onClick={() => { onSelect(p); onClose(); }}
            className="w-full flex items-center gap-3 p-3 rounded-xl text-left"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <img src={p.imageUrl} alt={p.title} className="w-10 h-10 rounded-lg object-cover shrink-0" />
            <div className="flex-1 min-w-0">
              <p style={{ color: "var(--foreground)", fontWeight: 600, fontSize: "0.82rem" }} className="truncate">{p.title}</p>
              <p style={{ color: "var(--muted-foreground)", fontSize: "0.7rem" }}>{p.category}</p>
            </div>
            <span style={{ color: getScoreColor(p.score), fontWeight: 700, fontSize: "0.88rem" }}>{p.score}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function CompareScreen() {
  const [left, setLeft] = useState<Product | null>(null);
  const [right, setRight] = useState<Product | null>(null);
  const [picking, setPicking] = useState<"left" | "right" | null>(null);

  const leadComparison = left && right ? getLeadExplanation(left, right) : null;

  return (
    <div className="flex flex-col flex-1 min-h-0" style={{ background: "var(--background)" }}>
      {picking && (
        <PickerModal
          onSelect={(p) => { picking === "left" ? setLeft(p) : setRight(p); }}
          onClose={() => setPicking(null)}
        />
      )}

      <div className="px-4 pt-5 pb-3 shrink-0">
        <h2 style={{ color: "var(--foreground)", fontWeight: 800, fontSize: "1.2rem" }}>Compare</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: "0.75rem", marginTop: 2 }}>
          Head-to-head product intelligence
        </p>
      </div>

      {/* Slots */}
      <div className="flex gap-3 px-4 mb-4 shrink-0">
        <CompareSlot product={left} onPick={() => setPicking("left")} onClear={() => setLeft(null)} side="left" />
        <div className="flex items-center justify-center w-8 shrink-0">
          <span style={{ color: "var(--muted-foreground)", fontWeight: 700, fontSize: "0.7rem" }}>VS</span>
        </div>
        <CompareSlot product={right} onPick={() => setPicking("right")} onClear={() => setRight(null)} side="right" />
      </div>

      {/* Leader banner */}
      {leadComparison && (
        <div
          className="mx-4 mb-4 px-4 py-2.5 rounded-xl flex items-center gap-2 shrink-0"
          style={{ background: "rgba(24,211,209,0.08)", border: "1px solid rgba(24,211,209,0.2)" }}
        >
          <span
            className="px-1.5 py-0.5 rounded-md"
            style={{ color: "#18D3D1", background: "rgba(24,211,209,0.12)", fontSize: "0.62rem", fontWeight: 800 }}
          >
            IQ
          </span>
          <span style={{ color: "#18D3D1", fontSize: "0.78rem", fontWeight: 600 }}>
            {leadComparison.leader.title} leads by {leadComparison.finalIQAdvantage} IQ points
          </span>
        </div>
      )}

      {/* Metrics table */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-28" style={{ scrollbarWidth: "none", scrollPaddingBottom: "7rem" }}>
        {left && right ? (
          <div className="space-y-3">
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}
            >
            {METRICS.map((metric, i) => {
              const lVal = metric.render(left);
              const rVal = metric.render(right);
              const lNum = typeof lVal === "number" ? lVal : null;
              const rNum = typeof rVal === "number" ? rVal : null;
              const lLeads = lNum !== null && rNum !== null && lNum > rNum;
              const rLeads = lNum !== null && rNum !== null && rNum > lNum;

              return (
                <div
                  key={metric.key as string}
                  className="flex items-center"
                  style={{
                    borderBottom: i < METRICS.length - 1 ? "1px solid var(--border)" : "none",
                    padding: "0.75rem 1rem",
                  }}
                >
                  <div
                    className="flex-1 text-right pr-3 truncate"
                    style={{
                      color: lLeads ? "#18D3D1" : "var(--foreground)",
                      fontWeight: lLeads ? 700 : 400,
                      fontSize: "0.8rem",
                    }}
                  >
                    {String(lVal)}
                    {lLeads && " ✓"}
                  </div>
                  <div
                    className="w-24 text-center shrink-0"
                    style={{ color: "var(--muted-foreground)", fontSize: "0.65rem", fontWeight: 600 }}
                  >
                    {metric.label}
                  </div>
                  <div
                    className="flex-1 pl-3 truncate"
                    style={{
                      color: rLeads ? "#18D3D1" : "var(--foreground)",
                      fontWeight: rLeads ? 700 : 400,
                      fontSize: "0.8rem",
                    }}
                  >
                    {rLeads && "✓ "}
                    {String(rVal)}
                  </div>
                </div>
              );
            })}
            </div>

            {leadComparison && (
              <div
                className="rounded-2xl p-4"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                <p
                  className="mb-3"
                  style={{ color: "var(--foreground)", fontWeight: 800, fontSize: "0.78rem", letterSpacing: "0.08em" }}
                >
                  WHY IT LEADS
                </p>
                <div className="space-y-2.5">
                  {leadComparison.topContributions.map((item) => {
                    const color = item.iqContribution >= 0 ? "#18D3D1" : "#A78BFA";

                    return (
                      <div key={item.key} className="flex items-center justify-between gap-3">
                        <span style={{ color: "var(--muted-foreground)", fontSize: "0.76rem" }}>
                          {item.label}
                        </span>
                        <span
                          className="px-2 py-0.5 rounded-lg"
                          style={{
                            color,
                            background: `${color}14`,
                            border: `1px solid ${color}26`,
                            fontSize: "0.76rem",
                            fontWeight: 800,
                          }}
                        >
                          {formatIQ(item.iqContribution)}
                        </span>
                      </div>
                    );
                  })}

                  <div style={{ height: 1, background: "var(--border)", margin: "0.85rem 0" }} />

                  <div className="flex items-center justify-between gap-3">
                    <span style={{ color: "var(--muted-foreground)", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.04em" }}>
                      TOTAL EXPLAINED
                    </span>
                    <span
                      className="px-2 py-0.5 rounded-lg"
                      style={{
                        color: "#18D3D1",
                        background: "rgba(24,211,209,0.12)",
                        border: "1px solid rgba(24,211,209,0.28)",
                        fontSize: "0.78rem",
                        fontWeight: 800,
                      }}
                    >
                      {formatIQ(leadComparison.totalExplainedIQ)}
                    </span>
                  </div>
                  {leadComparison.showOtherAdjustments && (
                    <div className="flex items-center justify-between gap-3">
                      <span style={{ color: "var(--muted-foreground)", fontSize: "0.76rem" }}>
                        Other adjustments
                      </span>
                      <span
                        className="px-2 py-0.5 rounded-lg"
                        style={{
                          color: leadComparison.otherAdjustmentsIQ >= 0 ? "#18D3D1" : "#A78BFA",
                          background: leadComparison.otherAdjustmentsIQ >= 0 ? "rgba(24,211,209,0.12)" : "rgba(167,139,250,0.12)",
                          border: leadComparison.otherAdjustmentsIQ >= 0 ? "1px solid rgba(24,211,209,0.28)" : "1px solid rgba(167,139,250,0.28)",
                          fontSize: "0.76rem",
                          fontWeight: 800,
                        }}
                      >
                        {formatIQ(leadComparison.otherAdjustmentsIQ)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <span style={{ color: "var(--foreground)", fontSize: "0.78rem", fontWeight: 800, letterSpacing: "0.04em" }}>
                      FINAL IQ ADVANTAGE
                    </span>
                    <span
                      className="px-2 py-0.5 rounded-lg"
                      style={{
                        color: "#18D3D1",
                        background: "rgba(24,211,209,0.12)",
                        border: "1px solid rgba(24,211,209,0.28)",
                        fontSize: "0.78rem",
                        fontWeight: 800,
                      }}
                    >
                      {formatFinalIQ(leadComparison.finalIQAdvantage)}
                    </span>
                  </div>
                  {leadComparison.confidenceContext && (
                    <div
                      className="rounded-xl px-3 py-2"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span style={{ color: "var(--muted-foreground)", fontSize: "0.72rem" }}>
                          Confidence context
                        </span>
                        <span style={{ color: "var(--muted-foreground)", fontSize: "0.72rem", fontWeight: 700 }}>
                          {leadComparison.confidenceContext.leaderScore} vs {leadComparison.confidenceContext.otherScore}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <ChevronDown size={24} style={{ color: "var(--muted-foreground)", opacity: 0.4 }} />
            <p style={{ color: "var(--muted-foreground)", fontSize: "0.82rem" }}>Select two products to compare</p>
          </div>
        )}
      </div>
    </div>
  );
}
