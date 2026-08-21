import { describe, expect, it } from "vitest";
import { buildProductTrendSnapshotAsync } from "../../snapshotEngine";
import { merchantProvider, reviewsProvider, searchProvider, socialProvider } from "../../providers";
import { mockRedditProvider, RedditTrendSignalProvider } from "../../providers/redditProvider";
import { RAY_BAN_META_PRODUCT_ID } from "../../mockProviderSignals";
import type { RedditApiClient, RedditApiPost } from "../client";
import { readRedditProviderConfig } from "../config";

const now = new Date("2026-08-11T00:00:00.000Z");
const currentUtc = Date.parse("2026-08-10T12:00:00.000Z") / 1000;
const previousUtc = Date.parse("2026-07-31T12:00:00.000Z") / 1000;

function post(id: string, title: string, createdUtc = currentUtc, subreddit = "gadgets", author = `user-${id}`): RedditApiPost {
  return {
    id,
    title,
    selftext: "",
    subreddit,
    author,
    createdUtc,
    score: 10,
    commentCount: 2,
    permalink: `/r/${subreddit}/comments/${id}`,
  };
}

function fixturePosts(): RedditApiPost[] {
  return [
    ...Array.from({ length: 12 }, (_, index) =>
      post(`positive-${index}`, "Ray-Ban Meta is amazing and worth it", currentUtc, index % 2 ? "gadgets" : "RayBanStories")
    ),
    ...Array.from({ length: 5 }, (_, index) =>
      post(`negative-${index}`, "Ray Ban Meta battery is bad and not worth it", currentUtc, "technology")
    ),
    ...Array.from({ length: 8 }, (_, index) =>
      post(`neutral-${index}`, "Meta smart glasses camera quality discussion", currentUtc, "wearables")
    ),
    ...Array.from({ length: 10 }, (_, index) =>
      post(`previous-${index}`, "Ray-Ban smart glasses discussion", previousUtc, "gadgets")
    ),
  ];
}

class FixtureRedditClient implements RedditApiClient {
  readonly queries: string[] = [];

  constructor(private readonly posts: RedditApiPost[]) {}

  async searchPosts(query: string): Promise<RedditApiPost[]> {
    this.queries.push(query);
    return this.posts;
  }
}

function liveConfig() {
  return readRedditProviderConfig({}, {
    mode: "live",
    clientId: "client-id",
    clientSecret: "client-secret",
    userAgent: "web:trendiq-test:v1.0.0 (by /u/test)",
    minSampleSize: 20,
    now: () => now,
  });
}

describe("RedditTrendSignalProvider", () => {
  it("falls back to mock when live credentials are missing", async () => {
    const client = new FixtureRedditClient(fixturePosts());
    const provider = new RedditTrendSignalProvider(readRedditProviderConfig({}, {
      mode: "live",
      now: () => now,
    }), {
      client,
    });

    expect(await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID)).toEqual(
      mockRedditProvider.getSignals(RAY_BAN_META_PRODUCT_ID)
    );
    expect(client.queries).toEqual([]);
  });

  it("keeps Reddit mock/fallback while commercial approval is pending", async () => {
    const client = new FixtureRedditClient(fixturePosts());
    const provider = new RedditTrendSignalProvider(liveConfig(), {
      client,
    });
    const signals = await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);

    expect(signals).toEqual(mockRedditProvider.getSignals(RAY_BAN_META_PRODUCT_ID));
    expect(signals.every((signal) => signal.sourceProvenance.approvalStatus === "pending")).toBe(true);
    expect(signals.every((signal) => signal.sourceProvenance.liveApiRequestMade === false)).toBe(true);
    expect(client.queries).toEqual([]);
    expect(provider.getDebugSummary(RAY_BAN_META_PRODUCT_ID)).toBeUndefined();
  });

  it("does not accidentally call Reddit live clients on repeated async calls", async () => {
    const client = new FixtureRedditClient(fixturePosts());
    const provider = new RedditTrendSignalProvider(liveConfig(), {
      client,
    });

    await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);
    await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID);

    expect(client.queries).toHaveLength(0);
  });

  it("falls back to mock when live Reddit has too few observations", async () => {
    const client = new FixtureRedditClient([
      post("one", "Ray-Ban Meta is amazing and worth it"),
      post("two", "Ray Ban Meta battery is bad"),
    ]);
    const provider = new RedditTrendSignalProvider(liveConfig(), {
      client,
    });

    expect(await provider.getSignalsAsync(RAY_BAN_META_PRODUCT_ID)).toEqual(
      mockRedditProvider.getSignals(RAY_BAN_META_PRODUCT_ID)
    );
    expect(provider.getDebugSummary(RAY_BAN_META_PRODUCT_ID)).toBeUndefined();
    expect(client.queries).toEqual([]);
  });

  it("integrates pending Reddit as mock/fallback with the aggregator and Score Engine", async () => {
    const client = new FixtureRedditClient(fixturePosts());
    const redditProvider = new RedditTrendSignalProvider(liveConfig(), {
      client,
    });
    const snapshot = await buildProductTrendSnapshotAsync(
      RAY_BAN_META_PRODUCT_ID,
      [searchProvider, redditProvider, reviewsProvider, socialProvider, merchantProvider],
      { timestamp: now.toISOString() }
    );

    expect(snapshot.aggregatedSignals.searchMomentum.searchVolume7d).toBe(185000);
    expect(snapshot.aggregatedSignals.reviewQuality.averageRating).toBe(4.4);
    expect(snapshot.aggregatedSignals.purchaseIntent.addToCartRatePercent).toBe(10.5);
    expect(snapshot.aggregatedSignals.sentiment.positiveMentionPercent).toBe(74);
    expect(snapshot.liveDataAudit?.reddit).toEqual({
      mode: "mock/fallback",
      approvalStatus: "pending",
      liveApiRequestMade: false,
    });
    expect(client.queries).toEqual([]);
    expect(snapshot.trendIQScore.scoreVersion).toBe("v1.1");
    expect(snapshot.trendIQScore.score).toBeGreaterThan(0);
  });
});
