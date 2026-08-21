import { describe, expect, it } from "vitest";
import { calculateTrendChangePercent, calculateTrendMomentum, getMomentumStatus } from "../momentumEngine";

describe("momentumEngine", () => {
  it("uses the v1.1 Trend Momentum thresholds", () => {
    expect(getMomentumStatus(50)).toBe("Exploding");
    expect(getMomentumStatus(10)).toBe("Rising");
    expect(getMomentumStatus(9.9)).toBe("Stable");
    expect(getMomentumStatus(-9.9)).toBe("Stable");
    expect(getMomentumStatus(-10)).toBe("Cooling");
  });

  it("calculates seven-day change from the first and last points", () => {
    expect(calculateTrendChangePercent([
      { day: "Mon", value: 40 },
      { day: "Sun", value: 60 },
    ])).toBe(50);
  });

  it("handles zero baselines deterministically", () => {
    expect(calculateTrendChangePercent([
      { day: "Mon", value: 0 },
      { day: "Sun", value: 20 },
    ])).toBe(100);
  });

  it("prefers an explicit change percent when supplied", () => {
    expect(calculateTrendMomentum({
      changePercent: 34.24,
      history: [
        { day: "Mon", value: 10 },
        { day: "Sun", value: 100 },
      ],
    })).toEqual({
      changePercent: 34.2,
      status: "Rising",
    });
  });

  it("does not classify search-supported growth as Exploding when relative-interest gates fail", () => {
    expect(calculateTrendMomentum({
      changePercent: 500,
      current7dRelativeInterest: 18,
      previous7dRelativeInterest: 1.71,
      hasSearchGrowthContext: true,
      hasLowBaseSearchGrowth: true,
    })).toMatchObject({
      changePercent: 500,
      status: "Rising",
      isProvisional: true,
    });
  });

  it("allows Exploding when percent growth and relative-interest gates are all sufficient", () => {
    expect(calculateTrendMomentum({
      changePercent: 100,
      current7dRelativeInterest: 60,
      previous7dRelativeInterest: 30,
      hasSearchGrowthContext: true,
    })).toEqual({
      changePercent: 100,
      status: "Exploding",
    });
  });
});
