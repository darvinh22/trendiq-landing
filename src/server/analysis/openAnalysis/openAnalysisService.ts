import { createHash, randomBytes } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import type { ProductAnalysisResponse, ProductResolveResponse } from "../../../app/lib/analysis/productAnalysisContract";
import type { ProductProfile } from "../../../app/lib/data/capabilities/types";
import type { FetchLike } from "../../../app/lib/data/search/client";
import type { AlphaLogger } from "../../runtime/alphaLogger";
import { NOOP_ALPHA_LOGGER } from "../../runtime/alphaLogger";
import type { ProcessPaidOperationGuard } from "../../runtime/processPaidOperationGuard";
import { ProductAnalysisOrchestrator } from "../productAnalysisOrchestrator";
import {
  ProductionAnalysisEvidenceCollector,
  type AnalysisEvidenceCollector,
} from "../productionEvidenceCollector";
import {
  OPEN_ANALYSIS_DAILY_MAX_MICROS,
  OPEN_ANALYSIS_MAX_MICROS,
  PUBLISHED_PRICE_MICROS,
  type AnalysisSpendLedger,
  type SpendReservation,
} from "./costAccounting";
import { createAnalysisSpendTracker } from "./costAccounting";
import { OpenAnalysisFileStore, type ClientWindow, type CycleSpend, type DaySpend, type StoreDocument } from "./fileStore";
import {
  abstainMessage,
  ANALYSIS_RESULT_TTL_MS,
  decideIdentity,
  IDENTITY_AND_SPECS_TTL_MS,
  MAX_ANALYSES_PER_DAY,
  MAX_ANALYSES_PER_HOUR,
  MAX_RESOLVES_PER_DAY,
  PRICE_AVAILABILITY_TTL_MS,
  queryHash,
  sanitizeProductQuery,
  type IdentityDecision,
  type OpenAbstainReason,
  type ShoppingCandidate,
} from "./productResolver";
import { searchShoppingIdentity } from "./shoppingIdentitySearch";
import { OPEN_ABSTENTION_SUMMARIES } from "./abstentionResult";

export interface ProductResolveApiResult {
  statusCode: number;
  body: ProductResolveResponse;
}

export interface OpenAnalysisReadiness {
  status: "ready" | "not_ready";
  reason?: string;
}

export interface OpenAnalysisServiceOptions {
  enabled: boolean;
  /** `TRENDIQ_ANALYSIS_ENABLED`. Default false. Blocks resolve and analysis before any provider call. */
  analysisEnabled?: boolean;
  dataDir: string;
  now?: () => Date;
  clockMs?: () => number;
  fetchImpl?: FetchLike;
  apiBaseUrl?: string;
  login?: string;
  password?: string;
  liveConfigured?: boolean;
  jobDeadlineMs?: number;
  processPaidOperationGuard?: ProcessPaidOperationGuard;
  readiness?: () => OpenAnalysisReadiness;
  logger?: AlphaLogger;
  idFactory?: () => string;
  env?: Record<string, string | undefined>;
  evidenceCollector?: AnalysisEvidenceCollector;
  searchCandidates?: (query: string) => Promise<ShoppingCandidate[]>;
  sleep?: (ms: number) => Promise<void>;
  pollAttempts?: number;
  pollIntervalMs?: number;
}

interface StoredOption {
  candidateId: string;
  title: string;
  brand: string | null;
  identityKey: string;
  profile: ProductProfile;
  price: number | null;
}

interface StoredResolution {
  resolutionId: string;
  queryHash: string;
  status: "resolved" | "ambiguous" | "abstain";
  createdAt: string;
  expiresAt: string;
  evidenceDate: string;
  reason?: OpenAbstainReason;
  message?: string;
  identityKey?: string;
  title?: string;
  brand?: string | null;
  model?: string | null;
  profile?: ProductProfile;
  price?: number | null;
  options?: StoredOption[];
  cycleId?: string;
}

