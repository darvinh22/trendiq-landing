import { describe, expect, it } from "vitest";
import { calculateTrendIQScore } from "../../../scoring/scoreEngine";
import { RAY_BAN_META_PRODUCT_ID } from "../../mockProviderSignals";
import { merchantProvider, mockRedditProvider, socialProvider } from "../../providers";
import { mockSearchProvider } from "../../search";
import { buildProductTrendSnapshot, buildProductTrendSnapshotAsync } from "../../snapshotEngine";
import type {
  GoogleShoppingRecentReviewsClient,
  GoogleShoppingRecentReviewsObservation,
  GoogleShoppingReviewsClient,
  GoogleShoppingReviewObservation,
  RatingConsensusQualityResult,
} from "../types";
import { readReviewProviderConfig } from "../config";
import {
  ReviewQualitySignalProvider,
  mockReviewsProvider,
} from "../../providers/reviewsProvider";

const now = new Date("2026-08-21T23:47:20.000Z");
const recentWindowStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

function observation(overrides: Partial<GoogleShoppingReviewObservation> = {}): GoogleShoppingReviewObservation {
  return {
    provider: "dataforseo",
    productId: RAY_BAN_META_PRODUCT_ID,
    searchQuery: "Ray-Ban Meta",
    locationCode: 2840,
    languageCode: "en",
    fetchedAt: now.toISOString(),
    endpoint: "/v3/merchant/google/products/task_get/advanced",
    matchedProductTitle: "Meta Ray-Ban Wayfarer",
    seller: "Meta",
    identifiers: {
      productId: "11716803554991446550",
      dataDocid: "4690297997048968068",
      gid: "11193998885220934472",
    },
    averageRating: 4.4,
    ratingMax: 5,
    ratingVoteCount: 1700,
    ratingEvidenceCount: 1700,
    ratingEvidenceSourceField: "product_rating.votes_count",
    ratingEvidenceComposition: "rating_votes_only",
    matchConfidence: "high",
    matchScore: 100,
    matchReasons: ["accepted_seller_match", "persisted_provider_identifier_match"],
    providerVariantGrouping: "google_shopping_product_result_may_group_frame_and_lens_variants",
    rankGroup: 1,
    rankAbsolute: 1,
    ...overrides,
  };
}

function recentReviewsObservation(
  overrides: Partial<GoogleShoppingRecentReviewsObservation> = {}
): GoogleShoppingRecentReviewsObservation {
  return {
    provider: "dataforseo",
    productId: RAY_BAN_META_PRODUCT_ID,
    identifiers: {
      productId: "11716803554991446550",
      dataDocid: "4690297997048968068",
      gid: "11193998885220934472",
    },
    locationCode: 2840,
    languageCode: "en",
    fetchedAt: now.toISOString(),
    endpoint: "/v3/merchant/google/reviews/task_get/advanced",
    snapshotTimestamp: now.toISOString(),
    windowStart: recentWindowStart,
    windowEnd: now.toISOString(),
    windowDays: 90,
    status: "derived-live",
    recentAverageRating: 4.5,
    totalReviewsFetched: 30,
    datedReviewCount: 30,
    qualifyingReviewCount: 30,
    excludedReviewCount: 0,
    undatedReviewCount: 0,
    invalidRatingCount: 0,
    outsideWindowReviewCount: 0,
    sourceDomains: ["example.com"],
    reviews: [],
    calculationMethod: "mean_rating_of_dated_reviews_in_trailing_90_days",
    datePrecision: "provider_observed_approximate_relative_timestamp",
    ...overrides,
  };
}

function ratingConsensus(
  overrides: Partial<RatingConsensusQualityResult> = {}
): RatingConsensusQualityResult {
  return {
    star1Count: 0,
    star2Count: 0,
    star3Count: 2,
    star4Count: 198,
    star5Count: 0,
    totalDistributionCount: 200,
    mean: 3.99,
    standardDeviation: 0.0995,
    variance: 0.0099,
    qualityGate: 79.33,
    shapeSupport: 98.26,
    lowTailPenalty: 0.06,
    status: "derived-live",
    ratingConsensusQuality: 77.9,
    aggregateAverageRating: 4.4,
    aggregateRatingDelta: 0.41,
    aggregateRatingMismatchThreshold: 0.75,
    distributionSource: "review_items",
    distributionScope: "fetched_review_sample",
    distributionComposition: "valid_ratings_from_fetched_review_items",
    calculationMethod: "distribution_adjusted_rating_consensus_quality_v1",
    ...overrides,
  };
}

