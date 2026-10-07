import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsumerResultPanel } from "../../../components/ConsumerResultPanel";
import { buildConsumerResultViewModel } from "../../presentation/consumerResultViewModel";
import { getControlledProductProfile } from "../../../../server/analysis/controlledProductCatalog";
import { ProductAnalysisOrchestrator } from "../../../../server/analysis/productAnalysisOrchestrator";
import { ProductionAnalysisEvidenceCollector } from "../../../../server/analysis/productionEvidenceCollector";
import { redactConsumerProductResult } from "../../../../server/analysis/publicResponse";
import { buildConsumerProductResult } from "../consumerResult";
import { VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT } from "../liveSnapshotFixtures";
import { buildRecommendationResult } from "../recommendationEngine";
import { buildRevenueMvpResult } from "../revenueMvpResult";

const PRODUCT_ID = VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.productId;

function consumerPath() {
  const revenue = buildRevenueMvpResult({
    snapshot: VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT,
    product: {
      productId: PRODUCT_ID,
      canonicalTitle: "Ray-Ban Meta Glasses",
      brand: "Ray-Ban",
      category: "Tech",
    },
  });
  const recommendation = buildRecommendationResult({
    revenueMvpResult: revenue,
    productId: PRODUCT_ID,
    evaluatedAt: VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.timestamp,
  });
  const consumer = buildConsumerProductResult({
    recommendationResult: recommendation,
    productId: PRODUCT_ID,
  });
  const redacted = redactConsumerProductResult(consumer, PRODUCT_ID);
  const view = buildConsumerResultViewModel({
    consumerResult: redacted,
    productId: PRODUCT_ID,
  });
  return { revenue, consumer, redacted, view };
}

describe("confidence provenance exposure", () => {
  it("keeps the numeric score and exposure band while the public card withholds Good", () => {
    expect(VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.confidence.level).toBe("High");
    expect(VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.confidence.score).toBe(92);
    expect(VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.liveDataAudit?.liveCoveragePercent).toBe(37);
    expect(VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.liveDataAudit?.confidenceProvenanceWarning).toBe(true);

    const { revenue, redacted, view } = consumerPath();
    const warning = "Confidence is capped at Good, but liveCoveragePercent is 37%, below the 50% provenance-warning threshold.";

    expect(revenue.confidence.value?.level).toBe("Good");
    expect(revenue.confidence.value?.score).toBe(92);
    expect(revenue.confidence.value?.provenanceWarning).toBe(warning);
    expect(revenue.confidence.reasons).toContain(warning);
    expect(revenue.confidence.value?.level).not.toBe("High");

    expect(redacted?.confidence.level).toBe("Good");
    expect(redacted?.confidence.value).toBe(92);
    expect(redacted?.confidence.explanation).toContain(warning);
    expect(redacted?.confidence.explanation).not.toContain("Confidence is High");

    expect(view.confidence.level).toBe("Good");
    expect(view.confidence.value).toBe(92);
    expect(view.confidence.qualitativeSuppressed).toBe(true);
    expect(view.confidence.qualitativeLabel).not.toMatch(/^(Good|High)$/);
    expect(view.evidenceCoverage).toMatchObject({
      percent: 37,
      label: "37%",
      source: "liveCoveragePercent",
    });
    expect(view.confidence.explanation).not.toContain(warning);
    expect(view.confidence.explanation).not.toContain("Confidence is High");

    const html = renderToStaticMarkup(createElement(ConsumerResultPanel, {
      consumerResult: redacted,
      productId: PRODUCT_ID,
    }));
    const signalStart = html.indexOf('data-signal-quality=""');
    const signalEnd = html.indexOf('data-evidence-coverage=""');
    const signalCard = html.slice(signalStart, signalEnd);
    expect(signalCard).toContain(">92<");
    expect(signalCard).not.toMatch(/\bGood\b|\bHigh\b/);
    expect(html).toContain("SIGNAL QUALITY");
    expect(html).toContain("EVIDENCE COVERAGE");
    expect(html).toContain("37%");
    expect(html).not.toContain(warning);
    expect(html).not.toContain("Confidence is High");
    expect(html).not.toContain("92 evidence quality");
  });

  it("still returns unavailable evidence when the provider fails, without an invented score", async () => {
    expect(getControlledProductProfile(PRODUCT_ID)?.productId).toBe(PRODUCT_ID);
    const collector = new ProductionAnalysisEvidenceCollector({
      env: {
        TRENDIQ_SEARCH_MODE: "live",
        TRENDIQ_SEARCH_PROVIDER: "dataforseo",
        TRENDIQ_REVIEWS_MODE: "live",
        TRENDIQ_REVIEWS_PROVIDER: "dataforseo",
        DATAFORSEO_LOGIN: "fixture-login",
        DATAFORSEO_PASSWORD: "fixture-password",
        DATAFORSEO_API_BASE_URL: "https://api.dataforseo.com",
      },
      fetchImpl: async () => {
        throw new Error("fixture provider transport failure");
      },
    });
    const orchestrator = new ProductAnalysisOrchestrator({
      evidenceCollector: collector,
      now: () => new Date("2026-09-01T12:00:00.000Z"),
      idFactory: () => "analysis_fixturefail01",
      jobDeadlineMs: 5000,
    });

    const started = orchestrator.analyzeProduct(PRODUCT_ID);
    expect(started.status).toBe("pending");
    if (started.status !== "pending") throw new Error("analysis did not start");
    const settled = await orchestrator.waitForSettled(started.analysisId);

    expect(settled).toEqual({
      status: "unavailable",
      reason: "evidence_unavailable",
    });
  });
});
