import { clamp, normalizeInverseLinear, normalizeLinear, normalizeLogScale, roundTo } from "../../scoring/normalization";
import type { NormalizedTrendSignal } from "../types";
import type { RedditApiPost } from "./client";
import {
  patternPurchaseIntentClassifier,
  ruleBasedSentimentClassifier,
  type PurchaseIntentClassifier,
  type SentimentClassifier,
} from "./classifiers";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface RedditObservationWindow {
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
}

export interface RedditSignalSummary {
  productId: string;
  timestamp: string;
  aliasesUsed: string[];
  currentObservationCount: number;
  previousObservationCount: number;
  positivePercent: number;
  negativePercent: number;
  purchaseIntentPercent: number;
  mentionGrowthPercent: number;
  uniqueSubredditCount: number;
  uniqueAuthorCount: number;
  confidence: number;
  hasSufficientSample: boolean;
  observationWindow: RedditObservationWindow;
}

export interface RedditSignalBuildResult {
  signals: NormalizedTrendSignal[];
  summary: RedditSignalSummary;
}

export interface RedditSignalBuilderOptions {
  productId: string;
  aliases: readonly string[];
  posts: RedditApiPost[];
  now: Date;
  minSampleSize: number;
  sentimentClassifier?: SentimentClassifier;
  purchaseIntentClassifier?: PurchaseIntentClassifier;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function postText(post: RedditApiPost): string {
  return `${post.title} ${post.selftext}`.trim();
}

function matchesAlias(post: RedditApiPost, aliases: readonly string[]): boolean {
  const text = normalizeText(postText(post));

  return aliases.some((alias) => text.includes(normalizeText(alias)));
}

function dedupePosts(posts: RedditApiPost[]): RedditApiPost[] {
  const seen = new Set<string>();

  return posts.filter((post) => {
    if (seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  });
}

function filterWindow(posts: RedditApiPost[], startMs: number, endMs: number, aliases: readonly string[]): RedditApiPost[] {
  return dedupePosts(posts).filter((post) => {
    const createdMs = post.createdUtc * 1000;
    return createdMs >= startMs && createdMs <= endMs && matchesAlias(post, aliases);
  });
}

function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return roundTo((part / total) * 100, 1);
}

export function calculateMentionGrowthPercent(currentCount: number, previousCount: number): number {
  if (previousCount <= 0) return currentCount > 0 ? 100 : 0;
  return roundTo(((currentCount - previousCount) / previousCount) * 100, 1);
}

export function calculateRedditSignalConfidence(sampleSize: number, subredditCount: number, minSampleSize: number): number {
  if (sampleSize < minSampleSize) {
    // Low samples should not exaggerate Reddit certainty. Confidence rises
    // gently toward 45 until the minimum viable observation count is reached.
    return roundTo(normalizeLinear(sampleSize, 0, minSampleSize) * 0.45, 2);
  }

  return roundTo(
    clamp(
      65 +
        normalizeLogScale(sampleSize, minSampleSize, 1000) * 0.2 +
        normalizeLinear(subredditCount, 1, 8) * 0.15
    ),
    2
  );
}

function baseMetadata(summary: RedditSignalSummary) {
  return {
    provider: "reddit",
    aliasesUsed: summary.aliasesUsed.join(", "),
    sampleSize: summary.currentObservationCount,
    previousSampleSize: summary.previousObservationCount,
    timestamp: summary.timestamp,
    subredditDiversity: summary.uniqueSubredditCount,
    uniqueAuthorCount: summary.uniqueAuthorCount,
    currentWindowStart: summary.observationWindow.currentStart,
    currentWindowEnd: summary.observationWindow.currentEnd,
    previousWindowStart: summary.observationWindow.previousStart,
    previousWindowEnd: summary.observationWindow.previousEnd,
    hasSufficientSample: summary.hasSufficientSample,
  };
}

export function buildRedditSignalsFromPosts(options: RedditSignalBuilderOptions): RedditSignalBuildResult {
  const sentimentClassifier = options.sentimentClassifier ?? ruleBasedSentimentClassifier;
  const purchaseIntentClassifier = options.purchaseIntentClassifier ?? patternPurchaseIntentClassifier;
  const currentEndMs = options.now.getTime();
  const currentStartMs = currentEndMs - SEVEN_DAYS_MS;
  const previousStartMs = currentEndMs - SEVEN_DAYS_MS * 2;
  const previousEndMs = currentStartMs;
  const currentPosts = filterWindow(options.posts, currentStartMs, currentEndMs, options.aliases);
  const previousPosts = filterWindow(options.posts, previousStartMs, previousEndMs, options.aliases);
  const subredditSet = new Set(currentPosts.map((post) => post.subreddit.toLowerCase()).filter(Boolean));
  const authorSet = new Set(currentPosts.map((post) => post.author).filter(Boolean));
  let positiveCount = 0;
  let negativeCount = 0;
  let purchaseIntentCount = 0;

  for (const post of currentPosts) {
    const text = postText(post);
    const sentiment = sentimentClassifier.classify(text);

    if (sentiment === "positive") positiveCount += 1;
    if (sentiment === "negative") negativeCount += 1;
    if (purchaseIntentClassifier.hasPurchaseIntent(text)) purchaseIntentCount += 1;
  }

  // Low samples use the minimum sample size as the denominator so a tiny set of
  // posts cannot produce exaggerated 100% sentiment or intent values.
  const percentageDenominator = Math.max(currentPosts.length, options.minSampleSize);
  const positivePercent = percent(positiveCount, percentageDenominator);
  const negativePercent = percent(negativeCount, percentageDenominator);
  const purchaseIntentPercent = percent(purchaseIntentCount, percentageDenominator);
  const mentionGrowthPercent = calculateMentionGrowthPercent(currentPosts.length, previousPosts.length);
  const confidence = calculateRedditSignalConfidence(
    currentPosts.length,
    subredditSet.size,
    options.minSampleSize
  );
  const summary: RedditSignalSummary = {
    productId: options.productId,
    timestamp: options.now.toISOString(),
    aliasesUsed: [...options.aliases],
    currentObservationCount: currentPosts.length,
    previousObservationCount: previousPosts.length,
    positivePercent,
    negativePercent,
    purchaseIntentPercent,
    mentionGrowthPercent,
    uniqueSubredditCount: subredditSet.size,
    uniqueAuthorCount: authorSet.size,
    confidence,
    hasSufficientSample: currentPosts.length >= options.minSampleSize,
    observationWindow: {
      currentStart: new Date(currentStartMs).toISOString(),
      currentEnd: new Date(currentEndMs).toISOString(),
      previousStart: new Date(previousStartMs).toISOString(),
      previousEnd: new Date(previousEndMs).toISOString(),
    },
  };
  const metadata = baseMetadata(summary);

  return {
    summary,
    signals: [
      {
        source: "reddit",
        signalType: "sentiment",
        productId: options.productId,
        sourceProvenance: {
          mode: "live",
          provider: "reddit",
          providerLabel: "Reddit Data API",
          providerMetric: "positiveDiscussionShare",
          approvalStatus: "approved",
          liveApiRequestMade: true,
        },
        value: positivePercent,
        normalizedValue: roundTo(normalizeLinear(positivePercent, 30, 90), 2),
        sampleSize: currentPosts.length,
        timestamp: summary.timestamp,
        confidence,
        metadata: {
          ...metadata,
          providerMetric: "positiveDiscussionShare",
          engineField: "positiveMentionPercent",
          engineValue: positivePercent,
        },
      },
      {
        source: "reddit",
        signalType: "sentiment",
        productId: options.productId,
        sourceProvenance: {
          mode: "live",
          provider: "reddit",
          providerLabel: "Reddit Data API",
          providerMetric: "negativeDiscussionShare",
          approvalStatus: "approved",
          liveApiRequestMade: true,
        },
        value: negativePercent,
        normalizedValue: roundTo(normalizeInverseLinear(negativePercent, 5, 45), 2),
        sampleSize: currentPosts.length,
        timestamp: summary.timestamp,
        confidence,
        metadata: {
          ...metadata,
          providerMetric: "negativeDiscussionShare",
          engineField: "negativeMentionPercent",
          engineValue: negativePercent,
        },
      },
      {
        source: "reddit",
        signalType: "purchaseIntent",
        productId: options.productId,
        sourceProvenance: {
          mode: "live",
          provider: "reddit",
          providerLabel: "Reddit Data API",
          providerMetric: "buyingLanguageShare",
          approvalStatus: "approved",
          liveApiRequestMade: true,
        },
        value: purchaseIntentPercent,
        normalizedValue: roundTo(normalizeLinear(purchaseIntentPercent, 2, 35), 2),
        sampleSize: currentPosts.length,
        timestamp: summary.timestamp,
        confidence,
        metadata: {
          ...metadata,
          providerMetric: "buyingLanguageShare",
          engineField: "buyingKeywordSharePercent",
          engineValue: purchaseIntentPercent,
        },
      },
      {
        source: "reddit",
        signalType: "socialMomentum",
        productId: options.productId,
        sourceProvenance: {
          mode: "live",
          provider: "reddit",
          providerLabel: "Reddit Data API",
          providerMetric: "communityMentionGrowth",
          approvalStatus: "approved",
          liveApiRequestMade: true,
        },
        value: mentionGrowthPercent,
        normalizedValue: roundTo(normalizeLinear(mentionGrowthPercent, -25, 150), 2),
        previousValue: previousPosts.length,
        percentChange: mentionGrowthPercent,
        sampleSize: currentPosts.length,
        timestamp: summary.timestamp,
        confidence,
        metadata: {
          ...metadata,
          providerMetric: "communityMentionGrowth",
          engineField: "mentionGrowthPercent",
          engineValue: mentionGrowthPercent,
        },
      },
      {
        source: "reddit",
        signalType: "socialMomentum",
        productId: options.productId,
        sourceProvenance: {
          mode: "live",
          provider: "reddit",
          providerLabel: "Reddit Data API",
          providerMetric: "redditMentionCount",
          approvalStatus: "approved",
          liveApiRequestMade: true,
        },
        value: currentPosts.length,
        normalizedValue: roundTo(normalizeLogScale(currentPosts.length, 1, 1000), 2),
        previousValue: previousPosts.length,
        sampleSize: currentPosts.length,
        timestamp: summary.timestamp,
        confidence,
        metadata: {
          ...metadata,
          providerMetric: "redditMentionCount",
        },
      },
    ],
  };
}
