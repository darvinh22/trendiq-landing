import type {
  ControlledProductCatalogResponse,
  ProductAnalysisResponse,
} from "../../app/lib/analysis/productAnalysisContract";
import { getControlledProductCatalog } from "./controlledProductCatalog";
import type { ProductAnalysisOrchestrator } from "./productAnalysisOrchestrator";

export type ProductAnalysisService = Pick<
  ProductAnalysisOrchestrator,
  "analyzeProduct" | "getAnalysisStatus"
>;

export interface ProductAnalysisApiRequest {
  method: string;
  pathname: string;
  body?: unknown;
}

export interface ProductAnalysisApiResult {
  statusCode: number;
  body: ProductAnalysisResponse | ControlledProductCatalogResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statusCodeFor(response: ProductAnalysisResponse): number {
  if (response.status === "pending") return 202;
  if (response.status === "completed") return 200;
  if (response.reason === "product_not_supported" || response.reason === "analysis_not_found") return 404;
  if (response.reason === "invalid_request") return 400;
  return response.status === "unavailable" ? 503 : 500;
}

function validStartBody(body: unknown): body is { productId: string } {
  if (!isRecord(body)) return false;
  const keys = Object.keys(body);
  return keys.length === 1 &&
    keys[0] === "productId" &&
    typeof body.productId === "string" &&
    /^[a-z0-9][a-z0-9-]{0,63}$/.test(body.productId);
}

export function handleProductAnalysisApiRequest(
  request: ProductAnalysisApiRequest,
  orchestrator: ProductAnalysisService
): ProductAnalysisApiResult {
  if (request.method === "GET" && request.pathname === "/api/product-analysis/catalog") {
    return { statusCode: 200, body: getControlledProductCatalog() };
  }

  if (request.method === "POST" && request.pathname === "/api/product-analysis") {
    if (!validStartBody(request.body)) {
      return { statusCode: 400, body: { status: "error", reason: "invalid_request" } };
    }
    const body = orchestrator.analyzeProduct(request.body.productId);
    return { statusCode: statusCodeFor(body), body };
  }

  if (request.method === "GET" && request.pathname.startsWith("/api/product-analysis/")) {
    const analysisId = decodeURIComponent(request.pathname.slice("/api/product-analysis/".length));
    if (!/^analysis_[A-Za-z0-9_-]{8,128}$/.test(analysisId)) {
      return { statusCode: 400, body: { status: "error", reason: "invalid_request" } };
    }
    const body = orchestrator.getAnalysisStatus(analysisId);
    return { statusCode: statusCodeFor(body), body };
  }

  return { statusCode: 400, body: { status: "error", reason: "invalid_request" } };
}
