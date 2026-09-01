import { describe, expect, it } from "vitest";
import { calculateConfidenceScore } from "../../../scoring/confidenceEngine";
import { calculateTrendMomentum } from "../../../scoring/momentumEngine";
import { calculateTrendIQScore } from "../../../scoring/scoreEngine";
import { VALIDATION_PRODUCT_PROFILES } from "../../capabilities";
import { RAY_BAN_META_PRODUCT_ID, RAY_BAN_META_SIGNAL_INPUTS } from "../../mockProviderSignals";
import {
  buildReviewQualitySignalsFromObservation,
  buildReviewQualitySignalsFromValidatedEvidence,
  normalizeValidatedDetailedReviewEvidence,
} from "../signalBuilder";
import type {
  GoogleShoppingRecentReviewsObservation,
  GoogleShoppingReviewObservation,
  RatingConsensusQualityResult,
  ReviewProductIdentityConfig,
  ValidatedDetailedReviewEvidenceStatus,
} from "../types";

const observedAt = "2026-09-01T12:00:00.000Z";
const windowStart = "2026-06-03T12:00:00.000Z";

const products: Array<{
  name: string;
  identity: ReviewProductIdentityConfig;
}> = [
  {
    name: "wearable-like",
    identity: {
      productId: "fixture-garmin-venu-4",
      canonicalSearchQuery: "Garmin Venu 4",
      productTitle: "Garmin Venu 4 GPS Smartwatch",
      brand: "Garmin",
      generation: "Venu 4",
    },
  },
  {
    name: "phone-like",
    identity: {
      productId: "fixture-samsung-galaxy-ring",
      canonicalSearchQuery: "Samsung Galaxy Ring",
      productTitle: "Samsung Galaxy Ring Smart Ring",
      brand: "Samsung",
      generation: "Galaxy Ring",
    },
  },
  {
    name: "kitchen appliance-like",
    identity: {
      productId: "fixture-ninja-creami-swirl",
      canonicalSearchQuery: "Ninja Creami Swirl",
      productTitle: "Ninja Creami Swirl Ice Cream Maker",
      brand: "Ninja",
      generation: "Creami Swirl",
    },
  },
  {
    name: "generic Acme-style",
    identity: {
      productId: "fixture-acme-flux-pro-7",
      canonicalSearchQuery: "Acme Flux Pro 7",
      productTitle: "Acme Flux Pro 7 Device",
      brand: "Acme",
      generation: "Flux Pro 7",
    },
  },
];

function ratingConsensus(
  overrides: Partial<RatingConsensusQualityResult> = {}
): RatingConsensusQualityResult {
  return {
    star1Count: 2,
    star2Count: 3,
    star3Count: 10,
    star4Count: 55,
    star5Count: 130,
    totalDistributionCount: 200,
    mean: 4.54,
    standardDeviation: 0.79,
    variance: 0.63,
    qualityGate: 90.8,
    shapeSupport: 88.5,
    lowTailPenalty: 1.5,
    status: "derived-live",
    ratingConsensusQuality: 78.9,
    aggregateAverageRating: 4.5,
    aggregateRatingDelta: 0.04,
    aggregateRatingMismatchThreshold: 0.75,
    distributionSource: "provider_rating_groups",
    distributionScope: "full_provider_distribution",
    distributionComposition: "provider_rating_group_counts",
    calculationMethod: "distribution_adjusted_rating_consensus_quality_v1",
    ...overrides,
  };
}

