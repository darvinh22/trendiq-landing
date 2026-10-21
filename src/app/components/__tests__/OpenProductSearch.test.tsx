import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ControlledCatalogView } from "../../App";
import type { ControlledProductCatalogItem } from "../../lib/analysis/productAnalysisContract";
import { ProductAnalysisView } from "../ProductAnalysisScreen";
import { OpenProductSearchView } from "../OpenProductSearch";

const product: ControlledProductCatalogItem = {
  productId: "ray-ban-meta",
  displayName: "Ray-Ban Meta Glasses",
  brand: "Ray-Ban",
  category: "Tech",
};

describe("open product search surface", () => {
  it("keeps the free-text entry off the catalog unless the caller opts in", () => {
    const plain = renderToStaticMarkup(
      <ControlledCatalogView
        products={[product]}
        searchQuery=""
        onSearchChange={() => undefined}
        onSelect={() => undefined}
      />
    );
    expect(plain).not.toContain("Analyze a product by name");

    const optedIn = renderToStaticMarkup(
      <ControlledCatalogView
        products={[product]}
        searchQuery=""
        onSearchChange={() => undefined}
        onSelect={() => undefined}
        onOpenQuery={() => undefined}
      />
    );
    expect(optedIn).toContain("Analyze a product by name");
    expect(optedIn).not.toContain("Oura Ring");
    expect(optedIn).not.toContain("Bambu Lab");
  });

  it("shows an evidence date and refuses to analyze an ambiguous name before a choice", () => {
    const html = renderToStaticMarkup(
      <OpenProductSearchView
        state={{
          phase: "ambiguous",
          response: {
            status: "ambiguous",
            resolutionId: `resolution_${"a".repeat(32)}`,
            evidenceDate: "2026-10-21T00:00:00.000Z",
            candidates: [
              { candidateId: `cand_${"b".repeat(16)}`, title: "Example Phone", brand: "Example" },
              { candidateId: `cand_${"c".repeat(16)}`, title: "Example Phone Plus", brand: "Example" },
            ],
          },
        }}
        onQueryChange={() => undefined}
        onResolve={() => undefined}
        onConfirm={() => undefined}
        onChoose={() => undefined}
        onBack={() => undefined}
      />
    );
    expect(html).toContain("Nothing is analyzed until you choose.");
    expect(html).toContain("Evidence date: 2026-10-21T00:00:00.000Z");
    expect(html).toContain("Example Phone");
    expect(html).not.toContain("Analyze this product");
  });

  it("states a resolved product and its evidence date before analysis", () => {
    const html = renderToStaticMarkup(
      <OpenProductSearchView
        state={{
          phase: "resolved",
          response: {
            status: "resolved",
            resolutionId: `resolution_${"d".repeat(32)}`,
            title: "Example Headphones",
            brand: "Example",
            model: null,
            evidenceDate: "2026-10-21T00:00:00.000Z",
            priceEvidenceDate: null,
            priceStatus: "stale",
            cached: false,
          },
        }}
        onQueryChange={() => undefined}
        onResolve={() => undefined}
        onConfirm={() => undefined}
        onChoose={() => undefined}
        onBack={() => undefined}
      />
    );
    expect(html).toContain("We found: Example Headphones");
    expect(html).toContain("Evidence date: 2026-10-21T00:00:00.000Z");
    expect(html).toContain("older than 24 hours");
  });

  it("uses plain language for the new analysis limits", () => {
    for (const [reason, text] of [
      ["daily_capacity_reached", "capacity has been reached"],
      ["open_analysis_disabled", "not available right now"],
      ["rate_limited", "Too many analyses were requested"],
      ["resolution_not_found", "product choice expired"],
    ] as const) {
      const html = renderToStaticMarkup(
        <ProductAnalysisView
          product={product}
          state={{ phase: "unavailable", reason }}
          onAnalyze={() => undefined}
          onRetry={() => undefined}
          onBack={() => undefined}
        />
      );
      expect(html).toContain(text);
      expect(html).not.toContain(reason);
      expect(html).not.toMatch(/credential|authorization|provider|operator|server|polling|runtime|process budget|stack trace/i);
    }
  });
});
