import { normalizeInverseLinear, normalizeLinear, normalizeLogScale, roundTo } from "../../scoring/normalization";
import { DATA_LAYER_TIMESTAMP, RAY_BAN_META_PRODUCT_ID, RAY_BAN_META_SIGNAL_INPUTS } from "../mockProviderSignals";
import { canUseProvider, createUserSearchProductProfile, profileWithProviderIds, type ProductProfile } from "../capabilities";
import { InMemorySearchCache, type SearchCache } from "../search/cache";
import {
  DataForSeoGoogleShoppingReviewsClient,
  DataForSeoGoogleShoppingProductsClient,
  buildReviewProductIdentityFromProfile,
  buildReviewQualitySignalsFromObservation,
  buildReviewQualitySignalsFromValidatedEvidence,
  createEphemeralProviderIdentityFromAggregateObservation,
  normalizeValidatedDetailedReviewEvidence,
  readReviewProviderConfig,
  shouldUseLiveReviews,
  type EphemeralProviderIdentity,
  type GoogleShoppingRecentReviewsObservation,
  type GoogleShoppingReviewObservation,
  type NormalizedValidatedReviewEvidence,
  type GoogleShoppingRecentReviewsClient,
  type GoogleShoppingReviewsClient,
  type ReviewProviderConfig,
  type ReviewSignalBuildResult,
  type ValidatedDetailedReviewEvidenceStatus,
} from "../reviews";
import type { AsyncTrendSignalProvider, NormalizedTrendSignal, TrendSignalProvider } from "../types";

const source = "reviews" as const;
const label = "Product reviews";
const provider = "mock_reviews";

function normalize(value: number): number {
  return roundTo(value, 2);
}

export const mockReviewsProvider: TrendSignalProvider = {
  id: source,
  label,
  getSignals(productId: string): NormalizedTrendSignal[] {
    if (productId !== RAY_BAN_META_PRODUCT_ID) return [];

    const reviews = RAY_BAN_META_SIGNAL_INPUTS.reviewQuality;
    const sentiment = RAY_BAN_META_SIGNAL_INPUTS.sentiment;

    return [
      {
        source,
        signalType: "reviewQuality",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "averageRating",
        },
        value: reviews.averageRating,
        // Ratings below 3.2 are treated as weak for consumer products; 4.8+
        // is capped because review volume and freshness decide the rest.
        normalizedValue: normalize(normalizeLinear(reviews.averageRating, 3.2, 4.8)),
        sampleSize: reviews.ratingEvidenceCount,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 90,
        metadata: {
          provider,
          providerMetric: "averageRating",
          engineField: "averageRating",
          engineValue: reviews.averageRating,
        },
      },
      {
        source,
        signalType: "reviewQuality",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "ratingEvidenceCount",
        },
        value: reviews.ratingEvidenceCount,
        // Rating evidence is log-scaled from 20 to 20,000 so early credibility
        // rises quickly without letting large products dominate.
        normalizedValue: normalize(normalizeLogScale(reviews.ratingEvidenceCount, 20, 20000)),
        sampleSize: reviews.ratingEvidenceCount,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 91,
        metadata: {
          provider,
          providerMetric: "ratingEvidenceCount",
          ratingEvidenceComposition: "fallback_rating_review_evidence",
          fallbackReviewCountEquivalent: reviews.ratingEvidenceCount,
          engineField: "ratingEvidenceCount",
          engineValue: reviews.ratingEvidenceCount,
        },
      },
      {
        source,
        signalType: "reviewQuality",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "ratingConsensusQuality",
        },
        value: reviews.ratingConsensusQuality,
        // Fallback ratingConsensusQuality is already normalized to 0-100 under
        // the distribution-adjusted consensus semantics.
        normalizedValue: normalize(reviews.ratingConsensusQuality),
        sampleSize: reviews.ratingEvidenceCount,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 88,
        metadata: {
          provider,
          providerMetric: "ratingConsensusQuality",
          distributionScope: "fallback",
          distributionComposition: "fallback_numeric_equivalent",
          engineField: "ratingConsensusQuality",
          engineValue: reviews.ratingConsensusQuality,
        },
      },
      {
        source,
        signalType: "reviewQuality",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "recentAverageRating",
        },
        value: reviews.recentAverageRating,
        // Recent ratings use a 3.0-4.8 range to reveal deteriorating product
        // quality faster than long-lived all-time averages.
        normalizedValue: normalize(normalizeLinear(reviews.recentAverageRating, 3.0, 4.8)),
        sampleSize: 720,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 86,
        metadata: {
          provider,
          providerMetric: "recentAverageRating",
          engineField: "recentAverageRating",
          engineValue: reviews.recentAverageRating,
        },
      },
      {
        source,
        signalType: "sentiment",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "positiveReviewLanguage",
        },
        value: sentiment.positiveMentionPercent,
        normalizedValue: normalize(normalizeLinear(sentiment.positiveMentionPercent, 30, 90)),
        sampleSize: 720,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 84,
        metadata: {
          provider,
          providerMetric: "positiveReviewLanguage",
          engineField: "positiveMentionPercent",
          engineValue: sentiment.positiveMentionPercent,
        },
      },
      {
        source,
        signalType: "sentiment",
        productId,
        sourceProvenance: {
          mode: "mock",
          provider,
          providerLabel: label,
          providerMetric: "negativeReviewLanguage",
        },
        value: sentiment.negativeMentionPercent,
        normalizedValue: normalize(normalizeInverseLinear(sentiment.negativeMentionPercent, 5, 45)),
        sampleSize: 720,
        timestamp: DATA_LAYER_TIMESTAMP,
        confidence: 84,
        metadata: {
          provider,
          providerMetric: "negativeReviewLanguage",
          engineField: "negativeMentionPercent",
          engineValue: sentiment.negativeMentionPercent,
        },
      },
    ];
  },
};

