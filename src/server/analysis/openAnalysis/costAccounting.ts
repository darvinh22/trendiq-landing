import {
  DATAFORSEO_GOOGLE_ADS_SEARCH_VOLUME_PATH,
  DATAFORSEO_TRENDS_EXPLORE_PATH,
} from "../../../app/lib/data/search/client";
import {
  DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH,
  DATAFORSEO_GOOGLE_SHOPPING_REVIEWS_TASK_POST_PATH,
} from "../../../app/lib/data/reviews/client";
import { ProviderExecutionError } from "../../../app/lib/data/capabilities/types";
import type { FetchLike } from "../../../app/lib/data/search/client";

/** Integer millionths of a US dollar. $0.15 is 150_000 micros. */
export const USD_MICROS = 1_000_000;
export const OPEN_ANALYSIS_MAX_MICROS = 150_000;
export const OPEN_ANALYSIS_DAILY_MAX_MICROS = 3_000_000;

/**
 * Published list prices checked on 2026-10-20. These are estimates used only
 * when a response omits `cost` or the call errors before a cost field arrives.
 * Successful responses prefer the provider's own `cost` value.
 *
 * Sources:
 * - Google Shopping products: $0.002 per SERP of up to 40 results
 *   https://dataforseo.com/pricing/merchant/google-shopping-api
 * - Google Shopping reviews: $0.0015 per 10 reviews. The live reviews client
 *   sends recent depth 200, so 200/10 * 0.0015 = $0.03
 * - DataForSEO Trends explore live: $0.0012 per task
 *   https://dataforseo.com/pricing/keywords-data/dataforseo-trends-api-pricing
 * - Google Ads search volume live: $0.09 per task
 *   https://dataforseo.com/pricing/keywords-data/google-ads
 */
export const PUBLISHED_PRICE_MICROS = {
  shoppingProductsTaskPost: 2_000,
  shoppingReviewsTaskPost: 30_000,
  trendsExploreLive: 1_200,
  googleAdsSearchVolumeLive: 90_000,
} as const;

export const PUBLISHED_PRICE_SOURCES = {
  shoppingProductsTaskPost: "https://dataforseo.com/pricing/merchant/google-shopping-api",
  shoppingReviewsTaskPost: "https://dataforseo.com/pricing/merchant/google-shopping-api",
  trendsExploreLive: "https://dataforseo.com/pricing/keywords-data/dataforseo-trends-api-pricing",
  googleAdsSearchVolumeLive: "https://dataforseo.com/pricing/keywords-data/google-ads",
} as const;

export function usdToMicros(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) return 0;
  return Math.round(usd * USD_MICROS);
}

export function microsToUsd(micros: number): number {
  return Math.round(micros) / USD_MICROS;
}

export function estimateCallMicros(url: string, method: string): number {
  const path = safePath(url);
  const verb = method.toUpperCase();
  if (path.includes(DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH)) {
    return PUBLISHED_PRICE_MICROS.shoppingProductsTaskPost;
  }
  if (path.includes(DATAFORSEO_GOOGLE_SHOPPING_REVIEWS_TASK_POST_PATH)) {
    return PUBLISHED_PRICE_MICROS.shoppingReviewsTaskPost;
  }
  if (path.includes(DATAFORSEO_TRENDS_EXPLORE_PATH)) return PUBLISHED_PRICE_MICROS.trendsExploreLive;
  if (path.includes(DATAFORSEO_GOOGLE_ADS_SEARCH_VOLUME_PATH)) {
    return PUBLISHED_PRICE_MICROS.googleAdsSearchVolumeLive;
  }
  if (path.includes("/task_get/")) return 0;
  if (verb === "POST") return PUBLISHED_PRICE_MICROS.googleAdsSearchVolumeLive;
  return 0;
}

export function readResponseCostMicros(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.cost === "number" && Number.isFinite(record.cost) && record.cost >= 0) {
    return usdToMicros(record.cost);
  }
  if (!Array.isArray(record.tasks)) return null;
  let sum = 0;
  let saw = false;
  for (const task of record.tasks) {
    if (!task || typeof task !== "object") continue;
    const cost = (task as { cost?: unknown }).cost;
    if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) {
      sum += usdToMicros(cost);
      saw = true;
    }
  }
  return saw ? sum : null;
}

