import { describe, expect, it } from "vitest";
import { mapDataForSeoGoogleShoppingProductsResponse } from "../client";
import type { ReviewProductIdentityConfig } from "../types";

const fetchedAt = "2026-08-21T23:47:20.000Z";

function identity(overrides: Partial<ReviewProductIdentityConfig>): ReviewProductIdentityConfig {
  return {
    productId: overrides.productId ?? "synthetic-product",
    canonicalSearchQuery: overrides.canonicalSearchQuery ?? overrides.productTitle ?? "Synthetic Product",
    productTitle: overrides.productTitle ?? overrides.canonicalSearchQuery ?? "Synthetic Product",
    brand: overrides.brand ?? "Synthetic",
    generation: overrides.generation,
    acceptedSellers: overrides.acceptedSellers,
    providerProductIds: overrides.providerProductIds,
  };
}

function productsResponse(items: unknown[]) {
  return {
    status_code: 20000,
    status_message: "Ok.",
    tasks_error: 0,
    tasks: [
      {
        status_code: 20000,
        status_message: "Ok.",
        result_count: 1,
        result: [
          {
            datetime: "2026-08-21 23:47:20 +00:00",
            items,
          },
        ],
      },
    ],
  };
}

function item(title: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "google_shopping_serp",
    rank_group: 1,
    rank_absolute: 1,
    title,
    seller: "Example Seller",
    product_rating: {
      value: 4.5,
      rating_max: 5,
      votes_count: 120,
    },
    ...overrides,
  };
}

function selectAggregate(productIdentity: ReviewProductIdentityConfig, items: unknown[]) {
  return mapDataForSeoGoogleShoppingProductsResponse({
    response: productsResponse(items),
    productId: productIdentity.productId,
    identity: productIdentity,
    locationCode: 2840,
    languageCode: "en",
    fetchedAt,
    minimumMatchConfidence: "low",
  });
}

function expectNoSelection(productIdentity: ReviewProductIdentityConfig, items: unknown[]) {
  expect(() => selectAggregate(productIdentity, items))
    .toThrow("high-confidence rated product match");
}

describe("product-agnostic Google Shopping reviews end-to-end validation", () => {
  it("validates wearable generation matching through client selection", () => {
    const garmin = identity({
      productId: "synthetic-garmin-venu-4",
      canonicalSearchQuery: "Garmin Venu 4",
      productTitle: "Garmin Venu 4",
      brand: "Garmin",
      generation: "Venu 4",
    });

    expect(selectAggregate(garmin, [item("Garmin Venu 4 GPS Smartwatch")]).matchedProductTitle)
      .toBe("Garmin Venu 4 GPS Smartwatch");
    expectNoSelection(garmin, [item("Garmin Venu 3 GPS Smartwatch")]);
    expectNoSelection(garmin, [item("Garmin Venu Smartwatch")]);
    expectNoSelection(garmin, [item("Garmin Venu 4 charging cable accessory")]);
  });

  it("validates cosmetic variants without letting category or family-only evidence select", () => {
    const samsung = identity({
      productId: "synthetic-samsung-galaxy-ring",
      canonicalSearchQuery: "Samsung Galaxy Ring",
      productTitle: "Samsung Galaxy Ring",
      brand: "Samsung",
      generation: "Galaxy Ring",
    });

    expect(selectAggregate(samsung, [item("Samsung Galaxy Ring Size 9 Gold")]).matchedProductTitle)
      .toBe("Samsung Galaxy Ring Size 9 Gold");
    expectNoSelection(samsung, [item("Samsung Ring")]);
    expectNoSelection(samsung, [item("Samsung Galaxy Watch")]);
  });

  it("validates meaningful family model differences and listing guardrails", () => {
    const ninja = identity({
      productId: "synthetic-ninja-creami-swirl",
      canonicalSearchQuery: "Ninja Creami Swirl",
      productTitle: "Ninja Creami Swirl",
      brand: "Ninja",
      generation: "Creami Swirl",
    });

    expect(selectAggregate(ninja, [item("Ninja Creami Swirl Ice Cream Maker")]).matchedProductTitle)
      .toBe("Ninja Creami Swirl Ice Cream Maker");
    expectNoSelection(ninja, [item("Ninja Creami Ice Cream Maker")]);
    expectNoSelection(ninja, [item("Ninja Creami Deluxe Ice Cream Maker")]);
    expectNoSelection(ninja, [item("Ninja Creami Swirl bundle with accessory kit")]);
  });

  it("validates a fully synthetic unregistered product identity through the client boundary", () => {
    const acme = identity({
      productId: "synthetic-acme-flux-pro-7",
      canonicalSearchQuery: "Acme Flux Pro 7 Headphones",
      productTitle: "Acme Flux Pro 7 Headphones",
      brand: "Acme",
      generation: "Flux Pro 7",
    });
    const verifiedAcme = identity({
      ...acme,
      providerProductIds: {
        gid: "acme-flux-pro-7-gid",
        matchConfidence: "high",
      },
    });
    const unverifiedAcme = identity({
      ...acme,
      providerProductIds: {
        gid: "acme-flux-pro-7-gid",
        matchConfidence: "medium",
      },
    });

    expect(selectAggregate(acme, [item("Acme Flux Pro 7 Headphones")]).matchedProductTitle)
      .toBe("Acme Flux Pro 7 Headphones");
    expectNoSelection(acme, [item("Globex Flux Pro 7 Headphones")]);
    expectNoSelection(acme, [item("Acme Flux Pro 6 Headphones")]);
    expectNoSelection(acme, [item("Acme Headphones")]);
    expectNoSelection(acme, [item("Acme Headphone")]);
    expect(selectAggregate(verifiedAcme, [
      item("Flux listing", { gid: "acme-flux-pro-7-gid" }),
    ]).matchedProductTitle).toBe("Flux listing");
    expectNoSelection(unverifiedAcme, [
      item("Flux listing", { gid: "acme-flux-pro-7-gid" }),
    ]);
  });
});
