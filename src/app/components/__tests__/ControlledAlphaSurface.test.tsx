import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ControlledCatalogView,
  filterControlledCatalog,
  loadControlledCatalog,
} from "../../App";
import type { ProductAnalysisClient } from "../../lib/analysis/productAnalysisClient";
import type { ControlledProductCatalogItem } from "../../lib/analysis/productAnalysisContract";

const product: ControlledProductCatalogItem = {
  productId: "ray-ban-meta",
  displayName: "Ray-Ban Meta Glasses",
  brand: "Ray-Ban",
  category: "Tech",
};
const catalog = { version: "controlled_product_catalog_v1" as const, products: [product] };

function renderCatalog(query = ""): string {
  return renderToStaticMarkup(
    <ControlledCatalogView
      products={catalog.products}
      searchQuery={query}
      onSearchChange={() => undefined}
      onSelect={() => undefined}
    />
  );
}

describe("controlled external alpha surface", () => {
  it("renders only the controlled catalog and none of the legacy intelligence surfaces", () => {
    const html = renderCatalog();
    expect(html).toContain("Ray-Ban Meta Glasses");
    expect(html).toContain("CONTROLLED ALPHA");

    for (const forbidden of [
      "TrendIQ Score",
      "TREND HISTORY",
      "TRENDIQ SAYS",
      "TIKTOK SAYS",
      "REDDIT SENTIMENT",
      "$299",
      "Best For",
      "Compare",
      "For You",
      "Similar Alternatives",
      "Oura Ring",
      "Bambu Lab",
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("filters only the supplied controlled metadata without triggering work", () => {
    expect(filterControlledCatalog(catalog.products, "ray-ban")).toEqual([product]);
    expect(filterControlledCatalog(catalog.products, "tech")).toEqual([product]);
    expect(filterControlledCatalog(catalog.products, "arbitrary unknown product")).toEqual([]);
    expect(renderCatalog("arbitrary unknown product")).toContain("No controlled products match");
  });

  it("loads the catalog without starting or polling an analysis", async () => {
    const listCatalog = vi.fn(async () => catalog);
    const start = vi.fn();
    const getStatus = vi.fn();
    const client = { listCatalog, start, getStatus } as unknown as ProductAnalysisClient;

    await expect(loadControlledCatalog(client)).resolves.toEqual(catalog);
    expect(listCatalog).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("keeps legacy detail and provider/server modules out of the browser entry boundary", () => {
    const sources = [
      "src/main.tsx",
      "src/app/App.tsx",
      "src/app/components/ProductAnalysisScreen.tsx",
      "src/app/components/ConsumerResultPanel.tsx",
      "src/app/lib/analysis/productAnalysisClient.ts",
      "src/app/lib/analysis/productAnalysisContract.ts",
      "src/app/lib/presentation/consumerResultViewModel.ts",
    ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8")).join("\n");

    expect(sources).not.toMatch(/from\s+["'][^"']*server\//);
    expect(sources).not.toMatch(/from\s+["'][^"']*(?:providers|search\/client|reviews\/client)/);
    expect(sources).not.toMatch(/ProductDetail|CompareScreen|ForYouScreen|ProductCard|components\/data/);
  });
});
