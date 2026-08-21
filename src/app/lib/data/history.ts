import { roundTo } from "../scoring/normalization";
import { calculateTrendMomentum } from "../scoring/momentumEngine";
import { SCORE_VERSION, type ScoreVersion, type TrendMomentumResult, type TrendPoint } from "../scoring/types";
import type { HistoricalTrendSnapshot, SnapshotSourceMode } from "./types";

const HISTORY_START_UTC = Date.UTC(2026, 7, 5, 0, 0, 0);
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const DEFENSIBLE_LIVE_MOMENTUM_OBSERVATION_COUNT = 7;

// Mock historical scores are stored separately from product copy so future
// provider-backed history can replace them without touching UI-facing content.
// Values are 0-100 trend snapshot scores, and the first-to-last delta drives
// v1 momentum status with the existing momentum thresholds.
export const MOCK_HISTORICAL_SCORE_SERIES: Record<string, number[]> = {
  "ray-ban-meta": [67.1, 70, 72.4, 77.8, 82.3, 87, 90],
  "apple-vision-pro": [79.6, 77, 75, 73.5, 72, 71, 70],
  "whoop-5": [64, 66, 66.5, 70, 74, 78, 82],
  "oura-ring-4": [56.7, 64, 71, 80, 88, 92, 94.9],
  "bambu-lab-a1": [71, 72, 71.4, 73, 72.5, 73.3, 73],
  "claude-3-5": [51.2, 60, 69, 78, 86, 93, 96.9],
  "dyson-airwrap": [67.7, 67, 66.6, 65.8, 65.4, 64.5, 64],
  "peak-design-bag": [60.5, 64, 67, 69.5, 71, 73, 74],
};

function timestampForIndex(index: number): string {
  return new Date(HISTORY_START_UTC + index * ONE_DAY_MS).toISOString();
}

function toTrendPoints(snapshots: Pick<HistoricalTrendSnapshot, "timestamp" | "trendIQScore">[]): TrendPoint[] {
  return snapshots.map((snapshot, index) => ({
    day: new Date(snapshot.timestamp).toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: "UTC",
    }) || `Day ${index + 1}`,
    value: snapshot.trendIQScore,
  }));
}

export function calculateHistoricalMomentum(
  snapshots: Pick<HistoricalTrendSnapshot, "timestamp" | "trendIQScore">[],
  dayWindow = 7
): TrendMomentumResult {
  const sortedSnapshots = [...snapshots].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const scopedSnapshots = sortedSnapshots.slice(-dayWindow);

  return calculateTrendMomentum({
    history: toTrendPoints(scopedSnapshots),
  });
}

export interface CompatibleMomentumResult {
  isReady: boolean;
  sourceMode: SnapshotSourceMode;
  scoreVersion: ScoreVersion;
  compatibleSnapshotCount: number;
  requiredSnapshotCount: number;
  trendStatus?: TrendMomentumResult;
  reason?: string;
}

export function calculateCompatibleHistoricalMomentum(input: {
  snapshots: HistoricalTrendSnapshot[];
  sourceMode: SnapshotSourceMode;
  scoreVersion?: ScoreVersion;
  dayWindow?: number;
}): CompatibleMomentumResult {
  const scoreVersion = input.scoreVersion ?? SCORE_VERSION;
  const requiredSnapshotCount = input.dayWindow ?? DEFENSIBLE_LIVE_MOMENTUM_OBSERVATION_COUNT;
  const compatibleSnapshots = input.snapshots.filter((snapshot) =>
    snapshot.sourceMode === input.sourceMode && snapshot.scoreVersion === scoreVersion
  );

  if (compatibleSnapshots.length < requiredSnapshotCount) {
    return {
      isReady: false,
      sourceMode: input.sourceMode,
      scoreVersion,
      compatibleSnapshotCount: compatibleSnapshots.length,
      requiredSnapshotCount,
      reason: `Need ${requiredSnapshotCount} compatible ${input.sourceMode} ${scoreVersion} snapshots for historical momentum.`,
    };
  }

  return {
    isReady: true,
    sourceMode: input.sourceMode,
    scoreVersion,
    compatibleSnapshotCount: compatibleSnapshots.length,
    requiredSnapshotCount,
    trendStatus: calculateHistoricalMomentum(compatibleSnapshots, requiredSnapshotCount),
  };
}

export function buildMockHistoricalSnapshots(productId: string): HistoricalTrendSnapshot[] {
  const series = MOCK_HISTORICAL_SCORE_SERIES[productId] ?? [];

  return series.map((score, index, allScores) => {
    const snapshotsSoFar = allScores.slice(0, index + 1).map((trendIQScore, snapshotIndex) => ({
      productId,
      timestamp: timestampForIndex(snapshotIndex),
      trendIQScore,
      sourceMode: "mock" as const,
      scoreVersion: SCORE_VERSION,
      confidenceScore: 90,
    }));

    return {
      productId,
      timestamp: timestampForIndex(index),
      sourceMode: "mock",
      scoreVersion: SCORE_VERSION,
      trendIQScore: roundTo(score, 1),
      confidenceScore: 90,
      trendStatus: calculateHistoricalMomentum(snapshotsSoFar),
    };
  });
}
