import { RAY_BAN_META_PRODUCT_ID } from "../mockProviderSignals";
import type { NormalizedTrendSignal } from "../types";
import { RedditOAuthClient, type RedditApiClient, type RedditApiPost } from "./client";
import { readRedditProviderConfig, shouldUseLiveReddit, type RedditProviderConfig } from "./config";
import { buildRedditSignalsFromPosts } from "./signalBuilder";

export const REDDIT_DIAGNOSTIC_ALIAS = "Ray-Ban Meta";
export const REDDIT_DIAGNOSTIC_MAX_RESULTS = 10;

export interface RedditDiagnosticSummary {
  ok: boolean;
  productId: string;
  aliasQueried: string;
  maxResults: number;
  oauth: {
    httpStatus?: number;
    succeeded: boolean;
    statusMessage?: string;
  };
  search: {
    httpStatus?: number;
    succeeded: boolean;
    statusMessage?: string;
  };
  postsReturned: number;
  uniqueSubredditCount: number;
  uniqueAuthorCount: number;
  oldestPostTimestamp?: string;
  newestPostTimestamp?: string;
  sampleWindow?: {
    oldestAgeHours?: number;
    newestAgeHours?: number;
  };
  minimumSampleSize: number;
  minimumSampleSizeMet: boolean;
  liveUseQualified: boolean;
  approvalStatus: RedditProviderConfig["commercialApprovalStatus"];
  liveApiRequestMade: boolean;
  calculatedSignals?: {
    sampleSize: number;
    subredditDiversity: number;
    positiveMentionPercent: number;
    negativeMentionPercent: number;
    buyingLanguageSharePercent: number;
    confidence: number;
  };
  generatedSignals: Array<{
    source: NormalizedTrendSignal["source"];
    signalType: NormalizedTrendSignal["signalType"];
    providerMetric?: string;
    engineField?: string;
    engineValue?: number;
    confidence: number;
  }>;
  requestCounts: {
    oauth: number;
    search: number;
  };
}

export interface RunRedditLiveDiagnosticOptions {
  env?: Record<string, string | undefined>;
  config?: RedditProviderConfig;
  client?: RedditApiClient & {
    runSingleSearchDiagnostic?: RedditOAuthClient["runSingleSearchDiagnostic"];
  };
  now?: Date;
  requestCounts?: {
    oauth: number;
    search: number;
  };
}

function present(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}

export function validateRedditDiagnosticCredentials(env: Record<string, string | undefined>): {
  ok: boolean;
  redditClientIdPresent: boolean;
  redditClientSecretPresent: boolean;
  redditUserAgentPresent: boolean;
} {
  const redditClientIdPresent = present(env.REDDIT_CLIENT_ID);
  const redditClientSecretPresent = present(env.REDDIT_CLIENT_SECRET);
  const redditUserAgentPresent = present(env.REDDIT_USER_AGENT);

  return {
    ok: redditClientIdPresent && redditClientSecretPresent && redditUserAgentPresent,
    redditClientIdPresent,
    redditClientSecretPresent,
    redditUserAgentPresent,
  };
}

function ageHours(now: Date, timestamp?: string): number | undefined {
  if (!timestamp) return undefined;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return undefined;

  return Math.max(0, Math.round((now.getTime() - parsed) / 3600000));
}

function postTimestamp(post: RedditApiPost): string {
  return new Date(post.createdUtc * 1000).toISOString();
}

function summarizePosts(posts: RedditApiPost[], now: Date) {
  const timestamps = posts.map(postTimestamp).sort();
  const oldestPostTimestamp = timestamps[0];
  const newestPostTimestamp = timestamps.at(-1);

  return {
    uniqueSubredditCount: new Set(posts.map((post) => post.subreddit.toLowerCase()).filter(Boolean)).size,
    uniqueAuthorCount: new Set(posts.map((post) => post.author).filter(Boolean)).size,
    oldestPostTimestamp,
    newestPostTimestamp,
    sampleWindow: {
      oldestAgeHours: ageHours(now, oldestPostTimestamp),
      newestAgeHours: ageHours(now, newestPostTimestamp),
    },
  };
}

function summarizeSignals(signals: NormalizedTrendSignal[]): RedditDiagnosticSummary["generatedSignals"] {
  return signals.map((signal) => ({
    source: signal.source,
    signalType: signal.signalType,
    providerMetric: typeof signal.metadata?.providerMetric === "string" ? signal.metadata.providerMetric : undefined,
    engineField: signal.metadata?.engineField,
    engineValue: signal.metadata?.engineValue,
    confidence: signal.confidence,
  }));
}