export class OpenAnalysisService {
  private readonly enabled: boolean;
  private readonly analysisEnabled: boolean;
  private readonly dataDir: string;
  private readonly now: () => Date;
  private readonly clockMs: () => number;
  private readonly jobDeadlineMs: number;
  private readonly store: OpenAnalysisFileStore;
  private readonly orchestrator: ProductAnalysisOrchestrator;
  private readonly ledger: AnalysisSpendLedger;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly liveConfigured: boolean;
  private readonly searchCandidates: OpenAnalysisServiceOptions["searchCandidates"];
  private readonly apiBaseUrl: string;
  private readonly login: string;
  private readonly password: string;
  private readonly guard: ProcessPaidOperationGuard | undefined;
  private readonly readiness: OpenAnalysisServiceOptions["readiness"];
  private readonly env: Record<string, string | undefined> | undefined;
  private readonly sleep: OpenAnalysisServiceOptions["sleep"];
  private readonly pollAttempts: number | undefined;
  private readonly pollIntervalMs: number | undefined;

  constructor(options: OpenAnalysisServiceOptions) {
    this.enabled = options.enabled;
    this.analysisEnabled = options.analysisEnabled === true;
    this.dataDir = options.dataDir;
    this.now = options.now ?? (() => new Date());
    this.clockMs = options.clockMs ?? Date.now;
    this.jobDeadlineMs = options.jobDeadlineMs ?? 55_000;
    this.guard = options.processPaidOperationGuard;
    this.readiness = options.readiness;
    this.env = options.env;
    this.sleep = options.sleep;
    this.pollAttempts = options.pollAttempts;
    this.pollIntervalMs = options.pollIntervalMs;
    this.store = new OpenAnalysisFileStore(options.dataDir, {
      now: this.now,
      jobDeadlineMs: options.jobDeadlineMs,
    });
    this.ledger = new StoreSpendLedger(this.store);
    this.fetchImpl = options.fetchImpl;
    this.liveConfigured = options.liveConfigured === true;
    this.searchCandidates = options.searchCandidates;
    this.apiBaseUrl = options.apiBaseUrl ?? "https://api.dataforseo.com";
    this.login = options.login ?? "";
    this.password = options.password ?? "";
    this.orchestrator = new ProductAnalysisOrchestrator({
      evidenceCollector: options.evidenceCollector ?? new ProductionAnalysisEvidenceCollector({
        env: options.env,
        fetchImpl: options.fetchImpl,
        logger: options.logger,
        processPaidOperationGuard: options.processPaidOperationGuard,
      }),
      now: this.now,
      clockMs: options.clockMs,
      idFactory: options.idFactory,
      jobDeadlineMs: options.jobDeadlineMs,
      logger: options.logger ?? NOOP_ALPHA_LOGGER,
    });
  }

  async resolveOpenProduct(input: { query: string; clientKey?: string }): Promise<ProductResolveApiResult> {
    if (!this.enabled) return unavailable("open_analysis_disabled");
    const blocked = this.operationalBlock();
    if (blocked) return unavailable(blocked);
    const sanitized = sanitizeProductQuery(input.query);
    if (!sanitized.ok && sanitized.reason === "query_not_actionable") {
      return {
        statusCode: 400,
        body: { status: "abstain", reason: "query_not_actionable", message: abstainMessage("query_not_actionable") },
      };
    }
    if (!(await this.dataDirWritable())) return unavailable("runtime_not_ready");
    const query = sanitized.query;
    const hash = queryHash(query);
    const cycleId = `cycle_${randomBytes(8).toString("hex")}`;
    try {
      const cached = await this.store.update((document) => {
        if (!reserveResolveSlot(document, this.now())) return "capacity" as const;
        return freshResolution(document, hash, this.now());
      });
      if (cached === "capacity") return unavailable("daily_capacity_reached");
      if (cached) return { statusCode: 200, body: this.publicResolution(cached, true) };
      if (!sanitized.ok) {
        const abstain = await this.rememberAbstain(hash, "prohibited", cycleId);
        return { statusCode: 200, body: abstain };
      }
      if (!this.searchCandidates) {
        const remaining = await this.store.update((document) =>
          OPEN_ANALYSIS_DAILY_MAX_MICROS - (document.spendByDay[dayKey(this.now())]?.micros ?? 0)
        );
        if (!this.canCallProvider()) return unavailable("runtime_not_ready");
        if (remaining < PUBLISHED_PRICE_MICROS.shoppingProductsTaskPost) {
          return unavailable("daily_capacity_reached");
        }
      }
      const candidates = await this.loadCandidates(query, cycleId);
      const decision = decideIdentity({ query, candidates, now: this.now() });
      const stored = await this.store.update((document) => rememberDecision(document, hash, decision, this.now(), cycleId));
      return { statusCode: 200, body: this.publicResolution(stored, false) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "controlled_daily_spend_cap_exceeded") return unavailable("daily_capacity_reached");
      if (message === "controlled_spend_cap_exceeded") return unavailable("daily_capacity_reached");
      if (message === "process_paid_operation_ceiling_exhausted") {
        return unavailable("process_paid_operation_ceiling_exhausted");
      }
      if (message === "runtime_not_ready" || message === "open_analysis_fetch_missing") {
        return unavailable("runtime_not_ready");
      }
      return { statusCode: 503, body: { status: "error", reason: "analysis_failed" } };
    }
  }

