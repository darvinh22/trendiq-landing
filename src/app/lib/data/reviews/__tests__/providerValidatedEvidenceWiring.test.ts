import { describe, expect, it } from "vitest";
import { calculateConfidenceScore } from "../../../scoring/confidenceEngine";
import { calculateTrendMomentum } from "../../../scoring/momentumEngine";
import { calculateTrendIQScore } from "../../../scoring/scoreEngine";
import { createUserSearchProductProfile, type ProductProfile } from "../../capabilities";
import { RAY_BAN_META_SIGNAL_INPUTS } from "../../mockProviderSignals";
import {
  ReviewQualitySignalProvider,
  buildValidatedDetailedReviewSignalResult,
  mergeLiveReviewSignalsWithMockFallback,
} from "../../providers/reviewsProvider";
import type {
  GoogleShoppingProductIdentifier,
  GoogleShoppingRecentReviewsClient,
  GoogleShoppingRecentReviewsObservation,
  GoogleShoppingReviewObservation,
  GoogleShoppingReviewsClient,
  RatingConsensusQualityResult,
  ReviewProductIdentityConfig,
  ReviewSignalBuildResult,
  ValidatedDetailedReviewEvidenceStatus,
} from "../types";
import { readReviewProviderConfig } from "../config";

const now = new Date("2026-09-01T12:00:00.000Z");
const windowStart = "2026-06-03T12:00:00.000Z";

interface WiringFixture {
  name: string;
  identity: ReviewProductIdentityConfig;
  candidateTitle: string;
  seller: string;
  identifiers: Required<GoogleShoppingProductIdentifier>;
}

