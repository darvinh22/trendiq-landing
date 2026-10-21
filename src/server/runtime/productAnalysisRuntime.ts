import { access } from "node:fs/promises";
import path from "node:path";
import type { ProductAnalysisResponse } from "../../app/lib/analysis/productAnalysisContract";
import type { FetchLike } from "../../app/lib/data/search/client";
import { getControlledProductCatalog, getControlledProductProfile } from "../analysis/controlledProductCatalog";
import type { OpenProductAnalysisApi } from "../analysis/productAnalysisApi";
import { OpenAnalysisService } from "../analysis/openAnalysis/openAnalysisService";
import { STORE_FILE_NAME } from "../analysis/openAnalysis/fileStore";
import { ProductAnalysisOrchestrator } from "../analysis/productAnalysisOrchestrator";
import {
  ProductionAnalysisEvidenceCollector,
  type AnalysisEvidenceCollector,
} from "../analysis/productionEvidenceCollector";
import { SanitizedAlphaLogger, type AlphaLogger, type AlphaLogWriter } from "./alphaLogger";
import { ProcessPaidOperationGuard } from "./processPaidOperationGuard";
import {
  DEFAULT_ALPHA_JOB_DEADLINE_MS,
  readPrivateAlphaRuntimeConfig,
  type PrivateAlphaRuntimeConfig,
  type ReadinessFailureReason,
  type RuntimeEnvironment,
} from "./runtimeConfig";

export type RuntimeReadiness =
  | { status: "ready" }
  | { status: "not_ready"; reason: ReadinessFailureReason };

export interface ProductAnalysisRuntimeOptions {
  assetsReady?: () => boolean;
  clockMs?: () => number;
  env?: RuntimeEnvironment;
  evidenceCollector?: AnalysisEvidenceCollector;
  fetchImpl?: FetchLike;
  idFactory?: () => string;
  logger?: AlphaLogger;
  logWriter?: AlphaLogWriter;
  now?: () => Date;
}

function controlledCatalogIsReady(): boolean {
  const catalog = getControlledProductCatalog();
  if (
    catalog.version !== "controlled_product_catalog_v1" ||
    catalog.products.length !== 1 ||
    catalog.products[0]?.productId !== "ray-ban-meta"
  ) {
    return false;
  }
  return getControlledProductProfile("ray-ban-meta")?.productId === "ray-ban-meta";
}

export class ProductAnalysisRuntime implements OpenProductAnalysisApi {
  private openService: OpenAnalysisService | null = null;

  constructor(
    readonly config: PrivateAlphaRuntimeConfig,
    readonly paidOperationGuard: ProcessPaidOperationGuard,
    private readonly orchestrator: ProductAnalysisOrchestrator,
    private readonly evidenceCollector: AnalysisEvidenceCollector,
    private readonly logger: AlphaLogger,
    private readonly assetsReady: () => boolean,
    private readonly now: () => Date,
    private readonly clockMs: () => number,
    private readonly fetchImpl: FetchLike | undefined,
    private readonly idFactory: (() => string) | undefined,
    private readonly env: RuntimeEnvironment
  ) {}

  health(): { status: "ok" } {
    return { status: "ok" };
  }

  readiness(): RuntimeReadiness {
    if (this.config.validationFailure) {
      return { status: "not_ready", reason: this.config.validationFailure };
    }
    if (!controlledCatalogIsReady()) {
      return { status: "not_ready", reason: "catalog_not_ready" };
    }
    if (!this.assetsReady()) {
      return { status: "not_ready", reason: "build_assets_unavailable" };
    }
    if (this.paidOperationGuard.isExhausted()) {
      return { status: "not_ready", reason: "process_paid_operation_ceiling_exhausted" };
    }
    return { status: "ready" };
  }

  analyzeProduct(productId: string): ProductAnalysisResponse {
    if (!getControlledProductProfile(productId)) {
      return this.orchestrator.analyzeProduct(productId);
    }

    const readiness = this.readiness();
    if (readiness.status === "not_ready") {
      const reason = readiness.reason === "analysis_disabled"
        ? "analysis_disabled"
        : readiness.reason === "process_paid_operation_ceiling_exhausted"
          ? "process_paid_operation_ceiling_exhausted"
          : "runtime_not_ready";
      this.logger.log({
        event: "analysis_rejected",
        productId,
        jobState: "rejected",
        startedAt: this.now().toISOString(),
        finalStatus: "unavailable",
        reason,
      });
      return { status: "unavailable", reason };
    }

    return this.orchestrator.analyzeProduct(productId);
  }