  async analyzeResolution(input: {
    resolutionId: string;
    candidateId?: string;
    clientKey?: string;
  }): Promise<ProductAnalysisResponse> {
    if (!this.enabled) return { status: "unavailable", reason: "open_analysis_disabled" };
    const blocked = this.operationalBlock();
    if (blocked) return { status: "unavailable", reason: blocked };
    if (!(await this.dataDirWritable())) return { status: "unavailable", reason: "runtime_not_ready" };
    const client = hashClient(input.clientKey);
    try {
      const prepared = await this.store.update((document) =>
        prepareAnalysis(document, input, client, this.now())
      );
      if (prepared.kind === "response") return prepared.response;
      const tracker = createAnalysisSpendTracker({
        maxMicros: prepared.budgetRemaining,
        ledger: this.ledger,
        now: this.now,
        cycleId: prepared.cycleId,
      });
      const fetchImpl = this.fetchImpl ? tracker.wrap(this.fetchImpl) : undefined;
      const notes = evidenceNotes(prepared.resolution, this.now());
      let analysisId = "";
      const pending = this.orchestrator.analyzeResolvedProfile(prepared.profile, {
        fetchImpl,
        evidenceNotes: () => notes,
        forceAbstention: () => tracker.exceeded,
        failureSummary: () => tracker.dailyBlocked
          ? "Today's analysis capacity was reached before this result could be finished, so TrendIQ is not making a recommendation."
          : OPEN_ABSTENTION_SUMMARIES.budget,
        onSettled: (response) => {
          void this.finishJob(analysisId, prepared.profile, client, response).catch(() => undefined);
        },
      });
      if (pending.status !== "pending") {
        await this.clearInFlight(client);
        return pending;
      }
      analysisId = pending.analysisId;
      await this.store.update((document) => {
        const window = clientWindow(document, client, this.now());
        window.inFlightAnalysisId = pending.analysisId;
        window.inFlightSince = this.now().toISOString();
        document.jobs[pending.analysisId] = {
          status: "pending",
          createdAt: this.now().toISOString(),
          clientHash: client,
        };
      });
      this.orchestrator.releaseResolvedAnalysis(pending.analysisId);
      return pending;
    } catch {
      await this.clearInFlight(client).catch(() => undefined);
      return { status: "unavailable", reason: "analysis_failed" };
    }
  }

  getAnalysisStatus(analysisId: string): ProductAnalysisResponse | null {
    const live = this.orchestrator.getAnalysisStatus(analysisId);
    if (!(live.status === "unavailable" && live.reason === "analysis_not_found")) return live;
    return null;
  }

