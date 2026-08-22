import { RAY_BAN_META_PRODUCT_ID } from "../mockProviderSignals";
import type {
  ProductMatchConfidence,
  ReviewProviderConfig,
  ReviewProviderMode,
  ReviewProviderVendor,
} from "./types";

const DEFAULT_API_BASE_URL = "https://api.dataforseo.com";
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_LOCATION_CODE = 2840;
const DEFAULT_LANGUAGE_CODE = "en";
const DEFAULT_TASK_DEPTH = 40;
const DEFAULT_TASK_POLL_ATTEMPTS = 3;
const DEFAULT_TASK_POLL_INTERVAL_MS = 2000;

type RuntimeEnv = Record<string, string | undefined>;

function getRuntimeEnv(): RuntimeEnv {
  // DataForSEO credentials must stay server-side.
  return ((globalThis as { process?: { env?: RuntimeEnv } }).process?.env ?? {});
}

function parseMode(value: string | undefined): ReviewProviderMode {
  return value === "live" ? "live" : "mock";
}

function parseProvider(value: string | undefined): ReviewProviderVendor {
  return value === "dataforseo" ? "dataforseo" : "dataforseo";
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function cleanBaseUrl(value: string | undefined): string {
  return (value || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

export const REVIEW_PRODUCT_IDENTITIES: ReviewProviderConfig["productIdentities"] = {
  [RAY_BAN_META_PRODUCT_ID]: {
    productId: RAY_BAN_META_PRODUCT_ID,
    canonicalSearchQuery: "Ray-Ban Meta",
    productTitle: "Ray-Ban Meta",
    brand: "Ray-Ban",
    acceptedSellers: ["Meta", "Ray-Ban", "meta.com"],
    providerProductIds: {
      productId: "11716803554991446550",
      dataDocid: "4690297997048968068",
      gid: "11193998885220934472",
      observedAt: "2026-08-21T23:47:20.000Z",
      matchConfidence: "high",
    },
  },
};

export function readReviewProviderConfig(
  env: RuntimeEnv = getRuntimeEnv(),
  overrides: Partial<ReviewProviderConfig> = {}
): ReviewProviderConfig {
  return {
    mode: overrides.mode ?? parseMode(env.TRENDIQ_REVIEWS_MODE),
    provider: overrides.provider ?? parseProvider(env.TRENDIQ_REVIEWS_PROVIDER),
    apiLogin: overrides.apiLogin ?? env.DATAFORSEO_LOGIN,
    apiPassword: overrides.apiPassword ?? env.DATAFORSEO_PASSWORD,
    apiBaseUrl: overrides.apiBaseUrl ?? cleanBaseUrl(env.DATAFORSEO_API_BASE_URL),
    cacheTtlMs: overrides.cacheTtlMs ?? parsePositiveInteger(env.TRENDIQ_REVIEWS_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS),
    locationCode: overrides.locationCode ?? parsePositiveInteger(env.TRENDIQ_REVIEWS_LOCATION_CODE, DEFAULT_LOCATION_CODE),
    languageCode: overrides.languageCode ?? env.TRENDIQ_REVIEWS_LANGUAGE_CODE ?? DEFAULT_LANGUAGE_CODE,
    taskDepth: overrides.taskDepth ?? parsePositiveInteger(env.TRENDIQ_REVIEWS_TASK_DEPTH, DEFAULT_TASK_DEPTH),
    taskPollAttempts: overrides.taskPollAttempts
      ?? parsePositiveInteger(env.TRENDIQ_REVIEWS_TASK_POLL_ATTEMPTS, DEFAULT_TASK_POLL_ATTEMPTS),
    taskPollIntervalMs: overrides.taskPollIntervalMs
      ?? parsePositiveInteger(env.TRENDIQ_REVIEWS_TASK_POLL_INTERVAL_MS, DEFAULT_TASK_POLL_INTERVAL_MS),
    minimumMatchConfidence: overrides.minimumMatchConfidence ?? "high",
    productIdentities: overrides.productIdentities ?? REVIEW_PRODUCT_IDENTITIES,
    now: overrides.now ?? (() => new Date()),
  };
}

export function hasReviewCredentials(config: ReviewProviderConfig): boolean {
  return Boolean(config.apiLogin && config.apiPassword);
}

export function shouldUseLiveReviews(config: ReviewProviderConfig): boolean {
  return config.mode === "live" && config.provider === "dataforseo" && hasReviewCredentials(config);
}

export function matchConfidenceRank(confidence: ProductMatchConfidence): number {
  const ranks: Record<ProductMatchConfidence, number> = {
    rejected: 0,
    low: 1,
    medium: 2,
    high: 3,
  };

  return ranks[confidence];
}
