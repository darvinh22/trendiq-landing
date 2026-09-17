import type {
  ConsumerConfidenceLevel,
  ConsumerEvidenceStatus,
  ConsumerMomentumDirection,
  ConsumerMomentumEvidenceQuality,
  ConsumerMomentumStrength,
  ConsumerProductResult,
} from "../data/consumerResult";

type Recommendation = ConsumerProductResult["decision"]["recommendation"];
type RecommendationResultStatus = ConsumerProductResult["decision"]["status"];
type RecommendationMissingEvidence = ConsumerProductResult["explanation"]["missingEvidence"][number];

export type ConsumerUiIssueCode = "UI_INPUT_MALFORMED" | "UI_PRODUCT_BINDING_MISMATCH";

export interface ConsumerMetricViewModel<TValue> {
  value: TValue | null;
  valueLabel: string;
  status: ConsumerEvidenceStatus;
  statusLabel: string;
  explanation: string;
}

export interface ConsumerResultViewModel {
  version: "consumer_result_view_model_v1";
  product: {
    id: string;
    name: string;
    brand: string | null;
    category: string | null;
  };
  decision: {
    recommendation: Recommendation;
    recommendationLabel: string;
    status: RecommendationResultStatus;
    statusLabel: string;
    headline: string;
    summary: string;
    trustMessage: string;
  };
  score: ConsumerMetricViewModel<number> & {
    liveCoveragePercent: number | null;
    usedForDecision: boolean;
  };
  confidence: ConsumerMetricViewModel<number> & {
    level: ConsumerConfidenceLevel | null;
    meaning: "evidence_quality_not_correctness_probability";
    usedForDecision: boolean;
  };
  momentum: ConsumerMetricViewModel<ConsumerMomentumDirection> & {
    direction: ConsumerMomentumDirection | null;
    strength: ConsumerMomentumStrength | null;
    evidenceQuality: ConsumerMomentumEvidenceQuality | null;
    usedForDecision: boolean;
  };
  reviews: {
    status: ConsumerEvidenceStatus;
    statusLabel: string;
    usedForDecision: boolean;
    aggregate: {
      averageRating: number | null;
      averageRatingLabel: string;
      reviewCount: number | null;
      reviewCountLabel: string;
      status: ConsumerEvidenceStatus;
      statusLabel: string;
    };
    ratingConsensus: {
      quality: number | null;
      qualityLabel: string;
      averageRating: number | null;
      averageRatingLabel: string;
      status: ConsumerEvidenceStatus;
      statusLabel: string;
    };
    recentRating: {
      averageRating: number | null;
      averageRatingLabel: string;
      status: ConsumerEvidenceStatus;
      statusLabel: string;
    };
    textEvidence: {
      status: ConsumerEvidenceStatus;
      statusLabel: string;
      message: string;
      themes: [];
    };
  };
  take: {
    headline: string;
    summary: string;
    reasons: ConsumerProductResult["explanation"]["reasons"];
    watchOuts: string[];
    missingEvidence: Array<{
      key: RecommendationMissingEvidence;
      label: string;
    }>;
  };
  trust: {
    status: RecommendationResultStatus;
    statusLabel: string;
    summary: string;
    verifiedCoveragePercent: number | null;
    evaluatedAtLabel: string;
    freshnessStatus: ConsumerEvidenceStatus;
    freshnessStatusLabel: string;
    freshnessAgeHours: number | null;
    freshnessAgeLabel: string;
    mockFallbackEvidenceExcluded: boolean;
    unavailableDimensionCount: number;
  };
  availability: {
    bestFor: { status: "unavailable"; label: "Best For unavailable" };
    socialAndHype: { status: "unavailable"; label: "Social intelligence not available yet" };
    priceAndCommerce: { status: "unavailable"; label: "Price and commerce not available yet" };
    reviewTextIntelligence: { status: "unavailable"; label: "Review themes not available yet" };
  };
  issues: ConsumerUiIssueCode[];
}

