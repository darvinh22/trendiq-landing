import type { ScorePenalty, TrendIQScoreComponents, TrendIQSignalInputs } from "./types";
import { normalizeInverseLinear, normalizeLinear, roundTo } from "./normalization";

function penalty(id: string, label: string, points: number, reason: string): ScorePenalty | null {
  const rounded = roundTo(points, 2);
  if (rounded <= 0) return null;
  return { id, label, points: rounded, reason };
}

export function calculateScorePenalties(input: TrendIQSignalInputs, components: TrendIQScoreComponents): ScorePenalty[] {
  const penalties: Array<ScorePenalty | null> = [];
  const avgMomentum = (components.socialMomentum + components.searchMomentum) / 2;

  if (avgMomentum >= 75 && components.sentiment < 55) {
    // Penalizes noisy popularity when the underlying conversation is materially
    // more negative than positive. Max impact is 7 points.
    penalties.push(
      penalty(
        "sentiment_drag",
        "Sentiment drag",
        normalizeLinear(55 - components.sentiment, 0, 55) * 7 / 100,
        "Momentum is strong, but sentiment is not yet supportive."
      )
    );
  }

  if (components.socialMomentum >= 80 && input.hypeSustainability.creatorConcentrationPercent >= 70) {
    // Creator concentration above 70% means a small creator cluster is carrying
    // the trend; v1 treats that as less durable than broad organic momentum.
    penalties.push(
      penalty(
        "creator_concentration",
        "Creator concentration",
        normalizeLinear(input.hypeSustainability.creatorConcentrationPercent, 70, 95) * 8 / 100,
        "A concentrated creator base increases hype fragility."
      )
    );
  }

  if (input.reviewQuality.averageRating >= 4.5 && input.reviewQuality.ratingEvidenceCount < 75) {
    // Early rating evidence can look artificially pristine. This fades to zero
    // once there are 75+ rating/review signals for v1 product comparisons.
    penalties.push(
      penalty(
        "thin_rating_evidence",
        "Thin rating evidence",
        normalizeInverseLinear(input.reviewQuality.ratingEvidenceCount, 0, 75) * 5 / 100,
        "High rating is based on limited rating evidence."
      )
    );
  }

  if (input.growthVelocity.accelerationPercent >= 70 && input.growthVelocity.consecutiveGrowthDays < 3) {
    // A sharp acceleration with fewer than three growth days is treated as a
    // spike risk instead of durable momentum. Max impact is 5 points.
    penalties.push(
      penalty(
        "volatile_growth",
        "Volatile growth",
        normalizeLinear(input.growthVelocity.accelerationPercent, 70, 140) * 5 / 100,
        "Growth is sharp but too brief to fully trust."
      )
    );
  }

  return penalties.filter((item): item is ScorePenalty => item !== null);
}

export function sumPenalties(penalties: ScorePenalty[]): number {
  return roundTo(penalties.reduce((sum, item) => sum + item.points, 0), 2);
}
