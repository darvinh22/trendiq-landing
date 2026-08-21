import { RAY_BAN_META_PRODUCT_ID } from "../mockProviderSignals";

export type RedditProviderMode = "mock" | "live";
export type RedditCommercialApprovalStatus = "pending" | "approved";

export interface RedditProductQueryConfig {
  productId: string;
  aliases: string[];
}

export interface RedditProviderConfig {
  mode: RedditProviderMode;
  clientId?: string;
  clientSecret?: string;
  userAgent?: string;
  commercialApprovalStatus: RedditCommercialApprovalStatus;
  cacheTtlMs: number;
  minSampleSize: number;
  maxPostsPerAlias: number;
  productQueries: Record<string, RedditProductQueryConfig>;
  now: () => Date;
}

export const REDDIT_RAY_BAN_ALIASES = [
  "Ray-Ban Meta",
  "Ray Ban Meta",
  "Meta smart glasses",
  "Ray-Ban smart glasses",
] as const;

export const REDDIT_PRODUCT_QUERIES: Record<string, RedditProductQueryConfig> = {
  [RAY_BAN_META_PRODUCT_ID]: {
    productId: RAY_BAN_META_PRODUCT_ID,
    aliases: [...REDDIT_RAY_BAN_ALIASES],
  },
};

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MIN_SAMPLE_SIZE = 20;
const DEFAULT_MAX_POSTS_PER_ALIAS = 50;

type RuntimeEnv = Record<string, string | undefined>;

function getRuntimeEnv(): RuntimeEnv {
  return ((globalThis as { process?: { env?: RuntimeEnv } }).process?.env ?? {});
}

function parseMode(value: string | undefined): RedditProviderMode {
  return value === "live" ? "live" : "mock";
}

function parseCommercialApprovalStatus(value: string | undefined): RedditCommercialApprovalStatus {
  return value === "approved" ? "approved" : "pending";
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function readRedditProviderConfig(
  env: RuntimeEnv = getRuntimeEnv(),
  overrides: Partial<RedditProviderConfig> = {}
): RedditProviderConfig {
  return {
    mode: overrides.mode ?? parseMode(env.TRENDIQ_REDDIT_MODE),
    clientId: overrides.clientId ?? env.REDDIT_CLIENT_ID,
    clientSecret: overrides.clientSecret ?? env.REDDIT_CLIENT_SECRET,
    userAgent: overrides.userAgent ?? env.REDDIT_USER_AGENT,
    commercialApprovalStatus: overrides.commercialApprovalStatus ??
      parseCommercialApprovalStatus(env.TRENDIQ_REDDIT_COMMERCIAL_APPROVAL_STATUS),
    cacheTtlMs: overrides.cacheTtlMs ?? parsePositiveInteger(env.TRENDIQ_REDDIT_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS),
    minSampleSize: overrides.minSampleSize ?? parsePositiveInteger(env.TRENDIQ_REDDIT_MIN_SAMPLE_SIZE, DEFAULT_MIN_SAMPLE_SIZE),
    maxPostsPerAlias: overrides.maxPostsPerAlias ?? parsePositiveInteger(env.TRENDIQ_REDDIT_MAX_POSTS_PER_ALIAS, DEFAULT_MAX_POSTS_PER_ALIAS),
    productQueries: overrides.productQueries ?? REDDIT_PRODUCT_QUERIES,
    now: overrides.now ?? (() => new Date()),
  };
}

export function hasRedditCredentials(config: RedditProviderConfig): boolean {
  return Boolean(config.clientId && config.clientSecret && config.userAgent);
}

export function shouldUseLiveReddit(config: RedditProviderConfig): boolean {
  return (
    config.mode === "live" &&
    config.commercialApprovalStatus === "approved" &&
    hasRedditCredentials(config)
  );
}
