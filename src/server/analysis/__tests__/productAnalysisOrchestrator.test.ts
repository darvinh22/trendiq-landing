import { describe, expect, it, vi } from "vitest";
import { mockReviewsProvider } from "../../../app/lib/data/providers/reviewsProvider";
import { mockSearchProvider } from "../../../app/lib/data/search/mockSearchProvider";
import type { NormalizedTrendSignal } from "../../../app/lib/data/types";
import type {
  AnalysisEvidenceCollection,
  AnalysisEvidenceCollector,
} from "../productionEvidenceCollector";
import { ProductAnalysisOrchestrator } from "../productAnalysisOrchestrator";

const PRODUCT_ID = "ray-ban-meta";
const NOW = "2026-09-02T12:00:00.000Z";

function liveSignals(productId = PRODUCT_ID): NormalizedTrendSignal[] {
  return [
    ...mockSearchProvider.getSignals(PRODUCT_ID),
    ...mockReviewsProvider.getSignals(PRODUCT_ID),
  ].map((signal) => ({
    ...signal,
    productId,
    timestamp: NOW,
    sourceProvenance: {
      ...signal.sourceProvenance,
      mode: signal.source === "reviews" ? "derived-live" : "live",
      provider: `sanitized_${signal.source}`,
      liveApiRequestMade: true,
    },
  }));
}

function collection(overrides: Partial<AnalysisEvidenceCollection> = {}): AnalysisEvidenceCollection {
  return {
    productId: PRODUCT_ID,
    searchStatus: "completed",
    reviewStatus: "completed",
    signals: liveSignals(),
    usage: { httpRequestCount: 6, paidOperationCount: 4, taskPostCount: 2 },
    ...overrides,
  };
}

function orchestratorFor(
  result: AnalysisEvidenceCollection | Promise<AnalysisEvidenceCollection>,
  collect = vi.fn(async () => result)
) {
  const evidenceCollector: AnalysisEvidenceCollector = { collect };
  const orchestrator = new ProductAnalysisOrchestrator({
    evidenceCollector,
    now: () => new Date(NOW),
    idFactory: () => "analysis_offlinefixture01",
  });
  return { orchestrator, collect };
}

