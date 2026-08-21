import { describe, expect, it } from "vitest";
import { getLeadExplanation, formatFinalIQ, formatIQ, type ComparableTrendIQProduct } from "../leadExplanation";

const baseComponents = {
  socialMomentum: 50,
  searchMomentum: 50,
  sentiment: 50,
  reviewQuality: 50,
  purchaseIntent: 50,
  growthVelocity: 50,
  hypeSustainability: 50,
};

function product(overrides: Partial<ComparableTrendIQProduct>): ComparableTrendIQProduct {
  return {
    title: "Product",
    score: 50,
    scoreBreakdown: {
      components: baseComponents,
    },
    ...overrides,
  };
}

describe("leadExplanation", () => {
  it("calculates weighted IQ contributions from score components", () => {
    const left = product({
      title: "Leader",
      score: 71,
      scoreBreakdown: {
        components: {
          ...baseComponents,
          growthVelocity: 90,
          purchaseIntent: 80,
          sentiment: 67,
          reviewQuality: 48,
        },
      },
    });
    const right = product({
      title: "Other",
      score: 50,
      scoreBreakdown: {
        components: {
          ...baseComponents,
          growthVelocity: 39,
          purchaseIntent: 50,
          sentiment: 50,
          reviewQuality: 60,
        },
      },
    });

    const explanation = getLeadExplanation(left, right);

    expect(explanation?.finalIQAdvantage).toBe(21);
    expect(explanation?.contributions.find((item) => item.key === "growthVelocity")).toMatchObject({
      rawDifference: 51,
      weight: 0.1,
      iqContribution: 5.1,
    });
    expect(explanation?.contributions.find((item) => item.key === "purchaseIntent")?.iqContribution).toBe(4.5);
    expect(explanation?.contributions.find((item) => item.key === "reviewQuality")?.iqContribution).toBe(-1.8);
  });

  it("sorts top factors by absolute weighted IQ contribution", () => {
    const explanation = getLeadExplanation(
      product({
        score: 80,
        scoreBreakdown: {
          components: {
            socialMomentum: 90,
            searchMomentum: 40,
            sentiment: 70,
            reviewQuality: 45,
            purchaseIntent: 80,
            growthVelocity: 55,
            hypeSustainability: 50,
          },
        },
      }),
      product({
        score: 60,
        scoreBreakdown: {
          components: {
            socialMomentum: 50,
            searchMomentum: 70,
            sentiment: 50,
            reviewQuality: 55,
            purchaseIntent: 50,
            growthVelocity: 50,
            hypeSustainability: 50,
          },
        },
      })
    );

    expect(explanation?.topContributions.map((item) => item.key)).toEqual([
      "socialMomentum",
      "searchMomentum",
      "purchaseIntent",
      "sentiment",
      "reviewQuality",
    ]);
  });

  it("reconciles explained IQ to final score advantage with other adjustments", () => {
    const explanation = getLeadExplanation(
      product({
        score: 71,
        scoreBreakdown: {
          components: {
            ...baseComponents,
            growthVelocity: 90,
          },
        },
      }),
      product({
        score: 50,
        scoreBreakdown: {
          components: {
            ...baseComponents,
            growthVelocity: 39,
          },
        },
      })
    );

    expect(explanation?.totalExplainedIQ).toBe(5.1);
    expect(explanation?.otherAdjustmentsIQ).toBe(15.9);
    expect(explanation?.showOtherAdjustments).toBe(true);
    expect((explanation?.totalExplainedIQ ?? 0) + (explanation?.otherAdjustmentsIQ ?? 0)).toBe(explanation?.finalIQAdvantage);
  });

  it("keeps confidence separate from weighted IQ contributions", () => {
    const explanation = getLeadExplanation(
      product({
        score: 61,
        confidence: {
          scoreVersion: "v1",
          score: 90,
          level: "High",
          components: {
            dataVolume: 100,
            sourceDiversity: 100,
            dataRecency: 100,
            signalAgreement: 80,
            dataCompleteness: 100,
          },
        },
      }),
      product({
        score: 60,
        confidence: {
          scoreVersion: "v1",
          score: 70,
          level: "Good",
          components: {
            dataVolume: 70,
            sourceDiversity: 70,
            dataRecency: 70,
            signalAgreement: 70,
            dataCompleteness: 70,
          },
        },
      })
    );

    expect(explanation?.contributions.some((item) => item.label === "Confidence")).toBe(false);
    expect(explanation?.confidenceContext).toEqual({
      leaderScore: 90,
      otherScore: 70,
      difference: 20,
    });
  });

  it("formats IQ values for display", () => {
    expect(formatIQ(5.126)).toBe("+5.1 IQ");
    expect(formatIQ(-1.84)).toBe("-1.8 IQ");
    expect(formatFinalIQ(21)).toBe("+21 IQ");
  });
});