const productFixtures: WiringFixture[] = [
  {
    name: "wearable-like",
    identity: {
      productId: "fixture-garmin-venu-4",
      canonicalSearchQuery: "Garmin Venu 4",
      productTitle: "Garmin Venu 4 GPS Smartwatch",
      brand: "Garmin",
      generation: "Venu 4",
    },
    candidateTitle: "Garmin Venu 4 GPS Smartwatch",
    seller: "Synthetic Electronics",
    identifiers: {
      gid: "safe-garmin-venu-4-gid",
      productId: "safe-garmin-venu-4-product",
      dataDocid: "safe-garmin-venu-4-doc",
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
    candidateTitle: "Samsung Galaxy Ring Smart Ring",
    seller: "Synthetic Mobile",
    identifiers: {
      gid: "safe-samsung-galaxy-ring-gid",
      productId: "safe-samsung-galaxy-ring-product",
      dataDocid: "safe-samsung-galaxy-ring-doc",
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
    candidateTitle: "Ninja Creami Swirl Ice Cream Maker",
    seller: "Synthetic Kitchen",
    identifiers: {
      gid: "safe-ninja-creami-swirl-gid",
      productId: "safe-ninja-creami-swirl-product",
      dataDocid: "safe-ninja-creami-swirl-doc",
    },
  },
  {
    name: "generic product",
    identity: {
      productId: "fixture-acme-flux-pro-7",
      canonicalSearchQuery: "Acme Flux Pro 7",
      productTitle: "Acme Flux Pro 7 Device",
      brand: "Acme",
      generation: "Flux Pro 7",
    },
    candidateTitle: "Acme Flux Pro 7 Device",
    seller: "Synthetic Store",
    identifiers: {
      gid: "safe-acme-flux-pro-7-gid",
      productId: "safe-acme-flux-pro-7-product",
      dataDocid: "safe-acme-flux-pro-7-doc",
    },
  },
];

class FixtureReviewClient implements GoogleShoppingReviewsClient {
  readonly calls: Array<{ productId: string; locationCode: number; languageCode: string }> = [];

  constructor(private readonly observation: GoogleShoppingReviewObservation) {}

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

    return this.observation;
  }
}

class FixtureRecentReviewsClient implements GoogleShoppingRecentReviewsClient {
  readonly calls: Array<{
    productId: string;
    identifiers?: GoogleShoppingProductIdentifier;
    snapshotTimestamp: string;
  }> = [];

  constructor(
    private readonly recentReviews?: GoogleShoppingRecentReviewsObservation,
    private readonly error?: Error
  ) {}

  async getRecentProductReviews(input: {
    productId: string;
    identifiers?: GoogleShoppingProductIdentifier;
    snapshotTimestamp: string;
  }): Promise<GoogleShoppingRecentReviewsObservation> {
    this.calls.push({
      productId: input.productId,
      identifiers: input.identifiers,
      snapshotTimestamp: input.snapshotTimestamp,
    });

    if (this.error) throw this.error;
    if (!this.recentReviews) return undefined as unknown as GoogleShoppingRecentReviewsObservation;

    return this.recentReviews;
  }
}

class RecordingCache<T> {
  value?: T;

  get(): T | undefined {
    return undefined;
  }

  set(_key: string, value: T): void {
    this.value = value;
  }

  clear(): void {
    this.value = undefined;
  }
}

function profileFor(fixture: WiringFixture): ProductProfile {
  return createUserSearchProductProfile(fixture.identity.canonicalSearchQuery, {
    productId: fixture.identity.productId,
    source: "user_search",
    canonicalTitle: fixture.identity.productTitle,
    brand: fixture.identity.brand,
    aliases: [fixture.identity.canonicalSearchQuery, fixture.identity.productTitle],
    productType: "hardware",
    modelGeneration: fixture.identity.generation,
    identityConfidence: "high",
    guardrails: {
      requireExactBrandMatch: true,
      requireModelGenerationMatch: true,
      excludeAccessories: true,
      excludeBundles: true,
    },
  });
}

function aggregateObservation(
  fixture: WiringFixture,
  overrides: Partial<Omit<GoogleShoppingReviewObservation, "identifiers">> & {
    identifiers?: Partial<GoogleShoppingProductIdentifier>;
  } = {}
): GoogleShoppingReviewObservation {
  const { identifiers, ...rest } = overrides;

  return {
    provider: "dataforseo",
    productId: fixture.identity.productId,
    searchQuery: fixture.identity.canonicalSearchQuery,
    locationCode: 2840,
    languageCode: "en",
    fetchedAt: now.toISOString(),
    endpoint: "/v3/merchant/google/products/task_get/advanced/synthetic-aggregate-task",
    matchedProductTitle: fixture.candidateTitle,
    seller: fixture.seller,
    identifiers: {
      ...fixture.identifiers,
      ...identifiers,
    },
    averageRating: 4.5,
    ratingMax: 5,
    ratingVoteCount: 1240,
    ratingEvidenceCount: 1240,
    ratingEvidenceSourceField: "product_rating.votes_count",
    ratingEvidenceComposition: "rating_votes_only",
    matchConfidence: "high",
    matchScore: 100,
    matchReasons: ["title_token_coverage:100", "model_token_coverage:100", "match_brand_model"],
    providerVariantGrouping: "synthetic_product_result_may_group_variants",
    rankGroup: 1,
    rankAbsolute: 1,
    isBestMatch: true,
    cost: 0.019,
    ...rest,
  };
}

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
  fixture: WiringFixture,
  overrides: Partial<Omit<GoogleShoppingRecentReviewsObservation, "identifiers">> & {
    identifiers?: Partial<GoogleShoppingProductIdentifier>;
  } = {}
): GoogleShoppingRecentReviewsObservation {
  const { identifiers, ...rest } = overrides;

  return {
    provider: "dataforseo",
    productId: fixture.identity.productId,
    identifiers: {
      ...fixture.identifiers,
      ...identifiers,
    },
    locationCode: 2840,
    languageCode: "en",
    fetchedAt: now.toISOString(),
    endpoint: "/v3/merchant/google/reviews/task_get/advanced/synthetic-detailed-task",
    snapshotTimestamp: now.toISOString(),
    windowStart,
    windowEnd: now.toISOString(),
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
        publicationDate: now.toISOString(),
        providedBy: "example.com",
      },
    ],
    ratingConsensus: ratingConsensus(),
    calculationMethod: "mean_rating_of_dated_reviews_in_trailing_90_days",
    datePrecision: "provider_observed_approximate_relative_timestamp",
    cost: 0,
    ...rest,
  };
}

