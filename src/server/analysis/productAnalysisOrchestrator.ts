import { randomUUID } from "node:crypto";
import type { ProductAnalysisResponse } from "../../app/lib/analysis/productAnalysisContract";
import type { ProductProfile } from "../../app/lib/data/capabilities/types";
import type { FetchLike } from "../../app/lib/data/search/client";
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
import {
  buildOpenAbstentionResult,
  OPEN_ABSTENTION_SUMMARIES,
  withEvidenceNotes,
} from "./openAnalysis/abstentionResult";

interface AnalysisJob {
  analysisId: string;
  productId: string;
  createdAtMs: number;
  response: ProductAnalysisResponse;
  work: Promise<void>;
  /** Open-analysis listeners joined to this job. Catalog jobs leave this unset. */
  settlers?: Array<(response: ProductAnalysisResponse) => void | Promise<void>>;
}

export interface ResolvedAnalysisOptions {
  fetchImpl?: FetchLike;
  evidenceNotes?: () => string[];
  forceAbstention?: () => boolean;
  failureSummary?: () => string;
  /** Joined to the job. The in-memory status stays pending until this settles. */
  onSettled?: (response: ProductAnalysisResponse) => void | Promise<void>;
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
  private readonly resolvedReleases = new Map<string, () => void>();

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

  analyzeResolvedProfile(profile: ProductProfile, options: ResolvedAnalysisOptions = {}): ProductAnalysisResponse {
    if (!/^open-[a-f0-9]{20}$/.test(profile.productId)) {
      return { status: "error", reason: "invalid_request" };
    }
    this.pruneExpiredJobs();
    const existingId = this.activeByProduct.get(profile.productId);
    const existing = existingId ? this.jobs.get(existingId) : undefined;
    if (existing) {
      // A second caller for this product joins the job already in flight.
      // That does not start another provider execution.
      if (existing.response.status === "pending" && options.onSettled && existing.settlers) {
        existing.settlers.push(options.onSettled);
      }
      return redactApplicationResponse(existing.response, existing.productId);
    }

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
      productId: profile.productId,
      createdAtMs: this.now().getTime(),
      response: pending,
      work: Promise.resolve(),
      settlers: options.onSettled ? [options.onSettled] : [],
    };
    this.jobs.set(analysisId, job);
    this.activeByProduct.set(profile.productId, analysisId);
    this.logger.log({
      event: "analysis_started",
      analysisId,
      productId: profile.productId,
      jobState: "pending",
      startedAt,
    });

    const context: AnalysisExecutionContext = {
      canRequest: () => !deadlineReached && this.clockMs() < startedAtMs + this.jobDeadlineMs && !options.forceAbstention?.(),
      onUsage: (usage) => {
        latestUsage = { ...usage };
      },
      fetchImpl: options.fetchImpl,
    };
    let releaseStart = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    this.resolvedReleases.set(analysisId, releaseStart);
    job.work = gate.then(() => new Promise<ProductAnalysisResponse>((resolveRace) => {
      const deadlineTimer = setTimeout(() => {
        deadlineReached = true;
        resolveRace({ status: "unavailable", reason: "analysis_deadline_exceeded" });
      }, this.jobDeadlineMs);
      this.execute(profile.productId, context, profile)
        .catch((): ProductAnalysisResponse => ({ status: "error", reason: "analysis_failed" }))
        .then((response) => {
          clearTimeout(deadlineTimer);
          resolveRace(response);
        });
    }))
      .then(async (response) => {
        const presented = this.presentOpenProduct(response, profile, options, startedAt);
        const redacted = redactApplicationResponse(presented, job.productId);
        // Persist before publishing. Callers that poll status, and callers that
        // await job.work, both observe settlement only after every joined
        // ledger write and its flock helper have finished. Listeners added
        // while an earlier listener is still writing are included.
        const settlers = job.settlers ?? [];
        for (let index = 0; index < settlers.length; index += 1) {
          await settlers[index](redacted);
        }
        job.response = redacted;
        const completedAt = this.now().toISOString();
        const finalStatus = redacted.status === "pending" ? "error" : redacted.status;
        this.logger.log({
          event: "analysis_settled",
          analysisId,
          productId: profile.productId,
          jobState: "settled",
          startedAt,
          completedAt,
          durationMs: Math.max(0, this.clockMs() - startedAtMs),
          ...latestUsage,
          finalStatus,
          ...(redacted.status === "unavailable" || redacted.status === "error"
            ? { reason: redacted.reason }
            : {}),
        });
      });

    return pending;
  }

  releaseResolvedAnalysis(analysisId: string): void {
    const release = this.resolvedReleases.get(analysisId);
    if (!release) return;
    this.resolvedReleases.delete(analysisId);
    release();
  }

  private presentOpenProduct(
    response: ProductAnalysisResponse,
    profile: ProductProfile,
    options: ResolvedAnalysisOptions,
    evaluatedAt: string
  ): ProductAnalysisResponse {
    const notes = options.evidenceNotes?.() ?? [];
    const force = options.forceAbstention?.() ?? false;
    const timedOut = response.status === "unavailable" && response.reason === "analysis_deadline_exceeded";
    const evidenceFailed = response.status === "unavailable" && response.reason === "evidence_unavailable";
    const failed = response.status === "error" && response.reason === "analysis_failed";
    if (!force && !timedOut && !evidenceFailed && !failed) {
      if (response.status !== "completed") return response;
      return { status: "completed", result: withEvidenceNotes(response.result, notes) };
    }
    const summary = force
      ? (options.failureSummary?.() ?? OPEN_ABSTENTION_SUMMARIES.budget)
      : timedOut
        ? OPEN_ABSTENTION_SUMMARIES.timeout
        : OPEN_ABSTENTION_SUMMARIES.evidence;
    const abstained = buildOpenAbstentionResult({
      productId: profile.productId,
      title: profile.canonicalTitle,
      brand: profile.brand,
      category: profile.category,
      evaluatedAt,
      summary,
    });
    if (!abstained) return response.status === "completed"
      ? { status: "unavailable", reason: "evidence_unavailable" }
      : response;
    return { status: "completed", result: withEvidenceNotes(abstained, notes) };
  }

  private async execute(
    productId: string,
    context: AnalysisExecutionContext,
    profileOverride?: ProductProfile
  ): Promise<ProductAnalysisResponse> {
    const profile = profileOverride ?? getControlledProductProfile(productId);
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
