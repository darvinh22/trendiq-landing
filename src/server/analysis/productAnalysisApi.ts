import type {
  ControlledProductCatalogResponse,
  ProductAnalysisResponse,
  ProductResolveResponse,
} from "../../app/lib/analysis/productAnalysisContract";
import { getControlledProductCatalog } from "./controlledProductCatalog";
import type { ProductResolveApiResult } from "./openAnalysis/openAnalysisService";
import type { ProductAnalysisOrchestrator } from "./productAnalysisOrchestrator";

export type ProductAnalysisService = Pick<
  ProductAnalysisOrchestrator,
  "analyzeProduct" | "getAnalysisStatus"
>;

export interface ProductAnalysisApiRequest {
  method: string;
  pathname: string;
  body?: unknown;
  clientKey?: string;
}

export interface ProductAnalysisApiResult {
  statusCode: number;
  body: ProductAnalysisResponse | ControlledProductCatalogResponse | ProductResolveResponse;
}

export interface OpenProductAnalysisApi extends ProductAnalysisService {
  resolveOpenProduct(input: { query: string; clientKey?: string }): Promise<ProductResolveApiResult>;
  analyzeResolution(input: {
    resolutionId: string;
    candidateId?: string;
    clientKey?: string;
  }): Promise<ProductAnalysisResponse>;
  readPersistedAnalysis(analysisId: string): Promise<ProductAnalysisResponse | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statusCodeFor(response: ProductAnalysisResponse): number {
  if (response.status === "pending") return 202;
  if (response.status === "completed") return 200;
  if (
    response.reason === "product_not_supported" ||
    response.reason === "analysis_not_found" ||
    response.reason === "resolution_not_found"
  ) return 404;
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

function validQueryBody(body: unknown): body is { query: string } {
  if (!isRecord(body)) return false;
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === "query" && typeof body.query === "string";
}

function validResolutionBody(body: unknown): body is { resolutionId: string; candidateId?: string } {
  if (!isRecord(body)) return false;
  const keys = Object.keys(body).sort();
  const resolutionOnly = keys.length === 1 && keys[0] === "resolutionId";
  const withCandidate = keys.length === 2 && keys[0] === "candidateId" && keys[1] === "resolutionId";
  if (!resolutionOnly && !withCandidate) return false;
  if (typeof body.resolutionId !== "string" || !/^resolution_[a-z0-9]{16,64}$/.test(body.resolutionId)) return false;
  if (withCandidate && (typeof body.candidateId !== "string" || !/^cand_[a-z0-9]{8,64}$/.test(body.candidateId))) {
    return false;
  }
  return true;
}

export async function dispatchProductAnalysisApi(
  request: ProductAnalysisApiRequest,
  runtime: OpenProductAnalysisApi
): Promise<ProductAnalysisApiResult> {
  if (request.pathname === "/api/product-resolve") {
    if (request.method !== "POST" || !validQueryBody(request.body)) {
      return { statusCode: 400, body: { status: "error", reason: "invalid_request" } };
    }
    return runtime.resolveOpenProduct({ query: request.body.query, clientKey: request.clientKey });
  }

  if (request.method === "POST" && request.pathname === "/api/product-analysis" && validResolutionBody(request.body)) {
    const body = await runtime.analyzeResolution({
      resolutionId: request.body.resolutionId,
      candidateId: request.body.candidateId,
      clientKey: request.clientKey,
    });
    return { statusCode: statusCodeFor(body), body };
  }

  const sync = handleProductAnalysisApiRequest(request, runtime);
  if (
    request.method === "GET" &&
    sync.statusCode === 404 &&
    "reason" in sync.body &&
    sync.body.reason === "analysis_not_found"
  ) {
    const analysisId = decodeURIComponent(request.pathname.slice("/api/product-analysis/".length));
    const persisted = await runtime.readPersistedAnalysis(analysisId);
    if (persisted) return { statusCode: statusCodeFor(persisted), body: persisted };
  }
  return sync;
}
