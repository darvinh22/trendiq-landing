import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConsumerResultPanel } from "../../../components/ConsumerResultPanel";
import { buildConsumerProductResult } from "../../data/consumerResult";
import { VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT } from "../../data/liveSnapshotFixtures";
import { buildRecommendationResult } from "../../data/recommendationEngine";
import { buildRevenueMvpResult } from "../../data/revenueMvpResult";
import { buildConsumerResultViewModel } from "../consumerResultViewModel";
import { presentSignalQuality } from "../signalQualityPresentation";
import { createConsumerProductResultFixture } from "./consumerProductResultFixture";

const PRODUCT_ID = "fixture-product-a";

function signalQualityCard(html: string): string {
  const start = html.indexOf('data-signal-quality=""');
  const end = html.indexOf('data-evidence-coverage=""');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

function renderPanel(result: ReturnType<typeof createConsumerProductResultFixture>): string {
  return renderToStaticMarkup(createElement(ConsumerResultPanel, { consumerResult: result, productId: PRODUCT_ID }));
}

describe("signal quality presentation honesty", () => {
  it("allows Good when confidence is 65+ and both coverage measures are sufficient", () => {
    const result = createConsumerProductResultFixture({
      recommendation: "BUY",
      status: "verified",
      confidence: 65,
      confidenceLevel: "Good",
      liveCoveragePercent: 80,
      verifiedCoveragePercent: 80,
    });
    const view = buildConsumerResultViewModel({ consumerResult: result, productId: PRODUCT_ID });
    const card = signalQualityCard(renderPanel(result));

    expect(result.decision.recommendation).toBe("BUY");
    expect(view.confidence.value).toBe(65);
    expect(view.confidence.level).toBe("Good");
    expect(view.confidence.qualitativeSuppressed).toBe(false);
    expect(view.confidence.qualitativeLabel).toBe("Good");
    expect(view.evidenceCoverage).toMatchObject({ percent: 80, label: "80%", source: "liveCoveragePercent" });
    expect(card).toContain("SIGNAL QUALITY");
    expect(card).toContain(">65<");
    expect(card).toContain("Good");
    expect(view.evidenceCoverage.percent).toBe(result.score.liveCoveragePercent);
  });

  it("does not present Good or High when confidence is 65+ and live coverage is below 50%", () => {
    const result = createConsumerProductResultFixture({
      recommendation: "BUY",
      status: "verified",
      confidence: 72,
      confidenceLevel: "Good",
      liveCoveragePercent: 49.9,
      verifiedCoveragePercent: 80,
    });
    const view = buildConsumerResultViewModel({ consumerResult: result, productId: PRODUCT_ID });
    const card = signalQualityCard(renderPanel(result));

    expect(view.decision.recommendation).toBe("BUY");
    expect(view.confidence.value).toBe(72);
    expect(view.confidence.level).toBe("Good");
    expect(view.confidence.qualitativeSuppressed).toBe(true);
    expect(view.confidence.qualitativeLabel).toBe("Limited evidence");
    expect(view.evidenceCoverage).toMatchObject({ percent: 49.9, label: "49.9%", source: "liveCoveragePercent" });
    expect(card).toContain(">72<");
    expect(card).toContain("Limited evidence");
    expect(card).not.toMatch(/\bGood\b|\bHigh\b/);
  });

  it("does not present Good or High when confidence is 65+ and verified coverage is below 50%", () => {
    const result = createConsumerProductResultFixture({
      recommendation: "NO_RECOMMENDATION",
      status: "unavailable",
      confidence: 84,
      confidenceLevel: "Good",
      liveCoveragePercent: 90,
      verifiedCoveragePercent: 49.9,
    });
    const view = buildConsumerResultViewModel({ consumerResult: result, productId: PRODUCT_ID });
    const card = signalQualityCard(renderPanel(result));

    expect(view.decision.recommendation).toBe("NO_RECOMMENDATION");
    expect(view.confidence.value).toBe(84);
    expect(view.confidence.level).toBe("Good");
    expect(view.confidence.qualitativeSuppressed).toBe(true);
    expect(view.confidence.qualitativeLabel).toBe("Insufficient evidence");
    expect(card).toContain(">84<");
    expect(card).toContain("Insufficient evidence");
    expect(card).not.toMatch(/\bGood\b|\bHigh\b/);
  });

  it("uses a neutral evidence-limited presentation for NO_RECOMMENDATION with insufficient evidence", () => {
    const result = createConsumerProductResultFixture({
      recommendation: "NO_RECOMMENDATION",
      status: "unavailable",
      confidence: 65,
      confidenceLevel: "Good",
      score: 61,
      scoreStatus: "degraded",
      liveCoveragePercent: 5.3,
      verifiedCoveragePercent: 0,
    });
    const html = renderPanel(result);
    const view = buildConsumerResultViewModel({ consumerResult: result, productId: PRODUCT_ID });
    const card = signalQualityCard(html);

    expect(view.decision.recommendation).toBe("NO_RECOMMENDATION");
    expect(view.decision.recommendationLabel).toBe("NO RECOMMENDATION");
    expect(view.confidence.value).toBe(65);
    expect(view.confidence.qualitativeLabel).toBe("Insufficient evidence");
    expect(view.evidenceCoverage).toMatchObject({ percent: 5.3, label: "5.3%", source: "liveCoveragePercent" });
    expect(html).toContain("NO RECOMMENDATION");
    expect(html).toContain("Evidence incomplete");
    expect(html).toContain("EVIDENCE COVERAGE");
    expect(html).toContain("5.3%");
    expect(card).toContain("SIGNAL QUALITY");
    expect(card).toContain(">65<");
    expect(card).toContain("Insufficient evidence");
    expect(card).not.toMatch(/\bGood\b|\bHigh\b/);
    expect(html).not.toContain("65.3");
    expect(html).not.toContain("70.3");
  });

  it("keeps High available when evidence coverage is high", () => {
    const result = createConsumerProductResultFixture({
      recommendation: "BUY",
      status: "verified",
      confidence: 92,
      confidenceLevel: "High",
      liveCoveragePercent: 100,
      verifiedCoveragePercent: 100,
    });
    const view = buildConsumerResultViewModel({ consumerResult: result, productId: PRODUCT_ID });
    const card = signalQualityCard(renderPanel(result));

    expect(view.confidence.value).toBe(92);
    expect(view.confidence.level).toBe("High");
    expect(view.confidence.qualitativeSuppressed).toBe(false);
    expect(view.confidence.qualitativeLabel).toBe("High");
    expect(card).toContain(">92<");
    expect(card).toContain("High");
  });

  it("does not invent a composite from Signal Quality and Evidence Coverage", () => {
    const presentation = presentSignalQuality({
      confidenceValue: 65,
      confidenceLevel: "Good",
      confidenceStatus: "degraded",
      recommendation: "NO_RECOMMENDATION",
      decisionStatus: "unavailable",
      liveCoveragePercent: 5.3,
      verifiedCoveragePercent: 0,
      reasonCodes: ["LOW_EVIDENCE_COVERAGE"],
    });

    expect(presentation.value).toBe(65);
    expect(presentation.evidenceCoverage.percent).toBe(5.3);
    expect(presentation.evidenceCoverage.source).toBe("liveCoveragePercent");
    expect(presentation.evidenceCoverage.label).toBe("5.3%");
    expect(presentation.valueLabel).not.toContain("%");
    expect(presentation.evidenceCoverage.label).not.toContain("65");
  });
});

describe("Ray-Ban-like consumer panel", () => {
  it("matches the rendered honesty snapshot for sparse evidence", () => {
    const result = createConsumerProductResultFixture({
      productId: PRODUCT_ID,
      recommendation: "NO_RECOMMENDATION",
      status: "unavailable",
      confidence: 65,
      confidenceLevel: "Good",
      score: 61,
      scoreStatus: "degraded",
      liveCoveragePercent: 5.3,
      verifiedCoveragePercent: 0,
    });
    const html = renderToStaticMarkup(
      createElement(ConsumerResultPanel, {
        consumerResult: {
          ...result,
          product: { ...result.product, name: "Ray-Ban Meta Glasses", brand: "Ray-Ban", category: "Tech" },
        },
        productId: PRODUCT_ID,
      })
    );
    const snapshot = readFileSync(
      new URL("./__snapshots__/ray-ban-like-consumer-panel.html", import.meta.url),
      "utf8"
    );

    expect(html).toBe(snapshot);
  });
});

describe("validated Ray-Ban consumer path", () => {
  it("keeps the recommendation and numeric confidence while hiding supportive labels", () => {
    const productId = VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.productId;
    const revenue = buildRevenueMvpResult({
      snapshot: VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT,
      product: {
        productId,
        canonicalTitle: "Ray-Ban Meta Glasses",
        brand: "Ray-Ban",
        category: "Tech",
      },
    });
    const recommendation = buildRecommendationResult({
      revenueMvpResult: revenue,
      productId,
      evaluatedAt: VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.timestamp,
    });
    const consumer = buildConsumerProductResult({
      recommendationResult: recommendation,
      productId,
    });
    const view = buildConsumerResultViewModel({ consumerResult: consumer, productId });
    const html = renderToStaticMarkup(
      createElement(ConsumerResultPanel, { consumerResult: consumer, productId })
    );
    const card = signalQualityCard(html);

    expect(VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.confidence.score).toBe(92);
    expect(VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.confidence.level).toBe("High");
    expect(revenue.confidence.value?.score).toBe(VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.confidence.score);
    expect(recommendation.recommendation).toBe(consumer.decision.recommendation);
    expect(consumer.confidence.value).toBe(revenue.confidence.value?.score ?? null);
    expect(view.decision.recommendation).toBe(recommendation.recommendation);
    expect(view.confidence.value).toBe(consumer.confidence.value);
    expect(view.confidence.level).toBe(consumer.confidence.level);
    expect(view.evidenceCoverage.percent).toBe(consumer.score.liveCoveragePercent);
    expect(view.evidenceCoverage.source).toBe("liveCoveragePercent");
    expect(view.confidence.qualitativeLabel).not.toMatch(/^(Good|High)$/);
    expect(card).toContain(`>${consumer.confidence.value}<`);
    expect(card).not.toMatch(/\bGood\b|\bHigh\b/);
    expect(html).toContain("SIGNAL QUALITY");
    expect(html).toContain("EVIDENCE COVERAGE");
    expect(html).toContain(`${VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT.liveDataAudit?.liveCoveragePercent}%`);
    expect(html).not.toContain("Confidence is capped at Good");
    expect(html).not.toContain("Confidence is High");
  });
});