function recentReviewsObservation(
  productId = products[0].identity.productId,
  overrides: Partial<GoogleShoppingRecentReviewsObservation> = {}
): GoogleShoppingRecentReviewsObservation {
  return {
    provider: "dataforseo",
    productId,
    identifiers: {
      gid: "provider-gid-must-not-leak",
      productId: "provider-product-id-must-not-leak",
      dataDocid: "provider-data-docid-must-not-leak",
    },
    locationCode: 2840,
    languageCode: "en",
    fetchedAt: observedAt,
    endpoint: "/v3/merchant/google/reviews/task_get/advanced/provider-task-must-not-leak",
    snapshotTimestamp: observedAt,
    windowStart,
    windowEnd: observedAt,
    windowDays: 90,
    status: "derived-live",
    recentAverageRating: 4.42,
    totalReviewsFetched: 40,
    datedReviewCount: 40,
    qualifyingReviewCount: 40,
    excludedReviewCount: 0,
    undatedReviewCount: 0,
    invalidRatingCount: 0,
    outsideWindowReviewCount: 0,
    totalReviewsAvailable: 1240,
    sourceDomains: ["example.com", "retailer.test"],
    reviews: [
      {
        rating: 5,
        publicationDate: observedAt,
        providedBy: "example.com",
      },
    ],
    ratingConsensus: ratingConsensus(),
    calculationMethod: "mean_rating_of_dated_reviews_in_trailing_90_days",
    datePrecision: "provider_observed_approximate_relative_timestamp",
    cost: 0,
    ...overrides,
  };
}

function aggregateObservation(
  productId = products[0].identity.productId,
  overrides: Partial<GoogleShoppingReviewObservation> = {}
): GoogleShoppingReviewObservation {
  return {
    provider: "dataforseo",
    productId,
    searchQuery: "Garmin Venu 4",
    locationCode: 2840,
    languageCode: "en",
    fetchedAt: observedAt,
    endpoint: "/v3/merchant/google/products/task_get/advanced",
    matchedProductTitle: "Garmin Venu 4 GPS Smartwatch",
    seller: "Fixture Seller",
    identifiers: {
      gid: "aggregate-provider-gid",
      productId: "aggregate-provider-product-id",
      dataDocid: "aggregate-provider-data-docid",
    },
    averageRating: 4.5,
    ratingMax: 5,
    ratingVoteCount: 1240,
    ratingEvidenceCount: 1240,
    ratingEvidenceSourceField: "product_rating.votes_count",
    ratingEvidenceComposition: "rating_votes_only",
    matchConfidence: "high",
    matchScore: 100,
    matchReasons: ["accepted_identity_validated_fixture"],
    providerVariantGrouping: "fixture_product_result_may_group_variants",
    rankGroup: 1,
    rankAbsolute: 1,
    isBestMatch: true,
    cost: 0.019,
    ...overrides,
  };
}

function normalize(
  productId = products[0].identity.productId,
  overrides: Partial<GoogleShoppingRecentReviewsObservation> = {}
) {
  return normalizeValidatedDetailedReviewEvidence({
    canonicalProductId: productId,
    status: "reviews_validated",
    recentReviews: recentReviewsObservation(productId, overrides),
    taskCost: 0.02,
  });
}

function providerIdLeakText(value: unknown): string {
  return JSON.stringify(value);
}

