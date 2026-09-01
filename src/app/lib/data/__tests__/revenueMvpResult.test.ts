import { describe, expect, it } from "vitest";
import { calculateConfidenceScore } from "../../scoring/confidenceEngine";
import { calculateTrendMomentum } from "../../scoring/momentumEngine";
import { calculateTrendIQScore } from "../../scoring/scoreEngine";
import { buildMockHistoricalSnapshots } from "../history";
import { buildTrendIQSnapshotProvenanceSummary } from "../liveDataAudit";
import { DATA_LAYER_TIMESTAMP, RAY_BAN_META_PRODUCT_ID, RAY_BAN_META_SIGNAL_INPUTS } from "../mockProviderSignals";
import { mockTrendSignalProviders } from "../providers";
import { buildRevenueMvpResult } from "../revenueMvpResult";
import { buildSearchMomentumV1 } from "../searchMomentum";
import { aggregateSignals } from "../signalAggregator";
import { buildProductTrendSnapshot } from "../snapshotEngine";
import type {
  NormalizedTrendSignal,
  ProductTrendSnapshot,
  SignalSourceProvenanceMode,
  TrendIQDataSource,
  TrendIQSignalType,
} from "../types";

const TIMESTAMP = "2026-09-01T12:00:00.000Z";
const PRODUCT_IDS = {
  wearable: "fixture-garmin-venu-4",
  phone: "fixture-samsung-galaxy-ring",
  kitchen: "fixture-ninja-creami-swirl",
  generic: "fixture-acme-flux-pro-7",
} as const;

function signal(input: {
  productId: string;
  source: TrendIQDataSource;
  signalType: TrendIQSignalType;
  mode: SignalSourceProvenanceMode;
  provider: string;
  providerMetric: string;
  engineField?: string;
  engineValue?: number;
  value?: number;
  normalizedValue?: number;
  previousValue?: number;
  percentChange?: number;
  sampleSize?: number;
  confidence?: number;
  metadata?: NormalizedTrendSignal["metadata"];
}): NormalizedTrendSignal {
  const value = input.value ?? input.engineValue ?? 50;

  return {
    source: input.source,
    signalType: input.signalType,
    productId: input.productId,
    sourceProvenance: {
      mode: input.mode,
      provider: input.provider,
      providerMetric: input.providerMetric,
      liveApiRequestMade: input.mode === "live" || input.mode === "derived-live",
    },
    value,
    normalizedValue: input.normalizedValue ?? 50,
    previousValue: input.previousValue,
    percentChange: input.percentChange,
    sampleSize: input.sampleSize,
    timestamp: TIMESTAMP,
    confidence: input.confidence ?? 88,
    metadata: {
      provider: input.provider,
      providerMetric: input.providerMetric,
      ...(input.engineField ? { engineField: input.engineField } : {}),
      ...(typeof input.engineValue === "number" ? { engineValue: input.engineValue } : {}),
      ...input.metadata,
    },
  };
}

function snapshotFor(
  productId: string,
  rawSignals: NormalizedTrendSignal[],
  sourceMode: ProductTrendSnapshot["sourceMode"] = "live"
): ProductTrendSnapshot {
  const aggregation = aggregateSignals(productId, rawSignals, TIMESTAMP);
  const trendIQScore = calculateTrendIQScore(aggregation.aggregatedSignals);
  const confidence = calculateConfidenceScore(aggregation.confidenceSignals);
  const trendStatus = calculateTrendMomentum({
    changePercent: aggregation.aggregatedSignals.growthVelocity.trendChangePercent,
    current7dRelativeInterest: aggregation.aggregatedSignals.searchMomentum.current7dRelativeInterest,
    previous7dRelativeInterest: aggregation.aggregatedSignals.searchMomentum.previous7dRelativeInterest,
    hasSearchGrowthContext: aggregation.aggregatedSignals.growthVelocity.hasSearchDerivedVelocity,
    hasLowBaseSearchGrowth: aggregation.aggregatedSignals.searchMomentum.hasLowBaseSearchGrowth,
  });
  const liveDataAudit = buildTrendIQSnapshotProvenanceSummary({
    sourceMode,
    rawSignals: aggregation.rawSignals,
    trendIQScore,
    confidence,
    trendStatus,
  });
  const searchMomentumV1 = buildSearchMomentumV1({
    aggregatedSignals: aggregation.aggregatedSignals,
    rawSignals: aggregation.rawSignals,
  });

  return {
    productId,
    timestamp: TIMESTAMP,
    sourceMode,
    rawSignals: aggregation.rawSignals,
    aggregatedSignals: aggregation.aggregatedSignals,
    trendIQScore,
    confidence,
    trendStatus,
    provenance: aggregation.provenance,
    liveDataAudit,
    searchMomentumV1,
  };
}