export interface ReviewQualitySignalProviderDependencies {
  client?: GoogleShoppingReviewsClient;
  recentReviewsClient?: GoogleShoppingRecentReviewsClient;
  cache?: SearchCache<ReviewSignalBuildResult>;
  fallbackProvider?: TrendSignalProvider;
}

type DegradedDetailedReviewStatus = Exclude<ValidatedDetailedReviewEvidenceStatus, "reviews_validated">;

type DetailedReviewRetrievalResult =
  | {
      status: "reviews_validated";
      recentReviews: GoogleShoppingRecentReviewsObservation;
    }
  | {
      status: DegradedDetailedReviewStatus;
      reason: string;
    };

export interface ValidatedDetailedReviewSignalResult {
  evidence: NormalizedValidatedReviewEvidence;
  signals: NormalizedTrendSignal[];
}

function engineKey(signal: NormalizedTrendSignal): string | undefined {
  const field = signal.metadata?.engineField;
  return field ? `${signal.signalType}.${field}` : undefined;
}

function asLiveFallbackSignal(signal: NormalizedTrendSignal): NormalizedTrendSignal {
  return {
    ...signal,
    sourceProvenance: {
      ...signal.sourceProvenance,
      mode: "fallback",
      notes: signal.sourceProvenance.notes
        ?? "Mock review field retained because live DataForSEO Google Shopping did not supply this engine field.",
    },
  };
}

export function mergeLiveReviewSignalsWithMockFallback(
  liveSignals: NormalizedTrendSignal[],
  mockSignals: NormalizedTrendSignal[]
): NormalizedTrendSignal[] {
  const liveEngineKeys = new Set(liveSignals.map(engineKey).filter((key): key is string => Boolean(key)));
  const untouchedMockSignals = mockSignals
    .filter((signal) => {
      const key = engineKey(signal);
      return !key || !liveEngineKeys.has(key);
    })
    .map(asLiveFallbackSignal);

  return [...untouchedMockSignals, ...liveSignals];
}

function redactedDetailedReviewObservation(
  recentReviews: GoogleShoppingRecentReviewsObservation
): GoogleShoppingRecentReviewsObservation {
  return {
    ...recentReviews,
    endpoint: "redacted_provider_endpoint",
    identifiers: {},
    reviews: [],
  };
}

export function buildValidatedDetailedReviewSignalResult(input: {
  productId: string;
  status: ValidatedDetailedReviewEvidenceStatus;
  recentReviews?: GoogleShoppingRecentReviewsObservation;
  reason?: string;
  taskCost?: number | null;
  observationCost?: number | null;
}): ValidatedDetailedReviewSignalResult {
  const redactedObservation = input.recentReviews
    ? redactedDetailedReviewObservation(input.recentReviews)
    : undefined;
  const evidence = normalizeValidatedDetailedReviewEvidence({
    canonicalProductId: input.productId,
    status: input.status,
    recentReviews: redactedObservation,
    reason: input.reason,
    taskCost: input.taskCost,
    observationCost: input.observationCost,
  });

  return {
    evidence,
    signals: buildReviewQualitySignalsFromValidatedEvidence({ evidence }),
  };
}

