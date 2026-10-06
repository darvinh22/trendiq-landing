import type { ConsumerProductResult } from "../../app/lib/data/consumerResult";
import type { ProductAnalysisResponse } from "../../app/lib/analysis/productAnalysisContract";

type PublicSchema = true | readonly PublicSchema[] | { readonly [key: string]: PublicSchema };

const REASON_SCHEMA = {
  code: true,
  effect: true,
  dimension: true,
  message: true,
} as const;

const CONSUMER_RESULT_SCHEMA: PublicSchema = {
  version: true,
  source: {
    recommendationResultVersion: true,
    recommendationPolicyVersion: true,
    evaluatedAt: true,
  },
  product: { id: true, name: true, brand: true, category: true },
  decision: {
    recommendation: true,
    status: true,
    headline: true,
    summary: true,
    trustMessage: true,
  },
  score: {
    value: true,
    status: true,
    liveCoveragePercent: true,
    usedForDecision: true,
    explanation: true,
    scoreInputIncomplete: true,
  },
  confidence: {
    value: true,
    level: true,
    status: true,
    meaning: true,
    usedForDecision: true,
    explanation: true,
  },
  momentum: {
    direction: true,
    strength: true,
    evidenceQuality: true,
    status: true,
    usedForDecision: true,
    explanation: true,
  },
  reviews: {
    status: true,
    usedForDecision: true,
    aggregate: { averageRating: true, reviewCount: true, status: true },
    ratingConsensus: { quality: true, averageRating: true, status: true },
    recentRating: { averageRating: true, status: true },
    textEvidence: { status: true, summary: true, themes: [] },
    sampleWindow: { status: true, start: true, end: true },
  },
  explanation: {
    reasons: [REASON_SCHEMA],
    watchOuts: [true],
    missingEvidence: [true],
    bestFor: { status: true, items: [] },
  },
  trust: {
    status: true,
    summary: true,
    verifiedCoveragePercent: true,
    verifiedDimensions: [true],
    degradedDimensions: [true],
    unavailableDimensions: [true],
    influencingDimensions: [true],
    excludedDimensions: [true],
    missingCriticalEvidence: [true],
    freshness: { status: true, freshestSignalAt: true, ageHours: true },
    mockFallbackEvidenceExcluded: true,
    redactions: {
      providerIdentifiersRedacted: true,
      taskIdentifiersRedacted: true,
      sellerIdentityRedacted: true,
      sourceDomainsRedacted: true,
      rawQueriesRedacted: true,
      rawReviewBodiesRedacted: true,
      demoCommerceRedacted: true,
    },
  },
  unsupported: {
    reviewTextIntelligence: {
      status: true,
      pros: [],
      cons: [],
      themes: [],
      sentimentSummary: true,
    },
    socialAndHype: {
      status: true,
      tiktokSentiment: true,
      redditSentiment: true,
      socialBuzz: true,
      purchaseIntent: true,
      hypeSustainability: true,
      influencerSentiment: true,
    },
    priceAndCommerce: {
      status: true,
      price: true,
      currency: true,
      dealStatus: true,
      discountClaim: true,
      merchantRecommendations: [],
      affiliateLinks: [],
    },
  },
  issues: [true],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickPublic(value: unknown, schema: PublicSchema): unknown {
  if (schema === true) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  if (Array.isArray(schema)) {
    if (!schema.length) return [];
    return Array.isArray(value) ? value.map((item) => pickPublic(item, schema[0])) : [];
  }

  const record = isRecord(value) ? value : {};
  return Object.fromEntries(
    Object.entries(schema).map(([key, childSchema]) => [key, pickPublic(record[key], childSchema)])
  );
}

export function redactConsumerProductResult(
  value: ConsumerProductResult,
  expectedProductId: string
): ConsumerProductResult | null {
  const redacted = pickPublic(value, CONSUMER_RESULT_SCHEMA) as ConsumerProductResult;
  if (
    redacted.version !== "consumer_product_result_v1" ||
    redacted.product?.id !== expectedProductId ||
    value.product?.id !== expectedProductId
  ) {
    return null;
  }

  return redacted;
}

export function redactApplicationResponse(
  response: ProductAnalysisResponse,
  expectedProductId?: string
): ProductAnalysisResponse {
  if (response.status !== "completed") return { ...response };
  const result = redactConsumerProductResult(
    response.result,
    expectedProductId ?? response.result.product.id
  );
  return result
    ? { status: "completed", result }
    : { status: "error", reason: "product_binding_mismatch" };
}