function liveSearchSignals(productId = PRODUCT_IDS.wearable, query = "Garmin Venu 4"): NormalizedTrendSignal[] {
  return [
    signal({
      productId,
      source: "searchWeb",
      signalType: "searchMomentum",
      mode: "live",
      provider: "dataforseo_google_ads",
      providerMetric: "monthlySearchVolume",
      value: 45000,
      sampleSize: 45000,
      metadata: {
        monthlySearchVolume: 45000,
        aliasesUsed: query,
        sourceCost: 0.09,
      },
    }),
    signal({
      productId,
      source: "searchWeb",
      signalType: "searchMomentum",
      mode: "derived-live",
      provider: "dataforseo_google_ads",
      providerMetric: "estimated7dSearchVolumeFromMonthlySearchVolume",
      engineField: "searchVolume7d",
      engineValue: 10349,
      value: 10349,
      sampleSize: 45000,
      metadata: {
        providerMonthlySearchVolume: 45000,
        derived7dSearchVolume: 10349,
        aliasesUsed: query,
        sourceCost: 0.09,
      },
    }),
    signal({
      productId,
      source: "searchWeb",
      signalType: "searchMomentum",
      mode: "live",
      provider: "dataforseo_trends",
      providerMetric: "current7dRelativeSearchInterest",
      engineField: "current7dRelativeInterest",
      engineValue: 60,
      value: 60,
      previousValue: 30,
      sampleSize: 28,
      metadata: {
        current7dRelativeInterest: 60,
        previous7dRelativeInterest: 30,
        searchGrowthBaselineReadiness: 1,
        lowBaseSearchGrowth: false,
        evidenceQuality: "observed",
        change7dEvidenceQuality: "observed",
        aliasesUsed: query,
      },
    }),
    signal({
      productId,
      source: "searchWeb",
      signalType: "searchMomentum",
      mode: "derived-live",
      provider: "dataforseo_trends",
      providerMetric: "searchInterestGrowth7d",
      engineField: "searchGrowthPercent",
      engineValue: 100,
      value: 100,
      previousValue: 30,
      percentChange: 100,
      sampleSize: 28,
      metadata: {
        current7dRelativeInterest: 60,
        previous7dRelativeInterest: 30,
        searchGrowthBaselineReadiness: 1,
        lowBaseSearchGrowth: false,
        evidenceQuality: "observed",
        change7dEvidenceQuality: "observed",
        aliasesUsed: query,
      },
    }),
    signal({
      productId,
      source: "searchWeb",
      signalType: "searchMomentum",
      mode: "live",
      provider: "dataforseo_google_ads",
      providerMetric: "categoryQueryShare",
      engineField: "queryShareOfCategoryPercent",
      engineValue: 12,
      value: 12,
      sampleSize: 45000,
    }),
    signal({
      productId,
      source: "searchWeb",
      signalType: "growthVelocity",
      mode: "derived-live",
      provider: "dataforseo_trends",
      providerMetric: "searchInterestTrendChange7d",
      engineField: "trendChangePercent",
      engineValue: 100,
      value: 100,
      previousValue: 30,
      percentChange: 100,
      sampleSize: 28,
      metadata: {
        searchDerived: true,
        current7dRelativeInterest: 60,
        previous7dRelativeInterest: 30,
        searchGrowthBaselineReadiness: 1,
        lowBaseSearchGrowth: false,
        change7dEvidenceQuality: "observed",
        aliasesUsed: query,
      },
    }),
    signal({
      productId,
      source: "searchWeb",
      signalType: "growthVelocity",
      mode: "derived-live",
      provider: "dataforseo_trends",
      providerMetric: "searchInterestAcceleration",
      engineField: "accelerationPercent",
      engineValue: 12,
      value: 12,
      sampleSize: 28,
      metadata: {
        searchDerived: true,
        accelerationEvidenceQuality: "observed",
        aliasesUsed: query,
      },
    }),
    signal({
      productId,
      source: "searchWeb",
      signalType: "growthVelocity",
      mode: "derived-live",
      provider: "dataforseo_trends",
      providerMetric: "searchInterestConsecutiveGrowthDays",
      engineField: "consecutiveGrowthDays",
      engineValue: 5,
      value: 5,
      sampleSize: 7,
      metadata: {
        searchDerived: true,
        aliasesUsed: query,
      },
    }),
  ];
}

