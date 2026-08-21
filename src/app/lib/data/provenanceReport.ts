import type { TrendIQScoreComponentKey } from "../scoring/types";
import { buildTrendIQSnapshotProvenanceSummary } from "./liveDataAudit";
import type { ProductTrendSnapshot, SignalSourceProvenanceMode, TrendIQSnapshotProvenanceSummary } from "./types";

const COMPONENT_LABELS: Record<TrendIQScoreComponentKey, string> = {
  socialMomentum: "Social momentum",
  searchMomentum: "Search momentum",
  sentiment: "Sentiment",
  reviewQuality: "Review quality",
  purchaseIntent: "Purchase intent",
  growthVelocity: "Growth velocity",
  hypeSustainability: "Hype sustainability",
};

const PROVENANCE_LABELS: Record<SignalSourceProvenanceMode, string> = {
  live: "live",
  mock: "mock",
  fallback: "fallback",
  "derived-live": "derived-live",
  "derived-mixed": "derived-mixed",
};

function auditForSnapshot(snapshot: ProductTrendSnapshot): TrendIQSnapshotProvenanceSummary {
  return snapshot.liveDataAudit ?? buildTrendIQSnapshotProvenanceSummary({
    sourceMode: snapshot.sourceMode,
    rawSignals: snapshot.rawSignals,
    trendIQScore: snapshot.trendIQScore,
    confidence: snapshot.confidence,
    trendStatus: snapshot.trendStatus,
  });
}

function componentList(components: TrendIQScoreComponentKey[]): string {
  if (!components.length) return "none";
  return components.map((component) => COMPONENT_LABELS[component]).join(", ");
}

function formatContributionLines(audit: TrendIQSnapshotProvenanceSummary): string[] {
  return (Object.keys(PROVENANCE_LABELS) as SignalSourceProvenanceMode[]).map((mode) =>
    `  ${PROVENANCE_LABELS[mode]}: ${audit.weightedIQContributionByProvenance[mode].toFixed(2)} IQ points`
  );
}

export function formatRayBanMetaProvenanceReport(snapshot: ProductTrendSnapshot): string {
  const audit = auditForSnapshot(snapshot);

  return [
    "Ray-Ban Meta Live Data Layer v2 Provenance Report",
    `TrendIQ Score: ${audit.overallTrendIQScore}`,
    `Score version: ${audit.scoreVersion}`,
    `Confidence: ${audit.confidence.score} (${audit.confidence.level})`,
    `Momentum: ${audit.momentum.status} (${audit.momentum.changePercent >= 0 ? "+" : ""}${audit.momentum.changePercent}%)`,
    `liveCoveragePercent: ${audit.liveCoveragePercent}%`,
    `Live-backed components: ${componentList(audit.liveComponents)}`,
    `Mock/fallback components: ${componentList(audit.mockFallbackComponents)}`,
    "Weighted contribution by provenance type:",
    ...formatContributionLines(audit),
    `Weighted live IQ contribution: ${audit.weightedLiveIQContribution.toFixed(2)} IQ points`,
    `Weighted mock/fallback IQ contribution: ${audit.weightedMockFallbackIQContribution.toFixed(2)} IQ points`,
    `Reddit: mode=${audit.reddit.mode}; approvalStatus=${audit.reddit.approvalStatus}; liveApiRequestMade=${audit.reddit.liveApiRequestMade}`,
  ].join("\n");
}
