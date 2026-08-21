import { describe, expect, it } from "vitest";
import {
  clamp,
  normalizeInverseLinear,
  normalizeLinear,
  normalizeLogScale,
  normalizeRatio,
  roundScore,
  roundTo,
  weightedAverage,
} from "../normalization";

describe("normalization", () => {
  it("clamps values to a 0-100 score range by default", () => {
    expect(clamp(-12)).toBe(0);
    expect(clamp(64)).toBe(64);
    expect(clamp(140)).toBe(100);
  });

  it("normalizes linear values and clamps out-of-range inputs", () => {
    expect(normalizeLinear(50, 0, 100)).toBe(50);
    expect(normalizeLinear(-10, 0, 100)).toBe(0);
    expect(normalizeLinear(110, 0, 100)).toBe(100);
  });

  it("normalizes inverse linear values", () => {
    expect(normalizeInverseLinear(0, 0, 10)).toBe(100);
    expect(normalizeInverseLinear(5, 0, 10)).toBe(50);
    expect(normalizeInverseLinear(10, 0, 10)).toBe(0);
  });

  it("normalizes log-scaled values to preserve low-volume signal movement", () => {
    expect(normalizeLogScale(100, 100, 10000)).toBe(0);
    expect(normalizeLogScale(10000, 100, 10000)).toBe(100);
    expect(normalizeLogScale(1000, 100, 10000)).toBeGreaterThan(0);
  });

  it("normalizes ratios and guards against empty denominators", () => {
    expect(normalizeRatio(3, 4)).toBe(75);
    expect(normalizeRatio(1, 0)).toBe(0);
  });

  it("rounds and weights deterministic score calculations", () => {
    expect(roundTo(42.126, 2)).toBe(42.13);
    expect(roundScore(82.5)).toBe(83);
    expect(weightedAverage([
      { score: 100, weight: 0.25 },
      { score: 50, weight: 0.75 },
    ])).toBe(62.5);
  });
});