function reviewSignals(input: {
  productId?: string;
  includeText?: boolean;
  textStatus?: "derived-live" | "insufficient" | "provisional";
} = {}): NormalizedTrendSignal[] {
  const productId = input.productId ?? PRODUCT_IDS.wearable;
  const textStatus = input.textStatus ?? "derived-live";

  return [
    signal({
      productId,
      source: "reviews",
      signalType: "reviewQuality",
      mode: "live",
      provider: "dataforseo_google_shopping",
      providerMetric: "aggregateAverageRating",
      engineField: "averageRating",
      engineValue: 4.6,
      value: 4.6,
      sampleSize: 1240,
      metadata: {
        providerRatingMax: 5,
        ratingEvidenceCount: 1240,
        ratingEvidenceSourceField: "product_rating.votes_count",
        ratingEvidenceComposition: "rating_votes_only",
        providerGid: "provider-gid-must-not-leak",
        providerProductId: "provider-product-id-must-not-leak",
        providerDataDocid: "provider-data-docid-must-not-leak",
      },
    }),
    signal({
      productId,
      source: "reviews",
      signalType: "reviewQuality",
      mode: "live",
      provider: "dataforseo_google_shopping",
      providerMetric: "ratingEvidenceCount",
      engineField: "ratingEvidenceCount",
      engineValue: 1240,
      value: 1240,
      sampleSize: 1240,
    }),
    signal({
      productId,
      source: "reviews",
      signalType: "reviewQuality",
      mode: "derived-live",
      provider: "dataforseo_google_shopping_reviews",
      providerMetric: "ratingConsensusQuality",
      engineField: "ratingConsensusQuality",
      engineValue: 82.4,
      value: 82.4,
      sampleSize: 1240,
      metadata: {
        validationStatus: "reviews_validated",
        reviewRetrievalStatus: "reviews_validated",
        textEvidenceStatus: textStatus,
        ratingConsensusQualityStatus: "derived-live",
        ratingConsensusQualityObservationCount: 1240,
        ratingConsensusDistributionSource: "provider_rating_groups",
        ratingConsensusDistributionScope: "full_provider_distribution",
        ratingConsensusDistributionComposition: "provider_rating_group_counts",
        ratingConsensusMean: 4.55,
        ratingConsensusStandardDeviation: 0.74,
        ratingConsensusVariance: 0.55,
        ratingConsensusQualityGate: 91,
        ratingConsensusShapeSupport: 86,
        ratingConsensusLowTailPenalty: 1.2,
        ratingConsensusAggregateAverageRating: 4.6,
        ratingConsensusAggregateRatingDelta: 0.05,
        ratingConsensusAggregateRatingMismatchThreshold: 0.75,
        ratingConsensusQualityCalculationMethod: "distribution_adjusted_rating_consensus_quality_v1",
        recentReviewsProviderGid: "recent-provider-gid-must-not-leak",
        taskId: "task-id-must-not-leak",
      },
    }),
    ...(input.includeText === false
      ? []
      : [
          signal({
            productId,
            source: "reviews",
            signalType: "reviewQuality",
            mode: "derived-live",
            provider: "dataforseo_google_shopping_reviews",
            providerMetric: "recentAverageRating90d",
            engineField: "recentAverageRating",
            engineValue: 4.48,
            value: 4.48,
            sampleSize: 42,
            metadata: {
              validationStatus: "reviews_validated",
              reviewRetrievalStatus: "reviews_validated",
              textEvidenceStatus: textStatus,
              recentAverageRatingStatus: textStatus,
              textSampleScope: "trailing_window_dated_reviews",
              totalReviewsFetched: 50,
              qualifyingRecentReviewCount: 42,
              recentReviewSourceDomains: "retailer.test, example.com",
              recentAverageRatingWindowStart: "2026-06-03T12:00:00.000Z",
              recentAverageRatingWindowEnd: TIMESTAMP,
              recentAverageRatingWindowDays: 90,
              recentAverageRatingCalculationMethod: "mean_rating_of_dated_reviews_in_trailing_90_days",
              recentAverageRatingDatePrecision: "provider_observed_approximate_relative_timestamp",
              rawReviewText: "raw detailed review body must not leak",
              taskId: "detailed-task-id-must-not-leak",
            },
          }),
        ]),
  ];
}

function mockSignals(productId = PRODUCT_IDS.wearable): NormalizedTrendSignal[] {
  return [
    signal({
      productId,
      source: "social",
      signalType: "socialMomentum",
      mode: "mock",
      provider: "mock_social",
      providerMetric: "weeklySocialMentions",
      engineField: "mentions7d",
      engineValue: 42000,
      value: 42000,
      sampleSize: 42000,
    }),
    signal({
      productId,
      source: "merchant",
      signalType: "purchaseIntent",
      mode: "mock",
      provider: "mock_merchant",
      providerMetric: "merchantSaveRate",
      engineField: "saveRatePercent",
      engineValue: 14,
      value: 14,
      sampleSize: 4100,
    }),
  ];
}

function staticProduct(productId = PRODUCT_IDS.wearable) {
  return {
    productId,
    title: "Garmin Venu 4",
    brand: "Garmin",
    category: "Wearables",
    query: "Garmin Venu 4",
    trendiqSays: "STATIC TRENDIQ TAKE MUST NOT LEAK",
    tiktokSays: "STATIC TIKTOK COPY MUST NOT LEAK",
    redditSentiment: "STATIC REDDIT COPY MUST NOT LEAK",
    pros: ["STATIC PRO MUST NOT LEAK"],
    cons: ["STATIC CON MUST NOT LEAK"],
    bestFor: ["STATIC BEST FOR MUST NOT LEAK"],
    watchOut: ["STATIC WATCH OUT MUST NOT LEAK"],
    commerce: {
      merchants: [
        {
          merchantName: "TrendIQ demo merchant",
          productUrl: "https://example.com/products/demo",
          price: 299,
          currency: "USD",
        },
      ],
    },
  };
}

