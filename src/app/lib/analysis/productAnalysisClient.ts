import {
  parseControlledProductCatalogResponse,
  parseProductAnalysisResponse,
  type ControlledProductCatalogResponse,
  type ProductAnalysisResponse,
} from "./productAnalysisContract";

export type ProductAnalysisClientResponse =
  | ProductAnalysisResponse
  | { status: "error"; reason: "request_failed" };

export interface ProductAnalysisClient {
  listCatalog(): Promise<ControlledProductCatalogResponse | null>;
  start(productId: string): Promise<ProductAnalysisClientResponse>;
  getStatus(analysisId: string): Promise<ProductAnalysisClientResponse>;
}

export type ProductAnalysisExecutionClient = Pick<ProductAnalysisClient, "start" | "getStatus">;

async function readResponse(response: Response): Promise<ProductAnalysisClientResponse> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "error", reason: "request_failed" };
  }

  return parseProductAnalysisResponse(body) ?? { status: "error", reason: "request_failed" };
}

export const productAnalysisClient: ProductAnalysisClient = {
  async listCatalog() {
    try {
      const response = await fetch("/api/product-analysis/catalog", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      return parseControlledProductCatalogResponse(await response.json());
    } catch {
      return null;
    }
  },

  async start(productId) {
    try {
      return readResponse(await fetch("/api/product-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      }));
    } catch {
      return { status: "error", reason: "request_failed" };
    }
  },

  async getStatus(analysisId) {
    try {
      return readResponse(await fetch(`/api/product-analysis/${encodeURIComponent(analysisId)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      }));
    } catch {
      return { status: "error", reason: "request_failed" };
    }
  },
};