export async function runRedditLiveDiagnostic(
  options: RunRedditLiveDiagnosticOptions = {}
): Promise<RedditDiagnosticSummary> {
  const env = options.env ?? {};
  const credentialStatus = validateRedditDiagnosticCredentials(env);
  const now = options.now ?? new Date();
  const config = options.config ?? readRedditProviderConfig(env, {
    mode: "live",
    maxPostsPerAlias: REDDIT_DIAGNOSTIC_MAX_RESULTS,
    now: () => now,
    productQueries: {
      [RAY_BAN_META_PRODUCT_ID]: {
        productId: RAY_BAN_META_PRODUCT_ID,
        aliases: [REDDIT_DIAGNOSTIC_ALIAS],
      },
    },
  });
  const baseSummary: RedditDiagnosticSummary = {
    ok: false,
    productId: RAY_BAN_META_PRODUCT_ID,
    aliasQueried: REDDIT_DIAGNOSTIC_ALIAS,
    maxResults: REDDIT_DIAGNOSTIC_MAX_RESULTS,
    oauth: {
      succeeded: false,
      statusMessage: credentialStatus.ok ? undefined : "Missing required Reddit credentials",
    },
    search: {
      succeeded: false,
    },
    postsReturned: 0,
    uniqueSubredditCount: 0,
    uniqueAuthorCount: 0,
    minimumSampleSize: config.minSampleSize,
    minimumSampleSizeMet: false,
    liveUseQualified: false,
    approvalStatus: config.commercialApprovalStatus,
    liveApiRequestMade: false,
    generatedSignals: [],
    requestCounts: options.requestCounts ?? {
      oauth: 0,
      search: 0,
    },
  };

  if (!credentialStatus.ok) return baseSummary;

  if (!shouldUseLiveReddit(config)) {
    return {
      ...baseSummary,
      oauth: {
        succeeded: false,
        statusMessage: "Reddit commercial Data API approval is pending; no live Reddit API request made.",
      },
      search: {
        succeeded: false,
        statusMessage: "Blocked while Reddit approval status is pending.",
      },
    };
  }

  const client = options.client ?? new RedditOAuthClient(config);

  if (!client.runSingleSearchDiagnostic) {
    throw new Error("Reddit diagnostic requires a client with runSingleSearchDiagnostic");
  }

  const diagnostic = await client.runSingleSearchDiagnostic(REDDIT_DIAGNOSTIC_ALIAS, {
    limit: REDDIT_DIAGNOSTIC_MAX_RESULTS,
  });
  const posts = diagnostic.search?.posts ?? [];

  if (!diagnostic.oauth.ok || !diagnostic.search?.ok) {
    return {
      ...baseSummary,
      oauth: {
        httpStatus: diagnostic.oauth.httpStatus,
        succeeded: diagnostic.oauth.ok,
        statusMessage: diagnostic.oauth.statusMessage,
      },
      search: {
        httpStatus: diagnostic.search?.httpStatus,
        succeeded: Boolean(diagnostic.search?.ok),
        statusMessage: diagnostic.search?.statusMessage,
      },
    };
  }

  const postSummary = summarizePosts(posts, now);
  const signalResult = buildRedditSignalsFromPosts({
    productId: RAY_BAN_META_PRODUCT_ID,
    aliases: [REDDIT_DIAGNOSTIC_ALIAS],
    posts,
    now,
    minSampleSize: config.minSampleSize,
  });

  return {
    ...baseSummary,
    ok: Boolean(diagnostic.oauth.ok && diagnostic.search?.ok),
    liveApiRequestMade: true,
    oauth: {
      httpStatus: diagnostic.oauth.httpStatus,
      succeeded: diagnostic.oauth.ok,
      statusMessage: diagnostic.oauth.statusMessage,
    },
    search: {
      httpStatus: diagnostic.search?.httpStatus,
      succeeded: Boolean(diagnostic.search?.ok),
      statusMessage: diagnostic.search?.statusMessage,
    },
    postsReturned: posts.length,
    uniqueSubredditCount: postSummary.uniqueSubredditCount,
    uniqueAuthorCount: postSummary.uniqueAuthorCount,
    oldestPostTimestamp: postSummary.oldestPostTimestamp,
    newestPostTimestamp: postSummary.newestPostTimestamp,
    sampleWindow: postSummary.sampleWindow,
    minimumSampleSizeMet: signalResult.summary.hasSufficientSample,
    liveUseQualified: signalResult.summary.hasSufficientSample,
    calculatedSignals: {
      sampleSize: signalResult.summary.currentObservationCount,
      subredditDiversity: signalResult.summary.uniqueSubredditCount,
      positiveMentionPercent: signalResult.summary.positivePercent,
      negativeMentionPercent: signalResult.summary.negativePercent,
      buyingLanguageSharePercent: signalResult.summary.purchaseIntentPercent,
      confidence: signalResult.summary.confidence,
    },
    generatedSignals: summarizeSignals(signalResult.signals),
  };
}
