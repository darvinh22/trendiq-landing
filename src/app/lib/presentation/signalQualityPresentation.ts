import { CONFIDENCE_PROVENANCE_WARNING_THRESHOLD_PERCENT } from "../data/capabilities/evaluator";
import type { ConsumerConfidenceLevel, ConsumerEvidenceStatus } from "../data/consumerResult";
import {
  RECOMMENDATION_POLICY,
  type Recommendation,
  type RecommendationReasonCode,
  type RecommendationResultStatus,
} from "../data/recommendationEngine";

/**
 * Consumer labeling for the confidence meta-score.
 *
 * The numeric score and engine band stay on the result. This module only
 * decides which words the consumer surface may show. It does not blend Signal
 * Quality with coverage into another percentage.
 */
export const SIGNAL_QUALITY_METRIC_LABEL = "Signal Quality";
export const EVIDENCE_COVERAGE_METRIC_LABEL = "Evidence Coverage";

export const SIGNAL_QUALITY_EXPLANATION =
  "Signal Quality measures the quality of the signals that are available. It is not confidence that the recommendation is correct.";

export const EVIDENCE_COVERAGE_EXPLANATION =
  "Percent of the scoring contract backed by live evidence.";

export type ConsumerQualitativeLabel =
  | ConsumerConfidenceLevel
  | "Limited evidence"
  | "Insufficient evidence";

const INSUFFICIENT_EVIDENCE_REASON_CODES = new Set<RecommendationReasonCode>([
  "BOUNDARY_RESULT_UNAVAILABLE",
  "MALFORMED_BOUNDARY_RESULT",
  "PRODUCT_BINDING_MISMATCH",
  "INSUFFICIENT_TRUSTWORTHY_EVIDENCE",
  "LOW_EVIDENCE_COVERAGE",
  "INSUFFICIENT_FRESHNESS",
  "LOW_EVIDENCE_QUALITY",
  "MISSING_SEARCH_EVIDENCE",
  "MISSING_REVIEW_EVIDENCE",
  "MISSING_CONFIDENCE_EVIDENCE",
]);

export interface SignalQualityPresentationInput {
  confidenceValue: number | null;
  confidenceLevel: ConsumerConfidenceLevel | null;
  confidenceStatus: ConsumerEvidenceStatus;
  recommendation: Recommendation;
  decisionStatus: RecommendationResultStatus;
  liveCoveragePercent: number | null;
  verifiedCoveragePercent: number | null;
  reasonCodes: readonly string[];
}

export interface EvidenceCoveragePresentation {
  metricLabel: typeof EVIDENCE_COVERAGE_METRIC_LABEL;
  percent: number | null;
  label: string;
  source: "liveCoveragePercent";
  status: ConsumerEvidenceStatus;
  statusLabel: string;
  explanation: typeof EVIDENCE_COVERAGE_EXPLANATION;
}

export interface SignalQualityPresentation {
  metricLabel: typeof SIGNAL_QUALITY_METRIC_LABEL;
  value: number | null;
  valueLabel: string;
  level: ConsumerConfidenceLevel | null;
  qualitativeLabel: ConsumerQualitativeLabel;
  qualitativeSuppressed: boolean;
  explanation: typeof SIGNAL_QUALITY_EXPLANATION;
  evidenceCoverage: EvidenceCoveragePresentation;
}

function coverageBelow(value: number | null, threshold: number): boolean {
  return value === null || value < threshold;
}

function recommendationLacksEvidence(input: SignalQualityPresentationInput): boolean {
  if (input.recommendation !== "NO_RECOMMENDATION") return false;
  if (input.decisionStatus === "unavailable" || input.confidenceStatus === "unavailable") return true;
  return input.reasonCodes.some((code) =>
    INSUFFICIENT_EVIDENCE_REASON_CODES.has(code as RecommendationReasonCode)
  );
}

function neutralQualitativeLabel(
  input: SignalQualityPresentationInput,
  verifiedBelow: boolean,
  recommendationLacksSupport: boolean
): "Limited evidence" | "Insufficient evidence" {
  const liveMissing = input.liveCoveragePercent === null || input.liveCoveragePercent <= 0;
  const verifiedMissing = input.verifiedCoveragePercent === null || input.verifiedCoveragePercent <= 0;
  if (recommendationLacksSupport || verifiedBelow || verifiedMissing || liveMissing) {
    return "Insufficient evidence";
  }
  return "Limited evidence";
}

function coverageStatus(percent: number | null): ConsumerEvidenceStatus {
  if (percent === null || percent <= 0) return "unavailable";
  if (percent < CONFIDENCE_PROVENANCE_WARNING_THRESHOLD_PERCENT) return "degraded";
  return "verified";
}

function coverageStatusLabel(status: ConsumerEvidenceStatus): string {
  if (status === "verified") return "Evidence verified";
  if (status === "degraded") return "Evidence limited";
  return "Not enough evidence";
}

export function formatLiveCoveragePercent(percent: number | null): string {
  if (percent === null) return "Unavailable";
  return `${percent}%`;
}

export function presentSignalQuality(input: SignalQualityPresentationInput): SignalQualityPresentation {
  const liveBelow = coverageBelow(
    input.liveCoveragePercent,
    CONFIDENCE_PROVENANCE_WARNING_THRESHOLD_PERCENT
  );
  const verifiedBelow = coverageBelow(
    input.verifiedCoveragePercent,
    RECOMMENDATION_POLICY.minimumVerifiedCoveragePercent
  );
  const recommendationLacksSupport = recommendationLacksEvidence(input);
  const supportiveLevel = input.confidenceLevel === "Good" || input.confidenceLevel === "High";
  const qualitativeSuppressed =
    input.confidenceValue !== null &&
    supportiveLevel &&
    (liveBelow || verifiedBelow || recommendationLacksSupport);

  let qualitativeLabel: ConsumerQualitativeLabel;
  if (input.confidenceValue === null || input.confidenceLevel === null) {
    qualitativeLabel = "Insufficient evidence";
  } else if (qualitativeSuppressed) {
    qualitativeLabel = neutralQualitativeLabel(input, verifiedBelow, recommendationLacksSupport);
  } else {
    qualitativeLabel = input.confidenceLevel;
  }

  const status = coverageStatus(input.liveCoveragePercent);

  return {
    metricLabel: SIGNAL_QUALITY_METRIC_LABEL,
    value: input.confidenceValue,
    valueLabel: input.confidenceValue === null ? "Signal quality unavailable" : String(input.confidenceValue),
    level: input.confidenceLevel,
    qualitativeLabel,
    qualitativeSuppressed,
    explanation: SIGNAL_QUALITY_EXPLANATION,
    evidenceCoverage: {
      metricLabel: EVIDENCE_COVERAGE_METRIC_LABEL,
      percent: input.liveCoveragePercent,
      label: formatLiveCoveragePercent(input.liveCoveragePercent),
      source: "liveCoveragePercent",
      status,
      statusLabel: coverageStatusLabel(status),
      explanation: EVIDENCE_COVERAGE_EXPLANATION,
    },
  };
}

export function qualitativeChipStatus(
  label: ConsumerQualitativeLabel,
  fallback: ConsumerEvidenceStatus
): ConsumerEvidenceStatus {
  if (label === "High" || label === "Good") return "verified";
  if (label === "Developing" || label === "Limited evidence") return "degraded";
  if (label === "Low" || label === "Insufficient evidence") return "unavailable";
  return fallback;
}
