import { randomUUID } from "node:crypto";
import type { ProductAnalysisResponse } from "../../app/lib/analysis/productAnalysisContract";
import { buildConsumerProductResult } from "../../app/lib/data/consumerResult";
import { buildRecommendationResult } from "../../app/lib/data/recommendationEngine";
import { buildRevenueMvpResult } from "../../app/lib/data/revenueMvpResult";
import { buildProductTrendSnapshotFromSignals } from "../../app/lib/data/snapshotEngine";
import type { NormalizedTrendSignal } from "../../app/lib/data/types";
import { getControlledProductProfile } from "./controlledProductCatalog";
import {
  CONTROLLED_MAX_HTTP_REQUESTS,
  CONTROLLED_MAX_PAID_OPERATIONS,
  CONTROLLED_MAX_TASK_POSTS,
} from "./providerRequestBudget";
import {
  ProductionAnalysisEvidenceCollector,
  type AnalysisEvidenceCollector,
  type AnalysisExecutionContext,
} from "./productionEvidenceCollector";
import type { ProviderRequestUsage } from "./providerRequestBudget";
import { redactApplicationResponse, redactConsumerProductResult } from "./publicResponse";
import {
  NOOP_ALPHA_LOGGER,
  type AlphaLogger,
} from "../runtime/alphaLogger";
import { DEFAULT_ALPHA_JOB_DEADLINE_MS } from "../runtime/runtimeConfig";

interface AnalysisJob {
  analysisId: string;
  productId: string;
  createdAtMs: number;
  response: ProductAnalysisResponse;
  work: Promise<void>;
}

export interface ProductAnalysisOrchestratorOptions {
  evidenceCollector?: AnalysisEvidenceCollector;
  now?: () => Date;
  idFactory?: () => string;
  controlledWindowMs?: number;
  jobDeadlineMs?: number;
  clockMs?: () => number;
  logger?: AlphaLogger;
}

const DEFAULT_CONTROLLED_WINDOW_MS = 15 * 60 * 1000;
const EMPTY_USAGE: ProviderRequestUsage = {
  httpRequestCount: 0,
  paidOperationCount: 0,
  taskPostCount: 0,
};

function isLiveBacked(signal: NormalizedTrendSignal): boolean {
  return signal.sourceProvenance.mode === "live" || signal.sourceProvenance.mode === "derived-live";
}

function defaultAnalysisId(): string {
  return `analysis_${randomUUID().replace(/-/g, "")}`;
}

export class ProductAnalysisOrchestrator {
  private readonly jobs = new Map<string, AnalysisJob>();
  private readonly activeByProduct = new Map<string, string>();
  private readonly evidenceCollector: AnalysisEvidenceCollector;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly controlledWindowMs: number;
  private readonly jobDeadlineMs: number;
  private readonly clockMs: () => number;
  private readonly logger: AlphaLogger;

  constructor(options: ProductAnalysisOrchestratorOptions = {}) {
    this.evidenceCollector = options.evidenceCollector ?? new ProductionAnalysisEvidenceCollector();
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? defaultAnalysisId;
    this.controlledWindowMs = options.controlledWindowMs ?? DEFAULT_CONTROLLED_WINDOW_MS;
    this.jobDeadlineMs = options.jobDeadlineMs ?? DEFAULT_ALPHA_JOB_DEADLINE_MS;
    this.clockMs = options.clockMs ?? Date.now;
    this.logger = options.logger ?? NOOP_ALPHA_LOGGER;
    if (!Number.isFinite(this.jobDeadlineMs) || this.jobDeadlineMs <= 0) {
      throw new Error("invalid_analysis_job_deadline");
    }
  }

  analyzeProduct(productId: string): ProductAnalysisResponse {
    const profile = getControlledProductProfile(productId);
    if (!profile) return { status: "unavailable", reason: "product_not_supported" };

    this.pruneExpiredJobs();
    const existingId = this.activeByProduct.get(productId);
    const existing = existingId ? this.jobs.get(existingId) : undefined;
    if (existing) return redactApplicationResponse(existing.response, existing.productId);

    const analysisId = this.idFactory();
    if (!/^analysis_[A-Za-z0-9_-]{8,128}$/.test(analysisId) || this.jobs.has(analysisId)) {
      return { status: "error", reason: "analysis_failed" };
    }

    const pending: ProductAnalysisResponse = { status: "pending", analysisId };
    const startedAt = this.now().toISOString();
    const startedAtMs = this.clockMs();
    let deadlineReached = false;
    let latestUsage = { ...EMPTY_USAGE };
    const job: AnalysisJob = {
      analysisId,
      productId,
      createdAtMs: this.now().getTime(),
      response: pending,
      work: Promise.resolve(),
    };
    this.jobs.set(analysisId, job);
    this.activeByProduct.set(productId, analysisId);
    this.logger.log({
      event: "analysis_started",
      analysisId,
      productId,
      jobState: "pending",
      startedAt,
    });

    const context: AnalysisExecutionContext = {
      canRequest: () => !deadlineReached && this.clockMs() < startedAtMs + this.jobDeadlineMs,
      onUsage: (usage) => {
        latestUsage = { ...usage };
      },
    };
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<ProductAnalysisResponse>((resolve) => {
      deadlineTimer = setTimeout(() => {
        deadlineReached = true;
        resolve({ status: "unavailable", reason: "analysis_deadline_exceeded" });
      }, this.jobDeadlineMs);
    });
    const execution = this.execute(profile.productId, context)
      .catch((): ProductAnalysisResponse => ({ status: "error", reason: "analysis_failed" }));

    job.work = Promise.race([execution, deadline])
      .then((response) => {
        if (deadlineTimer) clearTimeout(deadlineTimer);
        job.response = redactApplicationResponse(response, job.productId);
        const completedAt = this.now().toISOString();
        const finalStatus = job.response.status === "pending" ? "error" : job.response.status;
        this.logger.log({
          event: "analysis_settled",
          analysisId,
          productId,
          jobState: "settled",
          startedAt,
          completedAt,
          durationMs: Math.max(0, this.clockMs() - startedAtMs),
          ...latestUsage,
          finalStatus,
          ...(job.response.status === "unavailable" || job.response.status === "error"
            ? { reason: job.response.reason }
            : {}),
        });
      });

    return pending;
  }

