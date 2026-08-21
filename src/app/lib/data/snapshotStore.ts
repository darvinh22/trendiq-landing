import type { HistoricalTrendSnapshot, ProductTrendSnapshot, SnapshotSourceMode } from "./types";

export interface SnapshotHistoryFilter {
  sourceMode?: SnapshotSourceMode;
}

function snapshotKey(snapshot: ProductTrendSnapshot): string {
  return [
    snapshot.productId,
    snapshot.timestamp,
    snapshot.sourceMode,
    snapshot.trendIQScore.scoreVersion,
  ].join(":");
}

export function toHistoricalTrendSnapshot(snapshot: ProductTrendSnapshot): HistoricalTrendSnapshot {
  return {
    productId: snapshot.productId,
    timestamp: snapshot.timestamp,
    sourceMode: snapshot.sourceMode,
    scoreVersion: snapshot.trendIQScore.scoreVersion,
    trendIQScore: snapshot.trendIQScore.score,
    confidenceScore: snapshot.confidence.score,
    trendStatus: snapshot.trendStatus,
  };
}

export class LocalTrendSnapshotStore {
  private readonly snapshots = new Map<string, ProductTrendSnapshot>();

  constructor(initialSnapshots: ProductTrendSnapshot[] = []) {
    for (const snapshot of initialSnapshots) {
      this.save(snapshot);
    }
  }

  save(snapshot: ProductTrendSnapshot): ProductTrendSnapshot {
    this.snapshots.set(snapshotKey(snapshot), snapshot);
    return snapshot;
  }

  list(productId: string, filter: SnapshotHistoryFilter = {}): ProductTrendSnapshot[] {
    return [...this.snapshots.values()]
      .filter((snapshot) => snapshot.productId === productId)
      .filter((snapshot) => !filter.sourceMode || snapshot.sourceMode === filter.sourceMode)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  listHistorical(productId: string, filter: SnapshotHistoryFilter = {}): HistoricalTrendSnapshot[] {
    return this.list(productId, filter).map(toHistoricalTrendSnapshot);
  }
}

export function createLocalTrendSnapshotStore(initialSnapshots: ProductTrendSnapshot[] = []): LocalTrendSnapshotStore {
  return new LocalTrendSnapshotStore(initialSnapshots);
}
