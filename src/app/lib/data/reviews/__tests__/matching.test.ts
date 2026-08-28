import { describe, expect, it } from "vitest";
import { REVIEW_PRODUCT_IDENTITIES } from "../config";
import { evaluateGoogleShoppingProductMatch } from "../matching";
import type {
  GoogleShoppingProductCandidate,
  ReviewProductIdentityConfig,
} from "../types";

function identity(overrides: Partial<ReviewProductIdentityConfig> = {}): ReviewProductIdentityConfig {
  return {
    productId: "synthetic-widget-pro",
    canonicalSearchQuery: "Acme Widget Pro",
    productTitle: "Acme Widget Pro",
    brand: "Acme",
    generation: "Widget Pro",
    ...overrides,
  };
}

function candidate(
  title: string,
  overrides: Partial<GoogleShoppingProductCandidate> = {}
): GoogleShoppingProductCandidate {
  return {
    title,
    identifiers: {},
    averageRating: 4.4,
    ...overrides,
  };
}

describe("generic Google Shopping product review matching", () => {
  it("matches exact brand and exact model identity", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Acme Widget Pro"),
      identity()
    );

    expect(result.identityDecision).toBe("match");
    expect(result.confidence).toBe("high");
    expect(result.reasons).toContain("match_brand_model");
  });

  it("matches exact brand and model with cosmetic variant differences", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Acme Widget Pro Black"),
      identity()
    );

    expect(result.identityDecision).toBe("match");
    expect(result.reasons).toContain("match_brand_model");
    expect(result.reasons).not.toContain("needs_identity_ambiguous_variant");
  });

  it("keeps exact brand with partial model evidence at needs_identity", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Acme Widget"),
      identity()
    );

    expect(result.identityDecision).toBe("needs_identity");
    expect(result.confidence).toBe("low");
    expect(result.reasons).toContain("needs_identity_missing_model");
  });

  it("rejects correct-brand candidates with a wrong numeric generation", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Garmin Venu 3 GPS Smartwatch"),
      identity({
        productId: "synthetic-garmin-venu-4",
        canonicalSearchQuery: "Garmin Venu 4",
        productTitle: "Garmin Venu 4",
        brand: "Garmin",
        generation: "Venu 4",
      })
    );

    expect(result.identityDecision).toBe("reject");
    expect(result.confidence).toBe("rejected");
    expect(result.reasons).toContain("reject_generation_mismatch");
  });

  it("rejects wrong-brand candidates with similar model tokens", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Amazfit Venu 4 Smartwatch"),
      identity({
        productId: "synthetic-garmin-venu-4",
        canonicalSearchQuery: "Garmin Venu 4",
        productTitle: "Garmin Venu 4",
        brand: "Garmin",
        generation: "Venu 4",
      })
    );

    expect(result.identityDecision).toBe("reject");
    expect(result.reasons).toContain("reject_brand_contradiction");
  });

  it("keeps same-family variant uncertainty at needs_identity", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Acme Widget Mini"),
      identity({
        productId: "synthetic-widget",
        canonicalSearchQuery: "Acme Widget",
        productTitle: "Acme Widget",
        generation: "Widget",
      })
    );

    expect(result.identityDecision).toBe("needs_identity");
    expect(result.reasons).toContain("needs_identity_ambiguous_variant");
  });

  it("keeps matching category with ambiguous model evidence at needs_identity", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Acme Ring Mini"),
      identity({
        productId: "synthetic-ring",
        canonicalSearchQuery: "Acme Ring",
        productTitle: "Acme Ring",
        generation: "Ring",
      })
    );

    expect(result.identityDecision).toBe("needs_identity");
    expect(result.reasons).toContain("needs_identity_ambiguous_variant");
    expect(result.reasons).not.toContain("reject_category_contradiction");
  });

  it("matches a high-confidence verified provider identifier when there is no hard contradiction", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Widget listing", {
        identifiers: { gid: "verified-gid" },
      }),
      identity({
        providerProductIds: {
          productId: "verified-product",
          dataDocid: "verified-doc",
          gid: "verified-gid",
          matchConfidence: "high",
        },
      })
    );

    expect(result.identityDecision).toBe("match");
    expect(result.confidence).toBe("high");
    expect(result.reasons).toContain("match_verified_identifier:gid");
  });

  it("rejects explicit brand contradiction even with a verified provider identifier", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Amazfit Venu 4 Smartwatch", {
        identifiers: { gid: "verified-gid" },
      }),
      identity({
        productId: "synthetic-garmin-venu-4",
        canonicalSearchQuery: "Garmin Venu 4",
        productTitle: "Garmin Venu 4",
        brand: "Garmin",
        generation: "Venu 4",
        providerProductIds: {
          gid: "verified-gid",
          matchConfidence: "high",
        },
      })
    );

    expect(result.identityDecision).toBe("reject");
    expect(result.reasons).toContain("reject_brand_contradiction");
    expect(result.reasons).not.toContain("match_verified_identifier:gid");
  });

  it("keeps provider IDs at needs_identity when semantic product identity is uncertain", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Widget listing", {
        identifiers: { gid: "uncorroborated-gid" },
      }),
      identity()
    );

    expect(result.identityDecision).toBe("needs_identity");
    expect(result.reasons).toContain("needs_identity_provider_identifier_uncorroborated");
  });

  it("keeps missing brand evidence at needs_identity", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Widget Pro"),
      identity({
        brand: "",
        canonicalSearchQuery: "Widget Pro",
        productTitle: "Widget Pro",
        generation: "Widget Pro",
      })
    );

    expect(result.identityDecision).toBe("needs_identity");
    expect(result.reasons).toContain("needs_identity_missing_brand");
  });

  it("keeps missing model evidence at needs_identity", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Acme"),
      identity({
        canonicalSearchQuery: "Acme",
        productTitle: "Acme",
        generation: undefined,
      })
    );

    expect(result.identityDecision).toBe("needs_identity");
    expect(result.reasons).toContain("needs_identity_missing_model");
  });

  it("keeps ambiguous candidate titles at needs_identity", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Acme product"),
      identity()
    );

    expect(result.identityDecision).toBe("needs_identity");
    expect(result.reasons).toContain("needs_identity_missing_model");
  });

  it("rejects explicit product category contradictions from available title evidence", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Acme Watch"),
      identity({
        productId: "synthetic-ring",
        canonicalSearchQuery: "Acme Ring",
        productTitle: "Acme Ring",
        generation: "Ring",
      })
    );

    expect(result.identityDecision).toBe("reject");
    expect(result.reasons).toContain("reject_category_contradiction");
  });

  it("does not reject normal singular or plural category tokenization differences", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Acme Headphone Pro"),
      identity({
        productId: "synthetic-headphones",
        canonicalSearchQuery: "Acme Headphones Pro",
        productTitle: "Acme Headphones Pro",
        generation: "Headphones Pro",
      })
    );

    expect(result.identityDecision).not.toBe("reject");
    expect(result.reasons).not.toContain("reject_category_contradiction");
  });

  it("does not reject equivalent earbud and earbuds category tokenization", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Acme Earbud Pro"),
      identity({
        productId: "synthetic-earbuds",
        canonicalSearchQuery: "Acme Earbuds Pro",
        productTitle: "Acme Earbuds Pro",
        generation: "Earbuds Pro",
      })
    );

    expect(result.identityDecision).not.toBe("reject");
    expect(result.reasons).not.toContain("reject_category_contradiction");
  });

  it("still rejects clearly different explicit categories", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Acme Speaker Pro"),
      identity({
        productId: "synthetic-headphone",
        canonicalSearchQuery: "Acme Headphone Pro",
        productTitle: "Acme Headphone Pro",
        generation: "Headphone Pro",
      })
    );

    expect(result.identityDecision).toBe("reject");
    expect(result.reasons).toContain("reject_category_contradiction");
  });

  it("rejects accessories even with strong title overlap", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Charging case for Acme Widget Pro"),
      identity()
    );

    expect(result.identityDecision).toBe("reject");
    expect(result.reasons).toContain("excluded_accessory:case for");
  });

  it("rejects bundles even with exact model tokens", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Acme Widget Pro Bundle"),
      identity()
    );

    expect(result.identityDecision).toBe("reject");
    expect(result.reasons).toContain("excluded_bundle_or_kit:bundle");
  });

  it("lets semantic product evidence decide when listing IDs differ", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Acme Widget Pro", {
        seller: "Independent Retailer",
        identifiers: {
          productId: "retailer-product",
          dataDocid: "retailer-doc",
          gid: "retailer-gid",
        },
      }),
      identity({
        providerProductIds: {
          productId: "canonical-product",
          dataDocid: "canonical-doc",
          gid: "canonical-gid",
          matchConfidence: "high",
        },
      })
    );

    expect(result.identityDecision).toBe("match");
    expect(result.reasons).toContain("match_brand_model");
    expect(result.reasons).toContain("provider_identifier_mismatch_not_canonical");
    expect(result.reasons).not.toContain("persisted_provider_identifier_match");
  });

  it("preserves Ray-Ban regression behavior through generic evidence", () => {
    const result = evaluateGoogleShoppingProductMatch(
      candidate("Meta Ray-Ban Wayfarer", {
        seller: "Meta",
        identifiers: {
          productId: "11716803554991446550",
          dataDocid: "4690297997048968068",
          gid: "11193998885220934472",
        },
      }),
      REVIEW_PRODUCT_IDENTITIES["ray-ban-meta"]
    );

    expect(result.identityDecision).toBe("match");
    expect(result.confidence).toBe("high");
    expect(result.reasons).toContain("match_brand_model");
    expect(result.reasons).toContain("match_verified_identifier:productId");
    expect(result.reasons).not.toContain("missing_required_ray_ban_meta_identity");
  });
});