describe("normalized validated review evidence", () => {
  it.each(products)("normalizes validated detailed reviews for $name products", ({ identity }) => {
    const evidence = normalize(identity.productId);

    expect(evidence.status).toBe("reviews_validated");
    expect(evidence.canonicalProductId).toBe(identity.productId);
    expect(evidence.provider).toBe("dataforseo");
    expect(evidence.providerEvidenceMode).toBe("derived-live");
    expect(evidence.totalReviewsAvailable).toBe(1240);
    expect(evidence.fetchedReviewCount).toBe(40);
    expect(evidence.qualifyingReviewCount).toBe(40);
    expect(evidence.sourceDomains).toEqual(["example.com", "retailer.test"]);
  });

  it("allows full-provider distribution to be usable while text evidence is insufficient", () => {
    const evidence = normalize(products[0].identity.productId, {
      status: "insufficient",
      recentAverageRating: undefined,
      totalReviewsFetched: 10,
      qualifyingReviewCount: 0,
      sourceDomains: [],
      reviews: [],
      ratingConsensus: ratingConsensus({
        distributionSource: "provider_rating_groups",
        distributionScope: "full_provider_distribution",
        star1Count: 12,
        star2Count: 18,
        star3Count: 60,
        star4Count: 330,
        star5Count: 780,
        totalDistributionCount: 1200,
        ratingConsensusQuality: 82.4,
      }),
    });
    const signals = buildReviewQualitySignalsFromValidatedEvidence({ evidence });

    expect(evidence.distributionEvidenceStatus).toBe("usable");
    expect(evidence.textEvidenceStatus).toBe("insufficient");
    expect(evidence.ratingConsensusQuality).toBe(82.4);
    expect(evidence.recentAverageRating).toBeNull();
    expect(signals.map((signal) => signal.metadata?.engineField)).toEqual(["ratingConsensusQuality"]);
  });

  it("emits distribution and text signals when both evidence dimensions qualify", () => {
    const evidence = normalize();
    const signals = buildReviewQualitySignalsFromValidatedEvidence({ evidence });

    expect(signals.map((signal) => signal.metadata?.engineField).sort()).toEqual([
      "ratingConsensusQuality",
      "recentAverageRating",
    ]);
    expect(signals.find((signal) => signal.metadata?.engineField === "recentAverageRating")?.value).toBe(4.42);
    expect(signals.find((signal) => signal.metadata?.engineField === "ratingConsensusQuality")?.value).toBe(78.9);
  });

  it("preserves text-sample distribution without a full provider distribution", () => {
    const evidence = normalize(products[0].identity.productId, {
      ratingConsensus: ratingConsensus({
        distributionSource: "review_items",
        distributionScope: "fetched_review_sample",
        distributionComposition: "valid_ratings_from_fetched_review_items",
      }),
    });

    expect(evidence.distributionEvidenceStatus).toBe("usable");
    expect(evidence.distributionSource).toBe("review_items");
    expect(evidence.distributionScope).toBe("fetched_review_sample");
  });

  it("does not fabricate distribution evidence from a qualifying text sample alone", () => {
    const evidence = normalize(products[0].identity.productId, {
      ratingConsensus: undefined,
    });
    const signals = buildReviewQualitySignalsFromValidatedEvidence({ evidence });

    expect(evidence.textEvidenceStatus).toBe("derived-live");
    expect(evidence.recentAverageRating).toBe(4.42);
    expect(evidence.distributionEvidenceStatus).toBe("unavailable");
    expect(evidence.ratingConsensusQuality).toBeNull();
    expect(signals.map((signal) => signal.metadata?.engineField)).toEqual(["recentAverageRating"]);
  });

  it("does not fabricate text evidence from a zero-qualifying text sample", () => {
    const evidence = normalize(products[0].identity.productId, {
      status: "insufficient",
      recentAverageRating: undefined,
      provisionalRecentAverageRating: undefined,
      qualifyingReviewCount: 0,
      sourceDomains: [],
      reviews: [],
    });
    const signals = buildReviewQualitySignalsFromValidatedEvidence({ evidence });

    expect(evidence.textEvidenceStatus).toBe("insufficient");
    expect(evidence.recentAverageRating).toBeNull();
    expect(signals.some((signal) => signal.metadata?.engineField === "recentAverageRating")).toBe(false);
  });

  it.each<ValidatedDetailedReviewEvidenceStatus>([
    "identity_inconclusive",
    "provider_pending",
    "provider_no_result",
    "provider_error",
    "malformed_response",
  ])("fails closed for degraded state %s", (status) => {
    const evidence = normalizeValidatedDetailedReviewEvidence({
      canonicalProductId: products[0].identity.productId,
      status,
      recentReviews: recentReviewsObservation(),
      taskCost: 0.02,
      observationCost: 0,
    });

    expect(evidence.status).toBe(status);
    expect(evidence.distributionEvidenceStatus).toBe("unavailable");
    expect(evidence.textEvidenceStatus).toBe("unavailable");
    expect(evidence.ratingConsensusQuality).toBeNull();
    expect(evidence.recentAverageRating).toBeNull();
    expect(buildReviewQualitySignalsFromValidatedEvidence({ evidence })).toEqual([]);
  });

  it("redacts provider identifiers and task identifiers from normalized evidence and signals", () => {
    const evidence = normalize();
    const signals = buildReviewQualitySignalsFromValidatedEvidence({ evidence });
    const serializedEvidence = providerIdLeakText(evidence);
    const serializedSignals = providerIdLeakText(signals);

    for (const forbidden of [
      "provider-gid-must-not-leak",
      "provider-product-id-must-not-leak",
      "provider-data-docid-must-not-leak",
      "provider-task-must-not-leak",
      "providerGid",
      "providerProductId",
      "providerDataDocid",
      "recentReviewsProviderGid",
      "taskId",
      "gid",
      "dataDocid",
    ]) {
      expect(serializedEvidence).not.toContain(forbidden);
      expect(serializedSignals).not.toContain(forbidden);
    }

    expect(evidence.canonicalProductId).toBe(products[0].identity.productId);
    expect(serializedEvidence).toContain(products[0].identity.productId);
  });

  it("preserves rating consensus and normalized rating groups", () => {
    const evidence = normalize();

    expect(evidence.ratingConsensusStatus).toBe("derived-live");
    expect(evidence.ratingConsensusQuality).toBe(78.9);
    expect(evidence.distributionEvidence.ratingGroups).toEqual([
      { star: 1, count: 2 },
      { star: 2, count: 3 },
      { star: 3, count: 10 },
      { star: 4, count: 55 },
      { star: 5, count: 130 },
    ]);
  });

  it("keeps POST task cost and retrieval observation cost distinct", () => {
    const unknownTaskCost = normalizeValidatedDetailedReviewEvidence({
      canonicalProductId: products[0].identity.productId,
      status: "reviews_validated",
      recentReviews: recentReviewsObservation(products[0].identity.productId, { cost: 0 }),
      taskCost: null,
    });
    const paidTaskWithRetrievalCost = normalizeValidatedDetailedReviewEvidence({
      canonicalProductId: products[0].identity.productId,
      status: "reviews_validated",
      recentReviews: recentReviewsObservation(products[0].identity.productId, { cost: 0 }),
      taskCost: 0.019,
      observationCost: 0.034,
    });
    const explicitZeroTaskCost = normalizeValidatedDetailedReviewEvidence({
      canonicalProductId: products[0].identity.productId,
      status: "reviews_validated",
      recentReviews: recentReviewsObservation(products[0].identity.productId, { cost: 0.034 }),
      taskCost: 0,
      observationCost: null,
    });

    expect(unknownTaskCost.cost).toEqual({
      taskCost: null,
      observationCost: 0,
      sourceCostCompatibleValue: null,
    });
    expect(paidTaskWithRetrievalCost.cost).toEqual({
      taskCost: 0.019,
      observationCost: 0.034,
      sourceCostCompatibleValue: 0.019,
    });
    expect(explicitZeroTaskCost.cost).toEqual({
      taskCost: 0,
      observationCost: null,
      sourceCostCompatibleValue: 0,
    });
  });

  it("fails closed for invalid validation discriminants", () => {
    for (const status of [undefined, "unexpected_status"]) {
      const evidence = normalizeValidatedDetailedReviewEvidence({
        canonicalProductId: products[0].identity.productId,
        status: status as unknown as string,
        recentReviews: recentReviewsObservation(),
      });

      expect(evidence.status).toBe("malformed_response");
      expect(evidence.distributionEvidenceStatus).toBe("unavailable");
      expect(evidence.textEvidenceStatus).toBe("unavailable");
      expect(buildReviewQualitySignalsFromValidatedEvidence({ evidence })).toEqual([]);
    }
  });

  it("fails closed for invalid canonical product identifiers", () => {
    const evidence = normalizeValidatedDetailedReviewEvidence({
      canonicalProductId: " ",
      status: "reviews_validated",
      recentReviews: recentReviewsObservation(),
    });

    expect(evidence.status).toBe("malformed_response");
    expect(evidence.reason).toBe("missing_canonical_product_id");
    expect(evidence.canonicalProductId).toBe("");
    expect(buildReviewQualitySignalsFromValidatedEvidence({ evidence })).toEqual([]);
  });

  it("keeps product A evidence from becoming product B evidence", () => {
    const evidence = normalizeValidatedDetailedReviewEvidence({
      canonicalProductId: products[0].identity.productId,
      status: "reviews_validated",
      recentReviews: recentReviewsObservation(products[1].identity.productId),
    });

    expect(evidence.status).toBe("identity_inconclusive");
    expect(evidence.reason).toBe("canonical_product_id_mismatch");
    expect(buildReviewQualitySignalsFromValidatedEvidence({ evidence })).toEqual([]);
  });

  it("fails closed instead of throwing for malformed runtime detailed-review status", () => {
    const evidence = normalizeValidatedDetailedReviewEvidence({
      canonicalProductId: products[0].identity.productId,
      status: "reviews_validated",
      recentReviews: {
        productId: products[0].identity.productId,
        provider: "dataforseo",
        fetchedAt: observedAt,
        status: "unexpected_status",
        sourceDomains: null,
      } as unknown as GoogleShoppingRecentReviewsObservation,
    });

    expect(evidence.status).toBe("malformed_response");
    expect(evidence.reason).toBe("malformed_recent_review_status");
    expect(buildReviewQualitySignalsFromValidatedEvidence({ evidence })).toEqual([]);
  });

  it("fails closed instead of throwing for malformed text evidence shape", () => {
    const evidence = normalizeValidatedDetailedReviewEvidence({
      canonicalProductId: products[0].identity.productId,
      status: "reviews_validated",
      recentReviews: {
        ...recentReviewsObservation(),
        sourceDomains: null,
      } as unknown as GoogleShoppingRecentReviewsObservation,
    });

    expect(evidence.status).toBe("malformed_response");
    expect(evidence.reason).toBe("malformed_recent_review_source_domains");
    expect(buildReviewQualitySignalsFromValidatedEvidence({ evidence })).toEqual([]);
  });

  it("fails closed for invalid nested distribution evidence without blocking valid text evidence", () => {
    const evidence = normalize(products[0].identity.productId, {
      ratingConsensus: ratingConsensus({
        star1Count: Number.NaN,
        totalDistributionCount: Number.POSITIVE_INFINITY,
      }),
    });
    const signals = buildReviewQualitySignalsFromValidatedEvidence({ evidence });

    expect(evidence.status).toBe("reviews_validated");
    expect(evidence.distributionEvidenceStatus).toBe("unavailable");
    expect(evidence.distributionEvidence.reviewsCount).toBeNull();
    expect(evidence.distributionEvidence.ratingGroups).toEqual([]);
    expect(evidence.ratingConsensusStatus).toBe("derived-live");
    expect(evidence.ratingConsensusQuality).toBeNull();
    expect(signals.map((signal) => signal.metadata?.engineField)).toEqual(["recentAverageRating"]);
  });

  it("fails closed when distribution source and scope conflict", () => {
    const evidence = normalize(products[1].identity.productId, {
      ratingConsensus: ratingConsensus({
        distributionSource: "review_items",
        distributionScope: "full_provider_distribution",
      }),
    });
    const signals = buildReviewQualitySignalsFromValidatedEvidence({ evidence });

    expect(evidence.status).toBe("reviews_validated");
    expect(evidence.distributionEvidenceStatus).toBe("unavailable");
    expect(evidence.distributionSource).toBe("review_items");
    expect(evidence.distributionScope).toBe("full_provider_distribution");
    expect(evidence.ratingConsensusQuality).toBeNull();
    expect(signals.map((signal) => signal.metadata?.engineField)).toEqual(["recentAverageRating"]);
  });

  it("fails closed for impossible distribution totals", () => {
    const evidence = normalize(products[2].identity.productId, {
      ratingConsensus: ratingConsensus({
        totalDistributionCount: 201,
      }),
    });
    const signals = buildReviewQualitySignalsFromValidatedEvidence({ evidence });

    expect(evidence.distributionEvidenceStatus).toBe("unavailable");
    expect(evidence.distributionEvidence.reviewsCount).toBe(201);
    expect(evidence.distributionEvidence.ratingGroups.reduce((sum, group) => sum + group.count, 0)).toBe(200);
    expect(evidence.ratingConsensusQuality).toBeNull();
    expect(signals.map((signal) => signal.metadata?.engineField)).toEqual(["recentAverageRating"]);
  });

  it("fails closed for fractional distribution bucket counts", () => {
    const evidence = normalize(products[2].identity.productId, {
      ratingConsensus: ratingConsensus({
        star3Count: 10.5,
        totalDistributionCount: 200.5,
      }),
    });
    const signals = buildReviewQualitySignalsFromValidatedEvidence({ evidence });

    expect(evidence.distributionEvidenceStatus).toBe("unavailable");
    expect(evidence.distributionEvidence.reviewsCount).toBeNull();
    expect(evidence.distributionEvidence.ratingGroups).toEqual([]);
    expect(evidence.ratingConsensusQuality).toBeNull();
    expect(signals.map((signal) => signal.metadata?.engineField)).toEqual(["recentAverageRating"]);
  });

  it("does not emit out-of-bounds rating consensus quality", () => {
    const evidence = normalize(products[3].identity.productId, {
      ratingConsensus: ratingConsensus({
        ratingConsensusQuality: 101,
      }),
    });
    const signals = buildReviewQualitySignalsFromValidatedEvidence({ evidence });

    expect(evidence.distributionEvidenceStatus).toBe("unavailable");
    expect(evidence.ratingConsensusQuality).toBeNull();
    expect(signals.map((signal) => signal.metadata?.engineField)).toEqual(["recentAverageRating"]);
  });

  it("preserves safe rating consensus calculation provenance without provider identifiers", () => {
    const evidence = normalize();
    const signals = buildReviewQualitySignalsFromValidatedEvidence({ evidence });
    const consensusSignal = signals.find((signal) => signal.metadata?.engineField === "ratingConsensusQuality");
    const serializedConsensusSignal = providerIdLeakText(consensusSignal);

    expect(evidence.distributionEvidence).toMatchObject({
      mean: 4.54,
      standardDeviation: 0.79,
      variance: 0.63,
      qualityGate: 90.8,
      shapeSupport: 88.5,
      lowTailPenalty: 1.5,
      aggregateAverageRating: 4.5,
      aggregateRatingDelta: 0.04,
      aggregateRatingMismatchThreshold: 0.75,
      calculationMethod: "distribution_adjusted_rating_consensus_quality_v1",
    });
    expect(consensusSignal?.metadata).toMatchObject({
      ratingConsensusDistributionSource: "provider_rating_groups",
      ratingConsensusDistributionScope: "full_provider_distribution",
      ratingConsensusMean: 4.54,
      ratingConsensusStandardDeviation: 0.79,
      ratingConsensusVariance: 0.63,
      ratingConsensusQualityGate: 90.8,
      ratingConsensusShapeSupport: 88.5,
      ratingConsensusLowTailPenalty: 1.5,
      ratingConsensusAggregateAverageRating: 4.5,
      ratingConsensusAggregateRatingDelta: 0.04,
      ratingConsensusAggregateRatingMismatchThreshold: 0.75,
      ratingConsensusQualityCalculationMethod: "distribution_adjusted_rating_consensus_quality_v1",
    });

    for (const forbidden of [
      "provider-gid-must-not-leak",
      "provider-product-id-must-not-leak",
      "provider-data-docid-must-not-leak",
      "provider-task-must-not-leak",
      "providerGid",
      "providerProductId",
      "providerDataDocid",
      "recentReviewsProviderGid",
      "taskId",
      "gid",
      "dataDocid",
    ]) {
      expect(serializedConsensusSignal).not.toContain(forbidden);
    }
  });

  it("does not emit text signals for non-finite text evidence numbers", () => {
    const evidence = normalize(products[0].identity.productId, {
      recentAverageRating: Number.NaN,
      totalReviewsFetched: Number.POSITIVE_INFINITY,
      qualifyingReviewCount: Number.NaN,
      ratingConsensus: undefined,
    });
    const signals = buildReviewQualitySignalsFromValidatedEvidence({ evidence });

    expect(evidence.fetchedReviewCount).toBe(0);
    expect(evidence.qualifyingReviewCount).toBe(0);
    expect(evidence.recentAverageRating).toBeNull();
    expect(evidence.textEvidenceStatus).toBe("derived-live");
    expect(signals).toEqual([]);
  });

  it("keeps the legacy aggregate and detailed-observation signal path unchanged", () => {
    const result = buildReviewQualitySignalsFromObservation({
      productId: products[0].identity.productId,
      observation: aggregateObservation(),
      recentReviews: recentReviewsObservation(),
    });
    const byEngineField = new Map(result.signals.map((signal) => [signal.metadata?.engineField, signal]));

    expect(result.signals.map((signal) => signal.metadata?.engineField)).toEqual([
      "averageRating",
      "ratingEvidenceCount",
      "recentAverageRating",
      "ratingConsensusQuality",
    ]);
    expect(byEngineField.get("averageRating")?.sourceProvenance.mode).toBe("live");
    expect(byEngineField.get("ratingEvidenceCount")?.sourceProvenance.mode).toBe("live");
    expect(byEngineField.get("recentAverageRating")?.sourceProvenance.mode).toBe("derived-live");
    expect(byEngineField.get("ratingConsensusQuality")?.sourceProvenance.mode).toBe("derived-live");
    expect(byEngineField.get("averageRating")?.metadata?.providerProductId).toBe("aggregate-provider-product-id");
    expect(byEngineField.get("averageRating")?.metadata?.providerDataDocid).toBe("aggregate-provider-data-docid");
    expect(byEngineField.get("averageRating")?.metadata?.providerGid).toBe("aggregate-provider-gid");
    expect(byEngineField.get("recentAverageRating")?.metadata?.recentReviewsProviderGid)
      .toBe("provider-gid-must-not-leak");
  });

  it("keeps legacy score, confidence, and momentum engines unchanged", () => {
    const score = calculateTrendIQScore(RAY_BAN_META_SIGNAL_INPUTS);
    const confidence = calculateConfidenceScore(RAY_BAN_META_SIGNAL_INPUTS.confidence);
    const momentum = calculateTrendMomentum({ changePercent: 34.2 });

    expect(score.scoreVersion).toBe("v1.1");
    expect(score.score).toBe(71);
    expect(confidence).toEqual({
      scoreVersion: "v1.1",
      score: 97,
      level: "High",
      components: {
        dataVolume: 100,
        sourceDiversity: 100,
        dataRecency: 95.24,
        signalAgreement: 85.71,
        dataCompleteness: 100,
      },
    });
    expect(momentum).toEqual({
      changePercent: 34.2,
      status: "Rising",
    });
  });

  it("keeps the existing canonical product profile contract intact", () => {
    expect(VALIDATION_PRODUCT_PROFILES[RAY_BAN_META_PRODUCT_ID]).toMatchObject({
      productId: RAY_BAN_META_PRODUCT_ID,
      source: "catalog",
      canonicalTitle: "Ray-Ban Meta",
      brand: "Ray-Ban",
      modelGeneration: "Meta",
      identityConfidence: "high",
    });
  });
});
