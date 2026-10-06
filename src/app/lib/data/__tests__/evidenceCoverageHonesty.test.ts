import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsumerResultPanel } from "../../../components/ConsumerResultPanel";
import { redactConsumerProductResult } from "../../../../server/analysis/publicResponse";
import { roundTo } from "../../scoring/normalization";
import { TRENDIQ_SCORE_WEIGHTS } from "../../scoring/scoreEngine";
import type { TrendIQScoreComponentKey } from "../../scoring/types";
import { buildConsumerProductResult } from "../consumerResult";
import { VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT } from "../liveSnapshotFixtures";
import { RAY_BAN_META_PRODUCT_ID } from "../mockProviderSignals";
import { buildRecommendationResult, RECOMMENDATION_POLICY } from "../recommendationEngine";
import { buildRevenueMvpResult } from "../revenueMvpResult";
import { buildProductTrendSnapshotFromSignals } from "../snapshotEngine";
import type {
  NormalizedTrendSignal,
  SignalSourceProvenanceMode,
  TrendIQComponentProvenanceSummary,
  TrendIQSnapshotProvenanceSummary,
} from "../types";

const INTENDED_WEIGHT = roundTo(
  Object.values(TRENDIQ_SCORE_WEIGHTS).reduce((sum, weight) => sum + weight, 0),
  4
);

function signal(input: {
  component: TrendIQScoreComponentKey;
  engineField: string;
  mode: SignalSourceProvenanceMode;
  source?: NormalizedTrendSignal["source"];
}): NormalizedTrendSignal {
  return {
    source: input.source ?? (input.component === "reviewQuality" ? "reviews" : "searchWeb"),
    signalType: input.component,
    productId: "coverage-fixture",
    sourceProvenance: {
      mode: input.mode,
      provider: input.mode === "mock" ? "mock_fixture" : "live_fixture",
      providerLabel: "Coverage fixture",
    },
    value: 10,
    normalizedValue: 50,
    sampleSize: 20,
    timestamp: "2026-09-01T12:00:00.000Z",
    confidence: 80,
    metadata: {
      engineField: input.engineField,
      engineValue: 10,
    },
  };
}

const FULL_CONTRACT_FIELDS: Record<TrendIQScoreComponentKey, readonly string[]> = {
  socialMomentum: ["mentions7d", "mentionGrowthPercent", "engagementRatePercent", "creatorPostCount"],
  searchMomentum: ["searchVolume7d", "searchGrowthPercent", "queryShareOfCategoryPercent"],
  sentiment: ["positiveMentionPercent", "negativeMentionPercent"],
  reviewQuality: ["averageRating", "ratingEvidenceCount", "ratingConsensusQuality", "recentAverageRating"],
  purchaseIntent: [
    "buyingKeywordSharePercent",
    "addToCartRatePercent",
    "affiliateClickThroughRatePercent",
    "saveRatePercent",
  ],
  growthVelocity: ["trendChangePercent", "accelerationPercent", "consecutiveGrowthDays"],
  hypeSustainability: [
    "repeatMentionRatePercent",
    "sourceHalfLifeDays",
    "creatorConcentrationPercent",
    "evergreenInterestPercent",
  ],
};

function coverageSnapshot(rawSignals: NormalizedTrendSignal[]) {
  return buildProductTrendSnapshotFromSignals("coverage-fixture", rawSignals, {
    timestamp: "2026-09-01T12:00:00.000Z",
    sourceMode: "live",
  });
}

function requireAudit(snapshot: { liveDataAudit?: TrendIQSnapshotProvenanceSummary }): TrendIQSnapshotProvenanceSummary {
  const audit = snapshot.liveDataAudit;
  if (!audit) throw new Error("expected a live data audit");
  return audit;
}

function requireComponent(
  audit: TrendIQSnapshotProvenanceSummary,
  component: TrendIQScoreComponentKey
): TrendIQComponentProvenanceSummary {
  const summary = audit.componentSummaries.find((item) => item.component === component);
  if (!summary) throw new Error(`expected ${component}`);
  return summary;
}

function rayBanSearchOnlySnapshot() {
  const rawSignals = VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.rawSignals.filter((item) =>
    item.sourceProvenance.provider === "dataforseo_trends"
  );

  return buildProductTrendSnapshotFromSignals(RAY_BAN_META_PRODUCT_ID, rawSignals, {
    timestamp: VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.timestamp,
    sourceMode: "live",
  });
}

