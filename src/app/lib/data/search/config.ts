import { RAY_BAN_META_PRODUCT_ID } from "../mockProviderSignals";
import type { SearchInterestTimeRange, SearchProviderConfig, SearchProviderMode, SearchProviderVendor } from "./types";

export const SEARCH_RAY_BAN_ALIASES = [
  "Ray-Ban Meta",
] as const;

export const SEARCH_PRODUCT_QUERIES: SearchProviderConfig["productQueries"] = {
  [RAY_BAN_META_PRODUCT_ID]: {
    productId: RAY_BAN_META_PRODUCT_ID,
    aliases: [...SEARCH_RAY_BAN_ALIASES],
  },
};

const DEFAULT_API_BASE_URL = "https://api.dataforseo.com";
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MIN_SAMPLE_SIZE = 2;
const DEFAULT_LOCATION_CODE = 2840;
const DEFAULT_TIME_RANGE: SearchInterestTimeRange = "past_30_days";

type RuntimeEnv = Record<string, string | undefined>;

function getRuntimeEnv(): RuntimeEnv {
  // Intentionally reads process-style env only. Do not mirror these values into
  // VITE_ variables; DataForSEO credentials must stay server-side.
  return ((globalThis as { process?: { env?: RuntimeEnv } }).process?.env ?? {});
}

function parseMode(value: string | undefined): SearchProviderMode {
  return value === "live" ? "live" : "mock";
}

function parseProvider(value: string | undefined): SearchProviderVendor {
  return value === "dataforseo" ? "dataforseo" : "dataforseo";
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function cleanBaseUrl(value: string | undefined): string {
  return (value || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

export function readSearchProviderConfig(
  env: RuntimeEnv = getRuntimeEnv(),
  overrides: Partial<SearchProviderConfig> = {}
): SearchProviderConfig {
  return {
    mode: overrides.mode ?? parseMode(env.TRENDIQ_SEARCH_MODE),
    provider: overrides.provider ?? parseProvider(env.TRENDIQ_SEARCH_PROVIDER),
    apiLogin: overrides.apiLogin ?? env.DATAFORSEO_LOGIN,
    apiPassword: overrides.apiPassword ?? env.DATAFORSEO_PASSWORD,
    apiBaseUrl: overrides.apiBaseUrl ?? cleanBaseUrl(env.DATAFORSEO_API_BASE_URL),
    cacheTtlMs: overrides.cacheTtlMs ?? parsePositiveInteger(env.TRENDIQ_SEARCH_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS),
    minSampleSize: overrides.minSampleSize ?? parsePositiveInteger(env.TRENDIQ_SEARCH_MIN_SAMPLE_SIZE, DEFAULT_MIN_SAMPLE_SIZE),
    locationCode: overrides.locationCode ?? parsePositiveInteger(env.TRENDIQ_SEARCH_LOCATION_CODE, DEFAULT_LOCATION_CODE),
    interestType: overrides.interestType ?? "web",
    timeRange: overrides.timeRange ?? DEFAULT_TIME_RANGE,
    productQueries: overrides.productQueries ?? SEARCH_PRODUCT_QUERIES,
    now: overrides.now ?? (() => new Date()),
  };
}

export function hasSearchCredentials(config: SearchProviderConfig): boolean {
  return Boolean(config.apiLogin && config.apiPassword);
}

export function shouldUseLiveSearch(config: SearchProviderConfig): boolean {
  return config.mode === "live" && config.provider === "dataforseo" && hasSearchCredentials(config);
}
