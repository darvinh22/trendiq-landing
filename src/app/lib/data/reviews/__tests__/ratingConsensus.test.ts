import { describe, expect, it } from "vitest";
import {
  RATING_CONSENSUS_MIN_SCORING_SAMPLE_SIZE,
  buildRatingConsensusQuality,
  calculateRatingConsensusQuality,
} from "../ratingConsensus";
import type { RatingDistributionInput } from "../types";

function distribution(stars: [number, number, number, number, number], source: RatingDistributionInput["distributionSource"] = "review_items"): RatingDistributionInput {
  return {
    star1Count: stars[0],
    star2Count: stars[1],
    star3Count: stars[2],
    star4Count: stars[3],
    star5Count: stars[4],
    distributionSource: source,
    distributionScope: source === "provider_rating_groups" ? "full_provider_distribution" : "fetched_review_sample",
    distributionComposition: source === "provider_rating_groups"
      ? "provider_rating_group_counts"
      : "valid_ratings_from_fetched_review_items",
  };
}

describe("ratingConsensusQuality", () => {
  it("recalculates the Ray-Ban sampled 200-review fixture distribution", () => {
    const result = buildRatingConsensusQuality({
      ...distribution([0, 0, 2, 198, 0]),
      aggregateAverageRating: 4.4,
    });

    expect(result.status).toBe("derived-live");
    expect(result.totalDistributionCount).toBe(200);
    expect(result.mean).toBe(3.99);
    expect(result.standardDeviation).toBeCloseTo(0.1, 1);
    expect(result.ratingConsensusQuality).toBeCloseTo(77.9, 1);
    expect(result.aggregateRatingDelta).toBe(0.41);
  });

  it("penalizes a 90% 5-star, 5% 4-star, 5% 1-star distribution", () => {
    const result = calculateRatingConsensusQuality(distribution([5, 0, 0, 5, 90]));

    expect(result.mean).toBe(4.75);
    expect(result.shapeSupport).toBeCloseTo(77.97, 1);
    expect(result.lowTailPenalty).toBe(3);
  });

  it("collapses polarized 50/50 5-star and 1-star ratings to weak consensus", () => {
    const result = buildRatingConsensusQuality(distribution([50, 0, 0, 0, 50]));

    expect(result.status).toBe("derived-live");
    expect(result.ratingConsensusQuality).toBe(0);
  });

  it("keeps mostly 2-star ratings as weak consensus", () => {
    const result = buildRatingConsensusQuality(distribution([0, 100, 0, 0, 0]));

    expect(result.status).toBe("derived-live");
    expect(result.ratingConsensusQuality).toBe(0);
  });

  it("keeps uniform 1-5 ratings as weak consensus", () => {
    const result = buildRatingConsensusQuality(distribution([20, 20, 20, 20, 20]));

    expect(result.status).toBe("derived-live");
    expect(result.ratingConsensusQuality).toBe(0);
  });

  it("uses 100 observations as the scoring guardrail", () => {
    expect(RATING_CONSENSUS_MIN_SCORING_SAMPLE_SIZE).toBe(100);
    expect(buildRatingConsensusQuality(distribution([0, 0, 0, 0, 100])).status).toBe("derived-live");
    expect(buildRatingConsensusQuality(distribution([0, 0, 0, 99, 0])).status).toBe("provisional");
    expect(buildRatingConsensusQuality(distribution([0, 0, 0, 29, 0])).status).toBe("insufficient");
  });

  it("falls back when a sampled review distribution is materially inconsistent with the aggregate rating", () => {
    const result = buildRatingConsensusQuality({
      ...distribution([0, 0, 0, 0, 100]),
      aggregateAverageRating: 3.9,
    });

    expect(result.status).toBe("mismatch");
    expect(result.ratingConsensusQuality).toBeUndefined();
    expect(result.aggregateRatingDelta).toBe(1.1);
  });

  it("does not apply sample mismatch fallback to full provider rating groups", () => {
    const result = buildRatingConsensusQuality({
      ...distribution([0, 0, 0, 0, 100], "provider_rating_groups"),
      aggregateAverageRating: 3.9,
    });

    expect(result.status).toBe("derived-live");
    expect(result.ratingConsensusQuality).toBeGreaterThan(0);
  });

  it.each<Array<[string, RatingDistributionInput]>>([
    ["negative star count", distribution([-1, 0, 0, 0, 101])],
    ["non-finite star count", distribution([0, Number.NaN, 0, 0, 100])],
    ["infinite star count", distribution([0, 0, Number.POSITIVE_INFINITY, 0, 100])],
    ["fractional star count", distribution([0, 0, 0.5, 0, 100])],
    ["empty distribution", distribution([0, 0, 0, 0, 0])],
    ["missing bucket", {
      ...distribution([0, 0, 0, 0, 100]),
      star4Count: undefined as unknown as number,
    }],
  ])("fails closed for malformed distribution input: %s", (_name, input) => {
    const result = buildRatingConsensusQuality({
      ...input,
      aggregateAverageRating: 4.5,
    });

    expect(result.status).toBe("insufficient");
    expect(result.ratingConsensusQuality).toBeUndefined();
    expect(result.provisionalRatingConsensusQuality).toBeUndefined();
    expect(result.totalDistributionCount).toBe(0);
    expect(result.mean).toBe(0);
    expect(result.standardDeviation).toBe(0);
    expect(result.variance).toBe(0);
    expect(result.qualityGate).toBe(0);
    expect(result.shapeSupport).toBe(0);
    expect(result.lowTailPenalty).toBe(0);
    expect(result.aggregateRatingDelta).toBeUndefined();
  });

  it("fails closed when source and scope are incoherent", () => {
    const result = buildRatingConsensusQuality({
      ...distribution([0, 0, 0, 0, 100], "provider_rating_groups"),
      distributionScope: "fetched_review_sample",
      aggregateAverageRating: 5,
    });

    expect(result.status).toBe("insufficient");
    expect(result.ratingConsensusQuality).toBeUndefined();
    expect(result.totalDistributionCount).toBe(0);
  });

  it("keeps extreme but valid distributions finite and bounded", () => {
    for (const input of [
      distribution([0, 0, 0, 1, 999], "provider_rating_groups"),
      distribution([999, 1, 0, 0, 0], "provider_rating_groups"),
    ]) {
      const result = buildRatingConsensusQuality(input);
      const quality = result.ratingConsensusQuality;

      expect(result.status).toBe("derived-live");
      expect(typeof quality).toBe("number");
      expect(Number.isFinite(quality)).toBe(true);
      expect(quality).toBeGreaterThanOrEqual(0);
      expect(quality).toBeLessThanOrEqual(100);
    }
  });
});