function detailedReviewIdentityIssue(input: {
  productId: string;
  recentReviews: GoogleShoppingRecentReviewsObservation;
  aggregateIdentity: EphemeralProviderIdentity;
}): Extract<DetailedReviewRetrievalResult, { status: DegradedDetailedReviewStatus }> | undefined {
  if (
    input.aggregateIdentity.productId !== input.productId ||
    input.recentReviews.productId !== input.productId
  ) {
    return {
      status: "identity_inconclusive",
      reason: "detailed_review_product_identity_mismatch",
    };
  }

  if (input.recentReviews.provider !== input.aggregateIdentity.provider) {
    return {
      status: "malformed_response",
      reason: "detailed_review_provider_mismatch",
    };
  }

  const expected = input.aggregateIdentity.identifiers;
  const observed = input.recentReviews.identifiers ?? {};
  const optionalProductIdMismatch = expected.productId &&
    observed.productId &&
    expected.productId !== observed.productId;
  const optionalDataDocidMismatch = expected.dataDocid &&
    observed.dataDocid &&
    expected.dataDocid !== observed.dataDocid;

  if (
    observed.gid !== expected.gid ||
    optionalProductIdMismatch ||
    optionalDataDocidMismatch
  ) {
    return {
      status: "identity_inconclusive",
      reason: "detailed_review_provider_identity_mismatch",
    };
  }

  return undefined;
}

export class ReviewQualitySignalProvider implements AsyncTrendSignalProvider {
  readonly id = source;
  readonly label = label;
  private readonly cache: SearchCache<ReviewSignalBuildResult>;
  private readonly fallbackProvider: TrendSignalProvider;

  constructor(
    private readonly config: ReviewProviderConfig = readReviewProviderConfig(),
    private readonly dependencies: ReviewQualitySignalProviderDependencies = {}
  ) {
    this.cache = dependencies.cache ?? new InMemorySearchCache<ReviewSignalBuildResult>();
    this.fallbackProvider = dependencies.fallbackProvider ?? mockReviewsProvider;
  }

  getSignals(productId: string): NormalizedTrendSignal[] {
    const profile = this.profileForProductId(productId);
    if (!profile) return [];

    const cached = this.cache.get(this.cacheKey(productId), this.config.now().getTime());
    if (this.config.mode === "live" && cached?.signals.length) {
      return mergeLiveReviewSignalsWithMockFallback(cached.signals, this.fallbackProvider.getSignals(productId));
    }

    return this.fallbackProvider.getSignals(productId);
  }

  async getSignalsAsync(productId: string): Promise<NormalizedTrendSignal[]> {
    const profile = this.profileForProductId(productId);
    if (!profile) return [];

    return this.getSignalsForProfile(profile);
  }

  async getSignalsForProfile(profile: ProductProfile): Promise<NormalizedTrendSignal[]> {
    if (!shouldUseLiveReviews(this.config)) {
      return this.fallbackProvider.getSignals(profile.productId);
    }

    const aggregateDecision = canUseProvider(profile, "dataforseo_google_shopping", "reviews");
    if (!aggregateDecision.allowed) {
      return this.fallbackProvider.getSignals(profile.productId).map(asLiveFallbackSignal);
    }

    const productId = profile.productId;
    const identity = this.identityForProfile(profile);
    const cacheKey = this.cacheKey(productId);
    const cached = this.cache.get(cacheKey, this.config.now().getTime());
    if (cached?.signals.length) {
      return mergeLiveReviewSignalsWithMockFallback(cached.signals, this.fallbackProvider.getSignals(productId));
    }

    try {
      const client = this.dependencies.client ?? new DataForSeoGoogleShoppingProductsClient(this.config);
      const observation = await client.getProductReviewAggregate({
        productId,
        identity,
        locationCode: this.config.locationCode,
        languageCode: this.config.languageCode,
      });
      const detailedReviews = await this.getValidatedDetailedReviews({
        productId,
        identity,
        profile,
        observation,
      });
      const aggregateResult = buildReviewQualitySignalsFromObservation({
        productId,
        observation,
      });
      const detailedReviewResult = buildValidatedDetailedReviewSignalResult({
        productId,
        status: detailedReviews.status,
        recentReviews: detailedReviews.status === "reviews_validated" ? detailedReviews.recentReviews : undefined,
        reason: detailedReviews.status === "reviews_validated" ? undefined : detailedReviews.reason,
        taskCost: null,
        observationCost: detailedReviews.status === "reviews_validated" ? detailedReviews.recentReviews.cost ?? null : null,
      });
      const result: ReviewSignalBuildResult = {
        ...aggregateResult,
        signals: [...aggregateResult.signals, ...detailedReviewResult.signals],
        validatedDetailedReviewEvidence: detailedReviewResult.evidence,
      };

      this.cache.set(cacheKey, result, this.config.cacheTtlMs, this.config.now().getTime());
      return mergeLiveReviewSignalsWithMockFallback(result.signals, this.fallbackProvider.getSignals(productId));
    } catch {
      return this.fallbackProvider.getSignals(productId).map(asLiveFallbackSignal);
    }
  }

