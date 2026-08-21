import { ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import type { Product } from "./data";
import { ScoreBadge } from "./ScoreBadge";
import { TrendSparkline } from "./TrendSparkline";
import { TrendStatusBadge, trendColor } from "./TrendStatusBadge";

interface ProductCardProps {
  product: Product;
  onTap: (product: Product) => void;
  compareMode?: boolean;
  isSelected?: boolean;
  onToggleCompare?: (product: Product) => void;
}

function formatChange(pct: number): string {
  return (pct > 0 ? "+" : "") + pct.toFixed(1) + "%";
}

export function ProductCard({ product, onTap, compareMode, isSelected, onToggleCompare }: ProductCardProps) {
  const [hasEntered, setHasEntered] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const setupObserver = (el: HTMLDivElement | null) => {
    if (!el || observerRef.current) return;
    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasEntered(true);
          observerRef.current?.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observerRef.current.observe(el);
  };

  const changeColor = product.trend.changePercent >= 0
    ? trendColor(product.trend.status)
    : "#A78BFA";

  return (
    <div ref={setupObserver}>
      <button
        className="w-full text-left group"
        onClick={() => compareMode ? onToggleCompare?.(product) : onTap(product)}
      >
        <div
          className="rounded-2xl p-4 transition-all duration-200 group-hover:scale-[1.01] group-active:scale-[0.99]"
          style={{
            background: "var(--card)",
            border: isSelected
              ? "1px solid rgba(24,211,209,0.5)"
              : "1px solid var(--border)",
            boxShadow: isSelected
              ? "0 4px 24px rgba(0,0,0,0.3), 0 0 20px rgba(24,211,209,0.12)"
              : "0 4px 24px rgba(0,0,0,0.3)",
          }}
        >
          {/* Row 1 — category + status badge + chevron */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  color: "var(--muted-foreground)",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                }}
              >
                {product.emoji} {product.category.toUpperCase()}
              </span>
              <TrendStatusBadge status={product.trend.status} size="sm" />
            </div>
            {compareMode ? (
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center"
                style={{
                  background: isSelected ? "rgba(24,211,209,0.2)" : "rgba(255,255,255,0.05)",
                  border: isSelected ? "2px solid #18D3D1" : "2px solid rgba(255,255,255,0.15)",
                }}
              >
                {isSelected && <div className="w-2 h-2 rounded-full" style={{ background: "#18D3D1" }} />}
              </div>
            ) : (
              <ChevronRight size={14} style={{ color: "var(--muted-foreground)" }} />
            )}
          </div>

          {/* Row 2 — title | sparkline + % | score badge */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex-1 min-w-0">
              <h3
                className="truncate"
                style={{ color: "var(--foreground)", fontWeight: 700, fontSize: "1.05rem" }}
              >
                {product.title}
              </h3>
              <p style={{ color: "var(--muted-foreground)", fontSize: "0.78rem" }}>{product.subtitle}</p>
            </div>

            {/* Sparkline + % change */}
            <div className="flex flex-col items-center gap-0.5 shrink-0">
              <TrendSparkline history={product.trend.history} status={product.trend.status} />
              <span style={{ color: changeColor, fontSize: "0.62rem", fontWeight: 700 }}>
                {formatChange(product.trend.changePercent)}
              </span>
            </div>

            <ScoreBadge score={product.score} size="md" animate={hasEntered} />
          </div>

          {/* Row 3 — TrendIQ Says */}
          <div
            className="rounded-xl p-3 mb-3"
            style={{ background: "rgba(24,211,209,0.04)", border: "1px solid rgba(24,211,209,0.1)" }}
          >
            <p className="mb-1" style={{ color: "#18D3D1", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.08em" }}>
              TRENDIQ SAYS
            </p>
            <p style={{ color: "var(--foreground)", fontSize: "0.82rem", lineHeight: 1.5, opacity: 0.85 }}>
              "{product.trendiqSays.split("—")[0].trim()}"
            </p>
          </div>

          {/* Row 4 — tags */}
          <div className="flex flex-wrap gap-1.5">
            {product.bestFor.map((tag) => (
              <span
                key={tag}
                className="px-2.5 py-1 rounded-full"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  color: "var(--muted-foreground)",
                  fontSize: "0.7rem",
                  fontWeight: 500,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </button>
    </div>
  );
}
