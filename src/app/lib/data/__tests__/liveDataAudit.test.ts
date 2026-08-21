import { describe, expect, it } from "vitest";
import { calculateConfidenceScore } from "../../scoring/confidenceEngine";
import { calculateTrendMomentum } from "../../scoring/momentumEngine";
import { calculateTrendIQScore } from "../../scoring/scoreEngine";
import { VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT } from "../liveSnapshotFixtures";
import { DATA_LAYER_TIMESTAMP, RAY_BAN_META_PRODUCT_ID } from "../mockProviderSignals";
import { mockTrendSignalProviders } from "../providers";
import { aggregateSignals } from "../signalAggregator";
import { buildProductTrendSnapshot } from "../snapshotEngine";
import { buildTrendIQSnapshotProvenanceSummary } from "../liveDataAudit";

function dataForSeoOnlyAudit() {
  const rawSignals = VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.rawSignals.filter((signal) =>
    signal.sourceProvenance.provider === "dataforseo_trends"
  );
  const aggregation = aggregateSignals(
    RAY_BAN_META_PRODUCT_ID,
    rawSignals,
    VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.timestamp
  );
  const trendIQScore = calculateTrendIQScore(aggregation.aggregatedSignals);
  const confidence = calculateConfidenceScore(aggregation.confidenceSignals);
  const trendStatus = calculateTrendMomentum({
    changePercent: aggregation.aggregatedSignals.growthVelocity.trendChangePercent,
    current7dRelativeInterest: aggregation.aggregatedSignals.searchMomentum.current7dRelativeInterest,
    previous7dRelativeInterest: aggregation.aggregatedSignals.searchMomentum.previous7dRelativeInterest,
    hasSearchGrowthContext: aggregation.aggregatedSignals.growthVelocity.hasSearchDerivedVelocity,
    hasLowBaseSearchGrowth: aggregation.aggregatedSignals.searchMomentum.hasLowBaseSearchGrowth,
  });

  return buildTrendIQSnapshotProvenanceSummary({
    sourceMode: "live",
    rawSignals: aggregation.rawSignals,
    trendIQScore,
    confidence,
    trendStatus,
  });
}

describe("live data audit", () => {
  it("summarizes a fully mock snapshot with zero live coverage", () => {
    const snapshot = buildProductTrendSnapshot(RAY_BAN_META_PRODUCT_ID, mockTrendSignalProviders, {
      timestamp: DATA_LAYER_TIMESTAMP,
      sourceMode: "mock",
    });

    expect(snapshot.rawSignals.every((signal) => signal.sourceProvenance.mode === "mock")).toBe(true);
    expect(snapshot.liveDataAudit?.overallTrendIQScore).toBe(snapshot.trendIQScore.score);
    expect(snapshot.liveDataAudit?.scoreVersion).toBe("v1.1");
    expect(snapshot.liveDataAudit?.liveCoveragePercent).toBe(0);
    expect(snapshot.liveDataAudit?.weightedLiveIQContribution).toBe(0);
    expect(snapshot.liveDataAudit?.mockFallbackComponents).toEqual([
      "socialMomentum",
      "searchMomentum",
      "sentiment",
      "reviewQuality",
      "purchaseIntent",
      "growthVelocity",
      "hypeSustainability",
    ]);
    expect(snapshot.liveDataAudit?.reddit).toEqual({
      mode: "mock/fallback",
      approvalStatus: "pending",
      liveApiRequestMade: false,
    });
  });

  it("reports DataForSEO-only active fields as fully live-covered", () => {
    const audit = dataForSeoOnlyAudit();

    expect(audit.liveCoveragePercent).toBe(100);
    expect(audit.mockFallbackScoringWeight).toBe(0);
    expect(audit.liveComponents).toEqual(["searchMomentum", "growthVelocity"]);
    expect(audit.liveBackedScoringWeight).toBeGreaterThan(0);
    expect(audit.componentSummaries.some((component) =>
      component.fields.some((field) => field.provenance === "derived-live")
    )).toBe(true);
  });

  it("summarizes a mixed DataForSEO plus mock/fallback snapshot", () => {
    const audit = VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.liveDataAudit;

    expect(audit?.liveCoveragePercent).toBeGreaterThan(0);
    expect(audit?.liveCoveragePercent).toBeLessThan(100);
    expect(audit?.liveComponents).toEqual(["searchMomentum", "growthVelocity"]);
    expect(audit?.mockFallbackComponents).toContain("searchMomentum");
    expect(audit?.mockFallbackComponents).not.toContain("growthVelocity");
    expect(audit?.mockFallbackComponents).toContain("sentiment");
    expect(audit?.weightedLiveIQContribution).toBeGreaterThan(0);
    expect(audit?.weightedMockFallbackIQContribution).toBeGreaterThan(0);
  });

  it("marks DataForSEO-derived fields as derived-live", () => {
    const searchComponent = VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.liveDataAudit?.componentSummaries
      .find((component) => component.component === "searchMomentum");
    const growthComponent = VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.liveDataAudit?.componentSummaries
      .find((component) => component.component === "growthVelocity");

    expect(searchComponent?.fields.find((field) =>
      field.engineField === "searchGrowthPercent"
    )?.provenance).toBe("derived-live");
    expect(growthComponent?.fields.find((field) =>
      field.engineField === "trendChangePercent"
    )?.provenance).toBe("derived-live");
    expect(growthComponent?.fields.find((field) =>
      field.engineField === "accelerationPercent"
    )?.provenance).toBe("derived-live");
    expect(growthComponent?.fields.find((field) =>
      field.engineField === "consecutiveGrowthDays"
    )?.provenance).toBe("derived-live");
  });

  it("marks only components that still combine live and fallback fields as derived-mixed", () => {
    const searchComponent = VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.liveDataAudit?.componentSummaries
      .find((component) => component.component === "searchMomentum");
    const growthComponent = VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.liveDataAudit?.componentSummaries
      .find((component) => component.component === "growthVelocity");

    expect(searchComponent?.provenance).toBe("derived-mixed");
    expect(growthComponent?.provenance).toBe("derived-live");
    expect(growthComponent?.liveCoveragePercent).toBe(100);
    expect(growthComponent?.fields.find((field) =>
      field.engineField === "accelerationPercent"
    )?.provenance).toBe("derived-live");
  });
});
