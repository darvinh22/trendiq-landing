import type { ConsumerProductResult } from "../../../app/lib/data/consumerResult";
import { buildConsumerProductResult } from "../../../app/lib/data/consumerResult";
import { buildRecommendationResult } from "../../../app/lib/data/recommendationEngine";
import { buildRevenueMvpResult } from "../../../app/lib/data/revenueMvpResult";
import type { ProductTrendSnapshot } from "../../../app/lib/data/types";

export const OPEN_ABSTENTION_SUMMARIES = {
  budget: "The analysis stopped because it reached its cost limit, so TrendIQ is not making a recommendation.",
  evidence: "Evidence collection stopped before there was enough support, so TrendIQ is not making a recommendation.",
  timeout: "The analysis timed out before there was enough evidence, so TrendIQ is not making a recommendation.",
} as const;

export function buildOpenAbstentionResult(input: {
  productId: string;
  title: string;
  brand?: string;
  category?: string;
  evaluatedAt: string;
  summary: string;
}): ConsumerProductResult | null {
  const revenue = buildRevenueMvpResult({
    snapshot: {
      productId: input.productId,
      timestamp: input.evaluatedAt,
      sourceMode: "live",
      rawSignals: [],
      aggregatedSignals: {},
      provenance: { generatedAt: input.evaluatedAt, sources: [] },
    } as unknown as ProductTrendSnapshot,
    product: {
      productId: input.productId,
      canonicalTitle: input.title,
      brand: input.brand,
      category: input.category ?? "General",
      query: input.title,
    },
  });
  const recommendation = buildRecommendationResult({
    revenueMvpResult: revenue,
    productId: input.productId,
    evaluatedAt: input.evaluatedAt,
  });
  if (recommendation.recommendation !== "NO_RECOMMENDATION") return null;
  const consumer = buildConsumerProductResult({
    recommendationResult: recommendation,
    productId: input.productId,
  });
  if (consumer.product.id !== input.productId) return null;
  if (consumer.issues.includes("CONSUMER_INPUT_MALFORMED") || consumer.issues.includes("CONSUMER_PRODUCT_BINDING_MISMATCH")) {
    return null;
  }
  return {
    ...consumer,
    decision: {
      ...consumer.decision,
      recommendation: "NO_RECOMMENDATION",
      summary: input.summary,
    },
  };
}

export function withEvidenceNotes(result: ConsumerProductResult, notes: readonly string[]): ConsumerProductResult {
  const extra = notes.map((note) => note.trim()).filter(Boolean);
  if (!extra.length) return result;
  return {
    ...result,
    explanation: {
      ...result.explanation,
      watchOuts: [...result.explanation.watchOuts, ...extra],
    },
  };
}