export interface BuildConsumerResultViewModelInput {
  consumerResult: ConsumerProductResult | unknown;
  productId: string;
}

const RECOMMENDATIONS = new Set<Recommendation>(["BUY", "WAIT", "SKIP", "NO_RECOMMENDATION"]);
const STATUSES = new Set<ConsumerEvidenceStatus>(["verified", "degraded", "unavailable"]);
const CONFIDENCE_LEVELS = new Set<ConsumerConfidenceLevel>(["Low", "Developing", "Good", "High"]);
const MOMENTUM_DIRECTIONS = new Set<ConsumerMomentumDirection>(["Exploding", "Rising", "Stable", "Cooling"]);
const MOMENTUM_STRENGTHS = new Set<ConsumerMomentumStrength>(["Low", "Medium", "High"]);
const MOMENTUM_EVIDENCE_QUALITIES = new Set<ConsumerMomentumEvidenceQuality>([
  "observed",
  "sparse",
  "insufficient",
  "missing",
]);
const MISSING_EVIDENCE = new Set<RecommendationMissingEvidence>([
  "score",
  "confidence",
  "searchMomentum",
  "absoluteDemand",
  "searchDirection",
  "reviewAggregate",
  "ratingConsensus",
  "recentRating",
  "reviewText",
  "freshness",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function finiteOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function enumOrNull<T extends string>(value: unknown, allowed: ReadonlySet<T>): value is T | null {
  return value === null || (typeof value === "string" && allowed.has(value as T));
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validProduct(value: unknown): boolean {
  return (
    isRecord(value) &&
    nonEmptyString(value.id) &&
    nullableString(value.name) &&
    nullableString(value.brand) &&
    nullableString(value.category)
  );
}

function validSource(value: unknown): boolean {
  return (
    isRecord(value) &&
    nullableString(value.recommendationResultVersion) &&
    nullableString(value.recommendationPolicyVersion) &&
    nullableString(value.evaluatedAt)
  );
}

function validDecision(value: unknown): boolean {
  return (
    isRecord(value) &&
    RECOMMENDATIONS.has(value.recommendation as Recommendation) &&
    STATUSES.has(value.status as ConsumerEvidenceStatus) &&
    nonEmptyString(value.headline) &&
    nonEmptyString(value.summary) &&
    nonEmptyString(value.trustMessage)
  );
}

function validScore(value: unknown): boolean {
  return (
    isRecord(value) &&
    STATUSES.has(value.status as ConsumerEvidenceStatus) &&
    finiteOrNull(value.value) &&
    finiteOrNull(value.liveCoveragePercent) &&
    typeof value.usedForDecision === "boolean" &&
    nonEmptyString(value.explanation) &&
    (value.status === "unavailable" ? value.value === null : typeof value.value === "number")
  );
}

function validConfidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    STATUSES.has(value.status as ConsumerEvidenceStatus) &&
    finiteOrNull(value.value) &&
    enumOrNull(value.level, CONFIDENCE_LEVELS) &&
    value.meaning === "evidence_quality_not_correctness_probability" &&
    typeof value.usedForDecision === "boolean" &&
    nonEmptyString(value.explanation) &&
    (value.status === "unavailable"
      ? value.value === null && value.level === null
      : typeof value.value === "number" && typeof value.level === "string")
  );
}

function validMomentum(value: unknown): boolean {
  return (
    isRecord(value) &&
    STATUSES.has(value.status as ConsumerEvidenceStatus) &&
    enumOrNull(value.direction, MOMENTUM_DIRECTIONS) &&
    enumOrNull(value.strength, MOMENTUM_STRENGTHS) &&
    enumOrNull(value.evidenceQuality, MOMENTUM_EVIDENCE_QUALITIES) &&
    typeof value.usedForDecision === "boolean" &&
    nonEmptyString(value.explanation) &&
    (value.status === "unavailable" ? value.direction === null : typeof value.direction === "string")
  );
}

function validReviewPart(value: unknown, valueKeys: string[]): boolean {
  return (
    isRecord(value) &&
    STATUSES.has(value.status as ConsumerEvidenceStatus) &&
    valueKeys.every((key) => finiteOrNull(value[key]))
  );
}

function validReviews(value: unknown): boolean {
  if (!isRecord(value) || !STATUSES.has(value.status as ConsumerEvidenceStatus)) return false;
  if (typeof value.usedForDecision !== "boolean") return false;
  if (!validReviewPart(value.aggregate, ["averageRating", "reviewCount"])) return false;
  if (!validReviewPart(value.ratingConsensus, ["quality", "averageRating"])) return false;
  if (!validReviewPart(value.recentRating, ["averageRating"])) return false;

  return (
    isRecord(value.textEvidence) &&
    STATUSES.has(value.textEvidence.status as ConsumerEvidenceStatus) &&
    value.textEvidence.summary === null &&
    Array.isArray(value.textEvidence.themes) &&
    value.textEvidence.themes.length === 0
  );
}

function validExplanation(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.reasons) &&
    value.reasons.every(
      (reason) =>
        isRecord(reason) &&
        nonEmptyString(reason.code) &&
        nonEmptyString(reason.effect) &&
        nonEmptyString(reason.dimension) &&
        nonEmptyString(reason.message)
    ) &&
    stringArray(value.watchOuts) &&
    Array.isArray(value.missingEvidence) &&
    value.missingEvidence.every((item) => MISSING_EVIDENCE.has(item as RecommendationMissingEvidence)) &&
    isRecord(value.bestFor) &&
    value.bestFor.status === "unavailable" &&
    Array.isArray(value.bestFor.items) &&
    value.bestFor.items.length === 0
  );
}

