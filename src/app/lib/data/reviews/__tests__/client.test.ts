import { describe, expect, it } from "vitest";
import {
  DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX,
  DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH,
  DataForSeoGoogleShoppingProductsClient,
  ReviewProviderError,
  mapDataForSeoGoogleShoppingProductsResponse,
  type FetchLike,
} from "../client";
import { REVIEW_PRODUCT_IDENTITIES, readReviewProviderConfig } from "../config";
import { evaluateGoogleShoppingProductMatch } from "../matching";

const now = new Date("2026-08-21T23:47:20.000Z");
const identity = REVIEW_PRODUCT_IDENTITIES["ray-ban-meta"];

function response(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
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

const rayBanMetaItem = {
  type: "google_shopping_serp",
  rank_group: 1,
  rank_absolute: 1,
  title: "Meta Ray-Ban Wayfarer",
  seller: "Meta",
  product_id: "11716803554991446550",
  data_docid: "4690297997048968068",
  gid: "11193998885220934472",
  product_rating: {
    value: 4.4,
    rating_max: 5,
    votes_count: 1700,
  },
};

describe("DataForSEO Google Shopping review mapping", () => {
  it("accepts the high-confidence Ray-Ban Meta aggregate rating and provider identifiers", () => {
    const observation = mapDataForSeoGoogleShoppingProductsResponse({
      response: productsResponse([rayBanMetaItem]),
      productId: "ray-ban-meta",
      identity,
      locationCode: 2840,
      languageCode: "en",
      fetchedAt: now.toISOString(),
      endpoint: DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX,
    });

    expect(observation.averageRating).toBe(4.4);
    expect(observation.ratingMax).toBe(5);
    expect(observation.providerReviewCount).toBe(1700);
    expect(observation.identifiers).toEqual({
      productId: "11716803554991446550",
      dataDocid: "4690297997048968068",
      gid: "11193998885220934472",
    });
    expect(observation.matchConfidence).toBe("high");
    expect(observation.matchReasons).toContain("accepted_seller_match");
    expect(observation.matchReasons).toContain("persisted_provider_identifier_match");
    expect(observation.fetchedAt).toBe("2026-08-21T23:47:20.000Z");
  });

  it("rejects unrelated Ray-Ban products without Meta identity", () => {
    expect(() => mapDataForSeoGoogleShoppingProductsResponse({
      response: productsResponse([
        {
          ...rayBanMetaItem,
          title: "Ray-Ban Original Wayfarer Classic Sunglasses",
          product_id: "unrelated-product",
          product_rating: { value: 4.7, rating_max: 5, votes_count: 1200 },
        },
      ]),
      productId: "ray-ban-meta",
      identity,
      locationCode: 2840,
      languageCode: "en",
      fetchedAt: now.toISOString(),
    })).toThrow("high-confidence rated product match");
  });

  it("rejects accessories even when the title includes Ray-Ban Meta", () => {
    const result = evaluateGoogleShoppingProductMatch({
      title: "Charging case for Ray-Ban Meta smart glasses",
      seller: "Example Store",
      identifiers: {},
      averageRating: 4.5,
      providerReviewCount: 50,
    }, identity);

    expect(result.confidence).toBe("rejected");
    expect(result.reasons[0]).toContain("excluded_accessory");
  });

  it("rejects missing aggregate ratings", () => {
    expect(() => mapDataForSeoGoogleShoppingProductsResponse({
      response: productsResponse([
        {
          ...rayBanMetaItem,
          product_rating: { value: null, rating_max: 5, votes_count: 1700 },
        },
      ]),
      productId: "ray-ban-meta",
      identity,
      locationCode: 2840,
      languageCode: "en",
      fetchedAt: now.toISOString(),
    })).toThrow("high-confidence rated product match");
  });

  it("uses the Google Shopping Products POST and Advanced GET task flow", async () => {
    const calls: Array<{ url: string; auth?: string; method?: string; body?: string }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({
        url,
        auth: init?.headers?.Authorization,
        method: init?.method,
        body: init?.body,
      });

      if (init?.method === "POST") {
        return response({
          status_code: 20000,
          status_message: "Ok.",
          tasks: [
            {
              id: "task-id",
              status_code: 20000,
              status_message: "Ok.",
            },
          ],
        });
      }

      return response(productsResponse([rayBanMetaItem]));
    };
    const config = readReviewProviderConfig({}, {
      mode: "live",
      apiLogin: "login",
      apiPassword: "password",
      apiBaseUrl: "https://api.dataforseo.com",
      taskPollAttempts: 1,
      taskPollIntervalMs: 0,
      now: () => now,
    });
    const client = new DataForSeoGoogleShoppingProductsClient(config, fetchImpl);

    await client.getProductReviewAggregate({
      productId: "ray-ban-meta",
      identity,
      locationCode: 2840,
      languageCode: "en",
    });

    expect(calls[0].url).toBe(`https://api.dataforseo.com${DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH}`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].auth).toMatch(/^Basic /);
    expect(JSON.parse(calls[0].body ?? "null")).toEqual([
      {
        keyword: "Ray-Ban Meta",
        location_code: 2840,
        language_code: "en",
        depth: 40,
        tag: "trendiq:ray-ban-meta:review-quality:google-shopping",
      },
    ]);
    expect(calls[1].url).toBe(
      `https://api.dataforseo.com${DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX}/task-id`
    );
    expect(calls[1].method).toBe("GET");
  });

  it("keeps DataForSEO credentials out of error diagnostics", async () => {
    const fetchImpl: FetchLike = async () => response({
      status_code: 50000,
      status_message: "Internal error.",
      tasks_error: 1,
      tasks: [
        {
          status_code: 50000,
          status_message: "Internal error.",
        },
      ],
    }, false, 500);
    const config = readReviewProviderConfig({}, {
      mode: "live",
      apiLogin: "sensitive-login",
      apiPassword: "sensitive-password",
      apiBaseUrl: "https://api.dataforseo.com",
      now: () => now,
    });
    const client = new DataForSeoGoogleShoppingProductsClient(config, fetchImpl);
    let caught: ReviewProviderError | undefined;

    try {
      await client.getProductReviewAggregate({
        productId: "ray-ban-meta",
        identity,
        locationCode: 2840,
        languageCode: "en",
      });
    } catch (error) {
      caught = error as ReviewProviderError;
    }

    expect(caught).toBeInstanceOf(ReviewProviderError);
    expect(JSON.stringify(caught?.diagnostics)).not.toContain("sensitive-login");
    expect(JSON.stringify(caught?.diagnostics)).not.toContain("sensitive-password");
    expect(JSON.stringify(caught?.diagnostics)).not.toContain("Authorization");
  });
});