  getAnalysisStatus(analysisId: string): ProductAnalysisResponse {
    if (this.openService) {
      const openStatus = this.openService.getAnalysisStatus(analysisId);
      if (openStatus) return openStatus;
    }
    return this.orchestrator.getAnalysisStatus(analysisId);
  }

  resolveOpenProduct(input: { query: string; clientKey?: string }) {
    const service = this.ensureOpenService();
    if (!service) {
      return Promise.resolve({
        statusCode: 503,
        body: { status: "unavailable" as const, reason: "open_analysis_disabled" as const },
      });
    }
    return service.resolveOpenProduct(input);
  }

  analyzeResolution(input: { resolutionId: string; candidateId?: string; clientKey?: string }) {
    const service = this.ensureOpenService();
    if (!service) return Promise.resolve({ status: "unavailable" as const, reason: "open_analysis_disabled" as const });
    return service.analyzeResolution(input);
  }

  async readPersistedAnalysis(analysisId: string): Promise<ProductAnalysisResponse | null> {
    if (!this.config.openAnalysisEnabled) return null;
    if (!this.openService) {
      try {
        await access(path.join(this.config.openAnalysisDataDir, STORE_FILE_NAME));
      } catch {
        return null;
      }
    }
    return this.ensureOpenService()?.readSettledJob(analysisId) ?? null;
  }

  private ensureOpenService(): OpenAnalysisService | null {
    if (!this.config.openAnalysisEnabled) return null;
    if (!this.openService) {
      const login = this.env.DATAFORSEO_LOGIN?.trim() ?? "";
      const password = this.env.DATAFORSEO_PASSWORD?.trim() ?? "";
      this.openService = new OpenAnalysisService({
        enabled: true,
        analysisEnabled: this.config.analysisEnabled,
        readiness: () => {
          const ready = this.readiness();
          return ready.status === "ready"
            ? { status: "ready" as const }
            : { status: "not_ready" as const, reason: ready.reason };
        },
        dataDir: this.config.openAnalysisDataDir,
        now: this.now,
        clockMs: this.clockMs,
        fetchImpl: this.fetchImpl,
        apiBaseUrl: this.config.dataForSeoApiBaseUrl,
        login,
        password,
        liveConfigured: (this.config.searchLive || this.config.reviewsLive) && Boolean(login && password),
        jobDeadlineMs: this.config.jobDeadlineMs ?? DEFAULT_ALPHA_JOB_DEADLINE_MS,
        processPaidOperationGuard: this.paidOperationGuard,
        logger: this.logger,
        idFactory: this.idFactory,
        env: this.config.providerEnvironment,
        evidenceCollector: this.evidenceCollector,
      });
    }
    return this.openService;
  }
}

export function createProductAnalysisRuntime(
  options: ProductAnalysisRuntimeOptions = {}
): ProductAnalysisRuntime {
  const env = options.env ?? process.env;
  const config = readPrivateAlphaRuntimeConfig(env);
  const paidOperationGuard = new ProcessPaidOperationGuard(config.paidOperationCeiling ?? 1);
  const logger = options.logger ?? new SanitizedAlphaLogger(options.logWriter);
  const now = options.now ?? (() => new Date());
  const evidenceCollector = options.evidenceCollector ?? new ProductionAnalysisEvidenceCollector({
    env: config.providerEnvironment,
    fetchImpl: options.fetchImpl,
    logger,
    processPaidOperationGuard: paidOperationGuard,
  });
  const orchestrator = new ProductAnalysisOrchestrator({
    evidenceCollector,
    now,
    clockMs: options.clockMs,
    idFactory: options.idFactory,
    jobDeadlineMs: config.jobDeadlineMs ?? DEFAULT_ALPHA_JOB_DEADLINE_MS,
    logger,
  });

  return new ProductAnalysisRuntime(
    config,
    paidOperationGuard,
    orchestrator,
    evidenceCollector,
    logger,
    options.assetsReady ?? (() => false),
    now,
    options.clockMs ?? Date.now,
    options.fetchImpl,
    options.idFactory,
    env
  );
}
