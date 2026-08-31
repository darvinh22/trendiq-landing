import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DATAFORSEO_GOOGLE_SHOPPING_REVIEWS_TASK_POST_PATH,
  ReviewProviderError,
  buildDataForSeoGoogleShoppingReviewsRequestPlan,
  createEphemeralProviderIdentityFromAggregateObservation,
} from "../client";
import type {
  EphemeralProviderIdentity,
  GoogleShoppingProductIdentifier,
  GoogleShoppingReviewObservation,
  ProductMatchConfidence,
  ReviewIdentityDecision,
  ReviewProductIdentityConfig,
} from "../types";

interface ProductFixture {
  name: string;
  identity: ReviewProductIdentityConfig;
  candidateTitle: string;
  seller: string;
  identifiers: Required<GoogleShoppingProductIdentifier>;
}

const fetchedAt = "2026-09-01T12:00:00.000Z";

const productFixtures: ProductFixture[] = [
  {
    name: "Garmin Venu 4-like fixture",
    identity: {
      productId: "fixture-garmin-venu-4",
      canonicalSearchQuery: "Garmin Venu 4",
      productTitle: "Garmin Venu 4 GPS Smartwatch",
      brand: "Garmin",
      generation: "Venu 4",
    },
    candidateTitle: "Garmin Venu 4 GPS Smartwatch",
    seller: "Synthetic Electronics",
    identifiers: {
      gid: "gid-garmin-venu-4",
      productId: "product-garmin-venu-4",
      dataDocid: "doc-garmin-venu-4",
    },
  },
  {
    name: "Samsung Galaxy Ring-like fixture",
    identity: {
      productId: "fixture-samsung-galaxy-ring",
      canonicalSearchQuery: "Samsung Galaxy Ring",
      productTitle: "Samsung Galaxy Ring Smart Ring",
      brand: "Samsung",
      generation: "Galaxy Ring",
    },
    candidateTitle: "Samsung Galaxy Ring Smart Ring",
    seller: "Synthetic Mobile",
    identifiers: {
      gid: "gid-samsung-galaxy-ring",
      productId: "product-samsung-galaxy-ring",
      dataDocid: "doc-samsung-galaxy-ring",
    },
  },
  {
    name: "Ninja Creami Swirl-like fixture",
    identity: {
      productId: "fixture-ninja-creami-swirl",
      canonicalSearchQuery: "Ninja Creami Swirl",
      productTitle: "Ninja Creami Swirl Ice Cream Maker",
      brand: "Ninja",
      generation: "Creami Swirl",
    },
    candidateTitle: "Ninja Creami Swirl Ice Cream Maker",
    seller: "Synthetic Kitchen",
    identifiers: {
      gid: "gid-ninja-creami-swirl",
      productId: "product-ninja-creami-swirl",
      dataDocid: "doc-ninja-creami-swirl",
    },
  },
  {
    name: "generic synthetic fixture",
    identity: {
      productId: "fixture-acme-flux-pro-7",
      canonicalSearchQuery: "Acme Flux Pro 7",
      productTitle: "Acme Flux Pro 7 Device",
      brand: "Acme",
      generation: "Flux Pro 7",
    },
    candidateTitle: "Acme Flux Pro 7 Device",
    seller: "Synthetic Store",
    identifiers: {
      gid: "gid-acme-flux-pro-7",
      productId: "product-acme-flux-pro-7",
      dataDocid: "doc-acme-flux-pro-7",
    },
  },
];

function makeObservation(
  fixture = productFixtures[0],
  overrides: Partial<Omit<GoogleShoppingReviewObservation, "identifiers">> & {
    identifiers?: GoogleShoppingProductIdentifier;
  } = {}
): GoogleShoppingReviewObservation {
  const { identifiers, ...observationOverrides } = overrides;

  return {
    provider: "dataforseo",
    productId: fixture.identity.productId,
    searchQuery: fixture.identity.canonicalSearchQuery,
    locationCode: 2840,
    languageCode: "en",
    fetchedAt,
    sourceDatetime: "2026-09-01 12:00:00 +00:00",
    endpoint: "/v3/merchant/google/products/task_get/advanced/synthetic-task",
    matchedProductTitle: fixture.candidateTitle,
    seller: fixture.seller,
    identifiers: {
      ...fixture.identifiers,
      ...identifiers,
    },
    averageRating: 4.6,
    ratingMax: 5,
    writtenReviewCount: 42,
    ratingEvidenceCount: 100,
    ratingEvidenceSourceField: "product_rating.rating_count",
    ratingEvidenceComposition: "total_rating_count_with_written_reviews",
    matchConfidence: "high",
    matchScore: 0.98,
    matchReasons: ["title_token_coverage:100", "model_token_coverage:100", "match_brand_model"],
    providerVariantGrouping: "exact",
    rankGroup: 1,
    rankAbsolute: 1,
    isBestMatch: true,
    cost: 0.001,
    ...observationOverrides,
  };
}

