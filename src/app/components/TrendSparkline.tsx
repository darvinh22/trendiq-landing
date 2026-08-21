import { AreaChart, Area, Tooltip, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { TrendPoint, TrendStatus, TrendData } from "./data";
import { trendColor } from "./TrendStatusBadge";

// ── Compact card sparkline (fixed 60×28, no axes, no tooltip) ──────────────

interface TrendSparklineProps {
  history: TrendPoint[];
  status: TrendStatus;
}

export function TrendSparkline({ history, status }: TrendSparklineProps) {
  const color = trendColor(status);
  const gradId = `sg-${status}`;

  return (
    <AreaChart
      width={60}
      height={28}
      data={history}
      margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <Area
        type="monotone"
        dataKey="value"
        stroke={color}
        strokeWidth={1.5}
        fill={`url(#${gradId})`}
        dot={false}
        isAnimationActive={false}
      />
    </AreaChart>
  );
}

// ── Full-width detail chart (responsive, axes, crosshair tooltip) ──────────

interface TrendChartProps {
  trendData: TrendData;
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "rgba(17,21,32,0.95)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "8px",
        padding: "6px 10px",
        fontSize: "0.72rem",
        color: "var(--foreground)",
        backdropFilter: "blur(8px)",
      }}
    >
      <span style={{ color: "var(--muted-foreground)" }}>{label} · </span>
      <span style={{ fontWeight: 700 }}>{payload[0].value}</span>
    </div>
  );
}

export function TrendChart({ trendData }: TrendChartProps) {
  const { history, status } = trendData;
  const color = trendColor(status);
  const gradId = `tg-${status}`;

  return (
    <ResponsiveContainer width="100%" height={88}>
      <AreaChart data={history} margin={{ top: 8, right: 4, bottom: 0, left: -28 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="day"
          tick={{ fill: "var(--muted-foreground)", fontSize: 9, fontFamily: "Inter" } as any}
          axisLine={false}
          tickLine={false}
        />
        <YAxis hide domain={["auto", "auto"]} />
        <Tooltip
          content={<CustomTooltip />}
          cursor={{ stroke: "rgba(255,255,255,0.12)", strokeWidth: 1 }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradId})`}
          dot={false}
          activeDot={{ r: 4, fill: color, stroke: "var(--card)", strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
