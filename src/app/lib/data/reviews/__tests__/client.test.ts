import { describe, expect, it } from "vitest";
import {
  DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX,
  DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH,
  DATAFORSEO_GOOGLE_SHOPPING_REVIEWS_TASK_GET_ADVANCED_PATH_PREFIX,
  DATAFORSEO_GOOGLE_SHOPPING_REVIEWS_TASK_POST_PATH,
  DataForSeoGoogleShoppingProductsClient,
  DataForSeoGoogleShoppingReviewsClient,
  ReviewProviderError,
  mapDataForSeoGoogleShoppingProductsResponse,
  mapDataForSeoGoogleShoppingReviewsResponse,
  type FetchLike,
} from "../client";
import { REVIEW_PRODUCT_IDENTITIES, readReviewProviderConfig } from "../config";
import { evaluateGoogleShoppingProductMatch } from "../matching";
import type { ReviewProductIdentityConfig } from "../types";

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

function shoppingReviewsResponse(
  items: unknown[],
  reviewsCount = items.length,
  resultOverrides: Record<string, unknown> = {}
) {
  return {
    status_code: 20000,
    status_message: "Ok.",
    tasks_error: 0,
    tasks: [
      {
        status_code: 20000,
        status_message: "Ok.",
        cost: 0.015,
        result_count: 1,
        result: [
          {
            product_id: "11716803554991446550",
            datetime: "2026-08-21 23:47:20 +00:00",
            reviews_count: reviewsCount,
            items_count: items.length,
            items,
            ...resultOverrides,
          },
        ],
      },
    ],
  };
}

function reviewItem(
  rating: unknown,
  publicationDate: string | null,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    type: "google_shopping_review_item",
    rank_group: 1,
    rank_absolute: 1,
    url: "https://example.com/reviews/ray-ban-meta",
    provided_by: "example.com",
    publication_date: publicationDate,
    rating: {
      rating_type: "Max5",
      value: rating,
      votes_count: null,
      rating_max: 5,
    },
    ...overrides,
  };
}

