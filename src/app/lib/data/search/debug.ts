import { roundTo } from "../../scoring/normalization";
import type { SearchSignalSummary } from "./types";

function formatOptionalPercent(value: number | undefined): string {
  if (typeof value !== "number") return "n/a";
  return `${value >= 0 ? "+" : ""}${roundTo(value, 1)}%`;
}

export function formatSearchDebugSummary(productName: string, summary: SearchSignalSummary): string {
  return [
    productName,
    `Search/Web provider: ${summary.provider}`,
    `Mode: ${summary.mode}`,
    `Queries matched: ${summary.queriesMatched}`,
    `Current 7d interest: ${roundTo(summary.current7dInterest, 1)}`,
    `Previous 7d interest: ${roundTo(summary.previous7dInterest, 1)}`,
    `7d change: ${formatOptionalPercent(summary.change7dPercent)}`,
    `30d change: ${formatOptionalPercent(summary.change30dPercent)}`,
    "Web mentions: n/a",
    "Source diversity: n/a",
    `Search Momentum: ${roundTo(summary.current7dInterest, 1)}`,
    `Growth Velocity: ${formatOptionalPercent(summary.accelerationPercent)}`,
    `Confidence: ${roundTo(summary.confidence, 1)}`,
  ].join("\n");
}
