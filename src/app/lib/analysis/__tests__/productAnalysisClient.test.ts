import { afterEach, describe, expect, it, vi } from "vitest";
import { productAnalysisClient } from "../productAnalysisClient";
import { parseControlledProductCatalogResponse } from "../productAnalysisContract";

const catalog = {
  version: "controlled_product_catalog_v1",
  products: [{
    productId: "ray-ban-meta",
    displayName: "Ray-Ban Meta Glasses",
    brand: "Ray-Ban",
    category: "Tech",
  }],
};

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("product analysis browser client", () => {
  it("loads the public catalog with a read-only request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(catalog));
    vi.stubGlobal("fetch", fetchMock);

    await expect(productAnalysisClient.listCatalog()).resolves.toEqual(catalog);
    expect(fetchMock).toHaveBeenCalledWith("/api/product-analysis/catalog", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  });

  it("sends exactly productId when the user starts analysis", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: "pending", analysisId: "analysis_fixture123" }));
    vi.stubGlobal("fetch", fetchMock);

    await productAnalysisClient.start("ray-ban-meta");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/product-analysis");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ productId: "ray-ban-meta" });
    expect(Object.keys(JSON.parse(String(init.body)))).toEqual(["productId"]);
  });

  it("distinguishes a retryable browser request failure from a settled analysis failure", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(jsonResponse({ status: "error", reason: "analysis_failed" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(productAnalysisClient.start("ray-ban-meta")).resolves.toEqual({
      status: "error",
      reason: "request_failed",
    });
    await expect(productAnalysisClient.start("ray-ban-meta")).resolves.toEqual({
      status: "error",
      reason: "analysis_failed",
    });
  });

  it("rejects catalog records with any extra or unsafe field", () => {
    expect(parseControlledProductCatalogResponse({
      ...catalog,
      products: [{ ...catalog.products[0], providerProductId: "must-not-pass" }],
    })).toBeNull();
    expect(parseControlledProductCatalogResponse({
      ...catalog,
      products: [{ ...catalog.products[0], aliases: ["provider query"] }],
    })).toBeNull();
  });
});