  async readSettledJob(analysisId: string): Promise<ProductAnalysisResponse | null> {
    try {
      return await this.store.update((document) => {
        const job = document.jobs[analysisId];
        if (!job || job.status !== "settled" || !job.response) return null;
        return job.response as ProductAnalysisResponse;
      });
    } catch {
      return null;
    }
  }

  private async clearInFlight(client: string): Promise<void> {
    await this.store.update((document) => {
      const window = document.clients[client];
      if (!window) return;
      window.inFlightAnalysisId = null;
      window.inFlightSince = null;
    });
  }

  private async finishJob(
    analysisId: string,
    profile: ProductProfile,
    client: string,
    response: ProductAnalysisResponse
  ): Promise<void> {
    await this.store.update((document) => {
      const window = document.clients[client];
      if (window?.inFlightAnalysisId === analysisId) {
        window.inFlightAnalysisId = null;
        window.inFlightSince = null;
      }
      document.jobs[analysisId] = {
        status: "settled",
        createdAt: document.jobs[analysisId]?.createdAt ?? this.now().toISOString(),
        response,
        clientHash: client,
      };
      if (response.status === "completed") {
        document.resultsByIdentity[profile.productId] = {
          expiresAt: new Date(this.now().getTime() + ANALYSIS_RESULT_TTL_MS).toISOString(),
          value: response,
        };
      }
    });
  }

  private operationalBlock():
    | "analysis_disabled"
    | "process_paid_operation_ceiling_exhausted"
    | "runtime_not_ready"
    | null {
    if (!this.analysisEnabled) return "analysis_disabled";
    if (this.guard?.isExhausted()) return "process_paid_operation_ceiling_exhausted";
    const readiness = this.readiness?.();
    if (readiness && readiness.status !== "ready") {
      if (readiness.reason === "analysis_disabled") return "analysis_disabled";
      if (readiness.reason === "process_paid_operation_ceiling_exhausted") {
        return "process_paid_operation_ceiling_exhausted";
      }
      return "runtime_not_ready";
    }
    return null;
  }

