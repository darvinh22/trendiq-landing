import { describe, expect, it } from "vitest";
import { calculateConfidenceComponents, calculateConfidenceScore, getConfidenceLevel } from "../confidenceEngine";

describe("confidenceEngine", () => {
  it("maps confidence levels to the v1.1 ranges", () => {
    expect(getConfidenceLevel(0)).toBe("Low");
    expect(getConfidenceLevel(39)).toBe("Low");
    expect(getConfidenceLevel(40)).toBe("Developing");
    expect(getConfidenceLevel(64)).toBe("Developing");
    expect(getConfidenceLevel(65)).toBe("Good");
    expect(getConfidenceLevel(84)).toBe("Good");
    expect(getConfidenceLevel(85)).toBe("High");
    expect(getConfidenceLevel(100)).toBe("High");
  });

  it("normalizes confidence components to 0-100", () => {
    const components = calculateConfidenceComponents({
      observationCount: 5000,
      sourceCount: 6,
      newestSignalAgeHours: 0,
      agreeingSignalCount: 3,
      totalSignalCount: 4,
      completeSignalCount: 8,
      expectedSignalCount: 10,
    });

    expect(components).toEqual({
      dataVolume: 100,
      sourceDiversity: 100,
      dataRecency: 100,
      signalAgreement: 75,
      dataCompleteness: 80,
    });
  });

  it("calculates a separate versioned confidence score", () => {
    const result = calculateConfidenceScore({
      observationCount: 5000,
      sourceCount: 6,
      newestSignalAgeHours: 0,
      agreeingSignalCount: 3,
      totalSignalCount: 4,
      completeSignalCount: 8,
      expectedSignalCount: 10,
    });

    expect(result.scoreVersion).toBe("v1.1");
    expect(result.score).toBe(94);
    expect(result.level).toBe("High");
  });

  it("applies a modest low-baseline growth interpretation penalty", () => {
    const baseInput = {
      observationCount: 5000,
      sourceCount: 6,
      newestSignalAgeHours: 0,
      agreeingSignalCount: 3,
      totalSignalCount: 4,
      completeSignalCount: 8,
      expectedSignalCount: 10,
    };

    expect(calculateConfidenceScore({
      ...baseInput,
      lowBaselineGrowthSignalCount: 2,
      growthInterpretationQuality: 0.171,
    }).score).toBe(89);
  });
});
