import type { ConsumerProductResult } from "../data/consumerResult";

export interface ControlledProductCatalogItem {
  productId: string;
  displayName: string;
  brand: string;
  category: string;
}

export interface ControlledProductCatalogResponse {
  version: "controlled_product_catalog_v1";
  products: ControlledProductCatalogItem[];
}

export type ProductAnalysisSafeReason =
  | "analysis_deadline_exceeded"
  | "analysis_disabled"
  | "analysis_failed"
  | "analysis_not_found"
  | "daily_capacity_reached"
  | "evidence_unavailable"
  | "invalid_request"
  | "open_analysis_disabled"
  | "process_paid_operation_ceiling_exhausted"
  | "product_binding_mismatch"
  | "product_not_supported"
  | "rate_limited"
  | "resolution_not_found"
  | "runtime_not_ready";

export type OpenAbstainPublicReason =
  | "accessory"
  | "bundle"
  | "low_confidence"
  | "not_found"
  | "prohibited"
  | "query_not_actionable"
  | "used";

export interface OpenResolveCandidate {
  candidateId: string;
  title: string;
  brand: string | null;
}

export type ProductResolveResponse =
  | {
      status: "resolved";
      resolutionId: string;
      title: string;
      brand: string | null;
      model: string | null;
      evidenceDate: string;
      priceEvidenceDate: string | null;
      priceStatus: "fresh" | "stale" | "missing";
      cached: boolean;
    }
  | {
      status: "ambiguous";
      resolutionId: string;
      evidenceDate: string;
      candidates: OpenResolveCandidate[];
    }
  | { status: "abstain"; reason: OpenAbstainPublicReason; message: string }
  | {
      status: "unavailable";
      reason: "open_analysis_disabled" | "daily_capacity_reached" | "rate_limited" | "runtime_not_ready";
    }
  | { status: "error"; reason: "invalid_request" | "analysis_failed" };

export type ProductAnalysisResponse =
  | { status: "completed"; result: ConsumerProductResult }
  | { status: "pending"; analysisId: string }
  | { status: "unavailable"; reason: ProductAnalysisSafeReason }
  | { status: "error"; reason: ProductAnalysisSafeReason };

export interface ProductAnalysisStartRequest {
  productId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SAFE_REASONS = new Set<ProductAnalysisSafeReason>([
  "analysis_deadline_exceeded",
  "analysis_disabled",
  "analysis_failed",
  "analysis_not_found",
  "daily_capacity_reached",
  "evidence_unavailable",
  "invalid_request",
  "open_analysis_disabled",
  "process_paid_operation_ceiling_exhausted",
  "product_binding_mismatch",
  "product_not_supported",
  "rate_limited",
  "resolution_not_found",
  "runtime_not_ready",
]);

const RESOLVE_CANDIDATE_KEYS = ["brand", "candidateId", "title"];
const ABSTAIN_REASONS = new Set<OpenAbstainPublicReason>([
  "accessory", "bundle", "low_confidence", "not_found", "prohibited", "query_not_actionable", "used",
]);

const CATALOG_RESPONSE_KEYS = ["products", "version"];
const CATALOG_ITEM_KEYS = ["brand", "category", "displayName", "productId"];

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

export function parseControlledProductCatalogResponse(value: unknown): ControlledProductCatalogResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, CATALOG_RESPONSE_KEYS) ||
    value.version !== "controlled_product_catalog_v1" ||
    !Array.isArray(value.products)
  ) {
    return null;
  }

  const products: ControlledProductCatalogItem[] = [];
  for (const product of value.products) {
    if (
      !isRecord(product) ||
      !hasExactKeys(product, CATALOG_ITEM_KEYS) ||
      typeof product.productId !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(product.productId) ||
      typeof product.displayName !== "string" ||
      !product.displayName.trim() ||
      typeof product.brand !== "string" ||
      !product.brand.trim() ||
      typeof product.category !== "string" ||
      !product.category.trim()
    ) {
      return null;
    }
    products.push({
      productId: product.productId,
      displayName: product.displayName,
      brand: product.brand,
      category: product.category,
    });
  }

  return { version: "controlled_product_catalog_v1", products };
}

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