  private async dataDirWritable(): Promise<boolean> {
    try {
      await mkdir(this.dataDir, { recursive: true });
      await access(this.dataDir, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  private canCallProvider(): boolean {
    return this.liveConfigured && Boolean(this.login.trim() && this.password.trim() && this.fetchImpl);
  }

  private async loadCandidates(query: string, cycleId: string): Promise<ShoppingCandidate[]> {
    if (this.searchCandidates) return this.searchCandidates(query);
    if (!this.fetchImpl || !this.canCallProvider()) throw new Error("runtime_not_ready");
    return searchShoppingIdentity({
      query,
      apiBaseUrl: this.apiBaseUrl,
      login: this.login,
      password: this.password,
      fetchImpl: this.fetchImpl,
      ledger: this.ledger,
      now: this.now,
      cycleId,
      allowPaidCall: true,
      processPaidOperationGuard: this.guard,
      pollAttempts: this.pollAttempts,
      pollIntervalMs: this.pollIntervalMs,
      sleep: this.sleep,
      clockMs: this.clockMs,
      deadlineAtMs: this.clockMs() + this.jobDeadlineMs,
      env: this.env,
    });
  }

  private async rememberAbstain(hash: string, reason: OpenAbstainReason, cycleId: string): Promise<ProductResolveResponse> {
    const stored = await this.store.update((document) => {
      const now = this.now();
      const resolution = abstainRecord(hash, reason, now, cycleId);
      document.resolutions[resolution.resolutionId] = resolution;
      document.identityByQuery[hash] = { resolutionId: resolution.resolutionId, expiresAt: resolution.expiresAt };
      return resolution;
    });
    return this.publicResolution(stored, false);
  }

  private publicResolution(resolution: StoredResolution, cached: boolean): ProductResolveResponse {
    if (resolution.status === "abstain") {
      const reason = resolution.reason ?? "not_found";
      return { status: "abstain", reason, message: resolution.message ?? abstainMessage(reason) };
    }
    if (resolution.status === "ambiguous") {
      return {
        status: "ambiguous",
        resolutionId: resolution.resolutionId,
        evidenceDate: resolution.evidenceDate,
        candidates: (resolution.options ?? []).slice(0, 3).map((option) => ({
          candidateId: option.candidateId,
          title: option.title,
          brand: option.brand,
        })),
      };
    }
    const price = priceStatusFor(resolution, this.now());
    return {
      status: "resolved",
      resolutionId: resolution.resolutionId,
      title: resolution.title ?? "Unknown product",
      brand: resolution.brand ?? null,
      model: resolution.model ?? null,
      evidenceDate: resolution.evidenceDate,
      priceEvidenceDate: price.priceEvidenceDate,
      priceStatus: price.priceStatus,
      cached,
    };
  }
}

class StoreSpendLedger implements AnalysisSpendLedger {
  constructor(private readonly store: OpenAnalysisFileStore) {}

  reserve(micros: number, now: Date, context?: { cycleId: string }): Promise<SpendReservation> {
    return this.store.update((document) => {
      if (!document.cycles) document.cycles = {};
      if (!context?.cycleId) return { ok: false, micros: 0, reason: "cycle" };
      const key = dayKey(now);
      const day = daySpend(document, key);
      const cycle = ensureCycle(document, context.cycleId, key);
      if (day.micros + micros > OPEN_ANALYSIS_DAILY_MAX_MICROS) return { ok: false, micros: 0, reason: "daily" };
      if (cycle.micros + micros > OPEN_ANALYSIS_MAX_MICROS) return { ok: false, micros: 0, reason: "cycle" };
      const id = randomBytes(8).toString("hex");
      day.micros += micros;
      cycle.micros += micros;
      day.reservations[id] = {
        micros,
        createdAt: now.toISOString(),
        dayKey: key,
        cycleId: context.cycleId,
      };
      if (micros > 0) day.paidOperationCount += 1;
      return { ok: true, id, micros };
    });
  }

  async reconcile(id: string, actualMicros: number, _responseAt: Date): Promise<void> {
    await this.store.update((document) => {
      const found = findReservation(document, id);
      if (!found) return;
      const delta = actualMicros - found.reservation.micros;
      found.day.micros += delta;
      if (found.day.micros < 0) found.day.micros = 0;
      const cycle = document.cycles?.[found.reservation.cycleId];
      if (cycle) {
        cycle.micros += delta;
        if (cycle.micros < 0) cycle.micros = 0;
      }
      delete found.day.reservations[id];
    });
  }
}

type PreparedAnalysis =
  | { kind: "response"; response: ProductAnalysisResponse }
  | {
      kind: "run";
      profile: ProductProfile;
      resolution: StoredResolution;
      budgetRemaining: number;
      cycleId: string;
      analysisPlaceholder: string;
    };

function prepareAnalysis(
  document: StoreDocument,
  input: { resolutionId: string; candidateId?: string },
  client: string,
  now: Date
): PreparedAnalysis {
  const resolution = document.resolutions[input.resolutionId] as StoredResolution | undefined;
  if (!resolution || Date.parse(resolution.expiresAt) <= now.getTime()) {
    return { kind: "response", response: { status: "unavailable", reason: "resolution_not_found" } };
  }
  const chosen = chooseProfile(resolution, input.candidateId);
  if (!chosen) return { kind: "response", response: { status: "error", reason: "invalid_request" } };
  const cached = document.resultsByIdentity[chosen.profile.productId];
  const window = clientWindow(document, client, now);
  if (window.hourAnalyses >= MAX_ANALYSES_PER_HOUR || window.dayAnalyses >= MAX_ANALYSES_PER_DAY) {
    return { kind: "response", response: { status: "unavailable", reason: "rate_limited" } };
  }
  if (cached && Date.parse(cached.expiresAt) > now.getTime()) {
    window.hourAnalyses += 1;
    window.dayAnalyses += 1;
    return { kind: "response", response: cached.value as ProductAnalysisResponse };
  }
  if (window.inFlightAnalysisId) {
    return { kind: "response", response: { status: "unavailable", reason: "rate_limited" } };
  }
  window.hourAnalyses += 1;
  window.dayAnalyses += 1;
  const day = daySpend(document, dayKey(now));
  const dailyRemaining = OPEN_ANALYSIS_DAILY_MAX_MICROS - day.micros;
  const cycleId = resolution.cycleId || `cycle_${input.resolutionId}`;
  const cycleRemaining = OPEN_ANALYSIS_MAX_MICROS - (document.cycles?.[cycleId]?.micros ?? 0);
  if (dailyRemaining <= 0 || cycleRemaining <= 0) {
    window.hourAnalyses -= 1;
    window.dayAnalyses -= 1;
    return { kind: "response", response: { status: "unavailable", reason: "daily_capacity_reached" } };
  }
  day.analysisCount += 1;
  ensureCycle(document, cycleId, dayKey(now));
  window.inFlightAnalysisId = "starting";
  window.inFlightSince = now.toISOString();
  return {
    kind: "run",
    profile: chosen.profile,
    resolution,
    budgetRemaining: Math.min(dailyRemaining, cycleRemaining),
    cycleId,
    analysisPlaceholder: input.resolutionId,
  };
}

function chooseProfile(
  resolution: StoredResolution,
  candidateId?: string
): { profile: ProductProfile; identityKey: string } | null {
  if (resolution.status === "abstain") return null;
  if (resolution.status === "ambiguous") {
    if (!candidateId) return null;
    const option = resolution.options?.find((item) => item.candidateId === candidateId);
    if (!option) return null;
    return { profile: option.profile, identityKey: option.identityKey };
  }
  if (candidateId) return null;
  if (!resolution.profile || !resolution.identityKey) return null;
  return { profile: resolution.profile, identityKey: resolution.identityKey };
}

function rememberDecision(
  document: StoreDocument,
  hash: string,
  decision: IdentityDecision,
  now: Date,
  cycleId: string
): StoredResolution {
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + IDENTITY_AND_SPECS_TTL_MS).toISOString();
  const resolutionId = `resolution_${randomBytes(16).toString("hex")}`;
  let resolution: StoredResolution;
  if (decision.status === "abstain") {
    resolution = {
      resolutionId,
      queryHash: hash,
      status: "abstain",
      createdAt,
      expiresAt,
      evidenceDate: decision.evidenceDate,
      reason: decision.reason,
      message: decision.message,
      cycleId,
    };
  } else if (decision.status === "ambiguous") {
    resolution = {
      resolutionId,
      queryHash: hash,
      status: "ambiguous",
      createdAt,
      expiresAt,
      evidenceDate: decision.evidenceDate,
      options: decision.options,
      cycleId,
    };
  } else {
    resolution = {
      resolutionId,
      queryHash: hash,
      status: "resolved",
      createdAt,
      expiresAt,
      evidenceDate: decision.evidenceDate,
      identityKey: decision.identityKey,
      title: decision.title,
      brand: decision.brand,
      model: decision.model,
      profile: decision.profile,
      price: decision.price,
      cycleId,
    };
    document.specsByIdentity[decision.identityKey] = {
      expiresAt,
      value: { title: decision.title, brand: decision.brand, model: decision.model, observedAt: decision.evidenceDate },
    };
    document.priceByIdentity[decision.identityKey] = {
      observedAt: decision.evidenceDate,
      expiresAt: new Date(now.getTime() + PRICE_AVAILABILITY_TTL_MS).toISOString(),
      amount: decision.price,
    };
  }
  document.resolutions[resolutionId] = resolution;
  document.identityByQuery[hash] = { resolutionId, expiresAt };
  return resolution;
}

function abstainRecord(hash: string, reason: OpenAbstainReason, now: Date, cycleId: string): StoredResolution {
  const createdAt = now.toISOString();
  return {
    resolutionId: `resolution_${randomBytes(16).toString("hex")}`,
    queryHash: hash,
    status: "abstain",
    createdAt,
    expiresAt: new Date(now.getTime() + IDENTITY_AND_SPECS_TTL_MS).toISOString(),
    evidenceDate: createdAt,
    reason,
    message: abstainMessage(reason),
    cycleId,
  };
}

function ensureCycle(document: StoreDocument, cycleId: string, day: string): CycleSpend {
  if (!document.cycles) document.cycles = {};
  const existing = document.cycles[cycleId];
  if (existing) return existing;
  const created = { dayKey: day, micros: 0 };
  document.cycles[cycleId] = created;
  return created;
}

function findReservation(document: StoreDocument, id: string): {
  day: DaySpend;
  reservation: DaySpend["reservations"][string];
} | null {
  for (const day of Object.values(document.spendByDay)) {
    const reservation = day.reservations[id];
    if (reservation) return { day, reservation };
  }
  return null;
}

function freshResolution(document: StoreDocument, hash: string, now: Date): StoredResolution | null {
  const pointer = document.identityByQuery[hash];
  if (!pointer || Date.parse(pointer.expiresAt) <= now.getTime()) return null;
  const resolution = document.resolutions[pointer.resolutionId] as StoredResolution | undefined;
  if (!resolution || Date.parse(resolution.expiresAt) <= now.getTime()) return null;
  return resolution;
}

function reserveResolveSlot(document: StoreDocument, now: Date): boolean {
  const key = dayKey(now);
  const count = document.resolveCountByDay[key] ?? 0;
  if (count >= MAX_RESOLVES_PER_DAY) return false;
  document.resolveCountByDay[key] = count + 1;
  return true;
}

function priceStatusFor(resolution: StoredResolution, now: Date): {
  priceEvidenceDate: string | null;
  priceStatus: "fresh" | "stale" | "missing";
} {
  if (resolution.price === null || resolution.price === undefined) {
    return { priceEvidenceDate: null, priceStatus: "missing" };
  }
  const age = now.getTime() - Date.parse(resolution.evidenceDate);
  if (age > PRICE_AVAILABILITY_TTL_MS) return { priceEvidenceDate: null, priceStatus: "stale" };
  return { priceEvidenceDate: resolution.evidenceDate, priceStatus: "fresh" };
}

function evidenceNotes(resolution: StoredResolution, now: Date): string[] {
  const price = priceStatusFor(resolution, now);
  const notes = [`Identity and specs evidence date: ${formatUtc(resolution.evidenceDate)}.`];
  if (price.priceStatus === "fresh" && price.priceEvidenceDate) {
    notes.push(`Price and availability evidence date: ${formatUtc(price.priceEvidenceDate)}.`);
  } else if (price.priceStatus === "stale") {
    notes.push("Price and availability evidence is older than 24 hours and is not shown.");
  }
  return notes;
}

function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

function clientWindow(document: StoreDocument, client: string, now: Date): ClientWindow {
  const hourKey = now.toISOString().slice(0, 13);
  const day = dayKey(now);
  const current = document.clients[client] ?? {
    hourKey,
    hourAnalyses: 0,
    dayKey: day,
    dayAnalyses: 0,
    inFlightAnalysisId: null,
    inFlightSince: null,
  };
  if (current.hourKey !== hourKey) {
    current.hourKey = hourKey;
    current.hourAnalyses = 0;
  }
  if (current.dayKey !== day) {
    current.dayKey = day;
    current.dayAnalyses = 0;
  }
  document.clients[client] = current;
  return current;
}

function daySpend(document: StoreDocument, day: string): DaySpend {
  const current = document.spendByDay[day] ?? {
    micros: 0,
    reservations: {},
    analysisCount: 0,
    paidOperationCount: 0,
  };
  document.spendByDay[day] = current;
  return current;
}

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function hashClient(value: string | undefined): string {
  return createHash("sha256").update(value?.trim() || "anonymous").digest("hex");
}

function unavailable(reason:
  | "analysis_disabled"
  | "open_analysis_disabled"
  | "daily_capacity_reached"
  | "process_paid_operation_ceiling_exhausted"
  | "runtime_not_ready"
): ProductResolveApiResult {
  return { statusCode: 503, body: { status: "unavailable", reason } };
}