class FixtureReviewClient implements GoogleShoppingReviewsClient {
  readonly calls: Array<{ productId: string; locationCode: number; languageCode: string }> = [];

  constructor(
    private readonly aggregate?: GoogleShoppingReviewObservation,
    private readonly error?: Error
  ) {}

  async getProductReviewAggregate(input: {
    productId: string;
    locationCode: number;
    languageCode: string;
  }): Promise<GoogleShoppingReviewObservation> {
    this.calls.push({
      productId: input.productId,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
    });

    if (this.error) throw this.error;
    if (!this.aggregate) throw new Error("review aggregate unavailable");

    return this.aggregate;
  }
}

class FixtureRecentReviewsClient implements GoogleShoppingRecentReviewsClient {
  readonly calls: Array<{
    productId: string;
    locationCode: number;
    languageCode: string;
    snapshotTimestamp: string;
  }> = [];

  constructor(
    private readonly recentReviews?: GoogleShoppingRecentReviewsObservation,
    private readonly error?: Error
  ) {}

  async getRecentProductReviews(input: {
    productId: string;
    identity: unknown;
    identifiers?: unknown;
    locationCode: number;
    languageCode: string;
    snapshotTimestamp: string;
  }): Promise<GoogleShoppingRecentReviewsObservation> {
    this.calls.push({
      productId: input.productId,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      snapshotTimestamp: input.snapshotTimestamp,
    });

    if (this.error) throw this.error;
    if (!this.recentReviews) throw new Error("recent reviews unavailable");

    return this.recentReviews;
  }
}

function unavailableRecentReviewsClient(): FixtureRecentReviewsClient {
  return new FixtureRecentReviewsClient(undefined, new Error("recent reviews not requested"));
}

function liveConfig(overrides: Parameters<typeof readReviewProviderConfig>[1] = {}) {
  return readReviewProviderConfig({}, {
    mode: "live",
    apiLogin: "login",
    apiPassword: "password",
    taskPollIntervalMs: 0,
    now: () => now,
    ...overrides,
  });
}

