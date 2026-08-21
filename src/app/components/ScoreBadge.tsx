import { useEffect, useRef, useState } from "react";

interface ScoreBadgeProps {
  score: number;
  size?: "sm" | "md" | "lg" | "xl";
  animate?: boolean;
}

function getScoreColor(score: number): { glow: string; text: string; bg: string; border: string } {
  if (score >= 85) return {
    glow: "0 0 20px rgba(24, 211, 209, 0.4)",
    text: "#18D3D1",
    bg: "rgba(24, 211, 209, 0.1)",
    border: "rgba(24, 211, 209, 0.3)",
  };
  if (score >= 70) return {
    glow: "0 0 20px rgba(124, 92, 252, 0.4)",
    text: "#A78BFA",
    bg: "rgba(124, 92, 252, 0.1)",
    border: "rgba(124, 92, 252, 0.3)",
  };
  return {
    glow: "0 0 20px rgba(255, 180, 71, 0.3)",
    text: "#FFB547",
    bg: "rgba(255, 180, 71, 0.1)",
    border: "rgba(255, 180, 71, 0.3)",
  };
}

export function ScoreBadge({ score, size = "md", animate = false }: ScoreBadgeProps) {
  const [displayed, setDisplayed] = useState(animate ? 0 : score);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!animate) { setDisplayed(score); return; }
    const duration = 900;
    const start = performance.now();
    startRef.current = start;
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(eased * score));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [score, animate]);

  const colors = getScoreColor(score);

  const sizeClasses = {
    sm: "w-10 h-10 text-sm",
    md: "w-14 h-14 text-lg",
    lg: "w-20 h-20 text-2xl",
    xl: "w-24 h-24 text-3xl",
  };

  const labelSizes = {
    sm: "text-[8px]",
    md: "text-[9px]",
    lg: "text-[10px]",
    xl: "text-[11px]",
  };

  return (
    <div
      className={`${sizeClasses[size]} rounded-2xl flex flex-col items-center justify-center shrink-0`}
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        boxShadow: colors.glow,
      }}
    >
      <span style={{ color: colors.text, fontWeight: 700, lineHeight: 1 }}>{displayed}</span>
      <span className={`${labelSizes[size]} mt-0.5`} style={{ color: colors.text, opacity: 0.7, fontWeight: 500 }}>
        IQ
      </span>
    </div>
  );
}

export function ScoreBar({ score, label, color }: { score: number; label: string; color: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span style={{ color: "var(--muted-foreground)", fontSize: "0.75rem" }}>{label}</span>
        <span style={{ color, fontSize: "0.75rem", fontWeight: 600 }}>{score}</span>
      </div>
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: "rgba(255,255,255,0.06)" }}
      >
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${score}%`,
            background: `linear-gradient(90deg, ${color}88, ${color})`,
            boxShadow: `0 0 8px ${color}66`,
          }}
        />
      </div>
    </div>
  );
}
