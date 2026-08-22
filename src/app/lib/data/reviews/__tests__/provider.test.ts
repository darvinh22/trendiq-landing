import { describe, expect, it } from "vitest";
import { calculateTrendIQScore } from "../../../scoring/scoreEngine";
import { RAY_BAN_META_PRODUCT_ID } from "../../mockProviderSignals";
import { merchantProvider, mockRedditProvider, socialProvider } from "../../providers";
import { mockSearchProvider } from "../../search";
import { buildProductTrendSnapshot, buildProductTrendSnapshotAsync } from "../../snapshotEngine";
import type { GoogleShoppingReviewsClient, GoogleShoppingReviewObservation } from "../types";
import { readReviewProviderConfig } from "../config";
import {
  ReviewQualitySignalProvider,
  mockReviewsProvider,
} from "../../providers/reviewsProvider";

const now = new Date("2026-08-21T23:47:20.000Z");

function observation(overrides: Partial<GoogleShoppingReviewObservation> = {}): GoogleShoppingReviewObservation {
  return {
    provider: "dataforseo",
    productId: RAY_BAN_META_PRODUCT_ID,
    searchQuery: "Ray-Ban Meta",
    locationCode: 2840,
    languageCode: "en",
    fetchedAt: now.toISOString(),
    endpoint: "/v3/merchant/google/products/task_get/advanced",
    matchedProductTitle: "Meta Ray-Ban Wayfarer",
    seller: "Meta",
    identifiers: {
      productId: "11716803554991446550",
      dataDocid: "4690297997048968068",
      gid: "11193998885220934472",
    },
    averageRating: 4.4,
    ratingMax: 5,
    providerReviewCount: 1700,
    matchConfidence: "high",
    matchScore: 100,
    matchReasons: ["accepted_seller_match", "persisted_provider_identifier_match"],
    providerVariantGrouping: "google_shopping_product_result_may_group_frame_and_lens_variants",
    rankGroup: 1,
    rankAbsolute: 1,
    ...overrides,
  };
}

class FixtureReviewClient implements GoogleShoppingReviewsClient {
  readonly calls: Array<{ productId: string; locationCode: number; languageCode: string }> = [];

  constructor(
    private readonly aggregate?: GoogleShoppingReviewObservation,
    private readonly error?: Error
  ) {}

  async getProductReviewAggregate(input: {
    productId: string;
    locationCode: number;
    languageCode: string;
  }): Promise<GoogleShoppingReviewObservation> {
    this.calls.push({
      productId: input.productId,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
    });

    if (this.error) throw this.error;
    if (!this.aggregate) throw new Error("review aggregate unavailable");

    return this.aggregate;
  }
}

function liveConfig(overrides: Parameters<typeof readReviewProviderConfig>[1] = {}) {
  return readReviewProviderConfig({}, {
    mode: "live",
    apiLogin: "login",
    apiPassword: "password",
    taskPollIntervalMs: 0,
    now: () => now,
    ...overrides,
  });
}

