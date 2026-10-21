import { createHash, randomBytes } from "node:crypto";
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
import { OpenAnalysisFileStore, type ClientWindow, type DaySpend, type StoreDocument } from "./fileStore";
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

export interface OpenAnalysisServiceOptions {
  enabled: boolean;
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
  logger?: AlphaLogger;
  idFactory?: () => string;
  env?: Record<string, string | undefined>;
  evidenceCollector?: AnalysisEvidenceCollector;
  searchCandidates?: (query: string) => Promise<ShoppingCandidate[]>;
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
}

export class OpenAnalysisService {
  private readonly enabled: boolean;
  private readonly now: () => Date;
  private readonly store: OpenAnalysisFileStore;
  private readonly orchestrator: ProductAnalysisOrchestrator;
  private readonly ledger: AnalysisSpendLedger;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly liveConfigured: boolean;
  private readonly searchCandidates: OpenAnalysisServiceOptions["searchCandidates"];
  private readonly apiBaseUrl: string;
  private readonly login: string;
  private readonly password: string;

  constructor(options: OpenAnalysisServiceOptions) {
    this.enabled = options.enabled;
    this.now = options.now ?? (() => new Date());
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
    const sanitized = sanitizeProductQuery(input.query);
    if (!sanitized.ok && sanitized.reason === "query_not_actionable") {
      return {
        statusCode: 400,
        body: { status: "abstain", reason: "query_not_actionable", message: abstainMessage("query_not_actionable") },
      };
    }
    const query = sanitized.query;
    const hash = queryHash(query);
    try {
      if (sanitized.ok && !this.searchCandidates) {
        const gate = await this.store.update((document) => ({
          hit: freshResolution(document, hash, this.now()),
          remaining: OPEN_ANALYSIS_DAILY_MAX_MICROS - (document.spendByDay[dayKey(this.now())]?.micros ?? 0),
        }));
        if (!gate.hit && !this.canCallProvider()) return unavailable("runtime_not_ready");
        if (!gate.hit && gate.remaining < PUBLISHED_PRICE_MICROS.shoppingProductsTaskPost) {
          return unavailable("daily_capacity_reached");
        }
      }
      const cached = await this.store.update((document) => {
        if (!reserveResolveSlot(document, this.now())) return "capacity" as const;
        return freshResolution(document, hash, this.now());
      });
      if (cached === "capacity") return unavailable("daily_capacity_reached");
      if (cached) return { statusCode: 200, body: this.publicResolution(cached, true) };
      if (!sanitized.ok) {
        const abstain = await this.rememberAbstain(hash, "prohibited");
        return { statusCode: 200, body: abstain };
      }
      const candidates = await this.loadCandidates(query);
      const decision = decideIdentity({ query, candidates, now: this.now() });
      const stored = await this.store.update((document) => rememberDecision(document, hash, decision, this.now()));
      return { statusCode: 200, body: this.publicResolution(stored, false) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "controlled_daily_spend_cap_exceeded") return unavailable("daily_capacity_reached");
      return { statusCode: 503, body: { status: "error", reason: "analysis_failed" } };
    }
  }

  async analyzeResolution(input: {
    resolutionId: string;
    candidateId?: string;
    clientKey?: string;
  }): Promise<ProductAnalysisResponse> {
    if (!this.enabled) return { status: "unavailable", reason: "open_analysis_disabled" };
    const client = hashClient(input.clientKey);
    try {
      const prepared = await this.store.update((document) =>
        prepareAnalysis(document, input, client, this.now())
      );
      if (prepared.kind === "response") return prepared.response;
      const tracker = createAnalysisSpendTracker({
        maxMicros: Math.min(OPEN_ANALYSIS_MAX_MICROS, prepared.dailyRemaining),
        ledger: this.ledger,
        now: this.now,
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

  private canCallProvider(): boolean {
    return this.liveConfigured && Boolean(this.login.trim() && this.password.trim() && this.fetchImpl);
  }

  private async loadCandidates(query: string): Promise<ShoppingCandidate[]> {
    if (this.searchCandidates) return this.searchCandidates(query);
    if (!this.fetchImpl) throw new Error("open_analysis_fetch_missing");
    return searchShoppingIdentity({
      query,
      apiBaseUrl: this.apiBaseUrl,
      login: this.login,
      password: this.password,
      fetchImpl: this.fetchImpl,
      ledger: this.ledger,
      now: this.now,
      allowPaidCall: true,
    });
  }

  private async rememberAbstain(hash: string, reason: OpenAbstainReason): Promise<ProductResolveResponse> {
    const stored = await this.store.update((document) => {
      const now = this.now();
      const resolution = abstainRecord(hash, reason, now);
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

  reserve(micros: number, now: Date): Promise<SpendReservation> {
    return this.store.update((document) => {
      const day = daySpend(document, dayKey(now));
      if (day.micros + micros > OPEN_ANALYSIS_DAILY_MAX_MICROS) return { ok: false, micros: 0 };
      const id = randomBytes(8).toString("hex");
      day.micros += micros;
      day.reservations[id] = { micros, createdAt: now.toISOString() };
      if (micros > 0) day.paidOperationCount += 1;
      return { ok: true, id, micros };
    });
  }

  async reconcile(id: string, actualMicros: number, now: Date): Promise<void> {
    await this.store.update((document) => {
      const day = daySpend(document, dayKey(now));
      const reservation = day.reservations[id];
      if (!reservation) return;
      day.micros += actualMicros - reservation.micros;
      if (day.micros < 0) day.micros = 0;
      delete day.reservations[id];
    });
  }
}

type PreparedAnalysis =
  | { kind: "response"; response: ProductAnalysisResponse }
  | {
      kind: "run";
      profile: ProductProfile;
      resolution: StoredResolution;
      dailyRemaining: number;
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
  if (dailyRemaining <= 0) {
    window.hourAnalyses -= 1;
    window.dayAnalyses -= 1;
    return { kind: "response", response: { status: "unavailable", reason: "daily_capacity_reached" } };
  }
  day.analysisCount += 1;
  window.inFlightAnalysisId = "starting";
  window.inFlightSince = now.toISOString();
  return {
    kind: "run",
    profile: chosen.profile,
    resolution,
    dailyRemaining,
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
  now: Date
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

function abstainRecord(hash: string, reason: OpenAbstainReason, now: Date): StoredResolution {
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
  };
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

function unavailable(reason: "open_analysis_disabled" | "daily_capacity_reached" | "runtime_not_ready"): ProductResolveApiResult {
  return { statusCode: 503, body: { status: "unavailable", reason } };
}
