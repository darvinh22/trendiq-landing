import { Check, Sparkles, Bookmark } from "lucide-react";
import { useState, useMemo } from "react";
import { PRODUCTS, CATEGORIES, type Category, type Product } from "./data";
import { ProductCard } from "./ProductCard";
import { TrendSparkline } from "./TrendSparkline";
import { TrendStatusBadge, trendColor } from "./TrendStatusBadge";
import { useWatchlist } from "../hooks/useWatchlist";

const CATEGORY_EMOJIS: Record<string, string> = {
  Tech: "💻",
  Gadgets: "🛠️",
  "AI Products": "🤖",
  Home: "🏠",
  Fitness: "💪",
  Fashion: "👗",
  Travel: "✈️",
  "Viral TikTok": "🎵",
  "Consumer Trends": "📈",
};

interface ForYouScreenProps {
  onTapProduct: (product: Product) => void;
}

function formatChange(pct: number): string {
  return (pct > 0 ? "+" : "") + pct.toFixed(1) + "%";
}

function WatchingCard({ product, onTap }: { product: Product; onTap: () => void }) {
  const changeColor = product.trend.changePercent >= 0
    ? trendColor(product.trend.status)
    : "#A78BFA";

  return (
    <button
      onClick={onTap}
      className="flex-shrink-0 flex flex-col gap-2 p-3 rounded-2xl text-left transition-all duration-150 active:scale-[0.97]"
      style={{
        width: 130,
        background: "var(--card)",
        border: "1px solid rgba(24,211,209,0.18)",
        boxShadow: "0 0 16px rgba(24,211,209,0.06)",
      }}
    >
      {/* Title + emoji */}
      <div className="flex items-start justify-between gap-1">
        <p
          className="leading-tight"
          style={{ color: "var(--foreground)", fontWeight: 700, fontSize: "0.72rem", lineHeight: 1.3 }}
        >
          {product.title}
        </p>
        <span style={{ fontSize: "0.9rem" }}>{product.emoji}</span>
      </div>

      {/* Sparkline */}
      <TrendSparkline history={product.trend.history} status={product.trend.status} />

      {/* Status + % */}
      <div className="flex items-center justify-between">
        <TrendStatusBadge status={product.trend.status} size="sm" />
        <span style={{ color: changeColor, fontSize: "0.65rem", fontWeight: 700 }}>
          {formatChange(product.trend.changePercent)}
        </span>
      </div>
    </button>
  );
}

export function ForYouScreen({ onTapProduct }: ForYouScreenProps) {
  const { watchedIds } = useWatchlist();
  const [selectedCategories, setSelectedCategories] = useState<Set<Category>>(
    new Set(["Tech", "Fitness", "AI Products"])
  );
  const [minScore, setMinScore] = useState(70);

  const watchedProducts = useMemo(
    () => PRODUCTS.filter((p) => watchedIds.includes(p.id)),
    [watchedIds]
  );

  const feed = useMemo(() => {
    return PRODUCTS.filter(
      (p) => selectedCategories.has(p.category) && p.score >= minScore
    ).sort((a, b) => b.score - a.score);
  }, [selectedCategories, minScore]);

  function toggleCategory(cat: Category) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        if (next.size > 1) next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col flex-1 min-h-0" style={{ background: "var(--background)" }}>

      {/* Header */}
      <div className="px-4 pt-5 pb-3 shrink-0">
        <div className="flex items-center gap-2 mb-0.5">
          <Sparkles size={16} style={{ color: "#18D3D1" }} />
          <h2 style={{ color: "var(--foreground)", fontWeight: 800, fontSize: "1.2rem" }}>For You</h2>
        </div>
        <p style={{ color: "var(--muted-foreground)", fontSize: "0.75rem" }}>
          Personalized to your interests
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: "none" }}>

        {/* ── Watching section ── */}
        {watchedProducts.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 px-4 mb-2">
              <Bookmark size={12} style={{ color: "#18D3D1" }} />
              <span style={{ color: "var(--foreground)", fontWeight: 700, fontSize: "0.78rem" }}>Watching</span>
              <span
                className="px-1.5 py-0.5 rounded-md"
                style={{ background: "rgba(24,211,209,0.1)", color: "#18D3D1", fontSize: "0.6rem", fontWeight: 700 }}
              >
                {watchedProducts.length}
              </span>
            </div>
            <div
              className="flex gap-3 overflow-x-auto px-4 pb-1"
              style={{ scrollbarWidth: "none" }}
            >
              {watchedProducts.map((p) => (
                <WatchingCard key={p.id} product={p} onTap={() => onTapProduct(p)} />
              ))}
            </div>
          </div>
        )}

        {/* Divider when Watching is shown */}
        {watchedProducts.length > 0 && (
          <div className="mx-4 mb-4" style={{ height: 1, background: "var(--border)" }} />
        )}

        {/* Category interests */}
        <div className="px-4 mb-3">
          <p style={{ color: "var(--muted-foreground)", fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.06em", marginBottom: "0.6rem" }}>
            YOUR INTERESTS
          </p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => {
              const active = selectedCategories.has(cat);
              return (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all duration-150"
                  style={{
                    background: active ? "rgba(24,211,209,0.1)" : "var(--secondary)",
                    border: active ? "1px solid rgba(24,211,209,0.3)" : "1px solid var(--border)",
                    color: active ? "#18D3D1" : "var(--muted-foreground)",
                    fontSize: "0.72rem",
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {CATEGORY_EMOJIS[cat]} {cat}
                  {active && <Check size={10} />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Min score filter */}
        <div className="px-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p style={{ color: "var(--muted-foreground)", fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.06em" }}>
              MINIMUM SCORE
            </p>
            <span
              className="px-2 py-0.5 rounded-lg"
              style={{ background: "rgba(24,211,209,0.1)", border: "1px solid rgba(24,211,209,0.2)", color: "#18D3D1", fontSize: "0.72rem", fontWeight: 700 }}
            >
              {minScore}+
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span style={{ color: "var(--muted-foreground)", fontSize: "0.65rem" }}>50</span>
            <input
              type="range"
              min={50}
              max={95}
              step={5}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #18D3D1 0%, #18D3D1 ${((minScore - 50) / 45) * 100}%, rgba(255,255,255,0.1) ${((minScore - 50) / 45) * 100}%, rgba(255,255,255,0.1) 100%)`,
                outline: "none",
                border: "none",
              }}
            />
            <span style={{ color: "var(--muted-foreground)", fontSize: "0.65rem" }}>95</span>
          </div>
        </div>

        {/* Results header */}
        <div className="flex items-center justify-between px-4 mb-2">
          <span style={{ color: "var(--foreground)", fontSize: "0.78rem", fontWeight: 700 }}>Picked for you</span>
          <span
            className="px-1.5 py-0.5 rounded-md"
            style={{ background: "rgba(24,211,209,0.1)", color: "#18D3D1", fontSize: "0.62rem", fontWeight: 700 }}
          >
            {feed.length} results
          </span>
        </div>

        {/* Feed */}
        <div className="px-4 pb-24 space-y-3">
          {feed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2">
              <Sparkles size={24} style={{ color: "var(--muted-foreground)", opacity: 0.4 }} />
              <p style={{ color: "var(--muted-foreground)", fontSize: "0.82rem" }}>
                Try lowering the minimum score or adding more interests
              </p>
            </div>
          ) : (
            feed.map((product) => (
              <ProductCard key={product.id} product={product} onTap={onTapProduct} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
