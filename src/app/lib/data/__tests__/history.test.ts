import { describe, expect, it } from "vitest";
import {
  buildMockHistoricalSnapshots,
  calculateCompatibleHistoricalMomentum,
  calculateHistoricalMomentum,
} from "../history";

const baseTimestamp = "2026-08-10T00:00:00.000Z";
const nextTimestamp = "2026-08-11T00:00:00.000Z";

function history(first: number, last: number) {
  return [
    {
      productId: "test",
      timestamp: baseTimestamp,
      sourceMode: "mock" as const,
      scoreVersion: "v1.1" as const,
      trendIQScore: first,
      confidenceScore: 90,
    },
    {
      productId: "test",
      timestamp: nextTimestamp,
      sourceMode: "mock" as const,
      scoreVersion: "v1.1" as const,
      trendIQScore: last,
      confidenceScore: 90,
    },
  ];
}

describe("historical trend snapshots", () => {
  it("builds mock historical snapshots for existing products", () => {
    const snapshots = buildMockHistoricalSnapshots("ray-ban-meta");
    const latest = snapshots[snapshots.length - 1];

    expect(snapshots).toHaveLength(7);
    expect(latest.productId).toBe("ray-ban-meta");
    expect(latest.sourceMode).toBe("mock");
    expect(latest.scoreVersion).toBe("v1.1");
    expect(latest.trendStatus?.status).toBe("Rising");
  });

  it("classifies Exploding from historical percent change", () => {
    expect(calculateHistoricalMomentum(history(40, 60)).status).toBe("Exploding");
  });

  it("classifies Rising from historical percent change", () => {
    expect(calculateHistoricalMomentum(history(50, 55)).status).toBe("Rising");
  });

  it("classifies Stable from historical percent change", () => {
    expect(calculateHistoricalMomentum(history(50, 54.9)).status).toBe("Stable");
  });

  it("classifies Cooling from historical percent change", () => {
    expect(calculateHistoricalMomentum(history(50, 45)).status).toBe("Cooling");
  });

  it("requires enough compatible live snapshots before calculating live momentum", () => {
    const snapshots = [
      ...buildMockHistoricalSnapshots("ray-ban-meta"),
      {
        productId: "ray-ban-meta",
        timestamp: "2026-08-12T00:00:00.000Z",
        sourceMode: "live" as const,
        scoreVersion: "v1.1" as const,
        trendIQScore: 63,
        confidenceScore: 100,
      },
    ];

    expect(calculateCompatibleHistoricalMomentum({
      snapshots,
      sourceMode: "live",
    })).toMatchObject({
      isReady: false,
      compatibleSnapshotCount: 1,
      requiredSnapshotCount: 7,
      sourceMode: "live",
      scoreVersion: "v1.1",
    });
  });

  it("calculates momentum from compatible source mode and score version only", () => {
    const liveSnapshots = [60, 62, 63, 64, 65, 66, 67].map((trendIQScore, index) => ({
      productId: "ray-ban-meta",
      timestamp: new Date(Date.UTC(2026, 7, 6 + index)).toISOString(),
      sourceMode: "live" as const,
      scoreVersion: "v1.1" as const,
      trendIQScore,
      confidenceScore: 100,
    }));
    const incompatibleSnapshots = [
      {
        productId: "ray-ban-meta",
        timestamp: "2026-08-13T00:00:00.000Z",
        sourceMode: "mock" as const,
        scoreVersion: "v1.1" as const,
        trendIQScore: 100,
        confidenceScore: 90,
      },
      {
        productId: "ray-ban-meta",
        timestamp: "2026-08-14T00:00:00.000Z",
        sourceMode: "live" as const,
        scoreVersion: "v1" as const,
        trendIQScore: 5,
        confidenceScore: 90,
      },
    ];

    const result = calculateCompatibleHistoricalMomentum({
      snapshots: [...incompatibleSnapshots, ...liveSnapshots],
      sourceMode: "live",
    });

    expect(result.isReady).toBe(true);
    expect(result.compatibleSnapshotCount).toBe(7);
    expect(result.trendStatus?.status).toBe("Rising");
  });

  it("does not mix legacy v1 snapshots with current v1.1 momentum", () => {
    const snapshots = [
      ...[60, 62, 64, 66, 68, 70].map((trendIQScore, index) => ({
        productId: "ray-ban-meta",
        timestamp: new Date(Date.UTC(2026, 7, 6 + index)).toISOString(),
        sourceMode: "live" as const,
        scoreVersion: "v1.1" as const,
        trendIQScore,
        confidenceScore: 100,
      })),
      {
        productId: "ray-ban-meta",
        timestamp: "2026-08-13T00:00:00.000Z",
        sourceMode: "live" as const,
        scoreVersion: "v1" as const,
        trendIQScore: 100,
        confidenceScore: 100,
      },
    ];

    expect(calculateCompatibleHistoricalMomentum({
      snapshots,
      sourceMode: "live",
    })).toMatchObject({
      isReady: false,
      compatibleSnapshotCount: 6,
      scoreVersion: "v1.1",
    });
  });
});
