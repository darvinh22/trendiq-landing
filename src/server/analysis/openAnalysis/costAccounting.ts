import {
  DATAFORSEO_GOOGLE_ADS_SEARCH_VOLUME_PATH,
  DATAFORSEO_TRENDS_EXPLORE_PATH,
} from "../../../app/lib/data/search/client";
import {
  DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH,
  DATAFORSEO_GOOGLE_SHOPPING_REVIEWS_TASK_POST_PATH,
} from "../../../app/lib/data/reviews/client";
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
}

export interface AnalysisSpendLedger {
  reserve(micros: number, now: Date): Promise<SpendReservation>;
  reconcile(id: string, actualMicros: number, now: Date): Promise<void>;
}

export interface AnalysisSpendTracker {
  readonly exceeded: boolean;
  readonly dailyBlocked: boolean;
  readonly spentMicros: number;
  wrap(fetchImpl: FetchLike): FetchLike;
}

export function createAnalysisSpendTracker(options: {
  maxMicros: number;
  ledger: AnalysisSpendLedger;
  now: () => Date;
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
        const reservation = await options.ledger.reserve(estimate, options.now());
        if (!reservation.ok || !reservation.id) {
          exceeded = true;
          dailyBlocked = true;
          throw new Error("controlled_daily_spend_cap_exceeded");
        }
        try {
          const response = await replayResponse(await fetchImpl(url, init));
          const actual = response.costMicros === null ? estimate : response.costMicros;
          await options.ledger.reconcile(reservation.id, actual, options.now());
          spentMicros += actual;
          if (spentMicros > options.maxMicros) exceeded = true;
          return response;
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (message !== "controlled_spend_cap_exceeded" && message !== "controlled_daily_spend_cap_exceeded") {
            await options.ledger.reconcile(reservation.id, estimate, options.now());
            spentMicros += estimate;
            exceeded = true;
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
      "Errors and thrown calls reserve the list-price estimate so retries and failures still count.",
      "A call is not started when its estimate would pass $0.15 for that analysis or $3 for the UTC day. One in-flight response can exceed the cap only by the gap between estimate and the returned cost.",
      "The $0.15 cap is per analysis. The resolve call counts against the $3 daily cap and is limited to one paid POST.",
      "Google Ads live is also documented at 12 requests per minute per account. This process does not try to exceed that; the daily dollar cap is the hard stop.",
    ],
  };
}

function roundUsd(value: number): number {
  return Math.round(value * USD_MICROS) / USD_MICROS;
}