function createReadyIdentity(fixture = productFixtures[0]): EphemeralProviderIdentity {
  const result = createEphemeralProviderIdentityFromAggregateObservation({
    observation: makeObservation(fixture),
    identity: fixture.identity,
    candidateMatchDecision: "match",
  });

  if (result.status !== "ready") {
    throw new Error(`Expected ready identity, received ${result.status}: ${result.reason}`);
  }

  return result.identity;
}

function buildPlan(fixture = productFixtures[0], ephemeralIdentity = createReadyIdentity(fixture)) {
  return buildDataForSeoGoogleShoppingReviewsRequestPlan({
    productId: fixture.identity.productId,
    identity: fixture.identity,
    ephemeralIdentity,
    locationCode: 2840,
    languageCode: "en",
    depth: 10,
  });
}

function clientSource() {
  return readFileSync(new URL("../client.ts", import.meta.url), "utf8");
}

function typesSource() {
  return readFileSync(new URL("../types.ts", import.meta.url), "utf8");
}

function testSource() {
  return readFileSync(new URL("./ephemeralIdentityHandoff.test.ts", import.meta.url), "utf8");
}

function handoffImplementationSource() {
  const source = clientSource();
  const start = source.indexOf("function providerIdentifierIssue");
  const end = source.indexOf("function selectRatingEvidence");

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe("ephemeral provider identity handoff", () => {
  it("creates an ephemeral identity from a high-confidence aggregate match", () => {
    const fixture = productFixtures[0];
    const result = createEphemeralProviderIdentityFromAggregateObservation({
      observation: makeObservation(fixture),
      identity: fixture.identity,
      candidateMatchDecision: "match",
    });

    expect(result).toEqual({
      status: "ready",
      identity: {
        provider: "dataforseo",
        productId: fixture.identity.productId,
        identifiers: fixture.identifiers,
        evidence: {
          source: "google_shopping_aggregate_candidate",
          matchDecision: "match",
          matchConfidence: "high",
          matchedProductTitle: fixture.candidateTitle,
          seller: fixture.seller,
          matchReasons: ["title_token_coverage:100", "model_token_coverage:100", "match_brand_model"],
          observedAt: fetchedAt,
        },
      },
    });
  });

  it.each(["medium", "low"] as const)(
    "does not hand off identity when aggregate confidence is %s",
    (matchConfidence: Exclude<ProductMatchConfidence, "rejected">) => {
      const fixture = productFixtures[0];
      const result = createEphemeralProviderIdentityFromAggregateObservation({
        observation: makeObservation(fixture, { matchConfidence }),
        identity: fixture.identity,
        candidateMatchDecision: "match",
      });

      expect(result).toEqual({
        status: "identity_inconclusive",
        reason: "candidate_match_confidence_not_high",
      });
    }
  );

  it.each(["needs_identity", "reject"] as const)(
    "does not hand off identity when candidate decision is %s",
    (candidateMatchDecision: ReviewIdentityDecision) => {
      const fixture = productFixtures[0];
      const result = createEphemeralProviderIdentityFromAggregateObservation({
        observation: makeObservation(fixture),
        identity: fixture.identity,
        candidateMatchDecision,
      });

      expect(result).toEqual({
        status: "identity_not_ready",
        reason: "candidate_match_decision_not_match",
      });
    }
  );

  it("fails closed when the required gid is missing", () => {
    const fixture = productFixtures[0];
    const result = createEphemeralProviderIdentityFromAggregateObservation({
      observation: makeObservation(fixture, { identifiers: { gid: undefined } }),
      identity: fixture.identity,
      candidateMatchDecision: "match",
    });

    expect(result).toEqual({
      status: "identity_not_ready",
      reason: "missing_provider_id:gid",
    });
  });

  it("fails closed when the required gid has the wrong primitive type", () => {
    const fixture = productFixtures[0];
    const result = createEphemeralProviderIdentityFromAggregateObservation({
      observation: makeObservation(fixture, {
        identifiers: { gid: 42 as unknown as string },
      }),
      identity: fixture.identity,
      candidateMatchDecision: "match",
    });

    expect(result).toEqual({
      status: "identity_not_ready",
      reason: "invalid_provider_id_type:gid",
    });
  });

  it.each([
    "gid/with/slash",
    "gid\\with\\backslash",
    "gid?query=true",
    "gid#fragment",
    "gid%2Fencoded-slash",
    "gid%2e%2eencoded-traversal",
    "gid@example",
    "gid&next=value",
    "https://example.test/gid",
    "https:example-gid",
    "mailto:example-gid",
    `gid${String.fromCharCode(31)}control`,
    "../gid",
    "g".repeat(129),
  ])("fails closed when gid contains unsafe path or URL characters: %s", (gid) => {
    const fixture = productFixtures[0];
    const result = createEphemeralProviderIdentityFromAggregateObservation({
      observation: makeObservation(fixture, { identifiers: { gid } }),
      identity: fixture.identity,
      candidateMatchDecision: "match",
    });

    expect(result).toEqual({
      status: "identity_not_ready",
      reason: "unsafe_provider_id:gid",
    });
  });

  it.each([
    { identifiers: { productId: "product/unsafe" }, reason: "unsafe_provider_id:productId" },
    { identifiers: { productId: "https:unsafe-product" }, reason: "unsafe_provider_id:productId" },
    { identifiers: { productId: 1 as unknown as string }, reason: "invalid_provider_id_type:productId" },
    { identifiers: { dataDocid: "doc?unsafe=true" }, reason: "unsafe_provider_id:dataDocid" },
    { identifiers: { dataDocid: "file:unsafe-doc" }, reason: "unsafe_provider_id:dataDocid" },
    { identifiers: { dataDocid: 1 as unknown as string }, reason: "invalid_provider_id_type:dataDocid" },
  ])("fails closed when an optional provider ID is invalid: $reason", ({ identifiers, reason }) => {
    const fixture = productFixtures[0];
    const result = createEphemeralProviderIdentityFromAggregateObservation({
      observation: makeObservation(fixture, { identifiers }),
      identity: fixture.identity,
      candidateMatchDecision: "match",
    });

    expect(result).toEqual({
      status: "identity_not_ready",
      reason,
    });
  });

  it("does not use persisted provider IDs to bypass semantic aggregate matching", () => {
    const fixture = productFixtures[0];
    const result = createEphemeralProviderIdentityFromAggregateObservation({
      observation: makeObservation(fixture, {
        matchedProductTitle: "Contoso Trail Watch",
      }),
      identity: {
        ...fixture.identity,
        providerProductIds: {
          ...fixture.identifiers,
          observedAt: fetchedAt,
          matchConfidence: "high",
        },
      },
      candidateMatchDecision: "match",
    });

    expect(result).toEqual({
      status: "identity_not_ready",
      reason: "aggregate_candidate_semantic_mismatch",
    });
  });

  it.each([
    {
      name: "same title but different canonical product key",
      observationFixture: productFixtures[0],
      identityFixture: productFixtures[1],
      overrides: {
        matchedProductTitle: productFixtures[0].candidateTitle,
        productId: productFixtures[1].identity.productId,
      },
      reason: "aggregate_candidate_semantic_mismatch",
    },
    {
      name: "same product key but different title",
      observationFixture: productFixtures[0],
      identityFixture: productFixtures[0],
      overrides: {
        matchedProductTitle: productFixtures[1].candidateTitle,
      },
      reason: "aggregate_candidate_semantic_mismatch",
    },
    {
      name: "brand collision",
      observationFixture: productFixtures[1],
      identityFixture: productFixtures[1],
      overrides: {
        matchedProductTitle: "Garmin Galaxy Ring Smart Ring",
      },
      reason: "aggregate_candidate_semantic_mismatch",
    },
    {
      name: "model collision",
      observationFixture: productFixtures[0],
      identityFixture: productFixtures[0],
      overrides: {
        matchedProductTitle: "Synthetic Venu 4 Wearable",
      },
      reason: "aggregate_candidate_semantic_mismatch",
    },
    {
      name: "variant collision",
      observationFixture: productFixtures[0],
      identityFixture: productFixtures[0],
      overrides: {
        matchedProductTitle: "Garmin Venu 3 GPS Smartwatch",
      },
      reason: "aggregate_candidate_semantic_mismatch",
    },
    {
      name: "synthetic unrelated candidate with valid provider IDs",
      observationFixture: productFixtures[3],
      identityFixture: productFixtures[3],
      overrides: {
        matchedProductTitle: "Contoso Blender Plus",
      },
      reason: "aggregate_candidate_semantic_mismatch",
    },
  ])("does not hand off identity for $name", ({ observationFixture, identityFixture, overrides, reason }) => {
    const result = createEphemeralProviderIdentityFromAggregateObservation({
      observation: makeObservation(observationFixture, overrides),
      identity: identityFixture.identity,
      candidateMatchDecision: "match",
    });

    expect(result).toEqual({
      status: "identity_not_ready",
      reason,
    });
  });

  it.each([
    {
      name: "empty product title",
      identity: { ...productFixtures[0].identity, productTitle: "" },
      reason: "missing_canonical_identity:productTitle",
    },
    {
      name: "empty brand",
      identity: { ...productFixtures[0].identity, brand: "" },
      reason: "missing_canonical_identity:brand",
    },
    {
      name: "whitespace padded product key",
      identity: {
        ...productFixtures[0].identity,
        productId: ` ${productFixtures[0].identity.productId} `,
      },
      reason: "unsafe_canonical_identity:productId",
    },
  ])("fails closed for $name canonical references", ({ identity, reason }) => {
    const result = createEphemeralProviderIdentityFromAggregateObservation({
      observation: makeObservation(productFixtures[0], { productId: identity.productId }),
      identity,
      candidateMatchDecision: "match",
    });

    expect(result).toEqual({
      status: "identity_not_ready",
      reason,
    });
  });

  it("constructs a detailed-review request plan for a valid synthetic identity", () => {
    const fixture = productFixtures[0];
    const plan = buildPlan(fixture);
    const [payload] = plan.requestPayload;

    expect(plan.provider).toBe("dataforseo");
    expect(plan.providerCapability).toBe("dataforseo_google_shopping_reviews");
    expect(plan.method).toBe("POST");
    expect(plan.endpointPath).toBe(DATAFORSEO_GOOGLE_SHOPPING_REVIEWS_TASK_POST_PATH);
    expect(plan.networkAllowed).toBe(false);
    expect(plan.product).toEqual({
      productId: fixture.identity.productId,
      canonicalSearchQuery: fixture.identity.canonicalSearchQuery,
      productTitle: fixture.identity.productTitle,
      brand: fixture.identity.brand,
      generation: fixture.identity.generation,
    });
    expect(plan.requiredProviderIds).toEqual(fixture.identifiers);
    expect(payload).toEqual({
      gid: fixture.identifiers.gid,
      product_id: fixture.identifiers.productId,
      data_docid: fixture.identifiers.dataDocid,
      location_code: 2840,
      language_code: "en",
      depth: 10,
      priority: 1,
      tag: `trendiq:${fixture.identity.productId}:review-quality:google-shopping-reviews`,
    });
  });

  it("constructs a plan with only gid when optional provider identifiers are absent", () => {
    const fixture = productFixtures[0];
    const result = createEphemeralProviderIdentityFromAggregateObservation({
      observation: makeObservation(fixture, {
        identifiers: {
          productId: undefined,
          dataDocid: undefined,
        },
      }),
      identity: fixture.identity,
      candidateMatchDecision: "match",
    });

    if (result.status !== "ready") {
      throw new Error(`Expected ready identity, received ${result.status}: ${result.reason}`);
    }

    const plan = buildPlan(fixture, result.identity);
    const [payload] = plan.requestPayload;

    expect(result.identity.identifiers).toEqual({ gid: fixture.identifiers.gid });
    expect(plan.requiredProviderIds).toEqual({ gid: fixture.identifiers.gid });
    expect(payload).toEqual({
      gid: fixture.identifiers.gid,
      location_code: 2840,
      language_code: "en",
      depth: 10,
      priority: 1,
      tag: `trendiq:${fixture.identity.productId}:review-quality:google-shopping-reviews`,
    });
  });

  it("constructs a plan with gid and productId when dataDocid is absent", () => {
    const fixture = productFixtures[0];
    const result = createEphemeralProviderIdentityFromAggregateObservation({
      observation: makeObservation(fixture, {
        identifiers: {
          dataDocid: undefined,
        },
      }),
      identity: fixture.identity,
      candidateMatchDecision: "match",
    });

    if (result.status !== "ready") {
      throw new Error(`Expected ready identity, received ${result.status}: ${result.reason}`);
    }

    const plan = buildPlan(fixture, result.identity);
    const [payload] = plan.requestPayload;

    expect(plan.requiredProviderIds).toEqual({
      gid: fixture.identifiers.gid,
      productId: fixture.identifiers.productId,
    });
    expect(payload).toEqual({
      gid: fixture.identifiers.gid,
      product_id: fixture.identifiers.productId,
      location_code: 2840,
      language_code: "en",
      depth: 10,
      priority: 1,
      tag: `trendiq:${fixture.identity.productId}:review-quality:google-shopping-reviews`,
    });
  });

  it("constructs a plan with gid and dataDocid when productId is absent", () => {
    const fixture = productFixtures[0];
    const result = createEphemeralProviderIdentityFromAggregateObservation({
      observation: makeObservation(fixture, {
        identifiers: {
          productId: undefined,
        },
      }),
      identity: fixture.identity,
      candidateMatchDecision: "match",
    });

    if (result.status !== "ready") {
      throw new Error(`Expected ready identity, received ${result.status}: ${result.reason}`);
    }

    const plan = buildPlan(fixture, result.identity);
    const [payload] = plan.requestPayload;

    expect(plan.requiredProviderIds).toEqual({
      gid: fixture.identifiers.gid,
      dataDocid: fixture.identifiers.dataDocid,
    });
    expect(payload).toEqual({
      gid: fixture.identifiers.gid,
      data_docid: fixture.identifiers.dataDocid,
      location_code: 2840,
      language_code: "en",
      depth: 10,
      priority: 1,
      tag: `trendiq:${fixture.identity.productId}:review-quality:google-shopping-reviews`,
    });
  });

  it("does not make network calls while constructing the request plan", () => {
    const source = handoffImplementationSource();
    const planJson = JSON.stringify(buildPlan());

    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toContain("getFetch(");
    expect(source).not.toContain("new DataForSeoGoogleShoppingReviewsClient");
    expect(planJson).not.toMatch(/\bfetch\b/i);
    expect(planJson).not.toMatch(/Authorization|Basic\s+[A-Za-z0-9+/=]+/i);
  });

  it("does not reference provider identity cache writes", () => {
    expect(handoffImplementationSource()).not.toMatch(
      /providerIdentityCache|writeProviderIdentityCache|providerProductIds\s*=|providerProductIds:/i
    );
  });

  it("does not reference product resolution cache writes", () => {
    expect(handoffImplementationSource()).not.toMatch(/productResolutionCache|writeProductResolutionCache/i);
  });

  it("does not reference review signal cache writes", () => {
    expect(handoffImplementationSource()).not.toMatch(/reviewSignalCache|writeReviewSignalCache|cache\.set/i);
  });

  it("does not reference snapshot or history writes", () => {
    expect(handoffImplementationSource()).not.toMatch(/writeSnapshot|snapshotWrites|history|localStorage|setItem/i);
  });

  it("does not mutate canonical product identity", () => {
    const fixture = productFixtures[0];
    const before = JSON.parse(JSON.stringify(fixture.identity));

    buildPlan(fixture);

    expect(fixture.identity).toEqual(before);
    expect(fixture.identity.providerProductIds).toBeUndefined();
  });

  it("does not let an unrelated aggregate candidate supply identity", () => {
    const fixture = productFixtures[0];
    const unrelated = productFixtures[1];
    const result = createEphemeralProviderIdentityFromAggregateObservation({
      observation: makeObservation(fixture, { productId: unrelated.identity.productId }),
      identity: fixture.identity,
      candidateMatchDecision: "match",
    });

    expect(result).toEqual({
      status: "identity_not_ready",
      reason: "aggregate_observation_product_mismatch",
    });
  });

  it.each(productFixtures)("$name can create an inspectable product-agnostic request plan", (fixture) => {
    const plan = buildPlan(fixture);
    const [payload] = plan.requestPayload;

    expect(plan.product.productId).toBe(fixture.identity.productId);
    expect(plan.identityEvidence.matchConfidence).toBe("high");
    expect(plan.requiredProviderIds).toEqual(fixture.identifiers);
    expect(payload?.gid).toBe(fixture.identifiers.gid);
  });

  it("keeps production handoff code free of fixture-specific product branching", () => {
    const source = handoffImplementationSource();

    for (const fixtureToken of ["Garmin", "Venu", "Samsung", "Galaxy", "Ninja", "Creami", "Acme", "Flux"]) {
      expect(source).not.toContain(fixtureToken);
    }
  });

  it("keeps historical live provider artifacts out of the new source and tests", () => {
    const source = `${handoffImplementationSource()}\n${typesSource()}\n${testSource()}`;

    expect(source).not.toMatch(/Brands\s*Mart/i);
    expect(source).not.toMatch(/\b\d{12,}\b/);
    expect(source).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
  });

  it("keeps credentials out of the inspectable request plan output", () => {
    const serialized = JSON.stringify(buildPlan());

    expect(serialized).not.toMatch(/Authorization|Basic\s+[A-Za-z0-9+/=]+|apiLogin|apiPassword|password|login/i);
  });

  it("keeps the request plan inspectable without executing network", () => {
    const plan = buildPlan();

    expect(Object.getPrototypeOf(plan)).toBe(Object.prototype);
    expect(plan.endpointPath).toBe(DATAFORSEO_GOOGLE_SHOPPING_REVIEWS_TASK_POST_PATH);
    expect(plan.endpointPath).not.toMatch(/^https?:\/\//);
    expect(plan.networkAllowed).toBe(false);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });

  it("freezes the request plan so endpoint and provider IDs cannot be mutated after construction", () => {
    const plan = buildPlan();
    const [payload] = plan.requestPayload;

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.product)).toBe(true);
    expect(Object.isFrozen(plan.requiredProviderIds)).toBe(true);
    expect(Object.isFrozen(plan.identityEvidence)).toBe(true);
    expect(Object.isFrozen(plan.identityEvidence.matchReasons)).toBe(true);
    expect(Object.isFrozen(plan.requestPayload)).toBe(true);
    expect(Object.isFrozen(payload)).toBe(true);
    expect(() => {
      (plan as { endpointPath: string }).endpointPath = "/v3/merchant/google/reviews/task_post/unsafe";
    }).toThrow(TypeError);
    expect(() => {
      (plan.requiredProviderIds as { gid: string }).gid = "unsafe-gid";
    }).toThrow(TypeError);
    expect(() => {
      (payload as { gid: string }).gid = "unsafe-gid";
    }).toThrow(TypeError);
  });

  it("rejects a malformed ephemeral identity before request-plan construction", () => {
    const fixture = productFixtures[0];
    const identity = {
      ...createReadyIdentity(fixture),
      identifiers: {
        gid: "gid/unsafe",
      },
    } as EphemeralProviderIdentity;

    expect(() => buildPlan(fixture, identity)).toThrow(ReviewProviderError);
  });

  it("rejects bypassed identities without high-confidence aggregate evidence", () => {
    const fixture = productFixtures[0];
    const identity = {
      ...createReadyIdentity(fixture),
      evidence: {
        ...createReadyIdentity(fixture).evidence,
        matchConfidence: "medium",
      },
    } as EphemeralProviderIdentity;

    expect(() => buildPlan(fixture, identity)).toThrow(ReviewProviderError);
  });

  it("rejects bypassed identities with unrelated matched titles before request-plan construction", () => {
    const fixture = productFixtures[0];
    const identity = {
      ...createReadyIdentity(fixture),
      evidence: {
        ...createReadyIdentity(fixture).evidence,
        matchedProductTitle: productFixtures[1].candidateTitle,
      },
    } as EphemeralProviderIdentity;

    expect(() => buildPlan(fixture, identity)).toThrow(ReviewProviderError);
  });

  it("rejects request-plan product mismatches", () => {
    const fixture = productFixtures[0];
    const identity = createReadyIdentity(fixture);

    expect(() =>
      buildDataForSeoGoogleShoppingReviewsRequestPlan({
        productId: productFixtures[1].identity.productId,
        identity: fixture.identity,
        ephemeralIdentity: identity,
        locationCode: 2840,
        languageCode: "en",
        depth: 10,
      })
    ).toThrow(ReviewProviderError);
  });
});