function serialized(value: unknown): string {
  return JSON.stringify(value);
}

function expectNoUnsafePublicOutput(value: unknown) {
  const text = serialized(value);

  for (const forbidden of [
    "provider-gid-must-not-leak",
    "provider-product-id-must-not-leak",
    "provider-data-docid-must-not-leak",
    "recent-provider-gid-must-not-leak",
    "task-id-must-not-leak",
    "detailed-task-id-must-not-leak",
    "providerGid",
    "providerProductId",
    "providerDataDocid",
    "recentReviewsProviderGid",
    "taskId",
    "gid",
    "dataDocid",
    "Authorization",
    "raw detailed review body must not leak",
    "rawReviewText",
    "retailer.test",
    "example.com",
  ]) {
    expect(text).not.toContain(forbidden);
  }
}

function expectOnlyFinitePublicNumbers(value: unknown) {
  function walk(current: unknown) {
    if (typeof current === "number") {
      expect(Number.isFinite(current)).toBe(true);
      return;
    }

    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }

    if (current && typeof current === "object") {
      Object.values(current).forEach(walk);
    }
  }

  walk(value);
}

describe("Revenue MVP result boundary", () => {
  it("exposes fully trustworthy search evidence from live SearchMomentumV1", () => {
    const snapshot = snapshotFor(PRODUCT_IDS.wearable, liveSearchSignals());
    const result = buildRevenueMvpResult({ snapshot, product: staticProduct() });

    expect(result.search.state).toBe("verified");
    expect(result.search.searchMomentum.state).toBe("verified");
    expect(result.search.absoluteDemand.state).toBe("verified");
    expect(result.search.directionalDemand.state).toBe("verified");
    expect(result.search.provenance).toEqual({
      measurementScope: "exact",
      query: "Garmin Venu 4",
      sources: [
        "absoluteDemand:dataforseo_google_ads",
        "directionalDemand:dataforseo_trends",
      ],
    });
  });

  it("degrades mixed live and fallback search evidence even when SearchMomentumV1 reports live provenance", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, [
        ...liveSearchSignals(),
        signal({
          productId: PRODUCT_IDS.wearable,
          source: "searchWeb",
          signalType: "searchMomentum",
          mode: "fallback",
          provider: "dataforseo_trends",
          providerMetric: "searchInterestGrowth7d",
          engineField: "searchGrowthPercent",
          engineValue: 900,
          value: 900,
        }),
      ]),
      product: staticProduct(),
    });

    expect(result.search.directionalDemand.state).toBe("degraded");
    expect(result.search.directionalDemand.reasons).toContain(
      "directional_search_demand_includes_mock_or_fallback_input"
    );
    expect(result.search.searchMomentum.state).toBe("degraded");
  });

  it("does not verify legacy Momentum when its trend-change input is fallback-contaminated", () => {
    const baseSnapshot = snapshotFor(PRODUCT_IDS.wearable, liveSearchSignals());
    const fallbackTrendChange = signal({
      productId: PRODUCT_IDS.wearable,
      source: "mockHistorical",
      signalType: "growthVelocity",
      mode: "fallback",
      provider: "mock_history",
      providerMetric: "historicalTrendChange",
      engineField: "trendChangePercent",
      engineValue: 900,
      value: 900,
    });
    const rawSignals = [...baseSnapshot.rawSignals, fallbackTrendChange];
    const snapshot: ProductTrendSnapshot = {
      ...baseSnapshot,
      rawSignals,
      liveDataAudit: buildTrendIQSnapshotProvenanceSummary({
        sourceMode: baseSnapshot.sourceMode,
        rawSignals,
        trendIQScore: baseSnapshot.trendIQScore,
        confidence: baseSnapshot.confidence,
        trendStatus: baseSnapshot.trendStatus,
      }),
    };
    const result = buildRevenueMvpResult({
      snapshot,
      product: staticProduct(),
    });

    expect(result.search.directionalDemand.state).toBe("verified");
    expect(result.search.legacyMomentum.state).toBe("degraded");
    expect(result.search.legacyMomentum.reasons).toContain(
      "legacy_momentum_includes_mock_or_fallback_trend_change"
    );
  });

  it("exposes validated review distribution separately from aggregate rating", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, reviewSignals()),
      product: staticProduct(),
    });

    expect(result.reviews.aggregateRating.state).toBe("verified");
    expect(result.reviews.aggregateRating.value).toMatchObject({
      averageRating: 4.6,
      ratingEvidenceCount: 1240,
    });
    expect(result.reviews.ratingConsensus.state).toBe("verified");
    expect(result.reviews.ratingConsensus.value).toMatchObject({
      ratingConsensusQuality: 82.4,
      distributionSource: "provider_rating_groups",
      distributionScope: "full_provider_distribution",
    });
  });

  it("keeps validated review distribution when text evidence is insufficient", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.phone, reviewSignals({
        productId: PRODUCT_IDS.phone,
        includeText: false,
        textStatus: "insufficient",
      })),
      product: {
        productId: PRODUCT_IDS.phone,
        title: "Samsung Galaxy Ring",
        category: "Wearables",
      },
    });

    expect(result.reviews.ratingConsensus.state).toBe("verified");
    expect(result.reviews.textEvidence.state).toBe("unavailable");
    expect(result.reviews.textEvidence.reasons).toContain("review_text_evidence_insufficient");
  });

  it("exposes usable validated recent review evidence only when text qualification passes", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.kitchen, reviewSignals({ productId: PRODUCT_IDS.kitchen })),
      product: {
        productId: PRODUCT_IDS.kitchen,
        title: "Ninja Creami Swirl",
        category: "Kitchen",
      },
    });

    expect(result.reviews.recentRating.state).toBe("verified");
    expect(result.reviews.recentRating.value).toMatchObject({
      recentAverageRating: 4.48,
      qualifyingReviewCount: 42,
      windowDays: 90,
    });
    expect(result.reviews.textEvidence.state).toBe("verified");
  });

  it("fails detailed review evidence closed when identity-validation metadata is absent", () => {
    const unqualifiedSignals = reviewSignals().map((reviewSignal) => {
      if (
        reviewSignal.metadata?.engineField !== "ratingConsensusQuality" &&
        reviewSignal.metadata?.engineField !== "recentAverageRating"
      ) {
        return reviewSignal;
      }

      const {
        validationStatus: _validationStatus,
        reviewRetrievalStatus: _reviewRetrievalStatus,
        ratingConsensusQualityStatus: _ratingConsensusQualityStatus,
        recentAverageRatingStatus: _recentAverageRatingStatus,
        ...metadata
      } = reviewSignal.metadata;

      return { ...reviewSignal, metadata };
    });
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, unqualifiedSignals),
      product: staticProduct(),
    });

    expect(result.reviews.aggregateRating.state).toBe("verified");
    expect(result.reviews.ratingConsensus.state).toBe("unavailable");
    expect(result.reviews.recentRating.state).toBe("unavailable");
    expect(result.reviews.textEvidence.state).toBe("unavailable");
  });

  it("keeps valid search evidence when review evidence is missing", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, liveSearchSignals()),
      product: staticProduct(),
    });

    expect(result.search.state).toBe("verified");
    expect(result.reviews.state).toBe("unavailable");
    expect(result.status).toBe("partial");
  });

  it("keeps valid review evidence when search evidence is missing", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, reviewSignals()),
      product: staticProduct(),
    });

    expect(result.reviews.state).toBe("verified");
    expect(result.search.state).toBe("unavailable");
    expect(result.status).toBe("partial");
  });

  it("does not expose mock-only results as verified external intelligence", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.generic, mockSignals(PRODUCT_IDS.generic), "mock"),
      product: {
        ...staticProduct(PRODUCT_IDS.generic),
        title: "Acme Flux Pro 7",
        brand: "Acme",
      },
    });

    expect(result.status).toBe("unavailable");
    expect(result.score.state).toBe("unavailable");
    expect(result.confidence.state).toBe("unavailable");
    expect(result.trust.mockFallbackSignalCountExcluded).toBeGreaterThan(0);
  });

  it("marks live plus mock mixed results as externally degraded rather than verified", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, [
        ...liveSearchSignals(),
        ...mockSignals(),
      ]),
      product: staticProduct(),
    });

    expect(result.search.state).toBe("verified");
    expect(result.score.state).toBe("degraded");
    expect(result.score.reasons).toContain("score_includes_mock_or_fallback_prone_dimensions");
    expect(result.trust.mockFallbackSignalCountExcluded).toBeGreaterThan(0);
  });

  it("prevents mock review fallback from becoming verified review evidence", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, [
        signal({
          productId: PRODUCT_IDS.wearable,
          source: "reviews",
          signalType: "reviewQuality",
          mode: "fallback",
          provider: "mock_reviews",
          providerMetric: "aggregateAverageRating",
          engineField: "averageRating",
          engineValue: 4.9,
          value: 4.9,
        }),
      ]),
      product: staticProduct(),
    });

    expect(result.reviews.aggregateRating.state).toBe("unavailable");
    expect(result.reviews.state).toBe("unavailable");
  });

  it("keeps unsupported social unavailable even when a signal is present", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, [
        ...liveSearchSignals(),
        signal({
          productId: PRODUCT_IDS.wearable,
          source: "social",
          signalType: "socialMomentum",
          mode: "live",
          provider: "unapproved_social_fixture",
          providerMetric: "mentions7d",
          engineField: "mentions7d",
          engineValue: 1000,
          value: 1000,
        }),
      ]),
      product: staticProduct(),
    });

    expect(result.unsupportedEvidence.social.state).toBe("unavailable");
    expect(result.score.unsupportedScoreComponents).toContain("socialMomentum");
  });

  it("keeps unsupported sentiment unavailable", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, [
        signal({
          productId: PRODUCT_IDS.wearable,
          source: "reddit",
          signalType: "sentiment",
          mode: "mock",
          provider: "mock_reddit_pending_approval",
          providerMetric: "positiveDiscussionShare",
          engineField: "positiveMentionPercent",
          engineValue: 80,
          value: 80,
        }),
      ], "mock"),
      product: staticProduct(),
    });

    expect(result.unsupportedEvidence.sentiment.state).toBe("unavailable");
  });

  it("keeps unsupported purchase intent unavailable", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, mockSignals()),
      product: staticProduct(),
    });

    expect(result.unsupportedEvidence.purchaseIntent.state).toBe("unavailable");
  });

  it("keeps unsupported hype sustainability unavailable", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, [
        signal({
          productId: PRODUCT_IDS.wearable,
          source: "social",
          signalType: "hypeSustainability",
          mode: "mock",
          provider: "mock_social",
          providerMetric: "repeatMentionRate",
          engineField: "repeatMentionRatePercent",
          engineValue: 60,
          value: 60,
        }),
      ], "mock"),
      product: staticProduct(),
    });

    expect(result.unsupportedEvidence.hypeSustainability.state).toBe("unavailable");
  });

  it("does not let static TikTok or Reddit copy become verified evidence", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, liveSearchSignals()),
      product: staticProduct(),
    });

    expect(result.staticCopy.tiktokRedditCopy.state).toBe("unavailable");
    expect(serialized(result)).not.toContain("STATIC TIKTOK COPY MUST NOT LEAK");
    expect(serialized(result)).not.toContain("STATIC REDDIT COPY MUST NOT LEAK");
  });

  it("does not let static TrendIQ Take cross the evidence boundary", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, liveSearchSignals()),
      product: staticProduct(),
    });

    expect(result.staticCopy.trendIqTake.state).toBe("unavailable");
    expect(serialized(result)).not.toContain("STATIC TRENDIQ TAKE MUST NOT LEAK");
  });

  it("does not let static pros and cons cross the evidence boundary", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, liveSearchSignals()),
      product: staticProduct(),
    });

    expect(result.staticCopy.prosCons.state).toBe("unavailable");
    expect(serialized(result)).not.toContain("STATIC PRO MUST NOT LEAK");
    expect(serialized(result)).not.toContain("STATIC CON MUST NOT LEAK");
  });

  it("does not expose example/demo commerce as verified price intelligence", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, liveSearchSignals()),
      product: staticProduct(),
    });

    expect(result.commerce.price.state).toBe("unavailable");
    expect(result.commerce.commerce.state).toBe("unavailable");
    expect(result.trust.commerceEvidenceExcluded).toBe(true);
    expect(serialized(result)).not.toContain("https://example.com/products/demo");
    expect(serialized(result)).not.toContain("TrendIQ demo merchant");
  });

  it("does not label a Score with fallback-prone dimensions as verified", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, [
        ...liveSearchSignals(),
        ...reviewSignals({ includeText: false }),
        ...mockSignals(),
      ]),
      product: staticProduct(),
    });

    expect(result.score.state).toBe("degraded");
    expect(result.score.value?.score).toEqual(expect.any(Number));
    expect(result.score.reasons).toContain("score_includes_mock_or_fallback_prone_dimensions");
  });

  it("keeps Confidence semantics truthful instead of presenting correctness probability", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, liveSearchSignals()),
      product: staticProduct(),
    });

    expect(result.confidence.state).toBe("degraded");
    expect(result.confidence.value?.meaning).toBe("evidence_quality_not_correctness_probability");
    expect(result.confidence.reasons).toContain("confidence_inputs_do_not_cover_all_score_dimensions");
  });

  it("preserves SearchMomentumV1 provenance in the public search result", () => {
    const snapshot = snapshotFor(PRODUCT_IDS.wearable, liveSearchSignals());
    const result = buildRevenueMvpResult({ snapshot, product: staticProduct() });

    expect(result.search.searchMomentum.value).toMatchObject({
      direction: snapshot.searchMomentumV1?.direction,
      strength: snapshot.searchMomentumV1?.strength,
      confidence: snapshot.searchMomentumV1?.confidence,
      evidenceQuality: snapshot.searchMomentumV1?.evidenceQuality,
    });
    expect(result.search.provenance.sources).toEqual(snapshot.searchMomentumV1?.provenance.sources);
  });

  it("redacts review provider identifiers from the public boundary", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, reviewSignals()),
      product: staticProduct(),
    });

    expect(result.reviews.providerIdsRedacted).toBe(true);
    expectNoUnsafePublicOutput(result);
  });

  it("redacts detailed task identifiers from the public boundary", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, reviewSignals()),
      product: staticProduct(),
    });

    expect(result.trust.providerIdentifiersRedacted).toBe(true);
    expectNoUnsafePublicOutput(result);
  });

  it("does not expose raw review text", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, reviewSignals()),
      product: staticProduct(),
    });

    expect(result.reviews.rawReviewBodiesExposed).toBe(false);
    expect(result.trust.rawReviewBodiesExposed).toBe(false);
    expectNoUnsafePublicOutput(result);
  });

  it("does not expose detailed-review source domains or seller identity", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, reviewSignals()),
      product: staticProduct(),
    });

    expectNoUnsafePublicOutput(result);
  });

  it("fails closed for malformed runtime input", () => {
    const result = buildRevenueMvpResult({
      snapshot: {
        productId: PRODUCT_IDS.wearable,
        rawSignals: "not-an-array",
      } as unknown,
      product: staticProduct(),
    });

    expect(result.status).toBe("malformed_input");
    expect(result.score.state).toBe("unavailable");
    expect(result.search.state).toBe("unavailable");
    expect(result.reviews.state).toBe("unavailable");
  });

  it("fails closed for malformed nested signal input", () => {
    const snapshot = snapshotFor(PRODUCT_IDS.wearable, liveSearchSignals());
    const result = buildRevenueMvpResult({
      snapshot: {
        ...snapshot,
        rawSignals: [null],
      } as unknown,
      product: staticProduct(),
    });

    expect(result.status).toBe("malformed_input");
    expect(result.score.totalActiveScoringWeight).toBeNull();
    expect(result.score.unsupportedScoreComponents).toEqual([]);
  });

  it("fails closed instead of throwing for malformed optional snapshot sections", () => {
    const snapshot = snapshotFor(PRODUCT_IDS.wearable, liveSearchSignals());
    const result = buildRevenueMvpResult({
      snapshot: {
        ...snapshot,
        searchMomentumV1: { confidence: 88 },
      } as unknown,
      product: staticProduct(),
    });

    expect(result.status).toBe("malformed_input");
    expect(result.product.productId).toBe(PRODUCT_IDS.wearable);
    expect(result.search.state).toBe("unavailable");
  });

  it("keeps partial degraded results usable field by field", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, [
        ...liveSearchSignals(),
        ...reviewSignals({ includeText: false, textStatus: "insufficient" }),
      ]),
      product: staticProduct(),
    });

    expect(result.status).toBe("partial");
    expect(result.search.state).toBe("verified");
    expect(result.reviews.ratingConsensus.state).toBe("verified");
    expect(result.reviews.textEvidence.state).toBe("unavailable");
    expect(result.score.state).toBe("degraded");
  });

  it("does not let product A evidence authorize product B", () => {
    const snapshot = snapshotFor(PRODUCT_IDS.wearable, liveSearchSignals(PRODUCT_IDS.wearable));
    const result = buildRevenueMvpResult({
      snapshot,
      product: {
        productId: PRODUCT_IDS.phone,
        title: "Samsung Galaxy Ring",
      },
    });

    expect(result.status).toBe("invalid_product_binding");
    expect(result.search.state).toBe("unavailable");
    expect(result.reviews.state).toBe("unavailable");
  });

  it("filters raw signals by exact snapshot product id", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.phone, [
        ...liveSearchSignals(PRODUCT_IDS.wearable),
        ...reviewSignals({ productId: PRODUCT_IDS.phone }),
      ]),
      product: {
        productId: PRODUCT_IDS.phone,
        title: "Samsung Galaxy Ring",
      },
    });

    expect(result.search.state).toBe("unavailable");
    expect(result.reviews.state).toBe("verified");
  });

  it("keeps exposure classification independent of input ordering", () => {
    const signals = [
      ...liveSearchSignals(PRODUCT_IDS.kitchen, "Ninja Creami Swirl"),
      ...reviewSignals({ productId: PRODUCT_IDS.kitchen }),
    ];
    const first = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.kitchen, signals),
      product: {
        productId: PRODUCT_IDS.kitchen,
        title: "Ninja Creami Swirl",
      },
    });
    const second = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.kitchen, [...signals].reverse()),
      product: {
        productId: PRODUCT_IDS.kitchen,
        title: "Ninja Creami Swirl",
      },
    });

    expect(second.search).toEqual(first.search);
    expect(second.reviews).toEqual(first.reviews);
    expect(second.trust.verifiedDimensions).toEqual(first.trust.verifiedDimensions);
  });

  it("returns deterministic output for identical input", () => {
    const snapshot = snapshotFor(PRODUCT_IDS.generic, [
      ...liveSearchSignals(PRODUCT_IDS.generic, "Acme Flux Pro 7"),
      ...reviewSignals({ productId: PRODUCT_IDS.generic }),
    ]);
    const product = {
      productId: PRODUCT_IDS.generic,
      title: "Acme Flux Pro 7",
      brand: "Acme",
    };

    expect(buildRevenueMvpResult({ snapshot, product })).toEqual(buildRevenueMvpResult({ snapshot, product }));
  });

  it("uses only supported live-backed signals for the trust-summary freshness timestamp", () => {
    const liveSignals = liveSearchSignals().map((liveSignal) => ({
      ...liveSignal,
      timestamp: "2026-08-30T12:00:00.000Z",
    }));
    const newerMockSignals = mockSignals().map((mockSignal) => ({
      ...mockSignal,
      timestamp: "2026-09-02T12:00:00.000Z",
    }));
    const unsupportedLiveSocialSignal = signal({
      productId: PRODUCT_IDS.wearable,
      source: "social",
      signalType: "socialMomentum",
      mode: "live",
      provider: "unsupported_social_fixture",
      providerMetric: "weeklySocialMentions",
      engineField: "mentions7d",
      engineValue: 50000,
      value: 50000,
    });
    unsupportedLiveSocialSignal.timestamp = "2026-09-03T12:00:00.000Z";
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, [
        ...liveSignals,
        ...newerMockSignals,
        unsupportedLiveSocialSignal,
      ]),
      product: staticProduct(),
    });

    expect(result.trust.freshestSignalAt).toBe("2026-08-30T12:00:00.000Z");
  });

  it("does not emit NaN or Infinity in public numeric fields", () => {
    const result = buildRevenueMvpResult({
      snapshot: snapshotFor(PRODUCT_IDS.wearable, [
        ...liveSearchSignals(),
        signal({
          productId: PRODUCT_IDS.wearable,
          source: "reviews",
          signalType: "reviewQuality",
          mode: "live",
          provider: "dataforseo_google_shopping",
          providerMetric: "aggregateAverageRating",
          engineField: "averageRating",
          engineValue: Number.NaN,
          value: Number.POSITIVE_INFINITY,
        }),
      ]),
      product: staticProduct(),
    });

    expectOnlyFinitePublicNumbers(result);
  });

  it("keeps legacy Score calculation unchanged", () => {
    const snapshot = snapshotFor(PRODUCT_IDS.wearable, [
      ...liveSearchSignals(),
      ...reviewSignals(),
    ]);
    const before = calculateTrendIQScore(snapshot.aggregatedSignals);

    buildRevenueMvpResult({ snapshot, product: staticProduct() });

    expect(snapshot.trendIQScore).toEqual(before);
    expect(calculateTrendIQScore(RAY_BAN_META_SIGNAL_INPUTS).score).toBe(71);
  });

  it("keeps legacy Confidence calculation unchanged", () => {
    const snapshot = snapshotFor(PRODUCT_IDS.wearable, [
      ...liveSearchSignals(),
      ...reviewSignals(),
    ]);
    const before = calculateConfidenceScore(snapshot.aggregatedSignals.confidence);

    buildRevenueMvpResult({ snapshot, product: staticProduct() });

    expect(snapshot.confidence).toEqual(before);
    expect(calculateConfidenceScore(RAY_BAN_META_SIGNAL_INPUTS.confidence).score).toBe(97);
  });

  it("keeps legacy Momentum calculation unchanged", () => {
    const snapshot = snapshotFor(PRODUCT_IDS.wearable, liveSearchSignals());
    const before = calculateTrendMomentum({
      changePercent: snapshot.aggregatedSignals.growthVelocity.trendChangePercent,
      current7dRelativeInterest: snapshot.aggregatedSignals.searchMomentum.current7dRelativeInterest,
      previous7dRelativeInterest: snapshot.aggregatedSignals.searchMomentum.previous7dRelativeInterest,
      hasSearchGrowthContext: snapshot.aggregatedSignals.growthVelocity.hasSearchDerivedVelocity,
      hasLowBaseSearchGrowth: snapshot.aggregatedSignals.searchMomentum.hasLowBaseSearchGrowth,
    });

    buildRevenueMvpResult({ snapshot, product: staticProduct() });

    expect(snapshot.trendStatus).toEqual(before);
  });

  it("keeps existing snapshot behavior unchanged", () => {
    const before = buildProductTrendSnapshot(RAY_BAN_META_PRODUCT_ID, mockTrendSignalProviders, {
      timestamp: DATA_LAYER_TIMESTAMP,
      historicalSnapshots: buildMockHistoricalSnapshots(RAY_BAN_META_PRODUCT_ID),
    });
    const after = buildProductTrendSnapshot(RAY_BAN_META_PRODUCT_ID, mockTrendSignalProviders, {
      timestamp: DATA_LAYER_TIMESTAMP,
      historicalSnapshots: buildMockHistoricalSnapshots(RAY_BAN_META_PRODUCT_ID),
    });

    buildRevenueMvpResult({ snapshot: before, product: { productId: RAY_BAN_META_PRODUCT_ID } });

    expect(after).toEqual(before);
  });
});