export interface SpendReservation {
  ok: boolean;
  id?: string;
  micros: number;
  /** Which limit rejected the reservation. Absent when the reservation is held. */
  reason?: "cycle" | "daily" | "unknown_cost";
}

export interface ReconciliationProof {
  source: "provider_response";
  /** Finite provider `cost` in USD. Must convert to `actualMicros`. */
  providerCostUsd: number;
  /**
   * Operator evidence for that cost, such as `task:<id> date:YYYY-MM-DD`.
   * Non-empty, no newlines, at most 512 characters. Not a substitute for the cost.
   */
  evidenceRef: string;
}

export interface SpendReserveContext {
  /** One resolution plus its later analysis. Both calls share this id. */
  cycleId: string;
}

export interface AnalysisSpendLedger {
  reserve(micros: number, now: Date, context?: SpendReserveContext): Promise<SpendReservation>;
  /**
   * `now` is the response time. The ledger must adjust the UTC day stored on
   * the reservation, not the day `now` falls on.
   */
  reconcile(id: string, actualMicros: number, now: Date): Promise<void>;
  /**
   * A paid request was sent and the cost did not come back. Keeps the hold and
   * blocks every UTC day and every cycle. Does not book the estimate.
   */
  markUnknown(id: string, now: Date): Promise<void>;
  /**
   * Clears an unknown hold only when `proof` matches `actualMicros`. Refuses a
   * proof that is missing or does not match.
   */
  reconcileVerified(id: string, actualMicros: number, now: Date, proof: ReconciliationProof): Promise<void>;
}

export interface AnalysisSpendTracker {
  readonly exceeded: boolean;
  readonly dailyBlocked: boolean;
  readonly spentMicros: number;
  wrap(fetchImpl: FetchLike): FetchLike;
}

export function createAnalysisSpendTracker(options: {
  /** Local ceiling for this tracker. The shared ledger is still the authority across calls. */
  maxMicros: number;
  ledger: AnalysisSpendLedger;
  now: () => Date;
  cycleId: string;
}): AnalysisSpendTracker {
  let spentMicros = 0;
  let exceeded = false;
  let dailyBlocked = false;

  return {
    get exceeded() {
      return exceeded;
    },
    get dailyBlocked() {
      return dailyBlocked;
    },
    get spentMicros() {
      return spentMicros;
    },
    wrap(fetchImpl: FetchLike): FetchLike {
      return async (url, init) => {
        const method = init?.method ?? "GET";
        const estimate = estimateCallMicros(url, method);
        if (spentMicros + estimate > options.maxMicros) {
          exceeded = true;
          throw new Error("controlled_spend_cap_exceeded");
        }
        const reservedAt = options.now();
        const reservation = await options.ledger.reserve(estimate, reservedAt, { cycleId: options.cycleId });
        if (!reservation.ok || !reservation.id) {
          exceeded = true;
          dailyBlocked = reservation.reason !== "cycle";
          throw new Error(reservation.reason === "cycle"
            ? "controlled_spend_cap_exceeded"
            : reservation.reason === "unknown_cost"
              ? "controlled_unknown_cost_blocked"
              : "controlled_daily_spend_cap_exceeded");
        }
        try {
          const response = await replayResponse(await fetchImpl(url, init));
          if (estimate > 0 && paidResultIsUnknown(response)) {
            await options.ledger.markUnknown(reservation.id, reservedAt);
            spentMicros += estimate;
            exceeded = true;
            return response;
          }
          const actual = response.costMicros === null ? estimate : response.costMicros;
          await options.ledger.reconcile(reservation.id, actual, options.now());
          spentMicros += actual;
          if (spentMicros > options.maxMicros) exceeded = true;
          return response;
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (estimate > 0 && isPostSendUnknown(error)) {
            await options.ledger.markUnknown(reservation.id, reservedAt);
            spentMicros += estimate;
            exceeded = true;
            throw error;
          }
          if (
            message !== "controlled_spend_cap_exceeded" &&
            message !== "controlled_daily_spend_cap_exceeded" &&
            message !== "controlled_unknown_cost_blocked" &&
            message !== "process_paid_operation_ceiling_exhausted"
          ) {
            await options.ledger.reconcile(reservation.id, estimate, reservedAt);
            spentMicros += estimate;
            exceeded = true;
          } else if (message === "process_paid_operation_ceiling_exhausted") {
            await options.ledger.reconcile(reservation.id, 0, reservedAt);
          }
          throw error;
        }
      };
    },
  };
}