describe("ReviewQualitySignalProvider", () => {
  it("uses high-confidence Google Shopping averageRating and leaves provider reviewCount as metadata only", async () => {
    const client = new FixtureReviewClient(observation());
    const provider = new ReviewQualitySignalProvider(liveConfig(), { client });
    const signals = await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    const averageRatingSignals = signals.filter((signal) => signal.metadata?.engineField === "averageRating");
    const byEngineField = new Map(signals.map((signal) => [signal.metadata?.engineField, signal]));

    expect(client.calls[0]).toEqual({
      productId: RAY_BAN_META_PRODUCT_ID,
      locationCode: 2840,
      languageCode: "en",
    });
    expect(averageRatingSignals).toHaveLength(1);
    expect(byEngineField.get("averageRating")?.value).toBe(4.4);
    expect(byEngineField.get("averageRating")?.sourceProvenance.mode).toBe("live");
    expect(byEngineField.get("averageRating")?.metadata?.provider).toBe("dataforseo_google_shopping");
    expect(byEngineField.get("averageRating")?.metadata?.providerReviewCount).toBe(1700);
    expect(byEngineField.get("averageRating")?.metadata?.providerReviewCountRole).toBe("metadata_only_phase_3b");
    expect(byEngineField.get("reviewCount")?.sourceProvenance.mode).toBe("fallback");
    expect(byEngineField.get("reviewCount")?.metadata?.engineValue).toBe(2900);
    expect(byEngineField.get("verifiedPurchasePercent")?.sourceProvenance.mode).toBe("fallback");
    expect(byEngineField.get("recentAverageRating")?.sourceProvenance.mode).toBe("fallback");
  });

  it("falls back without a live request when review credentials are unavailable", async () => {
    const client = new FixtureReviewClient(observation());
    const provider = new ReviewQualitySignalProvider(readReviewProviderConfig({}, {
      mode: "live",
      now: () => now,
    }), { client });

    expect(await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID)).toEqual(
      mockReviewsProvider.getSignals(RAY_BAN_META_PRODUCT_ID)
    );
    expect(client.calls).toEqual([]);
  });

  it("falls back when the live aggregate is unavailable or missing a usable rating", async () => {
    const client = new FixtureReviewClient(undefined, new Error("missing rating"));
    const provider = new ReviewQualitySignalProvider(liveConfig(), { client });
    const signals = await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    const averageRating = signals.find((signal) => signal.metadata?.engineField === "averageRating");

    expect(averageRating?.metadata?.provider).toBe("mock_reviews");
    expect(averageRating?.sourceProvenance.mode).toBe("fallback");
    expect(averageRating?.metadata?.engineValue).toBe(4.4);
  });

  it("falls back when product match confidence is below the approved threshold", async () => {
    const client = new FixtureReviewClient(undefined, new Error("low-confidence product match"));
    const provider = new ReviewQualitySignalProvider(liveConfig(), { client });
    const signals = await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    const averageRating = signals.find((signal) => signal.metadata?.engineField === "averageRating");

    expect(averageRating?.sourceProvenance.mode).toBe("fallback");
    expect(averageRating?.metadata?.provider).toBe("mock_reviews");
  });

  it("preserves existing mock behavior for unsupported products", async () => {
    const client = new FixtureReviewClient(observation());
    const provider = new ReviewQualitySignalProvider(liveConfig(), { client });

    expect(provider.getSignals("oura-ring-4")).toEqual([]);
    expect(await provider.getSignalsAsync("oura-ring-4")).toEqual([]);
    expect(client.calls).toEqual([]);
  });

  it("does not change score inputs beyond averageRating when the live rating equals the mock value", async () => {
    const client = new FixtureReviewClient(observation());
    const provider = new ReviewQualitySignalProvider(liveConfig(), { client });
    const mockSnapshot = buildProductTrendSnapshot(
      RAY_BAN_META_PRODUCT_ID,
      [mockSearchProvider, mockRedditProvider, mockReviewsProvider, socialProvider, merchantProvider],
      { timestamp: now.toISOString() }
    );
    const snapshot = await buildProductTrendSnapshotAsync(
      RAY_BAN_META_PRODUCT_ID,
      [mockSearchProvider, mockRedditProvider, provider, socialProvider, merchantProvider],
      { timestamp: now.toISOString() }
    );
    const reviewComponent = snapshot.liveDataAudit?.componentSummaries.find((component) =>
      component.component === "reviewQuality"
    );

    expect(snapshot.aggregatedSignals.reviewQuality).toEqual(mockSnapshot.aggregatedSignals.reviewQuality);
    expect(snapshot.aggregatedSignals.reviewQuality.reviewCount).toBe(2900);
    expect(calculateTrendIQScore(snapshot.aggregatedSignals).score).toBe(mockSnapshot.trendIQScore.score);
    expect(reviewComponent?.fields.find((field) => field.engineField === "averageRating")?.provenance).toBe("live");
    expect(reviewComponent?.fields.find((field) => field.engineField === "reviewCount")?.provenance).toBe("fallback");
  });
});