  getAnalysisStatus(analysisId: string): ProductAnalysisResponse {
    const job = this.jobs.get(analysisId);
    return job
      ? redactApplicationResponse(job.response, job.productId)
      : { status: "unavailable", reason: "analysis_not_found" };
  }

  async waitForSettled(analysisId: string): Promise<ProductAnalysisResponse> {
    const job = this.jobs.get(analysisId);
    if (!job) return { status: "unavailable", reason: "analysis_not_found" };
    await job.work;
    return this.getAnalysisStatus(analysisId);
  }

  private async execute(
    productId: string,
    context: AnalysisExecutionContext
  ): Promise<ProductAnalysisResponse> {
    const profile = getControlledProductProfile(productId);
    if (!profile || profile.productId !== productId) {
      return { status: "error", reason: "product_binding_mismatch" };
    }

    const stableTimestamp = this.now().toISOString();
    const stableNow = () => new Date(stableTimestamp);
    const evidence = await this.evidenceCollector.collect(profile, stableNow, context);

    if (
      evidence.productId !== productId ||
      evidence.signals.some((signal) => signal.productId !== productId)
    ) {
      return { status: "error", reason: "product_binding_mismatch" };
    }
    if (evidence.processPaidOperationRejected) {
      return { status: "unavailable", reason: "process_paid_operation_ceiling_exhausted" };
    }
    if (
      evidence.usage.httpRequestCount > CONTROLLED_MAX_HTTP_REQUESTS ||
      evidence.usage.paidOperationCount > CONTROLLED_MAX_PAID_OPERATIONS ||
      evidence.usage.taskPostCount > CONTROLLED_MAX_TASK_POSTS
    ) {
      return { status: "unavailable", reason: "evidence_unavailable" };
    }
    if (!evidence.signals.some(isLiveBacked)) {
      return { status: "unavailable", reason: "evidence_unavailable" };
    }

    const snapshot = buildProductTrendSnapshotFromSignals(productId, evidence.signals, {
      timestamp: stableTimestamp,
      sourceMode: "live",
    });
    if (snapshot.productId !== productId || snapshot.rawSignals.some((signal) => signal.productId !== productId)) {
      return { status: "error", reason: "product_binding_mismatch" };
    }

    const revenueResult = buildRevenueMvpResult({
      snapshot,
      product: {
        productId,
        canonicalTitle: profile.canonicalTitle,
        brand: profile.brand,
        category: profile.category,
        query: profile.query,
      },
    });
    if (revenueResult.product.productId !== productId) {
      return { status: "error", reason: "product_binding_mismatch" };
    }

    const recommendationResult = buildRecommendationResult({
      revenueMvpResult: revenueResult,
      productId,
      evaluatedAt: stableTimestamp,
    });
    if (recommendationResult.product.productId !== productId) {
      return { status: "error", reason: "product_binding_mismatch" };
    }

    const consumerResult = buildConsumerProductResult({ recommendationResult, productId });
    const redactedResult = redactConsumerProductResult(consumerResult, productId);
    if (!redactedResult || consumerResult.issues.includes("CONSUMER_PRODUCT_BINDING_MISMATCH")) {
      return { status: "error", reason: "product_binding_mismatch" };
    }

    return { status: "completed", result: redactedResult };
  }

  private pruneExpiredJobs(): void {
    const cutoff = this.now().getTime() - this.controlledWindowMs;
    for (const [analysisId, job] of this.jobs) {
      if (job.createdAtMs >= cutoff || job.response.status === "pending") continue;
      this.jobs.delete(analysisId);
      if (this.activeByProduct.get(job.productId) === analysisId) {
        this.activeByProduct.delete(job.productId);
      }
    }
  }
}
