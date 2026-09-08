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
  | "evidence_unavailable"
  | "invalid_request"
  | "process_paid_operation_ceiling_exhausted"
  | "product_binding_mismatch"
  | "product_not_supported"
  | "runtime_not_ready";

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
  "evidence_unavailable",
  "invalid_request",
  "process_paid_operation_ceiling_exhausted",
  "product_binding_mismatch",
  "product_not_supported",
  "runtime_not_ready",
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
