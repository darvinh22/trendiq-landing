import type { ConsumerProductResult } from "../data/consumerResult";

export const CONTROLLED_ANALYSIS_PRODUCT_IDS = ["ray-ban-meta"] as const;

export type ProductAnalysisSafeReason =
  | "analysis_failed"
  | "analysis_not_found"
  | "evidence_unavailable"
  | "invalid_request"
  | "product_binding_mismatch"
  | "product_not_supported";

export type ProductAnalysisResponse =
  | { status: "completed"; result: ConsumerProductResult }
  | { status: "pending"; analysisId: string }
  | { status: "unavailable"; reason: ProductAnalysisSafeReason }
  | { status: "error"; reason: ProductAnalysisSafeReason };

export interface ProductAnalysisStartRequest {
  productId: string;
}

export function isControlledAnalysisProductId(productId: string): boolean {
  return (CONTROLLED_ANALYSIS_PRODUCT_IDS as readonly string[]).includes(productId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SAFE_REASONS = new Set<ProductAnalysisSafeReason>([
  "analysis_failed",
  "analysis_not_found",
  "evidence_unavailable",
  "invalid_request",
  "product_binding_mismatch",
  "product_not_supported",
]);

export function parseProductAnalysisResponse(value: unknown): ProductAnalysisResponse | null {
  if (!isRecord(value) || typeof value.status !== "string") return null;

  if (value.status === "pending") {
    return typeof value.analysisId === "string" && /^analysis_[A-Za-z0-9_-]{8,128}$/.test(value.analysisId)
      ? { status: "pending", analysisId: value.analysisId }
      : null;
  }

  if (value.status === "completed") {
    if (!isRecord(value.result) || value.result.version !== "consumer_product_result_v1") return null;
    return { status: "completed", result: value.result as unknown as ConsumerProductResult };
  }

  if (value.status === "unavailable" || value.status === "error") {
    if (typeof value.reason !== "string" || !SAFE_REASONS.has(value.reason as ProductAnalysisSafeReason)) return null;
    return { status: value.status, reason: value.reason as ProductAnalysisSafeReason };
  }

  return null;
}