const RESOLUTION_ID = /^resolution_[a-z0-9]{16,64}$/;
const CANDIDATE_ID = /^cand_[a-z0-9]{8,64}$/;

export function parseProductResolveResponse(value: unknown): ProductResolveResponse | null {
  if (!isRecord(value) || typeof value.status !== "string") return null;
  if (value.status === "resolved") {
    if (!hasExactKeys(value, [
      "brand", "cached", "evidenceDate", "model", "priceEvidenceDate", "priceStatus", "resolutionId", "status", "title",
    ])) return null;
    if (
      !RESOLUTION_ID.test(String(value.resolutionId)) ||
      typeof value.title !== "string" ||
      !value.title.trim() ||
      !nullableText(value.brand) ||
      !nullableText(value.model) ||
      typeof value.evidenceDate !== "string" ||
      !Number.isFinite(Date.parse(value.evidenceDate)) ||
      (value.priceEvidenceDate !== null && (typeof value.priceEvidenceDate !== "string" || !Number.isFinite(Date.parse(value.priceEvidenceDate)))) ||
      (value.priceStatus !== "fresh" && value.priceStatus !== "stale" && value.priceStatus !== "missing") ||
      typeof value.cached !== "boolean"
    ) return null;
    return {
      status: "resolved",
      resolutionId: value.resolutionId,
      title: value.title,
      brand: value.brand as string | null,
      model: value.model as string | null,
      evidenceDate: value.evidenceDate,
      priceEvidenceDate: value.priceEvidenceDate as string | null,
      priceStatus: value.priceStatus,
      cached: value.cached,
    };
  }
  if (value.status === "ambiguous") {
    if (!hasExactKeys(value, ["candidates", "evidenceDate", "resolutionId", "status"])) return null;
    if (!RESOLUTION_ID.test(String(value.resolutionId)) || typeof value.evidenceDate !== "string" || !Array.isArray(value.candidates)) {
      return null;
    }
    if (value.candidates.length < 1 || value.candidates.length > 3) return null;
    const candidates: OpenResolveCandidate[] = [];
    for (const candidate of value.candidates) {
      if (!isRecord(candidate) || !hasExactKeys(candidate, RESOLVE_CANDIDATE_KEYS)) return null;
      if (!CANDIDATE_ID.test(String(candidate.candidateId)) || typeof candidate.title !== "string" || !candidate.title.trim() || !nullableText(candidate.brand)) {
        return null;
      }
      candidates.push({
        candidateId: candidate.candidateId,
        title: candidate.title,
        brand: candidate.brand as string | null,
      });
    }
    return { status: "ambiguous", resolutionId: value.resolutionId, evidenceDate: value.evidenceDate, candidates };
  }
  if (value.status === "abstain") {
    if (!hasExactKeys(value, ["message", "reason", "status"])) return null;
    if (typeof value.reason !== "string" || !ABSTAIN_REASONS.has(value.reason as OpenAbstainPublicReason)) return null;
    if (typeof value.message !== "string" || !value.message.trim()) return null;
    return { status: "abstain", reason: value.reason as OpenAbstainPublicReason, message: value.message };
  }
  if (value.status === "unavailable") {
    if (!hasExactKeys(value, ["reason", "status"])) return null;
    if (
      value.reason !== "open_analysis_disabled" &&
      value.reason !== "daily_capacity_reached" &&
      value.reason !== "rate_limited" &&
      value.reason !== "runtime_not_ready"
    ) return null;
    return { status: "unavailable", reason: value.reason };
  }
  if (value.status === "error") {
    if (!hasExactKeys(value, ["reason", "status"])) return null;
    if (value.reason !== "invalid_request" && value.reason !== "analysis_failed") return null;
    return { status: "error", reason: value.reason };
  }
  return null;
}

function nullableText(value: unknown): boolean {
  return value === null || (typeof value === "string" && value.trim().length > 0);
}