function repeatedReviewItems(count: number, rating: number, publicationDate = "2026-08-01 00:00:00 +00:00") {
  return Array.from({ length: count }, (_, index) => reviewItem(rating, publicationDate, {
    rank_group: index + 1,
    rank_absolute: index + 1,
  }));
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

const syntheticWidgetIdentity: ReviewProductIdentityConfig = {
  productId: "synthetic-widget-pro",
  canonicalSearchQuery: "Acme Widget Pro",
  productTitle: "Acme Widget Pro",
  brand: "Acme",
  generation: "Widget Pro",
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
    expect(observation.ratingEvidenceCount).toBe(1700);
    expect(observation.ratingVoteCount).toBe(1700);
    expect(observation.writtenReviewCount).toBeUndefined();
    expect(observation.ratingEvidenceSourceField).toBe("product_rating.votes_count");
    expect(observation.ratingEvidenceComposition).toBe("rating_votes_only");
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

  it("maps reviews_count only into ratingEvidenceCount as written review evidence", () => {
    const observation = mapDataForSeoGoogleShoppingProductsResponse({
      response: productsResponse([
        {
          ...rayBanMetaItem,
          reviews_count: 430,
          product_rating: {
            value: 4.4,
            rating_max: 5,
          },
        },
      ]),
      productId: "ray-ban-meta",
      identity,
      locationCode: 2840,
      languageCode: "en",
      fetchedAt: now.toISOString(),
    });

    expect(observation.writtenReviewCount).toBe(430);
    expect(observation.ratingVoteCount).toBeUndefined();
    expect(observation.ratingEvidenceCount).toBe(430);
    expect(observation.ratingEvidenceSourceField).toBe("reviews_count");
    expect(observation.ratingEvidenceComposition).toBe("written_reviews_only");
  });

  it("uses votes_count when both counts exist and votes_count covers reviews_count", () => {
    const observation = mapDataForSeoGoogleShoppingProductsResponse({
      response: productsResponse([
        {
          ...rayBanMetaItem,
          reviews_count: 800,
          product_rating: {
            value: 4.4,
            rating_max: 5,
            votes_count: 1200,
          },
        },
      ]),
      productId: "ray-ban-meta",
      identity,
      locationCode: 2840,
      languageCode: "en",
      fetchedAt: now.toISOString(),
    });

    expect(observation.writtenReviewCount).toBe(800);
    expect(observation.ratingVoteCount).toBe(1200);
    expect(observation.ratingEvidenceCount).toBe(1200);
    expect(observation.ratingEvidenceSourceField).toBe("product_rating.votes_count");
    expect(observation.ratingEvidenceComposition).toBe("rating_votes_with_written_reviews");
  });

  it("marks inconsistent votes_count below reviews_count without choosing a rating evidence value", () => {
    const observation = mapDataForSeoGoogleShoppingProductsResponse({
      response: productsResponse([
        {
          ...rayBanMetaItem,
          reviews_count: 1200,
          product_rating: {
            value: 4.4,
            rating_max: 5,
            votes_count: 800,
          },
        },
      ]),
      productId: "ray-ban-meta",
      identity,
      locationCode: 2840,
      languageCode: "en",
      fetchedAt: now.toISOString(),
    });

    expect(observation.writtenReviewCount).toBe(1200);
    expect(observation.ratingVoteCount).toBe(800);
    expect(observation.ratingEvidenceCount).toBeUndefined();
    expect(observation.ratingEvidenceSourceField).toBe("inconsistent_provider_counts");
    expect(observation.ratingEvidenceComposition).toBe("inconsistent_votes_count_lt_reviews_count");
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
      ratingEvidenceCount: 50,
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

  it("does not select needs_identity matches even when the confidence threshold is lowered", () => {
    expect(() => mapDataForSeoGoogleShoppingProductsResponse({
      response: productsResponse([
        {
          ...rayBanMetaItem,
          title: "Acme Widget",
          seller: "Acme",
          product_id: "retailer-widget",
          data_docid: "retailer-doc",
          gid: "retailer-gid",
          product_rating: {
            value: 4.2,
            rating_max: 5,
            votes_count: 420,
          },
        },
      ]),
      productId: "synthetic-widget-pro",
      identity: syntheticWidgetIdentity,
      locationCode: 2840,
      languageCode: "en",
      fetchedAt: now.toISOString(),
      minimumMatchConfidence: "low",
    })).toThrow("high-confidence rated product match");
  });

  it("computes derived-live recentAverageRating from 30 qualifying 90-day reviews", () => {
    const observation = mapDataForSeoGoogleShoppingReviewsResponse({
      response: shoppingReviewsResponse([
        ...repeatedReviewItems(15, 5),
        ...repeatedReviewItems(15, 4),
      ]),
      productId: "ray-ban-meta",
      identifiers: {
        gid: "11193998885220934472",
        productId: "11716803554991446550",
        dataDocid: "4690297997048968068",
      },
      locationCode: 2840,
      languageCode: "en",
      fetchedAt: now.toISOString(),
      snapshotTimestamp: "2026-08-21T00:00:00.000Z",
      windowDays: 90,
      minimumScoringSampleSize: 30,
      provisionalSampleSize: 10,
    });

    expect(observation.status).toBe("derived-live");
    expect(observation.recentAverageRating).toBe(4.5);
    expect(observation.qualifyingReviewCount).toBe(30);
    expect(observation.totalReviewsFetched).toBe(30);
    expect(observation.windowStart).toBe("2026-05-23T00:00:00.000Z");
    expect(observation.windowEnd).toBe("2026-08-21T00:00:00.000Z");
    expect(observation.sourceDomains).toEqual(["example.com"]);
    expect(observation.datePrecision).toBe("provider_observed_approximate_relative_timestamp");
  });

  it("computes derived-live ratingConsensusQuality from the Ray-Ban 200-review sample distribution", () => {
    const observation = mapDataForSeoGoogleShoppingReviewsResponse({
      response: shoppingReviewsResponse([
        ...repeatedReviewItems(2, 3, "2026-06-22 02:18:56 +00:00"),
        ...repeatedReviewItems(32, 4, "2026-08-01 02:18:56 +00:00"),
        ...repeatedReviewItems(166, 4, "2026-05-13 00:00:00 +00:00"),
      ], 200),
      productId: "ray-ban-meta",
      identifiers: {
        gid: "11193998885220934472",
        productId: "11716803554991446550",
        dataDocid: "4690297997048968068",
      },
      locationCode: 2840,
      languageCode: "en",
      fetchedAt: now.toISOString(),
      snapshotTimestamp: "2026-08-12T00:00:00.000Z",
      windowDays: 90,
      minimumScoringSampleSize: 30,
      provisionalSampleSize: 10,
      aggregateAverageRating: 4.4,
    });

    expect(observation.status).toBe("derived-live");
    expect(observation.recentAverageRating).toBe(3.94);
    expect(observation.qualifyingReviewCount).toBe(34);
    expect(observation.outsideWindowReviewCount).toBe(166);
    expect(observation.ratingConsensus?.status).toBe("derived-live");
    expect(observation.ratingConsensus?.distributionSource).toBe("review_items");
    expect(observation.ratingConsensus?.distributionScope).toBe("fetched_review_sample");
    expect(observation.ratingConsensus?.totalDistributionCount).toBe(200);
    expect(observation.ratingConsensus?.star3Count).toBe(2);
    expect(observation.ratingConsensus?.star4Count).toBe(198);
    expect(observation.ratingConsensus?.mean).toBe(3.99);
    expect(observation.ratingConsensus?.aggregateRatingDelta).toBe(0.41);
    expect(observation.ratingConsensus?.ratingConsensusQuality).toBeCloseTo(77.9, 1);
  });

  it("keeps 30-99 rating observations provisional for ratingConsensusQuality", () => {
    const observation = mapDataForSeoGoogleShoppingReviewsResponse({
      response: shoppingReviewsResponse(repeatedReviewItems(99, 4), 99),
      productId: "ray-ban-meta",
      identifiers: { gid: "11193998885220934472" },
      locationCode: 2840,
      languageCode: "en",
      fetchedAt: now.toISOString(),
      snapshotTimestamp: "2026-08-21T00:00:00.000Z",
      windowDays: 90,
      minimumScoringSampleSize: 30,
      provisionalSampleSize: 10,
      aggregateAverageRating: 4,
    });

    expect(observation.ratingConsensus?.status).toBe("provisional");
    expect(observation.ratingConsensus?.ratingConsensusQuality).toBeUndefined();
    expect(observation.ratingConsensus?.provisionalRatingConsensusQuality).toBeDefined();
  });

  it("keeps fewer than 30 rating observations insufficient for ratingConsensusQuality", () => {
    const observation = mapDataForSeoGoogleShoppingReviewsResponse({
      response: shoppingReviewsResponse(repeatedReviewItems(29, 4), 29),
      productId: "ray-ban-meta",
      identifiers: { gid: "11193998885220934472" },
      locationCode: 2840,
      languageCode: "en",
      fetchedAt: now.toISOString(),
      snapshotTimestamp: "2026-08-21T00:00:00.000Z",
      windowDays: 90,
      minimumScoringSampleSize: 30,
      provisionalSampleSize: 10,
      aggregateAverageRating: 4,
    });

    expect(observation.ratingConsensus?.status).toBe("insufficient");
    expect(observation.ratingConsensus?.ratingConsensusQuality).toBeUndefined();
  });

  it("falls back when sampled ratingConsensusQuality conflicts with aggregate averageRating", () => {
    const observation = mapDataForSeoGoogleShoppingReviewsResponse({
      response: shoppingReviewsResponse(repeatedReviewItems(100, 5), 100),
      productId: "ray-ban-meta",
      identifiers: { gid: "11193998885220934472" },
      locationCode: 2840,
      languageCode: "en",
      fetchedAt: now.toISOString(),
      snapshotTimestamp: "2026-08-21T00:00:00.000Z",
      windowDays: 90,
      minimumScoringSampleSize: 30,
      provisionalSampleSize: 10,
      aggregateAverageRating: 3.9,
    });

    expect(observation.ratingConsensus?.status).toBe("mismatch");
    expect(observation.ratingConsensus?.ratingConsensusQuality).toBeUndefined();
    expect(observation.ratingConsensus?.aggregateRatingDelta).toBe(1.1);
  });

  it("prefers full provider rating groups over sampled review-item ratings", () => {
    const observation = mapDataForSeoGoogleShoppingReviewsResponse({
      response: shoppingReviewsResponse(repeatedReviewItems(200, 1), 120, {
        rating_groups: [
          { value: 5, rating_max: 5, rating_count: 120 },
        ],
      }),
      productId: "ray-ban-meta",
      identifiers: { gid: "11193998885220934472" },
      locationCode: 2840,
      languageCode: "en",
      fetchedAt: now.toISOString(),
      snapshotTimestamp: "2026-08-21T00:00:00.000Z",
      windowDays: 90,
      minimumScoringSampleSize: 30,
      provisionalSampleSize: 10,
      aggregateAverageRating: 3.9,
    });

    expect(observation.ratingConsensus?.status).toBe("derived-live");
    expect(observation.ratingConsensus?.distributionSource).toBe("provider_rating_groups");
    expect(observation.ratingConsensus?.distributionScope).toBe("full_provider_distribution");
    expect(observation.ratingConsensus?.totalDistributionCount).toBe(120);
    expect(observation.ratingConsensus?.star1Count).toBe(0);
    expect(observation.ratingConsensus?.star5Count).toBe(120);
    expect(observation.ratingConsensus?.ratingConsensusQuality).toBeGreaterThan(90);
  });

  it("keeps 10-29 qualifying reviews provisional instead of scoring-ready", () => {
    const observation = mapDataForSeoGoogleShoppingReviewsResponse({
      response: shoppingReviewsResponse(repeatedReviewItems(20, 4.8)),
      productId: "ray-ban-meta",
      identifiers: { gid: "11193998885220934472" },
      locationCode: 2840,
      languageCode: "en",
      fetchedAt: now.toISOString(),
      snapshotTimestamp: "2026-08-21T00:00:00.000Z",
      windowDays: 90,
      minimumScoringSampleSize: 30,
      provisionalSampleSize: 10,
    });

    expect(observation.status).toBe("provisional");
    expect(observation.recentAverageRating).toBeUndefined();
    expect(observation.provisionalRecentAverageRating).toBe(4.8);
    expect(observation.qualifyingReviewCount).toBe(20);
  });

  it("falls below provisional status with fewer than 10 qualifying reviews", () => {
    const observation = mapDataForSeoGoogleShoppingReviewsResponse({
      response: shoppingReviewsResponse(repeatedReviewItems(9, 4.8)),
      productId: "ray-ban-meta",
      identifiers: { gid: "11193998885220934472" },
      locationCode: 2840,
      languageCode: "en",
      fetchedAt: now.toISOString(),
      snapshotTimestamp: "2026-08-21T00:00:00.000Z",
      windowDays: 90,
      minimumScoringSampleSize: 30,
      provisionalSampleSize: 10,
    });

    expect(observation.status).toBe("insufficient");
    expect(observation.recentAverageRating).toBeUndefined();
    expect(observation.provisionalRecentAverageRating).toBeUndefined();
    expect(observation.qualifyingReviewCount).toBe(9);
  });

  it("excludes outside-window, undated, and invalid-rating reviews from the recent average", () => {
    const observation = mapDataForSeoGoogleShoppingReviewsResponse({
      response: shoppingReviewsResponse([
        ...repeatedReviewItems(30, 4.5, "2026-08-01 00:00:00 +00:00"),
        reviewItem(5, "2026-05-22 23:59:59 +00:00"),
        reviewItem(1, null),
        reviewItem(null, "2026-08-01 00:00:00 +00:00"),
        reviewItem(6, "2026-08-01 00:00:00 +00:00"),
      ]),
      productId: "ray-ban-meta",
      identifiers: { gid: "11193998885220934472" },
      locationCode: 2840,
      languageCode: "en",
      fetchedAt: now.toISOString(),
      snapshotTimestamp: "2026-08-21T00:00:00.000Z",
      windowDays: 90,
      minimumScoringSampleSize: 30,
      provisionalSampleSize: 10,
    });

    expect(observation.status).toBe("derived-live");
    expect(observation.recentAverageRating).toBe(4.5);
    expect(observation.totalReviewsFetched).toBe(34);
    expect(observation.qualifyingReviewCount).toBe(30);
    expect(observation.outsideWindowReviewCount).toBe(1);
    expect(observation.undatedReviewCount).toBe(1);
    expect(observation.invalidRatingCount).toBe(2);
    expect(observation.excludedReviewCount).toBe(4);
  });

  it("includes exact 90-day window boundaries anchored to the snapshot timestamp", () => {
    const observation = mapDataForSeoGoogleShoppingReviewsResponse({
      response: shoppingReviewsResponse([
        reviewItem(5, "2026-05-23 00:00:00 +00:00"),
        reviewItem(4, "2026-08-21 00:00:00 +00:00"),
        ...repeatedReviewItems(28, 4.5, "2026-07-01 00:00:00 +00:00"),
      ]),
      productId: "ray-ban-meta",
      identifiers: { gid: "11193998885220934472" },
      locationCode: 2840,
      languageCode: "en",
      fetchedAt: now.toISOString(),
      snapshotTimestamp: "2026-08-21T00:00:00.000Z",
      windowDays: 90,
      minimumScoringSampleSize: 30,
      provisionalSampleSize: 10,
    });

    expect(observation.status).toBe("derived-live");
    expect(observation.qualifyingReviewCount).toBe(30);
    expect(observation.reviews[0].publicationDate).toBe("2026-05-23T00:00:00.000Z");
    expect(observation.reviews[1].publicationDate).toBe("2026-08-21T00:00:00.000Z");
    expect(observation.recentAverageRating).toBe(4.5);
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
              status_code: 20100,
              status_message: "Task Created.",
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

  it("uses the Google Shopping Reviews POST and Advanced GET task flow with capped standard-priority depth", async () => {
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
              id: "reviews-task-id",
              status_code: 20100,
              status_message: "Task Created.",
            },
          ],
        });
      }

      return response(shoppingReviewsResponse(repeatedReviewItems(30, 4.5)));
    };
    const config = readReviewProviderConfig({}, {
      mode: "live",
      apiLogin: "login",
      apiPassword: "password",
      apiBaseUrl: "https://api.dataforseo.com",
      taskPollAttempts: 1,
      taskPollIntervalMs: 0,
      recentReviewsDepth: 200,
      now: () => now,
    });
    const client = new DataForSeoGoogleShoppingReviewsClient(config, fetchImpl);

    await client.getRecentProductReviews({
      productId: "ray-ban-meta",
      identity,
      identifiers: {
        gid: "11193998885220934472",
        productId: "11716803554991446550",
        dataDocid: "4690297997048968068",
      },
      locationCode: 2840,
      languageCode: "en",
      snapshotTimestamp: "2026-08-21T00:00:00.000Z",
    });

    expect(calls[0].url).toBe(`https://api.dataforseo.com${DATAFORSEO_GOOGLE_SHOPPING_REVIEWS_TASK_POST_PATH}`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].auth).toMatch(/^Basic /);
    expect(JSON.parse(calls[0].body ?? "null")).toEqual([
      {
        gid: "11193998885220934472",
        product_id: "11716803554991446550",
        data_docid: "4690297997048968068",
        location_code: 2840,
        language_code: "en",
        depth: 200,
        priority: 1,
        tag: "trendiq:ray-ban-meta:review-quality:google-shopping-reviews",
      },
    ]);
    expect(calls[1].url).toBe(
      `https://api.dataforseo.com${DATAFORSEO_GOOGLE_SHOPPING_REVIEWS_TASK_GET_ADVANCED_PATH_PREFIX}/reviews-task-id`
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