  private cacheKey(productId: string): string {
    const profile = this.profileForProductId(productId);
    const identity = profile ? this.identityForProfile(profile) : this.config.productIdentities[productId];

    return [
      "reviews",
      this.config.provider,
      productId,
      identity?.canonicalSearchQuery ?? "",
      this.config.locationCode,
      this.config.languageCode,
      this.config.recentReviewsDepth,
      this.config.recentReviewsWindowDays,
      this.config.recentReviewsMinimumScoringSampleSize,
      this.config.recentReviewsProvisionalSampleSize,
    ].join(":");
  }

  private async getValidatedDetailedReviews(input: {
    productId: string;
    identity: NonNullable<ReviewProviderConfig["productIdentities"][string]>;
    profile: ProductProfile;
    observation: GoogleShoppingReviewObservation;
  }): Promise<DetailedReviewRetrievalResult> {
    const ephemeralIdentity = createEphemeralProviderIdentityFromAggregateObservation({
      observation: input.observation,
      identity: input.identity,
      candidateMatchDecision: "match",
    });

    if (ephemeralIdentity.status !== "ready") {
      return {
        status: "identity_inconclusive",
        reason: ephemeralIdentity.reason,
      };
    }

    try {
      const enrichedProfile = profileWithProviderIds(
        input.profile,
        "dataforseo_google_shopping_reviews",
        ephemeralIdentity.identity.identifiers
      );
      const reviewsDecision = canUseProvider(
        enrichedProfile,
        "dataforseo_google_shopping_reviews",
        "reviews"
      );
      if (!reviewsDecision.allowed) {
        return {
          status: "identity_inconclusive",
          reason: "detailed_review_capability_not_allowed",
        };
      }

      const client = this.dependencies.recentReviewsClient
        ?? new DataForSeoGoogleShoppingReviewsClient(this.config);

      const recentReviews = await client.getRecentProductReviews({
        productId: input.productId,
        identity: input.identity,
        identifiers: ephemeralIdentity.identity.identifiers,
        locationCode: this.config.locationCode,
        languageCode: this.config.languageCode,
        snapshotTimestamp: this.config.now().toISOString(),
        aggregateAverageRating: input.observation.averageRating,
      });

      if (!recentReviews) {
        return {
          status: "provider_no_result",
          reason: "detailed_review_provider_no_result",
        };
      }

      const identityIssue = detailedReviewIdentityIssue({
        productId: input.productId,
        recentReviews,
        aggregateIdentity: ephemeralIdentity.identity,
      });
      if (identityIssue) return identityIssue;

      return {
        status: "reviews_validated",
        recentReviews,
      };
    } catch {
      return {
        status: "provider_error",
        reason: "detailed_review_provider_error",
      };
    }
  }

  private profileForProductId(productId: string): ProductProfile | undefined {
    const configuredProfile = this.config.productProfiles?.[productId];
    if (configuredProfile) return configuredProfile;

    const identity = this.config.productIdentities[productId];
    if (!identity) return undefined;

    return createUserSearchProductProfile(identity.canonicalSearchQuery, {
      productId,
      source: "resolved_provider",
      canonicalTitle: identity.productTitle,
      brand: identity.brand,
      aliases: [identity.canonicalSearchQuery, identity.productTitle],
      modelGeneration: identity.generation,
      identityConfidence: identity.providerProductIds?.matchConfidence === "high" ? "high" : "medium",
      providerIds: identity.providerProductIds ? {
        dataforseo_google_shopping: identity.providerProductIds,
        dataforseo_google_shopping_reviews: identity.providerProductIds,
      } : undefined,
      guardrails: {
        requireExactBrandMatch: true,
        requireModelGenerationMatch: Boolean(identity.generation),
        excludeAccessories: true,
        excludeBundles: true,
      },
    });
  }

  private identityForProfile(profile: ProductProfile) {
    return this.config.productIdentities[profile.productId] ?? buildReviewProductIdentityFromProfile(profile);
  }
}

export function createReviewQualitySignalProvider(
  config: ReviewProviderConfig = readReviewProviderConfig(),
  dependencies: ReviewQualitySignalProviderDependencies = {}
): ReviewQualitySignalProvider {
  return new ReviewQualitySignalProvider(config, dependencies);
}

export const reviewsProvider = createReviewQualitySignalProvider();