function validTrust(value: unknown): boolean {
  return (
    isRecord(value) &&
    STATUSES.has(value.status as ConsumerEvidenceStatus) &&
    nonEmptyString(value.summary) &&
    finiteOrNull(value.verifiedCoveragePercent) &&
    stringArray(value.verifiedDimensions) &&
    stringArray(value.degradedDimensions) &&
    stringArray(value.unavailableDimensions) &&
    Array.isArray(value.influencingDimensions) &&
    Array.isArray(value.excludedDimensions) &&
    Array.isArray(value.missingCriticalEvidence) &&
    typeof value.mockFallbackEvidenceExcluded === "boolean" &&
    isRecord(value.freshness) &&
    STATUSES.has(value.freshness.status as ConsumerEvidenceStatus) &&
    finiteOrNull(value.freshness.ageHours)
  );
}

function validUnsupported(value: unknown): boolean {
  return (
    isRecord(value) &&
    isRecord(value.reviewTextIntelligence) &&
    value.reviewTextIntelligence.status === "unavailable" &&
    Array.isArray(value.reviewTextIntelligence.pros) &&
    value.reviewTextIntelligence.pros.length === 0 &&
    Array.isArray(value.reviewTextIntelligence.cons) &&
    value.reviewTextIntelligence.cons.length === 0 &&
    isRecord(value.socialAndHype) &&
    value.socialAndHype.status === "unavailable" &&
    isRecord(value.priceAndCommerce) &&
    value.priceAndCommerce.status === "unavailable" &&
    value.priceAndCommerce.price === null &&
    Array.isArray(value.priceAndCommerce.merchantRecommendations) &&
    value.priceAndCommerce.merchantRecommendations.length === 0 &&
    Array.isArray(value.priceAndCommerce.affiliateLinks) &&
    value.priceAndCommerce.affiliateLinks.length === 0
  );
}

