import {
  ArrowLeft, CheckCircle, AlertTriangle, TrendingUp,
  MessageCircle, Flame, ExternalLink, Zap, Bookmark, BookmarkCheck,
} from "lucide-react";
import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from "recharts";
import type { Product } from "./data";
import { ScoreBadge, ScoreBar } from "./ScoreBadge";
import { TrendStatusBadge, trendColor } from "./TrendStatusBadge";
import { TrendChart } from "./TrendSparkline";
import { useWatchlist } from "../hooks/useWatchlist";
import type { ConsumerProductResult } from "../lib/data/consumerResult";
import { ConsumerResultPanel } from "./ConsumerResultPanel";

interface LegacyProductDetailProps {
  product: Product;
  onBack: () => void;
  consumerResult?: never;
  productId?: never;
}

interface SafeConsumerProductDetailProps {
  consumerResult: ConsumerProductResult | unknown;
  productId: string;
  onBack: () => void;
  product?: never;
}

export type ProductDetailProps = LegacyProductDetailProps | SafeConsumerProductDetailProps;

export function ProductDetail(props: ProductDetailProps) {
  if ("consumerResult" in props) {
    return (
      <div
        className="flex h-full min-h-0 flex-col overflow-y-auto"
        data-result-scroll=""
        style={{ background: "var(--background)", scrollbarWidth: "none" }}
      >
        <div className="px-4 pt-4">
          <button
            onClick={props.onBack}
            className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <ArrowLeft size={15} style={{ color: "var(--foreground)" }} />
            <span style={{ color: "var(--foreground)", fontSize: "0.75rem", fontWeight: 700 }}>Back</span>
          </button>
        </div>
        <div className="p-4">
          <ConsumerResultPanel consumerResult={props.consumerResult} productId={props.productId} />
        </div>
      </div>
    );
  }

  return <LegacyProductDetail product={props.product} onBack={props.onBack} />;
}