interface ReplayResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  costMicros: number | null;
}

async function replayResponse(response: {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}): Promise<ReplayResponse> {
  let textBody = "";
  let parsed: unknown;
  let parsedOk = false;
  try {
    if (typeof response.text === "function") {
      textBody = await response.text();
      parsed = JSON.parse(textBody);
      parsedOk = true;
    } else if (typeof response.json === "function") {
      parsed = await response.json();
      parsedOk = true;
      textBody = JSON.stringify(parsed);
    }
  } catch {
    parsedOk = false;
  }
  const costMicros = parsedOk ? readResponseCostMicros(parsed) : null;
  return {
    ok: response.ok,
    status: response.status,
    costMicros,
    json: async () => {
      if (!parsedOk) throw new Error("invalid_provider_json");
      return parsed;
    },
    text: async () => textBody,
  };
}

const PRE_SEND_REFUSAL = new Set([
  "controlled_spend_cap_exceeded",
  "controlled_daily_spend_cap_exceeded",
  "controlled_unknown_cost_blocked",
  "process_paid_operation_ceiling_exhausted",
  "controlled_analysis_deadline_exceeded",
  "controlled_http_budget_exhausted",
  "controlled_paid_operation_budget_exhausted",
  "controlled_task_post_budget_exhausted",
  "unsafe_provider_post_retry_blocked",
]);

/**
 * True when the POST was already handed to the provider and the outcome does
 * not prove there was no billable consumption. Pre-send refusals stay false.
 */
function isPostSendUnknown(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  if (PRE_SEND_REFUSAL.has(message)) return false;
  if (error instanceof ProviderExecutionError) {
    if (error.requestDispatched) return true;
    return error.failureCategory === "provider_timeout" || error.failureCategory === "provider_network_error";
  }
  if (message === "controlled_provider_request_timeout") return true;
  return /ECONNRESET|ECONNABORTED|EPIPE|ETIMEDOUT|socket hang up|socket_reset|ECONNREFUSED|aborted|interrupted/i.test(message);
}

/**
 * A paid POST stays unknown when the status is 5xx, the status is 4xx without
 * an explicit zero cost, or a 2xx body has no finite cost. A 5xx `cost` is not
 * proof, including zero. A 4xx or 2xx cost of zero is proof of no consumption.
 */
function paidResultIsUnknown(response: ReplayResponse): boolean {
  if (response.status >= 500) return true;
  if (response.costMicros === 0) return false;
  if (response.status >= 400) return true;
  return response.costMicros === null;
}

export function assertReconciliationProof(actualMicros: number, proof: ReconciliationProof | undefined): void {
  if (!proof || proof.source !== "provider_response") throw new Error("open_analysis_reconciliation_unverified");
  if (typeof proof.providerCostUsd !== "number" || !Number.isFinite(proof.providerCostUsd) || proof.providerCostUsd < 0) {
    throw new Error("open_analysis_reconciliation_unverified");
  }
  if (!isEvidenceRef(proof.evidenceRef)) throw new Error("open_analysis_reconciliation_unverified");
  if (usdToMicros(proof.providerCostUsd) !== actualMicros) throw new Error("open_analysis_reconciliation_unverified");
}

function isEvidenceRef(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 512 && trimmed === value && !/[\r\n]/.test(value);
}

/**
 * Applies a late provider body to an unknown hold. A body with no finite cost
 * leaves the hold and the block in place. This does not book the list-price estimate.
 */
