import { describe, expect, it } from "vitest";
import { calculateConfidenceScore } from "../../scoring/confidenceEngine";
import { calculateTrendIQScore } from "../../scoring/scoreEngine";
import { buildMockHistoricalSnapshots } from "../history";
import { DATA_LAYER_TIMESTAMP, RAY_BAN_META_PRODUCT_ID } from "../mockProviderSignals";
import { mockTrendSignalProviders } from "../providers";
import { buildProductTrendSnapshot, collectProviderSignals } from "../snapshotEngine";

describe("snapshotEngine", () => {
  it("builds a deterministic ProductTrendSnapshot from mock providers", () => {
    const historicalSnapshots = buildMockHistoricalSnapshots(RAY_BAN_META_PRODUCT_ID);
    const first = buildProductTrendSnapshot(RAY_BAN_META_PRODUCT_ID, mockTrendSignalProviders, {
      timestamp: DATA_LAYER_TIMESTAMP,
      historicalSnapshots,
    });
    const second = buildProductTrendSnapshot(RAY_BAN_META_PRODUCT_ID, mockTrendSignalProviders, {
      timestamp: DATA_LAYER_TIMESTAMP,
      historicalSnapshots,
    });

    expect(first).toEqual(second);
    expect(first.productId).toBe(RAY_BAN_META_PRODUCT_ID);
    expect(first.sourceMode).toBe("mock");
    expect(first.rawSignals.length).toBeGreaterThan(0);
    expect(first.trendIQScore.scoreVersion).toBe("v1.1");
    expect(first.confidence.scoreVersion).toBe("v1.1");
    expect(first.trendStatus.status).toBe("Rising");
  });

  it("integrates mock providers with the existing score and confidence engines", () => {
    const snapshot = buildProductTrendSnapshot(RAY_BAN_META_PRODUCT_ID, mockTrendSignalProviders, {
      timestamp: DATA_LAYER_TIMESTAMP,
      historicalSnapshots: buildMockHistoricalSnapshots(RAY_BAN_META_PRODUCT_ID),
    });

    expect(snapshot.trendIQScore).toEqual(calculateTrendIQScore(snapshot.aggregatedSignals));
    expect(snapshot.confidence).toEqual(calculateConfidenceScore(snapshot.aggregatedSignals.confidence));
  });

  it("collects provider signals without requiring the score engine to know their source", () => {
    const signals = collectProviderSignals(RAY_BAN_META_PRODUCT_ID, mockTrendSignalProviders);

    expect(signals.some((signal) => signal.source === "searchWeb")).toBe(true);
    expect(signals.some((signal) => signal.source === "reddit")).toBe(true);
    expect(signals.some((signal) => signal.source === "merchant")).toBe(true);
  });
});
