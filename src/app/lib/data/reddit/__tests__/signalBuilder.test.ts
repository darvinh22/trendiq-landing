import { describe, expect, it } from "vitest";
import type { RedditApiPost } from "../client";
import { REDDIT_RAY_BAN_ALIASES } from "../config";
import {
  buildRedditSignalsFromPosts,
  calculateMentionGrowthPercent,
  calculateRedditSignalConfidence,
} from "../signalBuilder";

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

describe("Reddit signal builder", () => {
  it("handles aliases and current/previous 7-day mention growth", () => {
    const posts = [
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
      post("irrelevant", "Other smart glasses discussion", currentUtc, "gadgets"),
    ];
    const result = buildRedditSignalsFromPosts({
      productId: "ray-ban-meta",
      aliases: REDDIT_RAY_BAN_ALIASES,
      posts,
      now,
      minSampleSize: 20,
    });
    const growthSignal = result.signals.find((signal) => signal.metadata?.engineField === "mentionGrowthPercent");

    expect(result.summary.currentObservationCount).toBe(25);
    expect(result.summary.previousObservationCount).toBe(10);
    expect(result.summary.mentionGrowthPercent).toBe(150);
    expect(result.summary.uniqueSubredditCount).toBe(4);
    expect(result.summary.hasSufficientSample).toBe(true);
    expect(growthSignal?.metadata?.engineValue).toBe(150);

    for (const signal of result.signals) {
      expect(signal.normalizedValue).toBeGreaterThanOrEqual(0);
      expect(signal.normalizedValue).toBeLessThanOrEqual(100);
      expect(signal.metadata?.provider).toBe("reddit");
      expect(signal.metadata?.aliasesUsed).toContain("Ray-Ban Meta");
    }
  });

  it("uses conservative percentages and low confidence for small samples", () => {
    const result = buildRedditSignalsFromPosts({
      productId: "ray-ban-meta",
      aliases: REDDIT_RAY_BAN_ALIASES,
      posts: [
        post("one", "Ray-Ban Meta is amazing and worth it"),
        post("two", "Ray Ban Meta battery is bad"),
      ],
      now,
      minSampleSize: 20,
    });

    expect(result.summary.currentObservationCount).toBe(2);
    expect(result.summary.positivePercent).toBe(5);
    expect(result.summary.negativePercent).toBe(5);
    expect(result.summary.confidence).toBeLessThan(10);
    expect(result.summary.hasSufficientSample).toBe(false);
  });

  it("calculates mention growth deterministically", () => {
    expect(calculateMentionGrowthPercent(30, 20)).toBe(50);
    expect(calculateMentionGrowthPercent(2, 0)).toBe(100);
    expect(calculateMentionGrowthPercent(0, 0)).toBe(0);
  });

  it("raises confidence once the minimum sample threshold is met", () => {
    expect(calculateRedditSignalConfidence(5, 1, 20)).toBeLessThan(20);
    expect(calculateRedditSignalConfidence(25, 4, 20)).toBeGreaterThan(65);
  });
});
