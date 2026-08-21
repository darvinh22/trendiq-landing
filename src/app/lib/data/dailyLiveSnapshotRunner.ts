import { SCORE_VERSION, type ScoreVersion } from "../scoring/types";
import { RAY_BAN_META_PRODUCT_ID } from "./mockProviderSignals";
import { merchantProvider } from "./providers/merchantProvider";
import { mockRedditProvider } from "./providers/redditProvider";
import { reviewsProvider } from "./providers/reviewsProvider";
import { socialProvider } from "./providers/socialProvider";
import { calculateCompatibleHistoricalMomentum } from "./history";
import { buildTrendIQSnapshotProvenanceSummary } from "./liveDataAudit";
import { buildProductTrendSnapshotAsync } from "./snapshotEngine";
import { toHistoricalTrendSnapshot, type LocalTrendSnapshotStore } from "./snapshotStore";
import type {
  HistoricalTrendSnapshot,
  ProductTrendSnapshot,
  TrendSignalProvider,
} from "./types";

const LIVE_SEARCH_PROVIDER_ID = "dataforseo_trends";

export type DailyLiveSnapshotStatus =
  | "created"
  | "already_exists"
  | "unsupported_product"
  | "failed_no_live_data";

export interface DailyLiveSnapshotSummary {
  productId: string;
  timestamp: string;
  utcDay: string;
  sourceMode: "live";
  scoreVersion: ScoreVersion;
  finalIQ?: number;
  confidence?: {
    score: number;
    level: string;
  };
  trendStatus?: ProductTrendSnapshot["trendStatus"];
  provenance?: ProductTrendSnapshot["provenance"];
  liveDataAudit?: ProductTrendSnapshot["liveDataAudit"];
  liveSignalCount: number;
  mockSignalCount: number;
  liveCoveragePercent?: number;
  historicalMomentum: {
    isProvisional: boolean;
    compatibleSnapshotCount: number;
    requiredSnapshotCount: number;
    additionalObservationsNeeded: number;
  };
}

export interface DailyLiveSnapshotResult {
  status: DailyLiveSnapshotStatus;
  snapshot?: ProductTrendSnapshot;
  existingSnapshot?: ProductTrendSnapshot;
  summary: DailyLiveSnapshotSummary;
  message: string;
}

export interface RunDailyLiveSnapshotOptions {
  productId: string;
  store: LocalTrendSnapshotStore;
  searchProvider: TrendSignalProvider;
  timestamp?: string;
  nonSearchProviders?: readonly TrendSignalProvider[];
}

export const DAILY_LIVE_SNAPSHOT_SUPPORTED_PRODUCTS = [RAY_BAN_META_PRODUCT_ID] as const;

export const DAILY_LIVE_SNAPSHOT_MOCK_FALLBACK_PROVIDERS: readonly TrendSignalProvider[] = [
  mockRedditProvider,
  reviewsProvider,
  socialProvider,
  merchantProvider,
];

export function utcDayForTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

export function findCompatibleLiveSnapshotForUtcDay(input: {
  snapshots: ProductTrendSnapshot[];
  productId: string;
  utcDay: string;
  scoreVersion?: ScoreVersion;
}): ProductTrendSnapshot | undefined {
  const scoreVersion = input.scoreVersion ?? SCORE_VERSION;

  return input.snapshots.find((snapshot) =>
    snapshot.productId === input.productId &&
    snapshot.sourceMode === "live" &&
    snapshot.trendIQScore.scoreVersion === scoreVersion &&
    utcDayForTimestamp(snapshot.timestamp) === input.utcDay
  );
}

function liveHistoricalSnapshotsForVersion(
  snapshots: HistoricalTrendSnapshot[],
  scoreVersion: ScoreVersion
): HistoricalTrendSnapshot[] {
  return snapshots.filter((snapshot) =>
    snapshot.sourceMode === "live" && snapshot.scoreVersion === scoreVersion
  );
}

