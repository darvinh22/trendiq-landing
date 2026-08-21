import { describe, expect, it } from "vitest";
import { VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT } from "../liveSnapshotFixtures";
import { DATA_LAYER_TIMESTAMP, RAY_BAN_META_PRODUCT_ID } from "../mockProviderSignals";
import { mockTrendSignalProviders } from "../providers";
import { EXPECTED_ENGINE_FIELDS, aggregateSignals } from "../signalAggregator";
import { collectProviderSignals } from "../snapshotEngine";

describe("signalAggregator", () => {
  it("aggregates normalized provider signals into TrendIQ Score v1.1 inputs", () => {
    const signals = collectProviderSignals(RAY_BAN_META_PRODUCT_ID, mockTrendSignalProviders);
    const result = aggregateSignals(RAY_BAN_META_PRODUCT_ID, signals, DATA_LAYER_TIMESTAMP);

    expect(result.aggregatedSignals.socialMomentum.mentions7d).toBe(42000);
    expect(result.aggregatedSignals.searchMomentum.searchGrowthPercent).toBe(46);
    expect(result.aggregatedSignals.sentiment.positiveMentionPercent).toBe(74);
    expect(result.aggregatedSignals.reviewQuality.averageRating).toBe(4.4);
    expect(result.aggregatedSignals.purchaseIntent.addToCartRatePercent).toBe(10.5);
    expect(result.aggregatedSignals.growthVelocity.trendChangePercent).toBe(34.2);
    expect(result.aggregatedSignals.hypeSustainability.sourceHalfLifeDays).toBe(18);
  });

  it("infers low-base search context from legacy persisted DataForSEO signals", () => {
    const result = aggregateSignals(
      RAY_BAN_META_PRODUCT_ID,
      VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.rawSignals,
      VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.timestamp
    );

    expect(result.aggregatedSignals.searchMomentum.previous7dRelativeInterest).toBe(42.29);
    expect(result.aggregatedSignals.searchMomentum.hasLowBaseSearchGrowth).toBe(false);
    expect(result.aggregatedSignals.growthVelocity.hasSearchDerivedVelocity).toBe(true);
  });

  it("derives confidence and provenance outside the score engine", () => {
    const signals = collectProviderSignals(RAY_BAN_META_PRODUCT_ID, mockTrendSignalProviders);
    const result = aggregateSignals(RAY_BAN_META_PRODUCT_ID, signals, DATA_LAYER_TIMESTAMP);

    expect(result.confidenceSignals.sourceCount).toBe(5);
    expect(result.confidenceSignals.completeSignalCount).toBe(EXPECTED_ENGINE_FIELDS.length);
    expect(result.confidenceSignals.expectedSignalCount).toBe(EXPECTED_ENGINE_FIELDS.length);
    expect(result.confidenceSignals.observationCount).toBeGreaterThan(5000);
    expect(result.provenance.sources.map((source) => source.label)).toContain("Search/Web interest");
    expect(result.provenance.sources.map((source) => source.label)).toContain("Product reviews");
  });
});
