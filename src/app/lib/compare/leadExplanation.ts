import { TRENDIQ_SCORE_WEIGHTS } from "../scoring/scoreEngine";
import type { ConfidenceScoreResult, TrendIQScoreComponents, TrendIQScoreComponentKey } from "../scoring/types";
import { roundTo } from "../scoring/normalization";

export const SCORE_COMPONENT_LABELS: Record<TrendIQScoreComponentKey, string> = {
  socialMomentum: "Social Momentum",
  searchMomentum: "Search Momentum",
  sentiment: "Sentiment",
  reviewQuality: "Review Quality",
  purchaseIntent: "Purchase Intent",
  growthVelocity: "Growth Velocity",
  hypeSustainability: "Hype Sustainability",
};

const SCORE_COMPONENT_KEYS = Object.keys(SCORE_COMPONENT_LABELS) as TrendIQScoreComponentKey[];
const MIN_MEANINGFUL_IQ_CONTRIBUTION = 0.5;
const MIN_CONTEXTUAL_CONFIDENCE_DIFF = 5;

export interface ComparableTrendIQProduct {
  title: string;
  score: number;
  scoreBreakdown: {
    components: TrendIQScoreComponents;
  };
  confidence?: ConfidenceScoreResult;
}

export interface WeightedIQContribution {
  key: TrendIQScoreComponentKey;
  label: string;
  rawDifference: number;
  weight: number;
  iqContribution: number;
}

export interface ConfidenceContext {
  leaderScore: number;
  otherScore: number;
  difference: number;
}

export interface LeadExplanation {
  leader: ComparableTrendIQProduct;
  other: ComparableTrendIQProduct;
  finalIQAdvantage: number;
  contributions: WeightedIQContribution[];
  topContributions: WeightedIQContribution[];
  totalExplainedIQ: number;
  otherAdjustmentsIQ: number;
  showOtherAdjustments: boolean;
  confidenceContext?: ConfidenceContext;
}

export function formatIQ(value: number, decimals = 1): string {
  const rounded = roundTo(value, decimals);
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(decimals)} IQ`;
}

export function formatFinalIQ(value: number): string {
  return `${value >= 0 ? "+" : ""}${value} IQ`;
}

export function getLeadExplanation(left: ComparableTrendIQProduct, right: ComparableTrendIQProduct): LeadExplanation | null {
  if (left.score === right.score) return null;

  const leader = left.score > right.score ? left : right;
  const other = leader === left ? right : left;
  const finalIQAdvantage = leader.score - other.score;

  const contributions = SCORE_COMPONENT_KEYS.map((key) => {
    const rawDifference = leader.scoreBreakdown.components[key] - other.scoreBreakdown.components[key];
    const weight = TRENDIQ_SCORE_WEIGHTS[key];

    return {
      key,
      label: SCORE_COMPONENT_LABELS[key],
      rawDifference: roundTo(rawDifference, 2),
      weight,
      iqContribution: roundTo(rawDifference * weight, 2),
    };
  });

  const sortedContributions = [...contributions].sort(
    (a, b) => Math.abs(b.iqContribution) - Math.abs(a.iqContribution)
  );
  const meaningfulContributions = sortedContributions.filter(
    (item) => Math.abs(item.iqContribution) >= MIN_MEANINGFUL_IQ_CONTRIBUTION
  );
  const topContributions = (meaningfulContributions.length >= 3 ? meaningfulContributions : sortedContributions).slice(0, 5);
  const totalExplainedRaw = contributions.reduce((sum, item) => sum + item.iqContribution, 0);
  const totalExplainedIQ = roundTo(totalExplainedRaw, 1);
  const otherAdjustmentsIQ = roundTo(finalIQAdvantage - totalExplainedIQ, 1);
  const confidenceDiff =
    leader.confidence && other.confidence
      ? leader.confidence.score - other.confidence.score
      : 0;

  return {
    leader,
    other,
    finalIQAdvantage,
    contributions,
    topContributions,
    totalExplainedIQ,
    otherAdjustmentsIQ,
    showOtherAdjustments: otherAdjustmentsIQ !== 0,
    confidenceContext: Math.abs(confidenceDiff) >= MIN_CONTEXTUAL_CONFIDENCE_DIFF && leader.confidence && other.confidence
      ? {
        leaderScore: leader.confidence.score,
        otherScore: other.confidence.score,
        difference: confidenceDiff,
      }
      : undefined,
  };
}