function summarizeSnapshot(input: {
  productId: string;
  timestamp: string;
  snapshot?: ProductTrendSnapshot;
  compatibleHistoricalSnapshots: HistoricalTrendSnapshot[];
}): DailyLiveSnapshotSummary {
  const scoreVersion = input.snapshot?.trendIQScore.scoreVersion ?? SCORE_VERSION;
  const momentum = calculateCompatibleHistoricalMomentum({
    snapshots: input.compatibleHistoricalSnapshots,
    sourceMode: "live",
    scoreVersion,
  });
  const liveSignalCount = input.snapshot?.rawSignals.filter((signal) =>
    signal.metadata?.provider === LIVE_SEARCH_PROVIDER_ID
  ).length ?? 0;
  const totalSignalCount = input.snapshot?.rawSignals.length ?? 0;

  return {
    productId: input.productId,
    timestamp: input.timestamp,
    utcDay: utcDayForTimestamp(input.timestamp),
    sourceMode: "live",
    scoreVersion,
    finalIQ: input.snapshot?.trendIQScore.score,
    confidence: input.snapshot
      ? {
        score: input.snapshot.confidence.score,
        level: input.snapshot.confidence.level,
      }
      : undefined,
    trendStatus: input.snapshot?.trendStatus,
    provenance: input.snapshot?.provenance,
    liveDataAudit: input.snapshot?.liveDataAudit,
    liveSignalCount,
    mockSignalCount: Math.max(0, totalSignalCount - liveSignalCount),
    liveCoveragePercent: input.snapshot?.liveDataAudit?.liveCoveragePercent,
    historicalMomentum: {
      isProvisional: !momentum.isReady,
      compatibleSnapshotCount: momentum.compatibleSnapshotCount,
      requiredSnapshotCount: momentum.requiredSnapshotCount,
      additionalObservationsNeeded: Math.max(
        0,
        momentum.requiredSnapshotCount - momentum.compatibleSnapshotCount
      ),
    },
  };
}

export async function runDailyLiveSnapshot(
  options: RunDailyLiveSnapshotOptions
): Promise<DailyLiveSnapshotResult> {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const utcDay = utcDayForTimestamp(timestamp);

  if (!DAILY_LIVE_SNAPSHOT_SUPPORTED_PRODUCTS.includes(options.productId as typeof RAY_BAN_META_PRODUCT_ID)) {
    return {
      status: "unsupported_product",
      message: `Live daily snapshots currently support ${RAY_BAN_META_PRODUCT_ID} only.`,
      summary: summarizeSnapshot({
        productId: options.productId,
        timestamp,
        compatibleHistoricalSnapshots: [],
      }),
    };
  }

  const existingSnapshot = findCompatibleLiveSnapshotForUtcDay({
    snapshots: options.store.list(options.productId, { sourceMode: "live" }),
    productId: options.productId,
    utcDay,
  });

  if (existingSnapshot) {
    const compatibleHistoricalSnapshots = liveHistoricalSnapshotsForVersion(
      options.store.listHistorical(options.productId, { sourceMode: "live" }),
      existingSnapshot.trendIQScore.scoreVersion
    );

    return {
      status: "already_exists",
      existingSnapshot,
      message: "Today's compatible live snapshot already exists; no provider request was made.",
      summary: summarizeSnapshot({
        productId: options.productId,
        timestamp: existingSnapshot.timestamp,
        snapshot: existingSnapshot,
        compatibleHistoricalSnapshots,
      }),
    };
  }

  const providers = [
    options.searchProvider,
    ...(options.nonSearchProviders ?? DAILY_LIVE_SNAPSHOT_MOCK_FALLBACK_PROVIDERS),
  ];
  let snapshot = await buildProductTrendSnapshotAsync(options.productId, providers, {
    timestamp,
    sourceMode: "live",
  });
  const liveSignalCount = snapshot.rawSignals.filter((signal) =>
    signal.metadata?.provider === LIVE_SEARCH_PROVIDER_ID
  ).length;

  if (liveSignalCount === 0) {
    return {
      status: "failed_no_live_data",
      snapshot,
      message: "No DataForSEO-backed search signals were available; live snapshot was not saved.",
      summary: summarizeSnapshot({
        productId: options.productId,
        timestamp,
        snapshot,
        compatibleHistoricalSnapshots: liveHistoricalSnapshotsForVersion(
          options.store.listHistorical(options.productId, { sourceMode: "live" }),
          snapshot.trendIQScore.scoreVersion
        ),
      }),
    };
  }

  const historyWithCurrent = [
    ...liveHistoricalSnapshotsForVersion(
      options.store.listHistorical(options.productId, { sourceMode: "live" }),
      snapshot.trendIQScore.scoreVersion
    ),
    toHistoricalTrendSnapshot(snapshot),
  ];
  const momentum = calculateCompatibleHistoricalMomentum({
    snapshots: historyWithCurrent,
    sourceMode: "live",
    scoreVersion: snapshot.trendIQScore.scoreVersion,
  });

  if (momentum.isReady && momentum.trendStatus) {
    snapshot = {
      ...snapshot,
      trendStatus: momentum.trendStatus,
    };
    snapshot = {
      ...snapshot,
      liveDataAudit: buildTrendIQSnapshotProvenanceSummary({
        sourceMode: snapshot.sourceMode,
        rawSignals: snapshot.rawSignals,
        trendIQScore: snapshot.trendIQScore,
        confidence: snapshot.confidence,
        trendStatus: snapshot.trendStatus,
      }),
    };
  }

  options.store.save(snapshot);

  return {
    status: "created",
    snapshot,
    message: "Created one live daily TrendIQ snapshot.",
    summary: summarizeSnapshot({
      productId: options.productId,
      timestamp,
      snapshot,
      compatibleHistoricalSnapshots: historyWithCurrent,
    }),
  };
}
