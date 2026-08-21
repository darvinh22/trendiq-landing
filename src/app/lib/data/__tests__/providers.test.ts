import { describe, expect, it } from "vitest";
import {
  merchantProvider,
  mockTrendSignalProviders,
  redditProvider,
  reviewsProvider,
  searchProvider,
  socialProvider,
} from "../providers";
import { RAY_BAN_META_PRODUCT_ID } from "../mockProviderSignals";

describe("mock trend signal providers", () => {
  it("returns normalized Ray-Ban signals on a shared provider interface", () => {
    const signals = mockTrendSignalProviders.flatMap((provider) => provider.getSignals(RAY_BAN_META_PRODUCT_ID));

    expect(signals.length).toBeGreaterThan(0);
    expect(new Set(signals.map((signal) => signal.source))).toEqual(
      new Set(["searchWeb", "reddit", "reviews", "social", "merchant"])
    );

    for (const signal of signals) {
      expect(signal.productId).toBe(RAY_BAN_META_PRODUCT_ID);
      expect(signal.normalizedValue).toBeGreaterThanOrEqual(0);
      expect(signal.normalizedValue).toBeLessThanOrEqual(100);
      expect(signal.confidence).toBeGreaterThanOrEqual(0);
      expect(signal.confidence).toBeLessThanOrEqual(100);
      if (signal.metadata?.engineField) {
        expect(typeof signal.metadata.engineValue).toBe("number");
      }
    }
  });

  it("keeps provider mocks scoped to the proof-of-concept product", () => {
    expect(searchProvider.getSignals("oura-ring-4")).toEqual([]);
    expect(redditProvider.getSignals("oura-ring-4")).toEqual([]);
    expect(reviewsProvider.getSignals("oura-ring-4")).toEqual([]);
    expect(socialProvider.getSignals("oura-ring-4")).toEqual([]);
    expect(merchantProvider.getSignals("oura-ring-4")).toEqual([]);
  });
});