describe("ProductAnalysisOrchestrator", () => {
  it("runs an allowlisted product through the frozen result constructors", async () => {
    const { orchestrator } = orchestratorFor(collection());
    const started = orchestrator.analyzeProduct(PRODUCT_ID);
    expect(started).toEqual({ status: "pending", analysisId: "analysis_offlinefixture01" });

    const settled = await orchestrator.waitForSettled("analysis_offlinefixture01");
    expect(settled.status).toBe("completed");
    if (settled.status !== "completed") return;
    expect(settled.result.version).toBe("consumer_product_result_v1");
    expect(settled.result.product.id).toBe(PRODUCT_ID);
    expect(["BUY", "WAIT", "SKIP", "NO_RECOMMENDATION"]).toContain(settled.result.decision.recommendation);
  });

  it("fails unknown products before evidence execution", () => {
    const { orchestrator, collect } = orchestratorFor(collection());
    expect(orchestrator.analyzeProduct("unknown-product")).toEqual({
      status: "unavailable",
      reason: "product_not_supported",
    });
    expect(collect).not.toHaveBeenCalled();
  });

  it("rejects Product A evidence bound to Product B", async () => {
    const mismatchedSignals = liveSignals("product-b");
    const { orchestrator } = orchestratorFor(collection({ signals: mismatchedSignals }));
    const started = orchestrator.analyzeProduct(PRODUCT_ID);
    if (started.status !== "pending") throw new Error("expected pending");
    await expect(orchestrator.waitForSettled(started.analysisId)).resolves.toEqual({
      status: "error",
      reason: "product_binding_mismatch",
    });
  });

  it("deduplicates concurrent requests inside the controlled paid-operation window", async () => {
    let resolveCollection!: (value: AnalysisEvidenceCollection) => void;
    const deferred = new Promise<AnalysisEvidenceCollection>((resolve) => {
      resolveCollection = resolve;
    });
    const collect = vi.fn(() => deferred);
    const { orchestrator } = orchestratorFor(deferred, collect);

    const first = orchestrator.analyzeProduct(PRODUCT_ID);
    const duplicate = orchestrator.analyzeProduct(PRODUCT_ID);
    expect(duplicate).toEqual(first);
    expect(collect).toHaveBeenCalledTimes(1);

    resolveCollection(collection());
    if (first.status !== "pending") throw new Error("expected pending");
    await orchestrator.waitForSettled(first.analysisId);
    expect(orchestrator.analyzeProduct(PRODUCT_ID).status).toBe("completed");
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it("moves a pending server job to a truthful deadline terminal state without starting another analysis", async () => {
    vi.useFakeTimers();
    try {
      let resolveCollection!: (value: AnalysisEvidenceCollection) => void;
      const deferred = new Promise<AnalysisEvidenceCollection>((resolve) => {
        resolveCollection = resolve;
      });
      const collect = vi.fn((_profile, _now, context) => {
        context?.onUsage?.({ httpRequestCount: 1, paidOperationCount: 1, taskPostCount: 1 });
        return deferred;
      });
      const logger = { log: vi.fn() };
      const orchestrator = new ProductAnalysisOrchestrator({
        evidenceCollector: { collect } as AnalysisEvidenceCollector,
        now: () => new Date(NOW),
        clockMs: Date.now,
        idFactory: () => "analysis_deadlinefixture",
        jobDeadlineMs: 100,
        logger,
      });

      const started = orchestrator.analyzeProduct(PRODUCT_ID);
      if (started.status !== "pending") throw new Error("expected pending");
      await vi.advanceTimersByTimeAsync(100);

      await expect(orchestrator.waitForSettled(started.analysisId)).resolves.toEqual({
        status: "unavailable",
        reason: "analysis_deadline_exceeded",
      });
      expect(orchestrator.analyzeProduct(PRODUCT_ID)).toEqual({
        status: "unavailable",
        reason: "analysis_deadline_exceeded",
      });
      expect(collect).toHaveBeenCalledTimes(1);
      expect(logger.log).toHaveBeenLastCalledWith(expect.objectContaining({
        event: "analysis_settled",
        analysisId: started.analysisId,
        httpRequestCount: 1,
        paidOperationCount: 1,
        taskPostCount: 1,
        finalStatus: "unavailable",
        reason: "analysis_deadline_exceeded",
      }));

      resolveCollection(collection());
      await Promise.resolve();
      await Promise.resolve();
      expect(orchestrator.getAnalysisStatus(started.analysisId)).toEqual({
        status: "unavailable",
        reason: "analysis_deadline_exceeded",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires settled in-memory jobs only when a later explicit analysis request prunes them", async () => {
    let currentMs = Date.parse(NOW);
    let id = 0;
    const collect = vi.fn(async () => collection());
    const orchestrator = new ProductAnalysisOrchestrator({
      evidenceCollector: { collect } as AnalysisEvidenceCollector,
      now: () => new Date(currentMs),
      clockMs: () => currentMs,
      controlledWindowMs: 1_000,
      idFactory: () => `analysis_cleanupfixture0${++id}`,
    });

    const first = orchestrator.analyzeProduct(PRODUCT_ID);
    if (first.status !== "pending") throw new Error("expected pending");
    await orchestrator.waitForSettled(first.analysisId);
    expect(orchestrator.analyzeProduct(PRODUCT_ID).status).toBe("completed");

    currentMs += 1_001;
    const second = orchestrator.analyzeProduct(PRODUCT_ID);
    expect(second).toEqual({ status: "pending", analysisId: "analysis_cleanupfixture02" });
    expect(orchestrator.getAnalysisStatus(first.analysisId)).toEqual({
      status: "unavailable",
      reason: "analysis_not_found",
    });
    expect(collect).toHaveBeenCalledTimes(2);
    if (second.status === "pending") await orchestrator.waitForSettled(second.analysisId);
  });

  it.each([
    ["search degradation", collection({ searchStatus: "unavailable", signals: liveSignals().filter((s) => s.source === "reviews") })],
    ["aggregate identity inconclusive", collection({ reviewStatus: "unavailable", signals: liveSignals().filter((s) => s.source === "searchWeb") })],
    ["provider failure", collection({ searchStatus: "unavailable", reviewStatus: "unavailable", signals: [] })],
    ["timeout", collection({ reviewStatus: "unavailable", signals: [] })],
  ])("degrades truthfully for %s", async (_name, evidence) => {
    const { orchestrator } = orchestratorFor(evidence);
    const started = orchestrator.analyzeProduct(PRODUCT_ID);
    if (started.status !== "pending") throw new Error("expected pending");
    const settled = await orchestrator.waitForSettled(started.analysisId);
    if (evidence.signals.length) {
      expect(settled.status).toBe("completed");
    } else {
      expect(settled).toEqual({ status: "unavailable", reason: "evidence_unavailable" });
    }
  });

  it("prevents fallback contamination from becoming a directional result", async () => {
    const fallback = [...mockSearchProvider.getSignals(PRODUCT_ID), ...mockReviewsProvider.getSignals(PRODUCT_ID)]
      .map((signal) => ({
        ...signal,
        timestamp: NOW,
        sourceProvenance: { ...signal.sourceProvenance, mode: "fallback" as const },
      }));
    const { orchestrator } = orchestratorFor(collection({ signals: fallback }));
    const started = orchestrator.analyzeProduct(PRODUCT_ID);
    if (started.status !== "pending") throw new Error("expected pending");
    expect(await orchestrator.waitForSettled(started.analysisId)).toEqual({
      status: "unavailable",
      reason: "evidence_unavailable",
    });
  });

  it("fails closed on stale evidence with a genuine NO_RECOMMENDATION", async () => {
    const staleSignals = liveSignals().map((signal) => ({ ...signal, timestamp: "2025-01-01T00:00:00.000Z" }));
    const { orchestrator } = orchestratorFor(collection({ signals: staleSignals }));
    const started = orchestrator.analyzeProduct(PRODUCT_ID);
    if (started.status !== "pending") throw new Error("expected pending");
    const settled = await orchestrator.waitForSettled(started.analysisId);
    expect(settled.status).toBe("completed");
    if (settled.status === "completed") {
      expect(settled.result.decision.recommendation).toBe("NO_RECOMMENDATION");
    }
  });

  it("fails closed when injected execution usage exceeds a controlled budget", async () => {
    const { orchestrator } = orchestratorFor(collection({
      usage: { httpRequestCount: 11, paidOperationCount: 5, taskPostCount: 3 },
    }));
    const started = orchestrator.analyzeProduct(PRODUCT_ID);
    if (started.status !== "pending") throw new Error("expected pending");
    expect(await orchestrator.waitForSettled(started.analysisId)).toEqual({
      status: "unavailable",
      reason: "evidence_unavailable",
    });
  });

  it("returns only a safe application error when orchestration throws", async () => {
    const collect = vi.fn(async () => {
      throw new Error("Authorization Basic SECRET provider-task-123 C:\\private\\.env");
    });
    const { orchestrator } = orchestratorFor(collection(), collect);
    const started = orchestrator.analyzeProduct(PRODUCT_ID);
    if (started.status !== "pending") throw new Error("expected pending");
    const settled = await orchestrator.waitForSettled(started.analysisId);
    expect(settled).toEqual({ status: "error", reason: "analysis_failed" });
    expect(JSON.stringify(settled)).not.toMatch(/SECRET|provider-task|private/i);
  });

  it("does not project malicious provider fields through the application boundary", async () => {
    const signals = liveSignals().map((signal, index) => index === 0 ? {
      ...signal,
      sourceProvenance: {
        ...signal.sourceProvenance,
        provider: "secret-provider-token",
        notes: "Authorization Basic SECRET API_KEY=SECRET C:\\private\\.env",
      },
      metadata: {
        ...signal.metadata,
        taskId: "provider-task-secret",
        gid: "provider-gid-secret",
        dataDocid: "provider-data-docid-secret",
        providerProductId: "provider-product-secret",
        seller: "seller-secret",
        sourceDomain: "private.example",
        rawQuery: "secret raw query",
        rawResponse: "secret raw response",
        rawReviewBody: "secret review body",
        nested: "unexpected",
      },
    } as unknown as NormalizedTrendSignal : signal);
    const { orchestrator } = orchestratorFor(collection({ signals }));
    const started = orchestrator.analyzeProduct(PRODUCT_ID);
    if (started.status !== "pending") throw new Error("expected pending");
    const serialized = JSON.stringify(await orchestrator.waitForSettled(started.analysisId));
    for (const forbidden of [
      "SECRET", "provider-task-secret", "provider-gid-secret", "provider-data-docid-secret", "provider-product-secret",
      "seller-secret", "private.example", "raw query", "raw response", "review body", "C:\\private",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    for (const forbiddenKey of ["taskId", "gid", "dataDocid", "providerProductId", "seller", "sourceDomain", "rawQuery", "rawResponse", "rawReviewBody"]) {
      expect(serialized).not.toContain(`\"${forbiddenKey}\":`);
    }
  });
});
