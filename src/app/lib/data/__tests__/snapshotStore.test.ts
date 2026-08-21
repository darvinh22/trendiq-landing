import { describe, expect, it } from "vitest";
import { buildMockHistoricalSnapshots } from "../history";
import {
  VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT,
  createDevelopmentTrendSnapshotStore,
} from "../liveSnapshotFixtures";
import { RAY_BAN_META_PRODUCT_ID } from "../mockProviderSignals";
import { mockTrendSignalProviders } from "../providers";
import { buildProductTrendSnapshot } from "../snapshotEngine";
import { createLocalTrendSnapshotStore, toHistoricalTrendSnapshot } from "../snapshotStore";

const timestamp = "2026-08-12T00:00:00.000Z";

describe("LocalTrendSnapshotStore", () => {
  it("saves and reads a live ProductTrendSnapshot", () => {
    const store = createLocalTrendSnapshotStore();

    store.save(VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT);

    const snapshots = store.list(RAY_BAN_META_PRODUCT_ID, { sourceMode: "live" });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      productId: RAY_BAN_META_PRODUCT_ID,
      timestamp,
      sourceMode: "live",
    });
    expect(snapshots[0].trendIQScore.scoreVersion).toBe("v1.1");
    expect(snapshots[0].trendIQScore.score).toBeGreaterThan(0);
  });

  it("reads snapshot history and preserves scoreVersion", () => {
    const store = createDevelopmentTrendSnapshotStore();
    const history = store.listHistorical(RAY_BAN_META_PRODUCT_ID, { sourceMode: "live" });

    expect(history).toEqual([
      {
        productId: RAY_BAN_META_PRODUCT_ID,
        timestamp,
        sourceMode: "live",
        scoreVersion: "v1.1",
        trendIQScore: VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.trendIQScore.score,
        confidenceScore: VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.confidence.score,
        trendStatus: VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.trendStatus,
      },
    ]);
  });

  it("distinguishes mock and live snapshots without overwriting either mode", () => {
    const mockSnapshot = buildProductTrendSnapshot(RAY_BAN_META_PRODUCT_ID, mockTrendSignalProviders, {
      timestamp,
      historicalSnapshots: buildMockHistoricalSnapshots(RAY_BAN_META_PRODUCT_ID),
      sourceMode: "mock",
    });
    const store = createLocalTrendSnapshotStore([mockSnapshot]);

    store.save(VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT);

    expect(store.list(RAY_BAN_META_PRODUCT_ID)).toHaveLength(2);
    expect(store.list(RAY_BAN_META_PRODUCT_ID, { sourceMode: "mock" })).toHaveLength(1);
    expect(store.list(RAY_BAN_META_PRODUCT_ID, { sourceMode: "live" })).toHaveLength(1);
    expect(store.list(RAY_BAN_META_PRODUCT_ID, { sourceMode: "mock" })[0].trendIQScore.score).toBeGreaterThan(0);
    expect(store.list(RAY_BAN_META_PRODUCT_ID, { sourceMode: "live" })[0].trendIQScore.score).toBeGreaterThan(0);
  });

  it("stores provider provenance, live search signals, score breakdown, and confidence", () => {
    const snapshot = VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT;
    const liveSearchSignal = snapshot.rawSignals.find((signal) =>
      signal.metadata?.provider === "dataforseo_trends" &&
      signal.metadata.engineField === "searchGrowthPercent"
    );

    expect(snapshot.provenance.sources.some((source) => source.source === "searchWeb")).toBe(true);
    expect(liveSearchSignal).toMatchObject({
      source: "searchWeb",
      signalType: "searchMomentum",
      confidence: 100,
    });
    expect(liveSearchSignal?.metadata?.engineValue).toBe(-82.8);
    expect(snapshot.aggregatedSignals.searchMomentum.searchGrowthPercent).toBe(-82.8);
    expect(snapshot.trendIQScore.components.searchMomentum).toBeGreaterThan(0);
    expect(snapshot.confidence.scoreVersion).toBe("v1.1");
  });

  it("converts full snapshots into compact historical snapshots", () => {
    expect(toHistoricalTrendSnapshot(VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT)).toMatchObject({
      productId: RAY_BAN_META_PRODUCT_ID,
      timestamp,
      sourceMode: "live",
      scoreVersion: "v1.1",
      trendIQScore: VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.trendIQScore.score,
    });
  });
});