function liveConfigFor(fixture: WiringFixture) {
  return readReviewProviderConfig({}, {
    mode: "live",
    apiLogin: "login",
    apiPassword: "password",
    taskPollIntervalMs: 0,
    productIdentities: {
      [fixture.identity.productId]: fixture.identity,
    },
    productProfiles: {
      [fixture.identity.productId]: profileFor(fixture),
    },
    now: () => now,
  });
}

function signalsByEngineField(signals: Array<{ metadata?: { engineField?: string } }>) {
  return new Map(signals.map((signal) => [signal.metadata?.engineField, signal]));
}

function engineFieldCounts(signals: Array<{ metadata?: { engineField?: string } }>): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const signal of signals) {
    const field = signal.metadata?.engineField;
    if (!field) continue;
    counts[field] = (counts[field] ?? 0) + 1;
  }

  return counts;
}

async function getProductionSignals(input: {
  fixture: WiringFixture;
  aggregate?: GoogleShoppingReviewObservation;
  recentReviews?: GoogleShoppingRecentReviewsObservation;
  recentReviewsError?: Error;
}) {
  const cache = new RecordingCache<ReviewSignalBuildResult>();
  const provider = new ReviewQualitySignalProvider(liveConfigFor(input.fixture), {
    client: new FixtureReviewClient(input.aggregate ?? aggregateObservation(input.fixture)),
    recentReviewsClient: new FixtureRecentReviewsClient(input.recentReviews, input.recentReviewsError),
    cache,
    fallbackProvider: {
      id: "reviews",
      label: "Product reviews",
      getSignals: () => [],
    },
  });

  const signals = await provider.getSignalsForProfile(profileFor(input.fixture));

  return {
    signals,
    cache,
  };
}