export async function reconcileUnknownFromProviderBody(
  ledger: AnalysisSpendLedger,
  id: string,
  body: unknown,
  now: Date,
  evidenceRef: string
): Promise<boolean> {
  const micros = readResponseCostMicros(body);
  if (micros === null) return false;
  await ledger.reconcileVerified(id, micros, now, {
    source: "provider_response",
    providerCostUsd: micros / USD_MICROS,
    evidenceRef,
  });
  return true;
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export interface OpenAnalysisSpendEstimate {
  label: "estimate";
  resolveUsd: number;
  analysisTypicalUsd: number;
  fullCycleTypicalUsd: number;
  perAnalysisCapUsd: number;
  dailyCapUsd: number;
  maxFullCyclesPerDayAtTypicalCost: number;
  calls: Array<{ name: string; endpoint: string; estimateUsd: number; when: string }>;
  notes: string[];
}

export function estimateOpenAnalysisSpend(): OpenAnalysisSpendEstimate {
  const calls = [
    {
      name: "Identity shopping products",
      endpoint: DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH,
      estimateUsd: microsToUsd(PUBLISHED_PRICE_MICROS.shoppingProductsTaskPost),
      when: "resolve, one paid POST, depth 40; skipped on a 30-day identity cache hit",
    },
    {
      name: "Trends explore live",
      endpoint: DATAFORSEO_TRENDS_EXPLORE_PATH,
      estimateUsd: microsToUsd(PUBLISHED_PRICE_MICROS.trendsExploreLive),
      when: "analysis, when search mode is live",
    },
    {
      name: "Google Ads search volume live",
      endpoint: DATAFORSEO_GOOGLE_ADS_SEARCH_VOLUME_PATH,
      estimateUsd: microsToUsd(PUBLISHED_PRICE_MICROS.googleAdsSearchVolumeLive),
      when: "analysis, when search mode is live; about 90% of a typical cycle",
    },
    {
      name: "Review aggregate shopping products",
      endpoint: DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH,
      estimateUsd: microsToUsd(PUBLISHED_PRICE_MICROS.shoppingProductsTaskPost),
      when: "analysis, reviews client posts one products task",
    },
    {
      name: "Shopping reviews",
      endpoint: DATAFORSEO_GOOGLE_SHOPPING_REVIEWS_TASK_POST_PATH,
      estimateUsd: microsToUsd(PUBLISHED_PRICE_MICROS.shoppingReviewsTaskPost),
      when: "analysis, recent review depth 200 at $0.0015 per 10 reviews",
    },
  ];
  const resolveUsd = calls[0].estimateUsd;
  const analysisTypicalUsd = roundUsd(calls.slice(1).reduce((sum, call) => sum + call.estimateUsd, 0));
  const fullCycleTypicalUsd = roundUsd(resolveUsd + analysisTypicalUsd);
  return {
    label: "estimate",
    resolveUsd,
    analysisTypicalUsd,
    fullCycleTypicalUsd,
    perAnalysisCapUsd: microsToUsd(OPEN_ANALYSIS_MAX_MICROS),
    dailyCapUsd: microsToUsd(OPEN_ANALYSIS_DAILY_MAX_MICROS),
    maxFullCyclesPerDayAtTypicalCost: Math.floor(microsToUsd(OPEN_ANALYSIS_DAILY_MAX_MICROS) / fullCycleTypicalUsd),
    calls,
    notes: [
      "Estimate from the code paths in productionEvidenceCollector and the resolve shopping search, priced from public DataForSEO list pages. Not a bill.",
      "Task GET polls reserve $0 and then add the response cost field when present.",
      "A refusal before the request is sent still reserves the list-price estimate so a retry cannot spend the cap twice.",
      "After the POST is sent, a timeout, connection reset, or any HTTP 5xx stays an unknown hold even when the body reports cost 0. A 4xx or 2xx cost of exactly 0 is the proof of no consumption. The unknown hold blocks every UTC day and every cycle until explicit reconciliation. It is not deleted.",
      "A call is not started unless the published list price still fits in both the resolution+analysis cycle ($0.15) and the UTC day the reservation is made ($3).",
      "Resolve and analysis share one cycle ledger. There is no separate $0.002 allowance on top of $0.15.",
      "Returned provider cost can exceed the published list price. That overage is recorded on the reservation's original UTC day and can put the cycle or the day above the limit. This is not a hard invoice cap. See docs/OPEN_ANALYSIS.md.",
      "Google Ads live is also documented at 12 requests per minute per account. This process does not try to exceed that.",
    ],
  };
}

function roundUsd(value: number): number {
  return Math.round(value * USD_MICROS) / USD_MICROS;
}