function isConsumerProductResult(value: unknown): value is ConsumerProductResult {
  return (
    isRecord(value) &&
    value.version === "consumer_product_result_v1" &&
    validSource(value.source) &&
    validProduct(value.product) &&
    validDecision(value.decision) &&
    validScore(value.score) &&
    validConfidence(value.confidence) &&
    validMomentum(value.momentum) &&
    validReviews(value.reviews) &&
    validExplanation(value.explanation) &&
    validTrust(value.trust) &&
    validUnsupported(value.unsupported) &&
    Array.isArray(value.issues) &&
    value.issues.every((item) => typeof item === "string")
  );
}

function statusLabel(status: ConsumerEvidenceStatus): string {
  if (status === "verified") return "Evidence verified";
  if (status === "degraded") return "Evidence limited";
  return "Not enough evidence";
}

function recommendationLabel(recommendation: Recommendation): string {
  return recommendation === "NO_RECOMMENDATION" ? "NO RECOMMENDATION" : recommendation;
}

function evidenceValue(value: number | null): string {
  return value === null ? "Unavailable" : String(value);
}

function ratingLabel(value: number | null): string {
  return value === null ? "Unavailable" : `${value} / 5`;
}

function countLabel(value: number | null): string {
  return value === null ? "Unavailable" : `${value.toLocaleString("en-US")} reviews`;
}

function timestampLabel(value: string | null): string {
  if (value === null) return "Unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`;
}