describe("evidence coverage honesty", () => {
  it("uses the full TRENDIQ_SCORE_WEIGHTS contract as the coverage denominator", () => {
    expect(TRENDIQ_SCORE_WEIGHTS).toEqual({
      socialMomentum: 0.2,
      searchMomentum: 0.15,
      sentiment: 0.15,
      reviewQuality: 0.15,
      purchaseIntent: 0.15,
      growthVelocity: 0.1,
      hypeSustainability: 0.1,
    });
    expect(INTENDED_WEIGHT).toBe(1);

    const snapshot = rayBanSearchOnlySnapshot();
    const audit = snapshot.liveDataAudit;
    if (!audit) throw new Error("expected a live data audit");

    expect(audit.liveCoveragePercent).toBe(
      roundTo((audit.liveBackedScoringWeight / INTENDED_WEIGHT) * 100, 1)
    );
    expect(audit.totalActiveScoringWeight).toBeLessThan(INTENDED_WEIGHT);
    expect(audit.unavailableWeight).toBe(
      roundTo(INTENDED_WEIGHT - audit.totalActiveScoringWeight, 4)
    );
  });

  it("keeps missing dimensions in the denominator so they reduce coverage", () => {
    const snapshot = buildProductTrendSnapshotFromSignals("coverage-fixture", [
      signal({ component: "searchMomentum", engineField: "searchVolume7d", mode: "live" }),
    ], {
      timestamp: "2026-09-01T12:00:00.000Z",
      sourceMode: "live",
    });
    const audit = snapshot.liveDataAudit;
    if (!audit) throw new Error("expected a live data audit");

    const activeOnlyPercent = roundTo(
      (audit.liveBackedScoringWeight / audit.totalActiveScoringWeight) * 100,
      1
    );

    expect(audit.liveBackedScoringWeight).toBeGreaterThan(0);
    expect(audit.totalActiveScoringWeight).toBeLessThan(INTENDED_WEIGHT);
    expect(activeOnlyPercent).toBe(100);
    expect(audit.liveCoveragePercent).toBe(
      roundTo((audit.liveBackedScoringWeight / INTENDED_WEIGHT) * 100, 1)
    );
    expect(audit.liveCoveragePercent).toBeLessThan(activeOnlyPercent);
    expect(audit.componentSummaries.find((component) => component.component === "reviewQuality")?.fields).toEqual([]);
    expect(audit.componentSummaries.find((component) => component.component === "socialMomentum")?.fields).toEqual([]);
  });

  it("does not report 100% coverage for thin live search when reviews and social are absent", () => {
    const snapshot = rayBanSearchOnlySnapshot();
    const audit = snapshot.liveDataAudit;
    if (!audit) throw new Error("expected a live data audit");
    const activeOnlyPercent = roundTo(
      (audit.liveBackedScoringWeight / audit.totalActiveScoringWeight) * 100,
      1
    );

    expect(audit.liveComponents).toEqual(["searchMomentum", "growthVelocity"]);
    expect(audit.mockFallbackScoringWeight).toBe(0);
    expect(audit.componentSummaries.find((component) => component.component === "reviewQuality")?.fields).toEqual([]);
    expect(audit.componentSummaries.find((component) => component.component === "socialMomentum")?.fields).toEqual([]);
    expect(activeOnlyPercent).toBe(100);
    expect(audit.liveCoveragePercent).toBe(16.8);
    expect(audit.liveCoveragePercent).toBeLessThan(100);

    const search = requireComponent(audit, "searchMomentum");
    const growth = requireComponent(audit, "growthVelocity");
    expect(search.fields.map((field) => field.engineField)).toEqual(["searchGrowthPercent"]);
    expect(search.liveCoveragePercent).toBe(
      roundTo((search.liveBackedWeight / search.scoreWeight) * 100, 1)
    );
    expect(search.liveCoveragePercent).toBe(45);
    expect(growth.fields.map((field) => field.engineField)).toEqual([
      "trendChangePercent",
      "accelerationPercent",
      "consecutiveGrowthDays",
    ]);
    expect(growth.liveBackedWeight).toBe(growth.scoreWeight);
    expect(growth.liveCoveragePercent).toBe(100);
  });

  it("keeps live, mixed, and mock provenance shares", () => {
    const snapshot = buildProductTrendSnapshotFromSignals("coverage-fixture", [
      signal({ component: "searchMomentum", engineField: "searchVolume7d", mode: "live" }),
      signal({ component: "searchMomentum", engineField: "searchGrowthPercent", mode: "mock" }),
      signal({ component: "reviewQuality", engineField: "averageRating", mode: "live", source: "reviews" }),
      signal({ component: "reviewQuality", engineField: "averageRating", mode: "mock", source: "reviews" }),
    ], {
      timestamp: "2026-09-01T12:00:00.000Z",
      sourceMode: "live",
    });
    const audit = snapshot.liveDataAudit;
    if (!audit) throw new Error("expected a live data audit");
    const search = audit.componentSummaries.find((component) => component.component === "searchMomentum");
    const reviews = audit.componentSummaries.find((component) => component.component === "reviewQuality");
    const volume = search?.fields.find((field) => field.engineField === "searchVolume7d");
    const growth = search?.fields.find((field) => field.engineField === "searchGrowthPercent");
    const rating = reviews?.fields.find((field) => field.engineField === "averageRating");

    expect(volume?.provenance).toBe("live");
    expect(volume?.liveBackedWeight).toBe(volume?.scoreWeight);
    expect(growth?.provenance).toBe("mock");
    expect(growth?.liveBackedWeight).toBe(0);
    expect(rating?.provenance).toBe("derived-mixed");
    expect(rating?.liveBackedWeight).toBe(roundTo((rating?.scoreWeight ?? 0) * 0.5, 4));
    expect(audit.liveBackedScoringWeight).toBeGreaterThan(0);
    expect(audit.mockFallbackScoringWeight).toBeGreaterThan(0);
    expect(audit.liveCoveragePercent).toBe(
      roundTo((audit.liveBackedScoringWeight / INTENDED_WEIGHT) * 100, 1)
    );
    expect(audit.liveCoveragePercent).toBeLessThan(100);
    expect(audit.unavailableWeight).toBe(
      roundTo(INTENDED_WEIGHT - audit.totalActiveScoringWeight, 4)
    );
    expect(VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.liveDataAudit?.liveCoveragePercent).toBe(37);
    expect(VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.liveDataAudit?.weightedLiveIQContribution).toBeGreaterThan(0);
    expect(VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.liveDataAudit?.weightedMockFallbackIQContribution).toBeGreaterThan(0);
  });

  it("reports zero component and snapshot coverage when no evidence is present", () => {
    const audit = requireAudit(coverageSnapshot([]));

    expect(audit.liveBackedScoringWeight).toBe(0);
    expect(audit.totalActiveScoringWeight).toBe(0);
    expect(audit.unavailableWeight).toBe(INTENDED_WEIGHT);
    expect(audit.liveCoveragePercent).toBe(0);
    for (const component of audit.componentSummaries) {
      expect(component.fields).toEqual([]);
      expect(component.liveBackedWeight).toBe(0);
      expect(component.liveCoveragePercent).toBe(0);
    }
  });

  it("scores partial live and mock evidence against the full component contract", () => {
    const audit = requireAudit(coverageSnapshot([
      signal({ component: "searchMomentum", engineField: "searchVolume7d", mode: "live" }),
      signal({ component: "searchMomentum", engineField: "searchGrowthPercent", mode: "mock" }),
    ]));
    const search = requireComponent(audit, "searchMomentum");
    const activeWeight = search.liveBackedWeight + search.mockFallbackWeight;
    const activeOnlyPercent = roundTo((search.liveBackedWeight / activeWeight) * 100, 1);

    expect(search.fields.map((field) => field.engineField)).toEqual([
      "searchVolume7d",
      "searchGrowthPercent",
    ]);
    expect(search.liveBackedWeight).toBe(roundTo(TRENDIQ_SCORE_WEIGHTS.searchMomentum * 0.35, 4));
    expect(activeOnlyPercent).toBe(43.8);
    expect(search.liveCoveragePercent).toBe(
      roundTo((search.liveBackedWeight / search.scoreWeight) * 100, 1)
    );
    expect(search.liveCoveragePercent).toBe(35);
    expect(search.scoreWeight).toBe(TRENDIQ_SCORE_WEIGHTS.searchMomentum);
    expect(audit.liveCoveragePercent).toBe(
      roundTo((audit.liveBackedScoringWeight / INTENDED_WEIGHT) * 100, 1)
    );
    expect(audit.liveCoveragePercent).toBeLessThan(search.liveCoveragePercent);
    expect(audit.unavailableWeight).toBe(
      roundTo(INTENDED_WEIGHT - audit.totalActiveScoringWeight, 4)
    );
    expect(audit.unavailableWeight).toBeGreaterThan(0);
  });

  it("reports 100% coverage only when the full score contract is live-backed", () => {
    const audit = requireAudit(coverageSnapshot(
      (Object.keys(FULL_CONTRACT_FIELDS) as TrendIQScoreComponentKey[]).flatMap((component) =>
        FULL_CONTRACT_FIELDS[component].map((engineField) =>
          signal({ component, engineField, mode: "live" })
        )
      )
    ));

    expect(audit.liveBackedScoringWeight).toBe(INTENDED_WEIGHT);
    expect(audit.totalActiveScoringWeight).toBe(INTENDED_WEIGHT);
    expect(audit.unavailableWeight).toBe(0);
    expect(audit.liveCoveragePercent).toBe(100);
    for (const component of audit.componentSummaries) {
      expect(component.liveBackedWeight).toBe(component.scoreWeight);
      expect(component.liveCoveragePercent).toBe(100);
    }
    expect(requireComponent(audit, "sentiment").fields.map((field) => field.engineField)).toEqual([
      "netMentionSentimentPercent",
      "positiveMentionPercent",
      "negativeMentionPercent",
    ]);
  });

  it("keeps an unavailable source inside intended weight", () => {
    const audit = requireAudit(coverageSnapshot([
      signal({ component: "searchMomentum", engineField: "searchVolume7d", mode: "live" }),
    ]));
    const reviews = requireComponent(audit, "reviewQuality");
    const social = requireComponent(audit, "socialMomentum");

    expect(reviews.fields).toEqual([]);
    expect(reviews.liveCoveragePercent).toBe(0);
    expect(social.fields).toEqual([]);
    expect(social.liveCoveragePercent).toBe(0);
    expect(audit.totalActiveScoringWeight).toBeLessThan(INTENDED_WEIGHT);
    expect(audit.unavailableWeight).toBe(
      roundTo(INTENDED_WEIGHT - audit.totalActiveScoringWeight, 4)
    );
    expect(audit.unavailableWeight).toBeGreaterThan(0);
    expect(audit.liveCoveragePercent).toBe(
      roundTo((audit.liveBackedScoringWeight / INTENDED_WEIGHT) * 100, 1)
    );
    expect(audit.liveCoveragePercent).toBeLessThan(100);
  });

  it("does not report 100% component coverage when part of that component contract is absent", () => {
    const audit = requireAudit(coverageSnapshot([
      signal({
        component: "reviewQuality",
        engineField: "ratingConsensusQuality",
        mode: "live",
        source: "reviews",
      }),
    ]));
    const reviews = requireComponent(audit, "reviewQuality");
    const activeOnlyPercent = roundTo(
      (reviews.liveBackedWeight / (reviews.liveBackedWeight + reviews.mockFallbackWeight)) * 100,
      1
    );

    expect(reviews.fields.map((field) => field.engineField)).toEqual(["ratingConsensusQuality"]);
    expect(reviews.mockFallbackWeight).toBe(0);
    expect(activeOnlyPercent).toBe(100);
    expect(reviews.scoreWeight).toBe(TRENDIQ_SCORE_WEIGHTS.reviewQuality);
    expect(reviews.liveCoveragePercent).toBe(
      roundTo((reviews.liveBackedWeight / reviews.scoreWeight) * 100, 1)
    );
    expect(reviews.liveCoveragePercent).toBe(15);
    expect(audit.liveCoveragePercent).toBe(
      roundTo((audit.liveBackedScoringWeight / INTENDED_WEIGHT) * 100, 1)
    );
    expect(audit.liveCoveragePercent).toBeLessThan(reviews.liveCoveragePercent);
  });

  it("keeps NO_RECOMMENDATION and MISSING_REVIEW_EVIDENCE when review evidence is absent", () => {
    expect(RECOMMENDATION_POLICY).toMatchObject({
      minimumVerifiedCoveragePercent: 50,
      supportingScore: 70,
      contradictingScore: 35,
      strongAverageRating: 4.2,
      weakAverageRating: 3.2,
      minimumRatingEvidenceCount: 50,
    });

    const productId = "missing-review-fixture";
    const evaluatedAt = "2026-09-01T12:00:00.000Z";
    const unavailable = { state: "unavailable" as const, value: null, reasons: [] as string[] };
    const recommendation = buildRecommendationResult({
      productId,
      evaluatedAt,
      revenueMvpResult: {
        version: "revenue_mvp_result_v1",
        status: "partial",
        product: { productId, title: "Fixture", brand: "Fixture", category: "Fixture", query: null },
        score: {
          state: "verified",
          value: { score: 80, scoreVersion: "v1.1", weightedComponentScore: 80, penaltyTotal: 0 },
          reasons: [],
          liveCoveragePercent: 100,
          totalActiveScoringWeight: 1,
          liveBackedScoringWeight: 1,
          mockFallbackScoringWeight: 0,
          verifiedComponents: ["searchMomentum"],
          degradedComponents: [],
          unsupportedScoreComponents: [],
          excludedMockFallbackComponents: [],
        },
        confidence: {
          state: "verified",
          value: {
            score: 90,
            level: "High",
            scoreVersion: "v1.1",
            meaning: "evidence_quality_not_correctness_probability",
            provenanceWarning: null,
          },
          reasons: [],
          liveCoveragePercent: 100,
        },
        search: {
          state: "verified",
          searchMomentum: {
            state: "verified",
            value: { direction: "Rising", strength: "High", evidenceQuality: "observed" },
            reasons: [],
          },
          absoluteDemand: {
            state: "verified",
            value: { strength: "High" },
            reasons: [],
          },
          directionalDemand: {
            state: "verified",
            value: { direction: "Rising", strength: "High", evidenceQuality: "observed" },
            reasons: [],
          },
          legacyMomentum: unavailable,
          provenance: { measurementScope: "exact", query: null, sources: [] },
          reasons: [],
        },
        reviews: {
          state: "unavailable",
          aggregateRating: unavailable,
          ratingConsensus: unavailable,
          recentRating: unavailable,
          textEvidence: unavailable,
          providerIdsRedacted: true,
          rawReviewBodiesExposed: false,
          reasons: [],
        },
        trust: {
          verifiedCoveragePercent: 75,
          freshestSignalAt: "2026-09-01T00:00:00.000Z",
          mockFallbackSignalCountExcluded: 0,
          mockFallbackComponentsExcluded: [],
          verifiedDimensions: ["confidence", "searchMomentum"],
          degradedDimensions: [],
          unavailableDimensions: ["reviews"],
        },
      },
    });

    expect(recommendation.recommendation).toBe("NO_RECOMMENDATION");
    expect(recommendation.take.reasons.map((reason) => reason.code)).toContain("MISSING_REVIEW_EVIDENCE");
  });

  it("keeps a thin Ray-Ban search from looking fully covered while still abstaining", () => {
    const snapshot = rayBanSearchOnlySnapshot();
    const revenue = buildRevenueMvpResult({
      snapshot,
      product: {
        productId: RAY_BAN_META_PRODUCT_ID,
        canonicalTitle: "Ray-Ban Meta Glasses",
        brand: "Ray-Ban",
        category: "Tech",
      },
    });
    const recommendation = buildRecommendationResult({
      revenueMvpResult: revenue,
      productId: RAY_BAN_META_PRODUCT_ID,
      evaluatedAt: snapshot.timestamp,
    });
    const consumer = buildConsumerProductResult({
      recommendationResult: recommendation,
      productId: RAY_BAN_META_PRODUCT_ID,
    });
    const html = renderToStaticMarkup(createElement(ConsumerResultPanel, {
      consumerResult: consumer,
      productId: RAY_BAN_META_PRODUCT_ID,
    }));

    expect(revenue.score.reasons).toContain("score_input_is_incomplete");
    expect(revenue.score.state).not.toBe("verified");
    expect(revenue.score.liveCoveragePercent).toBe(16.8);
    expect(recommendation.recommendation).toBe("NO_RECOMMENDATION");
    expect(recommendation.take.reasons.map((reason) => reason.code)).toEqual([
      "LOW_EVIDENCE_COVERAGE",
      "SCORE_NOT_FULLY_VERIFIED",
      "CONFIDENCE_IS_EVIDENCE_QUALITY",
      "MISSING_TEXT_REVIEW_EVIDENCE",
      "UNSUPPORTED_DIMENSIONS_EXCLUDED",
    ]);
    expect(consumer.score.value).toEqual(revenue.score.value?.score ?? null);
    expect(consumer.score.scoreInputIncomplete).toBe(true);
    expect(consumer.decision.recommendation).toBe("NO_RECOMMENDATION");
    expect(html).toContain("NO RECOMMENDATION");
    expect(html).toContain("Evidence incomplete");
    expect(html).toContain("a recommendation cannot safely be made");
    expect(html).not.toContain("Live evidence coverage: 100%");
    expect(html).not.toContain("Live evidence coverage:");
    if (consumer.score.value !== null) {
      expect(html).not.toContain(`>${consumer.score.value}<`);
    }

    const redacted = redactConsumerProductResult(consumer, RAY_BAN_META_PRODUCT_ID);
    const redactedHtml = renderToStaticMarkup(createElement(ConsumerResultPanel, {
      consumerResult: redacted,
      productId: RAY_BAN_META_PRODUCT_ID,
    }));
    expect(redacted?.score.scoreInputIncomplete).toBe(true);
    expect(redacted?.score.value).toBe(consumer.score.value);
    expect(redactedHtml).toContain("Evidence incomplete");
    expect(redactedHtml).not.toContain("Live evidence coverage:");
  });
});
