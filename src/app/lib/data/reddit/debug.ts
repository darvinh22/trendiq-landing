import { roundTo } from "../../scoring/normalization";
import type { RedditSignalSummary } from "./signalBuilder";

export function formatRedditDebugSummary(productName: string, summary: RedditSignalSummary): string {
  return [
    productName,
    `Reddit observations: ${summary.currentObservationCount}`,
    `Positive: ${roundTo(summary.positivePercent, 1)}%`,
    `Negative: ${roundTo(summary.negativePercent, 1)}%`,
    `Purchase intent: ${roundTo(summary.purchaseIntentPercent, 1)}%`,
    `Mention growth: ${summary.mentionGrowthPercent >= 0 ? "+" : ""}${roundTo(summary.mentionGrowthPercent, 1)}%`,
    `Subreddits: ${summary.uniqueSubredditCount}`,
    `Confidence: ${roundTo(summary.confidence, 1)}`,
  ].join("\n");
}
