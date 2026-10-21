import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConsumerProductResult } from "../../../../app/lib/data/consumerResult";
import { buildRecommendationResult } from "../../../../app/lib/data/recommendationEngine";
import { buildRevenueMvpResult, type RevenueMvpResult } from "../../../../app/lib/data/revenueMvpResult";
import type { ProductTrendSnapshot } from "../../../../app/lib/data/types";
import {
  OPEN_PRODUCT_BATTERY,
  assertBatteryShape,
} from "../../fixtures/openProductBattery/v1/battery";
import { OpenAnalysisService } from "../openAnalysisService";
import { readShoppingCandidates } from "../productResolver";
import { estimateOpenAnalysisSpend } from "../costAccounting";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "trendiq-open-battery-"));
  tempDirs.push(dir);
  return dir;
}

describe("open product battery v1", () => {
  it("is a fixed set of 20 unseen synthetic products with zero cost", () => {
    expect(() => assertBatteryShape()).not.toThrow();
    expect(OPEN_PRODUCT_BATTERY.products).toHaveLength(20);
    expect(OPEN_PRODUCT_BATTERY.label).toBe("synthetic_fixture");
    for (const product of OPEN_PRODUCT_BATTERY.products) {
      expect(product.providerResponse.syntheticFixture).toBe(true);
      expect(product.providerResponse.notLiveData).toBe(true);
      expect(product.providerResponse.cost).toBe(0);
      expect(product.id).not.toBe("ray-ban-meta");
    }
  });

  it("resolves the battery at zero spend and records the outcome table", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("live_network_forbidden");
    });
    const providerReads: string[] = [];
    let spentMicros = 0;

    const rows: Array<{ product: string; outcome: string; reason: string }> = [];
    for (const product of OPEN_PRODUCT_BATTERY.products) {
      const dataDir = await tempDir();
      const service = new OpenAnalysisService({
        enabled: true,
        analysisEnabled: true,
        dataDir,
        now: () => new Date("2026-10-21T00:00:00.000Z"),
        searchCandidates: async (query) => {
          if (query !== product.query) throw new Error(`unexpected query ${query}`);
          if (product.doNotCallProvider) {
            providerReads.push(product.id);
            throw new Error("provider_payload_read");
          }
          return readShoppingCandidates(product.providerResponse);
        },
      });
      const resolved = await service.resolveOpenProduct({ query: product.query, clientKey: "battery" });
      if (product.scenario === "clear_match") {
        expect(resolved.body.status).toBe("resolved");
        rows.push({ product: product.id, outcome: "resolved", reason: "clear identity; analysis not started" });
      } else if (product.scenario === "ambiguous") {
        expect(resolved.body.status).toBe("ambiguous");
        if (resolved.body.status === "ambiguous") {
          expect(resolved.body.candidates.length).toBeGreaterThan(0);
          expect(resolved.body.candidates.length).toBeLessThanOrEqual(3);
        }
        const analysis = await service.analyzeResolution({
          resolutionId: resolved.body.status === "ambiguous" ? resolved.body.resolutionId : "",
          clientKey: "battery",
        });
        expect(analysis).toEqual({ status: "error", reason: "invalid_request" });
        rows.push({ product: product.id, outcome: "ambiguous", reason: "up to 3 options; no analysis until a choice" });
      } else if (product.scenario === "thin_evidence") {
        expect(resolved.body.status).toBe("resolved");
        const recommendation = thinRecommendation(product.id);
        expect(recommendation.recommendation).toBe("NO_RECOMMENDATION");
        expect(recommendation.status).not.toBe("verified");
        const reason = recommendation.take.reasons.find((entry) => entry.code === "LOW_EVIDENCE_COVERAGE");
        expect(reason?.message).toBe("Verified evidence coverage is below the recommendation policy minimum.");
        rows.push({
          product: product.id,
          outcome: "NO_RECOMMENDATION",
          reason: "LOW_EVIDENCE_COVERAGE: Verified evidence coverage is below the recommendation policy minimum.",
        });
      } else if (product.scenario === "unidentifiable" || product.scenario === "accessory" || product.scenario === "bundle" || product.scenario === "used" || product.scenario === "prohibited") {
        expect(resolved.body.status).toBe("abstain");
        if (resolved.body.status !== "abstain") throw new Error("expected abstain");
        rows.push({ product: product.id, outcome: "abstain", reason: resolved.body.reason });
      }
    }

    expect(providerReads).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    const { readFile } = await import("node:fs/promises");
    for (const dir of tempDirs) {
      const store = JSON.parse(await readFile(join(dir, "open-analysis.json"), "utf8")) as {
        spendByDay: Record<string, { micros: number }>;
      };
      spentMicros += Object.values(store.spendByDay).reduce((sum, day) => sum + day.micros, 0);
    }
    expect(spentMicros).toBe(0);
    expect(rows).toEqual([
      { product: "sony-wh-1000xm5", outcome: "resolved", reason: "clear identity; analysis not started" },
      { product: "apple-airpods-pro-2", outcome: "resolved", reason: "clear identity; analysis not started" },
      { product: "nintendo-switch-oled", outcome: "resolved", reason: "clear identity; analysis not started" },
      { product: "kindle-paperwhite", outcome: "resolved", reason: "clear identity; analysis not started" },
      { product: "bose-qc-ultra", outcome: "resolved", reason: "clear identity; analysis not started" },
      { product: "samsung-galaxy-s24", outcome: "ambiguous", reason: "up to 3 options; no analysis until a choice" },
      { product: "ipad-air", outcome: "ambiguous", reason: "up to 3 options; no analysis until a choice" },
      { product: "instant-pot-duo", outcome: "ambiguous", reason: "up to 3 options; no analysis until a choice" },
      { product: "lego-millennium-falcon", outcome: "ambiguous", reason: "up to 3 options; no analysis until a choice" },
      { product: "blue-gadget", outcome: "abstain", reason: "not_found" },
      { product: "xyzzy-plugh-9000", outcome: "abstain", reason: "not_found" },
      { product: "best-headphones", outcome: "abstain", reason: "not_found" },
      { product: "anker-soundcore-q45", outcome: "NO_RECOMMENDATION", reason: "LOW_EVIDENCE_COVERAGE: Verified evidence coverage is below the recommendation policy minimum." },
      { product: "framework-laptop-13", outcome: "NO_RECOMMENDATION", reason: "LOW_EVIDENCE_COVERAGE: Verified evidence coverage is below the recommendation policy minimum." },
      { product: "teenage-engineering-op1", outcome: "NO_RECOMMENDATION", reason: "LOW_EVIDENCE_COVERAGE: Verified evidence coverage is below the recommendation policy minimum." },
      { product: "xm5-charging-case", outcome: "abstain", reason: "accessory" },
      { product: "airpods-case", outcome: "abstain", reason: "accessory" },
      { product: "switch-oled-bundle", outcome: "abstain", reason: "bundle" },
      { product: "dyson-v15-used", outcome: "abstain", reason: "used" },
      { product: "prohibited-oxycodone", outcome: "abstain", reason: "prohibited" },
    ]);
    fetchSpy.mockRestore();
  });

  it("does not label mock or static evidence as verified for an unknown product", () => {
    const productId = "open-0123456789abcdef0123";
    const timestamp = "2026-10-21T00:00:00.000Z";
    const snapshot = {
      productId,
      timestamp,
      sourceMode: "mock",
      rawSignals: [{
        productId,
        source: "fixture",
        signalType: "search_interest",
        timestamp,
        sourceProvenance: { mode: "mock", provider: "fixture" },
        metadata: { monthlySearchVolume: 1000 },
      }],
      aggregatedSignals: {},
      trendIQScore: { score: 90, scoreVersion: "v1.1" },
      confidence: { score: 90, level: "High" },
      trendStatus: { direction: "Rising" },
    } as unknown as ProductTrendSnapshot;
    const revenue = buildRevenueMvpResult({
      snapshot,
      product: { productId, canonicalTitle: "Fixture Headphones", query: "Fixture Headphones" },
    });
    const recommendation = buildRecommendationResult({
      revenueMvpResult: revenue,
      productId,
      evaluatedAt: timestamp,
    });
    const consumer = buildConsumerProductResult({ recommendationResult: recommendation, productId });
    expect(recommendation.status).not.toBe("verified");
    expect(consumer.decision.status).not.toBe("verified");
    expect(consumer.decision.recommendation).not.toBe("BUY");
  });

  it("publishes the spend estimate used by the caps", () => {
    const estimate = estimateOpenAnalysisSpend();
    expect(estimate.label).toBe("estimate");
    expect(estimate.resolveUsd).toBe(0.002);
    expect(estimate.analysisTypicalUsd).toBe(0.1232);
    expect(estimate.fullCycleTypicalUsd).toBe(0.1252);
    expect(estimate.perAnalysisCapUsd).toBe(0.15);
    expect(estimate.dailyCapUsd).toBe(3);
    expect(estimate.maxFullCyclesPerDayAtTypicalCost).toBe(23);
  });
});

function thinRecommendation(productId: string) {
  const fixture = OPEN_PRODUCT_BATTERY.products.find((product) => product.id === productId)?.analysisFixture;
  if (!fixture) throw new Error("missing thin fixture");
  const revenue = {
    version: "revenue_mvp_result_v1",
    status: "usable",
    product: {
      productId,
      title: productId,
      brand: "Fixture",
      category: "General",
      query: productId,
    },
    score: {},
    confidence: {},
    search: {},
    reviews: {
      aggregateRating: {
        state: "verified",
        value: { averageRating: 4.4, ratingEvidenceCount: fixture.ratingEvidenceCount, ratingMax: 5 },
        reasons: [],
      },
      ratingConsensus: {
        state: "verified",
        value: { ratingConsensusQuality: fixture.consensusQuality, mean: 4.2 },
        reasons: [],
      },
    },
    trust: { verifiedCoveragePercent: fixture.verifiedCoveragePercent },
  } as unknown as RevenueMvpResult;
  return buildRecommendationResult({
    revenueMvpResult: revenue,
    productId,
    evaluatedAt: "2026-10-21T00:00:00.000Z",
  });
}
