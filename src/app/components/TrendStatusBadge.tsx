import type { TrendStatus } from "./data";

const STATUS_CONFIG: Record<TrendStatus, { color: string; bg: string; border: string; icon: string }> = {
  Exploding: { color: "#FF2D78", bg: "rgba(255,45,120,0.12)", border: "rgba(255,45,120,0.28)", icon: "🚀" },
  Rising:    { color: "#18D3D1", bg: "rgba(24,211,209,0.10)", border: "rgba(24,211,209,0.25)", icon: "↑" },
  Stable:    { color: "#7A8099", bg: "rgba(122,128,153,0.10)", border: "rgba(122,128,153,0.20)", icon: "→" },
  Cooling:   { color: "#A78BFA", bg: "rgba(167,139,250,0.10)", border: "rgba(167,139,250,0.22)", icon: "↓" },
};

interface TrendStatusBadgeProps {
  status: TrendStatus;
  size?: "sm" | "md";
}

export function TrendStatusBadge({ status, size = "sm" }: TrendStatusBadgeProps) {
  const cfg = STATUS_CONFIG[status];
  const textSize = size === "md" ? "0.72rem" : "0.62rem";
  const px = size === "md" ? "0.55rem" : "0.45rem";
  const py = size === "md" ? "0.3rem" : "0.22rem";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        padding: `${py} ${px}`,
        borderRadius: "999px",
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        color: cfg.color,
        fontSize: textSize,
        fontWeight: 700,
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: size === "md" ? "0.7rem" : "0.6rem" }}>{cfg.icon}</span>
      {status}
    </span>
  );
}

export function trendColor(status: TrendStatus): string {
  return STATUS_CONFIG[status].color;
}
