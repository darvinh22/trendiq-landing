import { SCORE_VERSION, type ConfidenceLevel, type ConfidenceComponents, type ConfidenceScoreResult, type ConfidenceSignals } from "./types";
import { normalizeInverseLinear, normalizeLogScale, normalizeLinear, normalizeRatio, roundScore, roundTo, weightedAverage } from "./normalization";

export const CONFIDENCE_WEIGHTS = {
  dataVolume: 0.3,
  sourceDiversity: 0.25,
  dataRecency: 0.2,
  signalAgreement: 0.15,
  dataCompleteness: 0.1,
} as const;

export function getConfidenceLevel(score: number): ConfidenceLevel {
  if (score <= 39) return "Low";
  if (score <= 64) return "Developing";
  if (score <= 84) return "Good";
  return "High";
}

export function calculateConfidenceComponents(input: ConfidenceSignals): ConfidenceComponents {
  return {
    // Data volume assumes consumer-trend reads become useful around 50 weekly
    // observations and highly reliable around 5,000+ observations.
    dataVolume: roundTo(normalizeLogScale(input.observationCount, 50, 5000), 2),

    // Source diversity assumes one source is fragile and six or more distinct
    // source families is enough for v1 triangulation.
    sourceDiversity: roundTo(normalizeLinear(input.sourceCount, 1, 6), 2),

    // Data recency assumes signals older than seven days are stale for a
    // trend-tracking app, while same-day signals should score near 100.
    dataRecency: roundTo(normalizeInverseLinear(input.newestSignalAgeHours, 0, 168), 2),

    // Signal agreement rewards components pointing in the same direction; a
    // split signal set is intentionally less trusted even when data volume is high.
    signalAgreement: roundTo(normalizeRatio(input.agreeingSignalCount, input.totalSignalCount), 2),

    // Completeness is the percent of expected v1 inputs present for the product.
    dataCompleteness: roundTo(normalizeRatio(input.completeSignalCount, input.expectedSignalCount), 2),
  };
}

export function calculateConfidenceScore(input: ConfidenceSignals): ConfidenceScoreResult {
  const components = calculateConfidenceComponents(input);
  const baseScore = weightedAverage([
      { score: components.dataVolume, weight: CONFIDENCE_WEIGHTS.dataVolume },
      { score: components.sourceDiversity, weight: CONFIDENCE_WEIGHTS.sourceDiversity },
      { score: components.dataRecency, weight: CONFIDENCE_WEIGHTS.dataRecency },
      { score: components.signalAgreement, weight: CONFIDENCE_WEIGHTS.signalAgreement },
      { score: components.dataCompleteness, weight: CONFIDENCE_WEIGHTS.dataCompleteness },
    ]);
  const growthQuality = typeof input.growthInterpretationQuality === "number"
    ? input.growthInterpretationQuality
    : input.lowBaselineGrowthSignalCount
      ? 0
      : 1;
  // v1.1 has only one confidence score, so low baseline growth receives a
  // modest interpretation-quality penalty rather than treating valid fresh data
  // as unreliable overall.
  const lowBaselinePenalty = input.lowBaselineGrowthSignalCount
    ? Math.min(6, (1 - growthQuality) * 6)
    : 0;
  const score = roundScore(baseScore - lowBaselinePenalty);

  return {
    scoreVersion: SCORE_VERSION,
    score,
    level: getConfidenceLevel(score),
    components,
  };
}