describe("ReviewQualitySignalProvider", () => {
  it("uses high-confidence Google Shopping averageRating and ratingEvidenceCount", async () => {
    const client = new FixtureReviewClient(observation());
    const recentReviewsClient = unavailableRecentReviewsClient();
    const provider = new ReviewQualitySignalProvider(liveConfig(), { client, recentReviewsClient });
    const signals = await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    const averageRatingSignals = signals.filter((signal) => signal.metadata?.engineField === "averageRating");
    const byEngineField = new Map(signals.map((signal) => [signal.metadata?.engineField, signal]));

    expect(client.calls[0]).toEqual({
      productId: RAY_BAN_META_PRODUCT_ID,
      locationCode: 2840,
      languageCode: "en",
    });
    expect(averageRatingSignals).toHaveLength(1);
    expect(byEngineField.get("averageRating")?.value).toBe(4.4);
    expect(byEngineField.get("averageRating")?.sourceProvenance.mode).toBe("live");
    expect(byEngineField.get("averageRating")?.metadata?.provider).toBe("dataforseo_google_shopping");
    expect(byEngineField.get("averageRating")?.metadata?.ratingEvidenceCount).toBe(1700);
    expect(byEngineField.get("ratingEvidenceCount")?.value).toBe(1700);
    expect(byEngineField.get("ratingEvidenceCount")?.sourceProvenance.mode).toBe("live");
    expect(byEngineField.get("ratingEvidenceCount")?.metadata?.ratingVoteCount).toBe(1700);
    expect(byEngineField.get("ratingEvidenceCount")?.metadata?.writtenReviewCount).toBeUndefined();
    expect(byEngineField.get("ratingEvidenceCount")?.metadata?.ratingEvidenceSourceField)
      .toBe("product_rating.votes_count");
    expect(byEngineField.get("ratingEvidenceCount")?.metadata?.ratingEvidenceComposition).toBe("rating_votes_only");
    expect(byEngineField.get("ratingConsensusQuality")?.sourceProvenance.mode).toBe("fallback");
    expect(byEngineField.get("recentAverageRating")?.sourceProvenance.mode).toBe("fallback");
    expect(recentReviewsClient.calls[0]).toEqual({
      productId: RAY_BAN_META_PRODUCT_ID,
      locationCode: 2840,
      languageCode: "en",
      snapshotTimestamp: now.toISOString(),
    });
  });

  it("uses derived-live recentAverageRating when the 90-day sample meets the scoring guardrail", async () => {
    const client = new FixtureReviewClient(observation());
    const recentReviewsClient = new FixtureRecentReviewsClient(recentReviewsObservation());
    const provider = new ReviewQualitySignalProvider(liveConfig(), { client, recentReviewsClient });
    const signals = await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    const byEngineField = new Map(signals.map((signal) => [signal.metadata?.engineField, signal]));
    const recentAverageRating = byEngineField.get("recentAverageRating");

    expect(recentAverageRating?.value).toBe(4.5);
    expect(recentAverageRating?.sourceProvenance.mode).toBe("derived-live");
    expect(recentAverageRating?.sourceProvenance.provider).toBe("dataforseo_google_shopping_reviews");
    expect(recentAverageRating?.metadata?.provider).toBe("dataforseo_google_shopping_reviews");
    expect(recentAverageRating?.metadata?.sourceMetric).toBe("items[].rating.value");
    expect(recentAverageRating?.metadata?.recentAverageRatingStatus).toBe("derived-live");
    expect(recentAverageRating?.metadata?.qualifyingRecentReviewCount).toBe(30);
    expect(recentAverageRating?.metadata?.totalReviewsFetched).toBe(30);
    expect(recentAverageRating?.metadata?.recentAverageRatingWindowStart).toBe(recentWindowStart);
    expect(recentAverageRating?.metadata?.recentAverageRatingWindowEnd).toBe(now.toISOString());
    expect(recentAverageRating?.metadata?.recentAverageRatingCalculationMethod)
      .toBe("mean_rating_of_dated_reviews_in_trailing_90_days");
    expect(recentAverageRating?.metadata?.recentAverageRatingDatePrecision)
      .toBe("provider_observed_approximate_relative_timestamp");
    expect(recentAverageRating?.metadata?.recentReviewSourceDomains).toBe("example.com");
    expect(recentReviewsClient.calls[0]?.snapshotTimestamp).toBe(now.toISOString());
  });

  it("uses derived-live ratingConsensusQuality when distribution observations meet the scoring guardrail", async () => {
    const client = new FixtureReviewClient(observation());
    const recentReviewsClient = new FixtureRecentReviewsClient(recentReviewsObservation({
      ratingConsensus: ratingConsensus(),
    }));
    const provider = new ReviewQualitySignalProvider(liveConfig(), { client, recentReviewsClient });
    const signals = await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    const byEngineField = new Map(signals.map((signal) => [signal.metadata?.engineField, signal]));
    const ratingConsensusQuality = byEngineField.get("ratingConsensusQuality");

    expect(ratingConsensusQuality?.value).toBe(77.9);
    expect(ratingConsensusQuality?.normalizedValue).toBe(77.9);
    expect(ratingConsensusQuality?.sourceProvenance.mode).toBe("derived-live");
    expect(ratingConsensusQuality?.sourceProvenance.provider).toBe("dataforseo_google_shopping_reviews");
    expect(ratingConsensusQuality?.metadata?.provider).toBe("dataforseo_google_shopping_reviews");
    expect(ratingConsensusQuality?.metadata?.sourceMetric).toBe("items[].rating.value");
    expect(ratingConsensusQuality?.metadata?.ratingConsensusQualityStatus).toBe("derived-live");
    expect(ratingConsensusQuality?.metadata?.ratingConsensusQualityObservationCount).toBe(200);
    expect(ratingConsensusQuality?.metadata?.ratingConsensusStar3Count).toBe(2);
    expect(ratingConsensusQuality?.metadata?.ratingConsensusStar4Count).toBe(198);
    expect(ratingConsensusQuality?.metadata?.ratingConsensusDistributionScope).toBe("fetched_review_sample");
    expect(ratingConsensusQuality?.metadata?.ratingConsensusAggregateRatingDelta).toBe(0.41);
  });

  it("keeps 30-99 ratingConsensusQuality observations provisional without replacing scoring fallback", async () => {
    const client = new FixtureReviewClient(observation());
    const recentReviewsClient = new FixtureRecentReviewsClient(recentReviewsObservation({
      ratingConsensus: ratingConsensus({
        totalDistributionCount: 99,
        star4Count: 99,
        star3Count: 0,
        status: "provisional",
        ratingConsensusQuality: undefined,
        provisionalRatingConsensusQuality: 80,
      }),
    }));
    const provider = new ReviewQualitySignalProvider(liveConfig(), { client, recentReviewsClient });
    const signals = await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    const byEngineField = new Map(signals.map((signal) => [signal.metadata?.engineField, signal]));

    expect(byEngineField.get("averageRating")?.metadata?.ratingConsensusQualityStatus).toBe("provisional");
    expect(byEngineField.get("averageRating")?.metadata?.provisionalRatingConsensusQuality).toBe(80);
    expect(byEngineField.get("ratingConsensusQuality")?.value).toBe(85);
    expect(byEngineField.get("ratingConsensusQuality")?.sourceProvenance.mode).toBe("fallback");
  });

  it("keeps ratingConsensusQuality fallback below the provisional floor", async () => {
    const client = new FixtureReviewClient(observation());
    const recentReviewsClient = new FixtureRecentReviewsClient(recentReviewsObservation({
      ratingConsensus: ratingConsensus({
        totalDistributionCount: 29,
        star4Count: 29,
        star3Count: 0,
        status: "insufficient",
        ratingConsensusQuality: undefined,
      }),
    }));
    const provider = new ReviewQualitySignalProvider(liveConfig(), { client, recentReviewsClient });
    const signals = await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    const byEngineField = new Map(signals.map((signal) => [signal.metadata?.engineField, signal]));

    expect(byEngineField.get("averageRating")?.metadata?.ratingConsensusQualityStatus).toBe("insufficient");
    expect(byEngineField.get("ratingConsensusQuality")?.value).toBe(85);
    expect(byEngineField.get("ratingConsensusQuality")?.sourceProvenance.mode).toBe("fallback");
  });

  it("keeps ratingConsensusQuality fallback when the sampled distribution mismatches aggregate averageRating", async () => {
    const client = new FixtureReviewClient(observation());
    const recentReviewsClient = new FixtureRecentReviewsClient(recentReviewsObservation({
      ratingConsensus: ratingConsensus({
        totalDistributionCount: 100,
        star3Count: 0,
        star4Count: 0,
        star5Count: 100,
        mean: 5,
        status: "mismatch",
        ratingConsensusQuality: undefined,
        aggregateAverageRating: 3.9,
        aggregateRatingDelta: 1.1,
      }),
    }));
    const provider = new ReviewQualitySignalProvider(liveConfig(), { client, recentReviewsClient });
    const signals = await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    const byEngineField = new Map(signals.map((signal) => [signal.metadata?.engineField, signal]));

    expect(byEngineField.get("averageRating")?.metadata?.ratingConsensusQualityStatus).toBe("mismatch");
    expect(byEngineField.get("averageRating")?.metadata?.ratingConsensusAggregateRatingDelta).toBe(1.1);
    expect(byEngineField.get("ratingConsensusQuality")?.value).toBe(85);
    expect(byEngineField.get("ratingConsensusQuality")?.sourceProvenance.mode).toBe("fallback");
  });

  it("keeps 10-29 recent reviews as provisional metadata without replacing the scoring fallback", async () => {
    const client = new FixtureReviewClient(observation());
    const recentReviews = recentReviewsObservation({
      status: "provisional",
      provisionalRecentAverageRating: 4.8,
      totalReviewsFetched: 20,
      datedReviewCount: 20,
      qualifyingReviewCount: 20,
    });
    delete recentReviews.recentAverageRating;
    const recentReviewsClient = new FixtureRecentReviewsClient(recentReviews);
    const provider = new ReviewQualitySignalProvider(liveConfig(), { client, recentReviewsClient });
    const signals = await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    const byEngineField = new Map(signals.map((signal) => [signal.metadata?.engineField, signal]));
    const averageRating = byEngineField.get("averageRating");
    const recentAverageRating = byEngineField.get("recentAverageRating");

    expect(averageRating?.metadata?.recentAverageRatingStatus).toBe("provisional");
    expect(averageRating?.metadata?.provisionalRecentAverageRating).toBe(4.8);
    expect(averageRating?.metadata?.qualifyingRecentReviewCount).toBe(20);
    expect(recentAverageRating?.value).toBe(4.3);
    expect(recentAverageRating?.sourceProvenance.mode).toBe("fallback");
    expect(recentAverageRating?.metadata?.provider).toBe("mock_reviews");
  });

  it("keeps recentAverageRating fallback when the recent sample is below the provisional floor", async () => {
    const client = new FixtureReviewClient(observation());
    const recentReviews = recentReviewsObservation({
      status: "insufficient",
      totalReviewsFetched: 9,
      datedReviewCount: 9,
      qualifyingReviewCount: 9,
    });
    delete recentReviews.recentAverageRating;
    const provider = new ReviewQualitySignalProvider(liveConfig(), {
      client,
      recentReviewsClient: new FixtureRecentReviewsClient(recentReviews),
    });
    const signals = await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    const byEngineField = new Map(signals.map((signal) => [signal.metadata?.engineField, signal]));

    expect(byEngineField.get("averageRating")?.metadata?.recentAverageRatingStatus).toBe("insufficient");
    expect(byEngineField.get("averageRating")?.metadata?.qualifyingRecentReviewCount).toBe(9);
    expect(byEngineField.get("recentAverageRating")?.value).toBe(4.3);
    expect(byEngineField.get("recentAverageRating")?.sourceProvenance.mode).toBe("fallback");
  });

  it("falls back to mock rating evidence when provider counts are inconsistent", async () => {
    const client = new FixtureReviewClient(observation({
      writtenReviewCount: 1200,
      ratingVoteCount: 800,
      ratingEvidenceCount: undefined,
      ratingEvidenceSourceField: "inconsistent_provider_counts",
      ratingEvidenceComposition: "inconsistent_votes_count_lt_reviews_count",
    }));
    const provider = new ReviewQualitySignalProvider(liveConfig(), {
      client,
      recentReviewsClient: unavailableRecentReviewsClient(),
    });
    const signals = await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    const byEngineField = new Map(signals.map((signal) => [signal.metadata?.engineField, signal]));

    expect(byEngineField.get("averageRating")?.sourceProvenance.mode).toBe("live");
    expect(byEngineField.get("averageRating")?.metadata?.ratingEvidenceSourceField)
      .toBe("inconsistent_provider_counts");
    expect(byEngineField.get("ratingEvidenceCount")?.sourceProvenance.mode).toBe("fallback");
    expect(byEngineField.get("ratingEvidenceCount")?.metadata?.engineValue).toBe(2900);
  });

  it("falls back without a live request when review credentials are unavailable", async () => {
    const client = new FixtureReviewClient(observation());
    const provider = new ReviewQualitySignalProvider(readReviewProviderConfig({}, {
      mode: "live",
      now: () => now,
    }), { client });

    expect(await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID)).toEqual(
      mockReviewsProvider.getSignals(RAY_BAN_META_PRODUCT_ID)
    );
    expect(client.calls).toEqual([]);
  });

  it("falls back when the live aggregate is unavailable or missing a usable rating", async () => {
    const client = new FixtureReviewClient(undefined, new Error("missing rating"));
    const provider = new ReviewQualitySignalProvider(liveConfig(), {
      client,
      recentReviewsClient: unavailableRecentReviewsClient(),
    });
    const signals = await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    const averageRating = signals.find((signal) => signal.metadata?.engineField === "averageRating");

    expect(averageRating?.metadata?.provider).toBe("mock_reviews");
    expect(averageRating?.sourceProvenance.mode).toBe("fallback");
    expect(averageRating?.metadata?.engineValue).toBe(4.4);
  });

  it("falls back when product match confidence is below the approved threshold", async () => {
    const client = new FixtureReviewClient(undefined, new Error("low-confidence product match"));
    const provider = new ReviewQualitySignalProvider(liveConfig(), {
      client,
      recentReviewsClient: unavailableRecentReviewsClient(),
    });
    const signals = await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    const averageRating = signals.find((signal) => signal.metadata?.engineField === "averageRating");

    expect(averageRating?.sourceProvenance.mode).toBe("fallback");
    expect(averageRating?.metadata?.provider).toBe("mock_reviews");
  });

  it("preserves existing mock behavior for unsupported products", async () => {
    const client = new FixtureReviewClient(observation());
    const recentReviewsClient = unavailableRecentReviewsClient();
    const provider = new ReviewQualitySignalProvider(liveConfig(), { client, recentReviewsClient });

    expect(provider.getSignals("oura-ring-4")).toEqual([]);
    expect(await provider.getSignalsAsync("oura-ring-4")).toEqual([]);
    expect(client.calls).toEqual([]);
    expect(recentReviewsClient.calls).toEqual([]);
  });

  it("updates only averageRating and ratingEvidenceCount in Review Quality score inputs", async () => {
    const client = new FixtureReviewClient(observation());
    const provider = new ReviewQualitySignalProvider(liveConfig(), {
      client,
      recentReviewsClient: unavailableRecentReviewsClient(),
    });
    const mockSnapshot = buildProductTrendSnapshot(
      RAY_BAN_META_PRODUCT_ID,
      [mockSearchProvider, mockRedditProvider, mockReviewsProvider, socialProvider, merchantProvider],
      { timestamp: now.toISOString() }
    );
    const snapshot = await buildProductTrendSnapshotAsync(
      RAY_BAN_META_PRODUCT_ID,
      [mockSearchProvider, mockRedditProvider, provider, socialProvider, merchantProvider],
      { timestamp: now.toISOString() }
    );
    const reviewComponent = snapshot.liveDataAudit?.componentSummaries.find((component) =>
      component.component === "reviewQuality"
    );

    expect(snapshot.aggregatedSignals.reviewQuality.averageRating).toBe(
      mockSnapshot.aggregatedSignals.reviewQuality.averageRating
    );
    expect(snapshot.aggregatedSignals.reviewQuality.ratingEvidenceCount).toBe(1700);
    expect(snapshot.aggregatedSignals.reviewQuality.ratingConsensusQuality).toBe(
      mockSnapshot.aggregatedSignals.reviewQuality.ratingConsensusQuality
    );
    expect(snapshot.aggregatedSignals.reviewQuality.recentAverageRating).toBe(
      mockSnapshot.aggregatedSignals.reviewQuality.recentAverageRating
    );
    expect(calculateTrendIQScore(snapshot.aggregatedSignals).scoreVersion).toBe(mockSnapshot.trendIQScore.scoreVersion);
    expect(reviewComponent?.fields.find((field) => field.engineField === "averageRating")?.provenance).toBe("live");
    expect(reviewComponent?.fields.find((field) =>
      field.engineField === "ratingEvidenceCount"
    )?.provenance).toBe("live");
  });

  it("updates recentAverageRating score inputs only when the scoring guardrail is satisfied", async () => {
    const client = new FixtureReviewClient(observation());
    const provider = new ReviewQualitySignalProvider(liveConfig(), {
      client,
      recentReviewsClient: new FixtureRecentReviewsClient(recentReviewsObservation()),
    });
    const mockSnapshot = buildProductTrendSnapshot(
      RAY_BAN_META_PRODUCT_ID,
      [mockSearchProvider, mockRedditProvider, mockReviewsProvider, socialProvider, merchantProvider],
      { timestamp: now.toISOString() }
    );
    const snapshot = await buildProductTrendSnapshotAsync(
      RAY_BAN_META_PRODUCT_ID,
      [mockSearchProvider, mockRedditProvider, provider, socialProvider, merchantProvider],
      { timestamp: now.toISOString() }
    );
    const reviewComponent = snapshot.liveDataAudit?.componentSummaries.find((component) =>
      component.component === "reviewQuality"
    );
    const score = calculateTrendIQScore(snapshot.aggregatedSignals);

    expect(snapshot.aggregatedSignals.reviewQuality.averageRating).toBe(
      mockSnapshot.aggregatedSignals.reviewQuality.averageRating
    );
    expect(snapshot.aggregatedSignals.reviewQuality.ratingEvidenceCount).toBe(1700);
    expect(snapshot.aggregatedSignals.reviewQuality.recentAverageRating).toBe(4.5);
    expect(snapshot.aggregatedSignals.reviewQuality.ratingConsensusQuality).toBe(
      mockSnapshot.aggregatedSignals.reviewQuality.ratingConsensusQuality
    );
    expect(score.scoreVersion).toBe(mockSnapshot.trendIQScore.scoreVersion);
    expect(reviewComponent?.fields.find((field) =>
      field.engineField === "recentAverageRating"
    )?.provenance).toBe("derived-live");
  });
});