function SentimentGauge({ score, label }: { score: number; label: string }) {
  const color = score >= 85 ? "#18D3D1" : score >= 70 ? "#A78BFA" : "#FFB547";
  const data = [{ value: score, fill: color }];

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-16 h-16 relative">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart cx="50%" cy="50%" innerRadius="70%" outerRadius="100%" barSize={6} data={data} startAngle={90} endAngle={-270}>
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar dataKey="value" cornerRadius={4} background={{ fill: "rgba(255,255,255,0.05)" }} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center">
          <span style={{ color, fontWeight: 700, fontSize: "0.85rem" }}>{score}</span>
        </div>
      </div>
      <span style={{ color: "var(--muted-foreground)", fontSize: "0.65rem", fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function formatChange(pct: number): string {
  return (pct > 0 ? "+" : "") + pct.toFixed(1) + "% this week";
}

function LegacyProductDetail({ product, onBack }: LegacyProductDetailProps) {
  const { isWatched, toggle } = useWatchlist();
  const watched = isWatched(product.id);
  const changeColor = product.trend.changePercent >= 0 ? trendColor(product.trend.status) : "#A78BFA";

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: "var(--background)", scrollbarWidth: "none" }}>

      {/* Hero */}
      <div className="relative h-56 shrink-0 overflow-hidden">
        <img src={product.imageUrl} alt={product.title} className="w-full h-full object-cover" />
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(to bottom, rgba(8,9,14,0.3) 0%, rgba(8,9,14,0.95) 100%)" }}
        />

        {/* Back */}
        <button
          onClick={onBack}
          className="absolute top-4 left-4 flex items-center justify-center w-9 h-9 rounded-full"
          style={{ background: "rgba(8,9,14,0.7)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          <ArrowLeft size={16} style={{ color: "var(--foreground)" }} />
        </button>

        {/* Watch button */}
        <button
          onClick={() => toggle(product.id)}
          className="absolute top-14 right-4 flex items-center justify-center w-9 h-9 rounded-full transition-all duration-150"
          style={{
            background: watched ? "rgba(24,211,209,0.2)" : "rgba(8,9,14,0.7)",
            border: watched ? "1px solid rgba(24,211,209,0.4)" : "1px solid rgba(255,255,255,0.1)",
          }}
        >
          {watched
            ? <BookmarkCheck size={15} style={{ color: "#18D3D1" }} />
            : <Bookmark size={15} style={{ color: "var(--foreground)" }} />}
        </button>

        {/* Category + status */}
        <div className="absolute top-4 right-4 flex flex-col items-end gap-1.5">
          <span
            className="px-2.5 py-1 rounded-full"
            style={{
              background: "rgba(8,9,14,0.7)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "var(--muted-foreground)",
              fontSize: "0.65rem",
              fontWeight: 600,
            }}
          >
            {product.emoji} {product.category}
          </span>
        </div>

        {/* Title + trend status */}
        <div className="absolute bottom-4 left-4 right-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendStatusBadge status={product.trend.status} size="md" />
            <span style={{ color: changeColor, fontSize: "0.75rem", fontWeight: 700 }}>
              {formatChange(product.trend.changePercent)}
            </span>
          </div>
          <h1 style={{ color: "var(--foreground)", fontWeight: 800, fontSize: "1.4rem", lineHeight: 1.2 }}>
            {product.title}
          </h1>
          <p style={{ color: "var(--muted-foreground)", fontSize: "0.82rem", marginTop: "0.25rem" }}>
            {product.subtitle}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col gap-4 p-4">

        {/* Score + gauges */}
        <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-center gap-1">
              <ScoreBadge score={product.score} size="xl" animate />
              <span style={{ color: "var(--muted-foreground)", fontSize: "0.65rem", fontWeight: 600 }}>TRENDIQ SCORE</span>
            </div>
            <div className="flex-1 flex justify-around">
              <SentimentGauge score={product.tiktokScore} label="TIKTOK" />
              <SentimentGauge score={product.redditScore} label="REDDIT" />
              <SentimentGauge score={Math.round((product.score + product.tiktokScore + product.redditScore) / 3)} label="OVERALL" />
            </div>
          </div>
        </div>

        {/* Trend momentum card */}
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          {/* Chart header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <div className="flex items-center gap-2">
              <TrendingUp size={13} style={{ color: trendColor(product.trend.status) }} />
              <span style={{ color: "var(--foreground)", fontWeight: 700, fontSize: "0.82rem" }}>
                7-Day Momentum
              </span>
            </div>
            <span style={{ color: changeColor, fontWeight: 700, fontSize: "0.82rem" }}>
              {formatChange(product.trend.changePercent)}
            </span>
          </div>

          {/* Sparkline chart */}
          <div className="px-2">
            <TrendChart trendData={product.trend} />
          </div>

          {/* Why it's moving */}
          <div
            className="mx-4 mb-4 mt-3 rounded-xl p-3"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <p
              className="mb-1"
              style={{ color: trendColor(product.trend.status), fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em" }}
            >
              WHY IT'S MOVING
            </p>
            <p style={{ color: "var(--foreground)", fontSize: "0.8rem", lineHeight: 1.55, opacity: 0.85 }}>
              {product.trend.whyMoving}
            </p>
          </div>
        </div>

        {/* TrendIQ Says */}
        <div
          className="rounded-2xl p-4"
          style={{ background: "rgba(24,211,209,0.05)", border: "1px solid rgba(24,211,209,0.15)" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Zap size={13} style={{ color: "#18D3D1" }} />
            <span style={{ color: "#18D3D1", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.08em" }}>TRENDIQ SAYS</span>
          </div>
          <p style={{ color: "var(--foreground)", fontSize: "0.88rem", lineHeight: 1.6, opacity: 0.9 }}>
            "{product.trendiqSays}"
          </p>
        </div>

        {/* Sentiment breakdown */}
        <div className="rounded-2xl p-4 space-y-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <p style={{ color: "var(--foreground)", fontWeight: 700, fontSize: "0.85rem" }}>Sentiment Breakdown</p>
          <ScoreBar score={product.tiktokScore} label="TikTok Trend Score" color="#FF2D55" />
          <ScoreBar score={product.redditScore} label="Reddit Sentiment" color="#FF6314" />
          <ScoreBar score={product.score} label="Overall TrendIQ Score" color="#18D3D1" />
        </div>

        {/* TikTok Says */}
        <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={13} style={{ color: "#FF2D55" }} />
            <span style={{ color: "#FF2D55", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.08em" }}>TIKTOK SAYS</span>
          </div>
          <p style={{ color: "var(--foreground)", fontSize: "0.84rem", lineHeight: 1.6, opacity: 0.85 }}>{product.tiktokSays}</p>
        </div>

        {/* Reddit Sentiment */}
        <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 mb-2">
            <MessageCircle size={13} style={{ color: "#FF6314" }} />
            <span style={{ color: "#FF6314", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.08em" }}>REDDIT SENTIMENT</span>
          </div>
          <p style={{ color: "var(--foreground)", fontSize: "0.84rem", lineHeight: 1.6, opacity: 0.85 }}>{product.redditSentiment}</p>
        </div>

        {/* Best For + Watch Out */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl p-3" style={{ background: "rgba(76,175,130,0.06)", border: "1px solid rgba(76,175,130,0.15)" }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Flame size={12} style={{ color: "#4CAF82" }} />
              <span style={{ color: "#4CAF82", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em" }}>BEST FOR</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {product.bestFor.map((tag) => (
                <span key={tag} className="px-2 py-0.5 rounded-full" style={{ background: "rgba(76,175,130,0.1)", color: "#4CAF82", fontSize: "0.65rem", fontWeight: 500 }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-2xl p-3" style={{ background: "rgba(255,77,109,0.06)", border: "1px solid rgba(255,77,109,0.15)" }}>
            <div className="flex items-center gap-1.5 mb-2">
              <AlertTriangle size={12} style={{ color: "#FF4D6D" }} />
              <span style={{ color: "#FF4D6D", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em" }}>WATCH OUT</span>
            </div>
            <div className="flex flex-col gap-1">
              {product.watchOut.map((w) => (
                <span key={w} style={{ color: "var(--muted-foreground)", fontSize: "0.65rem", lineHeight: 1.4 }}>• {w}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Pros & Cons */}
        <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <p style={{ color: "var(--foreground)", fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.75rem" }}>Pros & Cons</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              {product.pros.map((pro) => (
                <div key={pro} className="flex items-start gap-2">
                  <CheckCircle size={12} className="shrink-0 mt-0.5" style={{ color: "#4CAF82" }} />
                  <span style={{ color: "var(--foreground)", fontSize: "0.75rem", lineHeight: 1.4, opacity: 0.85 }}>{pro}</span>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {product.cons.map((con) => (
                <div key={con} className="flex items-start gap-2">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" style={{ color: "#FF4D6D" }} />
                  <span style={{ color: "var(--foreground)", fontSize: "0.75rem", lineHeight: 1.4, opacity: 0.85 }}>{con}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Similar Alternatives */}
        <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 mb-3">
            <ExternalLink size={13} style={{ color: "var(--muted-foreground)" }} />
            <p style={{ color: "var(--foreground)", fontWeight: 700, fontSize: "0.85rem" }}>Similar Alternatives</p>
          </div>
          <div className="space-y-2">
            {product.alternatives.map((alt) => {
              const c = alt.score >= 85 ? "#18D3D1" : alt.score >= 70 ? "#A78BFA" : "#FFB547";
              return (
                <div
                  key={alt.title}
                  className="flex items-center justify-between py-2 px-3 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  <span style={{ color: "var(--foreground)", fontSize: "0.82rem" }}>{alt.title}</span>
                  <span className="px-2 py-0.5 rounded-lg" style={{ color: c, background: `${c}15`, border: `1px solid ${c}30`, fontSize: "0.75rem", fontWeight: 700 }}>
                    {alt.score}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="h-6" />
      </div>
    </div>
  );
}
