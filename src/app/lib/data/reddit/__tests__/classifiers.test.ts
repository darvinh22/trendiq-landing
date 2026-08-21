import { describe, expect, it } from "vitest";
import { PatternPurchaseIntentClassifier, RuleBasedSentimentClassifier } from "../classifiers";

describe("Reddit rule-based classifiers", () => {
  const sentiment = new RuleBasedSentimentClassifier();
  const purchaseIntent = new PatternPurchaseIntentClassifier();

  it("classifies transparent positive, negative, and neutral sentiment", () => {
    expect(sentiment.classify("Ray-Ban Meta is amazing and genuinely useful")).toBe("positive");
    expect(sentiment.classify("Ray Ban Meta battery is bad and not worth it")).toBe("negative");
    expect(sentiment.classify("Ray-Ban Meta discussion thread with fit notes")).toBe("neutral");
  });

  it("detects purchase-intent language without counting simple mentions", () => {
    expect(purchaseIntent.hasPurchaseIntent("Should I buy Ray-Ban Meta this week?")).toBe(true);
    expect(purchaseIntent.hasPurchaseIntent("Ray-Ban Meta is back in stock near me")).toBe(true);
    expect(purchaseIntent.hasPurchaseIntent("Ray-Ban Meta camera quality discussion")).toBe(false);
  });
});
