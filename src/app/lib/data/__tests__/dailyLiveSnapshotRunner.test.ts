import { describe, expect, it } from "vitest";
import {
  calculateCompatibleHistoricalMomentum,
  DEFENSIBLE_LIVE_MOMENTUM_OBSERVATION_COUNT,
} from "../history";
import { VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT } from "../liveSnapshotFixtures";
import { RAY_BAN_META_PRODUCT_ID } from "../mockProviderSignals";
import { mockTrendSignalProviders } from "../providers";
import {
  runDailyLiveSnapshot,
  utcDayForTimestamp,
} from "../dailyLiveSnapshotRunner";
import { buildProductTrendSnapshot } from "../snapshotEngine";
import { createLocalTrendSnapshotStore } from "../snapshotStore";
import type { NormalizedTrendSignal, ProductTrendSnapshot, TrendSignalProvider } from "../types";

const timestamp = "2026-08-13T12:00:00.000Z";

function fixtureSearchSignals(timestampOverride = timestamp): NormalizedTrendSignal[] {
  return VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.rawSignals
    .filter((signal) => signal.source === "searchWeb")
    .map((signal) => ({
      ...signal,
      timestamp: timestampOverride,
      metadata: { ...signal.metadata },
    }));
}

function liveSearchProvider(counter: { calls: number }): TrendSignalProvider {
  return {
    id: "searchWeb",
    label: "Fixture live search",
    getSignals: () => [],
    getSignalsAsync: async () => {
      counter.calls += 1;
      return fixtureSearchSignals();
    },
  };
}

function snapshotForDay(timestampOverride: string, score = 63): ProductTrendSnapshot {
  return {
    ...VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT,
    timestamp: timestampOverride,
    trendIQScore: {
      ...VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.trendIQScore,
      score,
    },
  };
}

describe("daily live snapshot runner", () => {
  it("creates one live daily snapshot and persists it through the snapshot store", async () => {
    const store = createLocalTrendSnapshotStore();
    const counter = { calls: 0 };

    const result = await runDailyLiveSnapshot({
      productId: RAY_BAN_META_PRODUCT_ID,
      store,
      searchProvider: liveSearchProvider(counter),
      timestamp,
    });

    expect(result.status).toBe("created");
    expect(counter.calls).toBe(1);
    expect(store.list(RAY_BAN_META_PRODUCT_ID, { sourceMode: "live" })).toHaveLength(1);
    expect(result.snapshot?.sourceMode).toBe("live");
    expect(result.snapshot?.trendIQScore.scoreVersion).toBe("v1.1");
    expect(result.summary.liveSignalCount).toBeGreaterThan(0);
    expect(result.summary.mockSignalCount).toBeGreaterThan(0);
  });

  it("prevents duplicate live snapshots for the same UTC day before calling providers", async () => {
    const existing = snapshotForDay(timestamp);
    const store = createLocalTrendSnapshotStore([existing]);
    const counter = { calls: 0 };

    const result = await runDailyLiveSnapshot({
      productId: RAY_BAN_META_PRODUCT_ID,
      store,
      searchProvider: liveSearchProvider(counter),
      timestamp: "2026-08-13T23:59:00.000Z",
    });

    expect(result.status).toBe("already_exists");
    expect(counter.calls).toBe(0);
    expect(store.list(RAY_BAN_META_PRODUCT_ID, { sourceMode: "live" })).toHaveLength(1);
    expect(result.message).toContain("no provider request");
  });

  it("allows mock and live snapshots to exist for the same UTC day", async () => {
    const mockSnapshot = buildProductTrendSnapshot(RAY_BAN_META_PRODUCT_ID, mockTrendSignalProviders, {
      timestamp,
      sourceMode: "mock",
    });
    const store = createLocalTrendSnapshotStore([mockSnapshot]);
    const counter = { calls: 0 };

    const result = await runDailyLiveSnapshot({
      productId: RAY_BAN_META_PRODUCT_ID,
      store,
      searchProvider: liveSearchProvider(counter),
      timestamp,
    });

    expect(result.status).toBe("created");
    expect(counter.calls).toBe(1);
    expect(store.list(RAY_BAN_META_PRODUCT_ID)).toHaveLength(2);
    expect(store.list(RAY_BAN_META_PRODUCT_ID, { sourceMode: "mock" })).toHaveLength(1);
    expect(store.list(RAY_BAN_META_PRODUCT_ID, { sourceMode: "live" })).toHaveLength(1);
  });

  it("treats same-day snapshots with incompatible score versions as non-duplicates", async () => {
    const incompatibleSnapshot = {
      ...snapshotForDay(timestamp),
      trendIQScore: {
        ...VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.trendIQScore,
        scoreVersion: "v1" as const,
      },
    };
    const store = createLocalTrendSnapshotStore([incompatibleSnapshot]);
    const counter = { calls: 0 };

    const result = await runDailyLiveSnapshot({
      productId: RAY_BAN_META_PRODUCT_ID,
      store,
      searchProvider: liveSearchProvider(counter),
      timestamp,
    });

    expect(result.status).toBe("created");
    expect(counter.calls).toBe(1);
    expect(store.list(RAY_BAN_META_PRODUCT_ID, { sourceMode: "live" })).toHaveLength(2);
  });

  it("marks historical 7-day status as provisional with fewer than seven live observations", async () => {
    const store = createLocalTrendSnapshotStore();
    const counter = { calls: 0 };

    const result = await runDailyLiveSnapshot({
      productId: RAY_BAN_META_PRODUCT_ID,
      store,
      searchProvider: liveSearchProvider(counter),
      timestamp,
    });

    expect(result.summary.historicalMomentum).toEqual({
      isProvisional: true,
      compatibleSnapshotCount: 1,
      requiredSnapshotCount: DEFENSIBLE_LIVE_MOMENTUM_OBSERVATION_COUNT,
      additionalObservationsNeeded: 6,
    });
  });

  it("calculates historical momentum from compatible live snapshots only", () => {
    const liveSnapshots = [60, 62, 63, 64, 65, 66, 67].map((score, index) => ({
      productId: RAY_BAN_META_PRODUCT_ID,
      timestamp: new Date(Date.UTC(2026, 7, 6 + index)).toISOString(),
      sourceMode: "live" as const,
      scoreVersion: "v1.1" as const,
      trendIQScore: score,
      confidenceScore: 100,
    }));
    const mockSnapshot = {
      ...liveSnapshots[0],
      timestamp: "2026-08-14T00:00:00.000Z",
      sourceMode: "mock" as const,
      trendIQScore: 1,
    };

    const result = calculateCompatibleHistoricalMomentum({
      snapshots: [mockSnapshot, ...liveSnapshots],
      sourceMode: "live",
    });

    expect(result.isReady).toBe(true);
    expect(result.compatibleSnapshotCount).toBe(7);
    expect(result.trendStatus?.status).toBe("Rising");
  });

  it("derives duplicate protection from UTC calendar days", () => {
    expect(utcDayForTimestamp("2026-08-13T23:59:59.999Z")).toBe("2026-08-13");
    expect(utcDayForTimestamp("2026-08-14T00:00:00.000Z")).toBe("2026-08-14");
  });
});