function freshnessAgeLabel(value: number | null): string {
  if (value === null) return "Unavailable";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${rounded === 1 ? "hour" : "hours"} old`;
}

function missingEvidenceLabel(value: RecommendationMissingEvidence): string {
  const labels: Record<RecommendationMissingEvidence, string> = {
    score: "Score",
    confidence: "Confidence",
    searchMomentum: "Search momentum",
    absoluteDemand: "Absolute search demand",
    searchDirection: "Search direction",
    reviewAggregate: "Aggregate reviews",
    ratingConsensus: "Rating consensus",
    recentRating: "Recent ratings",
    reviewText: "Review text",
    freshness: "Freshness",
  };
  return labels[value];
}

function textEvidenceMessage(status: ConsumerEvidenceStatus): string {
  if (status === "verified") return "Validated review text is available; no themes are presented.";
  if (status === "degraded") return "Review text evidence is limited; no themes are presented.";
  return "Review text evidence is unavailable; no themes are presented.";
}

function unavailableViewModel(productId: string, issue: ConsumerUiIssueCode): ConsumerResultViewModel {
  return {
    version: "consumer_result_view_model_v1",
    product: { id: productId, name: "Product result unavailable", brand: null, category: null },
    decision: {
      recommendation: "NO_RECOMMENDATION",
      recommendationLabel: recommendationLabel("NO_RECOMMENDATION"),
      status: "unavailable",
      statusLabel: statusLabel("unavailable"),
      headline: "Result unavailable",
      summary: "TrendIQ cannot safely display this consumer result.",
      trustMessage: "TrendIQ does not yet have enough trustworthy evidence for this result.",
    },
    score: {
      value: null,
      valueLabel: "Score unavailable",
      status: "unavailable",
      statusLabel: statusLabel("unavailable"),
      explanation: "A trustworthy Score is unavailable.",
      liveCoveragePercent: null,
      usedForDecision: false,
    },
    confidence: {
      value: null,
      valueLabel: "Confidence unavailable",
      status: "unavailable",
      statusLabel: statusLabel("unavailable"),
      explanation: "Confidence reflects the quality and completeness of available evidence.",
      level: null,
      meaning: "evidence_quality_not_correctness_probability",
      usedForDecision: false,
    },
    momentum: {
      value: null,
      valueLabel: "Momentum unavailable",
      status: "unavailable",
      statusLabel: statusLabel("unavailable"),
      explanation: "Current search timing is unavailable.",
      direction: null,
      strength: null,
      evidenceQuality: null,
      usedForDecision: false,
    },
    reviews: {
      status: "unavailable",
      statusLabel: statusLabel("unavailable"),
      usedForDecision: false,
      aggregate: {
        averageRating: null,
        averageRatingLabel: "Review evidence unavailable",
        reviewCount: null,
        reviewCountLabel: "Unavailable",
        status: "unavailable",
        statusLabel: statusLabel("unavailable"),
      },
      ratingConsensus: {
        quality: null,
        qualityLabel: "Unavailable",
        averageRating: null,
        averageRatingLabel: "Unavailable",
        status: "unavailable",
        statusLabel: statusLabel("unavailable"),
      },
      recentRating: {
        averageRating: null,
        averageRatingLabel: "Unavailable",
        status: "unavailable",
        statusLabel: statusLabel("unavailable"),
      },
      textEvidence: {
        status: "unavailable",
        statusLabel: statusLabel("unavailable"),
        message: textEvidenceMessage("unavailable"),
        themes: [],
      },
    },
    take: { headline: "Result unavailable", summary: "TrendIQ cannot safely display this consumer result.", reasons: [], watchOuts: [], missingEvidence: [] },
    trust: {
      status: "unavailable",
      statusLabel: statusLabel("unavailable"),
      summary: "TrendIQ does not yet have enough trustworthy evidence for this result.",
      verifiedCoveragePercent: null,
      evaluatedAtLabel: "Unavailable",
      freshnessStatus: "unavailable",
      freshnessStatusLabel: statusLabel("unavailable"),
      freshnessAgeHours: null,
      freshnessAgeLabel: "Unavailable",
      mockFallbackEvidenceExcluded: false,
      unavailableDimensionCount: 0,
    },
    availability: {
      bestFor: { status: "unavailable", label: "Best For unavailable" },
      socialAndHype: { status: "unavailable", label: "Social intelligence not available yet" },
      priceAndCommerce: { status: "unavailable", label: "Price and commerce not available yet" },
      reviewTextIntelligence: { status: "unavailable", label: "Review themes not available yet" },
    },
    issues: [issue],
  };
}

export function buildConsumerResultViewModel(input: BuildConsumerResultViewModelInput): ConsumerResultViewModel {
  const productId = nonEmptyString(input.productId) ? input.productId.trim() : "unknown";
  if (!nonEmptyString(input.productId) || !isConsumerProductResult(input.consumerResult)) {
    return unavailableViewModel(productId, "UI_INPUT_MALFORMED");
  }

  const result = input.consumerResult;
  if (result.product.id !== productId) {
    return unavailableViewModel(productId, "UI_PRODUCT_BINDING_MISMATCH");
  }

  const momentumParts = [result.momentum.direction, result.momentum.strength].filter(
    (value): value is string => value !== null
  );

  return {
    version: "consumer_result_view_model_v1",
    product: {
      id: productId,
      name: result.product.name ?? "Product",
      brand: result.product.brand,
      category: result.product.category,
    },
    decision: {
      recommendation: result.decision.recommendation,
      recommendationLabel: recommendationLabel(result.decision.recommendation),
      status: result.decision.status,
      statusLabel: statusLabel(result.decision.status),
      headline: result.decision.headline,
      summary: result.decision.summary,
      trustMessage: result.decision.trustMessage,
    },
    score: {
      value: result.score.value,
      valueLabel: result.score.value === null ? "Score unavailable" : evidenceValue(result.score.value),
      status: result.score.status,
      statusLabel: statusLabel(result.score.status),
      explanation: result.score.explanation,
      liveCoveragePercent: result.score.liveCoveragePercent,
      usedForDecision: result.score.usedForDecision,
    },
    confidence: {
      value: result.confidence.value,
      valueLabel:
        result.confidence.value === null ? "Confidence unavailable" : `${result.confidence.value} evidence quality`,
      status: result.confidence.status,
      statusLabel: statusLabel(result.confidence.status),
      explanation: result.confidence.explanation,
      level: result.confidence.level,
      meaning: result.confidence.meaning,
      usedForDecision: result.confidence.usedForDecision,
    },
    momentum: {
      value: result.momentum.direction,
      valueLabel: result.momentum.direction === null ? "Momentum unavailable" : momentumParts.join(" · "),
      status: result.momentum.status,
      statusLabel: statusLabel(result.momentum.status),
      explanation: result.momentum.explanation,
      direction: result.momentum.direction,
      strength: result.momentum.strength,
      evidenceQuality: result.momentum.evidenceQuality,
      usedForDecision: result.momentum.usedForDecision,
    },
    reviews: {
      status: result.reviews.status,
      statusLabel: statusLabel(result.reviews.status),
      usedForDecision: result.reviews.usedForDecision,
      aggregate: {
        averageRating: result.reviews.aggregate.averageRating,
        averageRatingLabel:
          result.reviews.aggregate.averageRating === null
            ? "Review evidence unavailable"
            : ratingLabel(result.reviews.aggregate.averageRating),
        reviewCount: result.reviews.aggregate.reviewCount,
        reviewCountLabel: countLabel(result.reviews.aggregate.reviewCount),
        status: result.reviews.aggregate.status,
        statusLabel: statusLabel(result.reviews.aggregate.status),
      },
      ratingConsensus: {
        quality: result.reviews.ratingConsensus.quality,
        qualityLabel:
          result.reviews.ratingConsensus.quality === null
            ? "Unavailable"
            : `${result.reviews.ratingConsensus.quality} / 100 evidence quality`,
        averageRating: result.reviews.ratingConsensus.averageRating,
        averageRatingLabel: ratingLabel(result.reviews.ratingConsensus.averageRating),
        status: result.reviews.ratingConsensus.status,
        statusLabel: statusLabel(result.reviews.ratingConsensus.status),
      },
      recentRating: {
        averageRating: result.reviews.recentRating.averageRating,
        averageRatingLabel: ratingLabel(result.reviews.recentRating.averageRating),
        status: result.reviews.recentRating.status,
        statusLabel: statusLabel(result.reviews.recentRating.status),
      },
      textEvidence: {
        status: result.reviews.textEvidence.status,
        statusLabel: statusLabel(result.reviews.textEvidence.status),
        message: textEvidenceMessage(result.reviews.textEvidence.status),
        themes: [],
      },
    },
    take: {
      headline: result.decision.headline,
      summary: result.decision.summary,
      reasons: result.explanation.reasons.map((reason) => ({ ...reason })),
      watchOuts: [...result.explanation.watchOuts],
      missingEvidence: result.explanation.missingEvidence.map((key) => ({ key, label: missingEvidenceLabel(key) })),
    },
    trust: {
      status: result.trust.status,
      statusLabel: statusLabel(result.trust.status),
      summary: result.trust.summary,
      verifiedCoveragePercent: result.trust.verifiedCoveragePercent,
      evaluatedAtLabel: timestampLabel(result.source.evaluatedAt),
      freshnessStatus: result.trust.freshness.status,
      freshnessStatusLabel: statusLabel(result.trust.freshness.status),
      freshnessAgeHours: result.trust.freshness.ageHours,
      freshnessAgeLabel: freshnessAgeLabel(result.trust.freshness.ageHours),
      mockFallbackEvidenceExcluded: result.trust.mockFallbackEvidenceExcluded,
      unavailableDimensionCount: result.trust.unavailableDimensions.length,
    },
    availability: {
      bestFor: { status: "unavailable", label: "Best For unavailable" },
      socialAndHype: { status: "unavailable", label: "Social intelligence not available yet" },
      priceAndCommerce: { status: "unavailable", label: "Price and commerce not available yet" },
      reviewTextIntelligence: { status: "unavailable", label: "Review themes not available yet" },
    },
    issues: [],
  };
}