describe("production validated-review evidence wiring", () => {
  it.each(productFixtures)("routes validated details through normalized evidence for $name products", async (fixture) => {
    const recentReviews = recentReviewsObservation(fixture);
    const { signals, cache } = await getProductionSignals({ fixture, recentReviews });
    const byEngineField = signalsByEngineField(signals);
    const detailedSignals = signals.filter((signal) =>
      signal.metadata?.engineField === "ratingConsensusQuality" ||
      signal.metadata?.engineField === "recentAverageRating"
    );
    const serializedDetailedPath = JSON.stringify({
      evidence: cache.value?.validatedDetailedReviewEvidence,
      signals: detailedSignals,
    });

    expect(engineFieldCounts(signals)).toEqual({
      averageRating: 1,
      ratingEvidenceCount: 1,
      ratingConsensusQuality: 1,
      recentAverageRating: 1,
    });
    expect(byEngineField.get("averageRating")?.value).toBe(4.5);
    expect(byEngineField.get("ratingEvidenceCount")?.value).toBe(1240);
    expect(byEngineField.get("ratingConsensusQuality")?.value).toBe(78.9);
    expect(byEngineField.get("recentAverageRating")?.value).toBe(4.42);
    expect(cache.value?.validatedDetailedReviewEvidence?.status).toBe("reviews_validated");
    expect(cache.value?.validatedDetailedReviewEvidence?.canonicalProductId).toBe(fixture.identity.productId);
    expect(cache.value?.validatedDetailedReviewEvidence?.cost).toEqual({
      taskCost: null,
      observationCost: 0,
      sourceCostCompatibleValue: null,
    });

    for (const forbidden of [
      fixture.identifiers.gid,
      fixture.identifiers.productId,
      fixture.identifiers.dataDocid,
      "synthetic-detailed-task",
      "providerGid",
      "providerProductId",
      "providerDataDocid",
      "recentReviewsProviderGid",
      "taskId",
    ]) {
      expect(serializedDetailedPath).not.toContain(forbidden);
    }
  });

  it("emits validated distribution evidence even when text evidence is insufficient", async () => {
    const fixture = productFixtures[0];
    const recentReviews = recentReviewsObservation(fixture, {
      status: "insufficient",
      recentAverageRating: undefined,
      totalReviewsFetched: 8,
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
    const { signals, cache } = await getProductionSignals({ fixture, recentReviews });
    const byEngineField = signalsByEngineField(signals);

    expect(cache.value?.validatedDetailedReviewEvidence?.distributionEvidenceStatus).toBe("usable");
    expect(cache.value?.validatedDetailedReviewEvidence?.textEvidenceStatus).toBe("insufficient");
    expect(byEngineField.get("ratingConsensusQuality")?.value).toBe(82.4);
    expect(byEngineField.has("recentAverageRating")).toBe(false);
  });

  it("emits validated text evidence without fabricating distribution evidence", async () => {
    const fixture = productFixtures[1];
    const recentReviews = recentReviewsObservation(fixture, {
      ratingConsensus: undefined,
    });
    const { signals, cache } = await getProductionSignals({ fixture, recentReviews });
    const byEngineField = signalsByEngineField(signals);

    expect(cache.value?.validatedDetailedReviewEvidence?.distributionEvidenceStatus).toBe("unavailable");
    expect(cache.value?.validatedDetailedReviewEvidence?.textEvidenceStatus).toBe("derived-live");
    expect(byEngineField.has("ratingConsensusQuality")).toBe(false);
    expect(byEngineField.get("recentAverageRating")?.value).toBe(4.42);
  });

  it("keeps aggregate evidence when zero qualifying text yields no detailed signals", async () => {
    const fixture = productFixtures[2];
    const recentReviews = recentReviewsObservation(fixture, {
      status: "insufficient",
      recentAverageRating: undefined,
      totalReviewsFetched: 0,
      qualifyingReviewCount: 0,
      sourceDomains: [],
      reviews: [],
      ratingConsensus: undefined,
    });
    const { signals, cache } = await getProductionSignals({ fixture, recentReviews });

    expect(cache.value?.validatedDetailedReviewEvidence?.textEvidenceStatus).toBe("insufficient");
    expect(cache.value?.validatedDetailedReviewEvidence?.distributionEvidenceStatus).toBe("unavailable");
    expect(engineFieldCounts(signals)).toEqual({
      averageRating: 1,
      ratingEvidenceCount: 1,
    });
  });

  it("keeps aggregate evidence and blocks detailed retrieval when identity is inconclusive", async () => {
    const fixture = productFixtures[3];
    const recentReviewsClient = new FixtureRecentReviewsClient(recentReviewsObservation(fixture));
    const cache = new RecordingCache<ReviewSignalBuildResult>();
    const provider = new ReviewQualitySignalProvider(liveConfigFor(fixture), {
      client: new FixtureReviewClient(aggregateObservation(fixture, {
        matchedProductTitle: "Different Brand Accessory Case",
      })),
      recentReviewsClient,
      cache,
      fallbackProvider: {
        id: "reviews",
        label: "Product reviews",
        getSignals: () => [],
      },
    });
    const signals = await provider.getSignalsForProfile(profileFor(fixture));

    expect(recentReviewsClient.calls).toEqual([]);
    expect(cache.value?.validatedDetailedReviewEvidence?.status).toBe("identity_inconclusive");
    expect(engineFieldCounts(signals)).toEqual({
      averageRating: 1,
      ratingEvidenceCount: 1,
    });
  });

  it("maps provider no-result and provider errors to zero detailed-review signals", async () => {
    const fixture = productFixtures[0];
    const noResult = await getProductionSignals({ fixture });
    const providerError = await getProductionSignals({
      fixture,
      recentReviewsError: new Error("synthetic provider failure"),
    });

    expect(noResult.cache.value?.validatedDetailedReviewEvidence?.status).toBe("provider_no_result");
    expect(providerError.cache.value?.validatedDetailedReviewEvidence?.status).toBe("provider_error");
    expect(engineFieldCounts(noResult.signals)).toEqual({
      averageRating: 1,
      ratingEvidenceCount: 1,
    });
    expect(engineFieldCounts(providerError.signals)).toEqual({
      averageRating: 1,
      ratingEvidenceCount: 1,
    });
  });

  it("fails closed for every degraded normalized detailed-review state", () => {
    const fixture = productFixtures[0];

    for (const status of [
      "identity_inconclusive",
      "provider_pending",
      "provider_no_result",
      "provider_error",
      "malformed_response",
    ] satisfies ValidatedDetailedReviewEvidenceStatus[]) {
      const result = buildValidatedDetailedReviewSignalResult({
        productId: fixture.identity.productId,
        status,
        recentReviews: recentReviewsObservation(fixture),
      });

      expect(result.evidence.status).toBe(status);
      expect(result.signals).toEqual([]);
    }
  });

  it("rejects mismatched detailed provider identifiers before normalized signal emission", async () => {
    const fixture = productFixtures[0];
    const recentReviews = recentReviewsObservation(fixture, {
      identifiers: {
        gid: "different-safe-provider-identity",
      },
    });
    const { signals, cache } = await getProductionSignals({ fixture, recentReviews });

    expect(cache.value?.validatedDetailedReviewEvidence?.status).toBe("identity_inconclusive");
    expect(engineFieldCounts(signals)).toEqual({
      averageRating: 1,
      ratingEvidenceCount: 1,
    });
  });

  it("keeps validated rating consensus ahead of mock fallback without duplicate engine fields", () => {
    const fixture = productFixtures[0];
    const live = buildValidatedDetailedReviewSignalResult({
      productId: fixture.identity.productId,
      status: "reviews_validated",
      recentReviews: recentReviewsObservation(fixture),
    }).signals;
    const fallbackRatingConsensus = {
      source: "reviews",
      signalType: "reviewQuality",
      productId: fixture.identity.productId,
      sourceProvenance: {
        mode: "mock",
        provider: "mock_reviews",
        providerLabel: "Product reviews",
        providerMetric: "ratingConsensusQuality",
      },
      value: 1,
      normalizedValue: 1,
      sampleSize: 1,
      timestamp: now.toISOString(),
      confidence: 1,
      metadata: {
        provider: "mock_reviews",
        providerMetric: "ratingConsensusQuality",
        engineField: "ratingConsensusQuality",
        engineValue: 1,
      },
    } as const;
    const fallbackAverageRating = {
      ...fallbackRatingConsensus,
      sourceProvenance: {
        ...fallbackRatingConsensus.sourceProvenance,
        providerMetric: "averageRating",
      },
      metadata: {
        ...fallbackRatingConsensus.metadata,
        providerMetric: "averageRating",
        engineField: "averageRating",
        engineValue: 4,
      },
      value: 4,
      normalizedValue: 50,
    } as const;
    const mergedA = mergeLiveReviewSignalsWithMockFallback(live, [
      fallbackRatingConsensus,
      fallbackAverageRating,
    ]);
    const mergedB = mergeLiveReviewSignalsWithMockFallback(live, [
      fallbackAverageRating,
      fallbackRatingConsensus,
    ]);

    for (const merged of [mergedA, mergedB]) {
      expect(engineFieldCounts(merged)).toEqual({
        averageRating: 1,
        ratingConsensusQuality: 1,
        recentAverageRating: 1,
      });
      expect(signalsByEngineField(merged).get("ratingConsensusQuality")?.value).toBe(78.9);
      expect(signalsByEngineField(merged).get("ratingConsensusQuality")?.sourceProvenance.mode)
        .toBe("derived-live");
      expect(signalsByEngineField(merged).get("averageRating")?.sourceProvenance.mode).toBe("fallback");
    }
  });

  it("keeps score, confidence, and momentum engines frozen when validated details are absent", () => {
    const score = calculateTrendIQScore(RAY_BAN_META_SIGNAL_INPUTS);
    const confidence = calculateConfidenceScore(RAY_BAN_META_SIGNAL_INPUTS.confidence);
    const momentum = calculateTrendMomentum({ changePercent: 34.2 });

    expect(score).toMatchObject({
      scoreVersion: "v1.1",
      score: 71,
    });
    expect(confidence).toMatchObject({
      scoreVersion: "v1.1",
      score: 97,
      level: "High",
    });
    expect(momentum).toEqual({
      changePercent: 34.2,
      status: "Rising",
    });
  });
});
