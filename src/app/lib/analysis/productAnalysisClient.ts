import {
  parseProductAnalysisResponse,
  type ProductAnalysisResponse,
} from "./productAnalysisContract";

export interface ProductAnalysisClient {
  start(productId: string): Promise<ProductAnalysisResponse>;
  getStatus(analysisId: string): Promise<ProductAnalysisResponse>;
}

async function readResponse(response: Response): Promise<ProductAnalysisResponse> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "error", reason: "analysis_failed" };
  }

  return parseProductAnalysisResponse(body) ?? { status: "error", reason: "analysis_failed" };
}

export const productAnalysisClient: ProductAnalysisClient = {
  async start(productId) {
    try {
      return readResponse(await fetch("/api/product-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      }));
    } catch {
      return { status: "error", reason: "analysis_failed" };
    }
  },

  async getStatus(analysisId) {
    try {
      return readResponse(await fetch(`/api/product-analysis/${encodeURIComponent(analysisId)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      }));
    } catch {
      return { status: "error", reason: "analysis_failed" };
    }
  },
};
