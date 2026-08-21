export type RedditSentimentLabel = "positive" | "neutral" | "negative";

export interface SentimentClassifier {
  classify(text: string): RedditSentimentLabel;
}

export interface PurchaseIntentClassifier {
  hasPurchaseIntent(text: string): boolean;
}

export const POSITIVE_SENTIMENT_PATTERNS: readonly RegExp[] = [
  /\blove(?:d|s)?\b/i,
  /\bgreat\b/i,
  /\bamazing\b/i,
  /\bexcellent\b/i,
  /\bimpressed\b/i,
  /\buseful\b/i,
  /\bworth it\b/i,
  /\brecommend(?:ed)?\b/i,
  /\bworks well\b/i,
  /\bbest\b/i,
];

export const NEGATIVE_SENTIMENT_PATTERNS: readonly RegExp[] = [
  /\bdisappoint(?:ed|ing)?\b/i,
  /\bterrible\b/i,
  /\bbad\b/i,
  /\bawful\b/i,
  /\bnot worth\b/i,
  /\boverpriced\b/i,
  /\bprivacy concern/i,
  /\bbattery (?:is )?(?:bad|poor|terrible|awful)\b/i,
  /\breturned\b/i,
  /\brefund\b/i,
];

export const PURCHASE_INTENT_PATTERNS: readonly RegExp[] = [
  /\bworth it\b/i,
  /\bshould i buy\b/i,
  /\bshould i get\b/i,
  /\bwhere can i buy\b/i,
  /\bordered\b/i,
  /\bjust bought\b/i,
  /\bbuying\b/i,
  /\bprice\b/i,
  /\bback in stock\b/i,
  /\bwhich one should i get\b/i,
];

function countMatches(text: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

export class RuleBasedSentimentClassifier implements SentimentClassifier {
  constructor(
    private readonly positivePatterns: readonly RegExp[] = POSITIVE_SENTIMENT_PATTERNS,
    private readonly negativePatterns: readonly RegExp[] = NEGATIVE_SENTIMENT_PATTERNS
  ) {}

  classify(text: string): RedditSentimentLabel {
    const positiveCount = countMatches(text, this.positivePatterns);
    const negativeCount = countMatches(text, this.negativePatterns);

    if (positiveCount > negativeCount) return "positive";
    if (negativeCount > positiveCount) return "negative";
    return "neutral";
  }
}

export class PatternPurchaseIntentClassifier implements PurchaseIntentClassifier {
  constructor(private readonly patterns: readonly RegExp[] = PURCHASE_INTENT_PATTERNS) {}

  hasPurchaseIntent(text: string): boolean {
    return countMatches(text, this.patterns) > 0;
  }
}

export const ruleBasedSentimentClassifier = new RuleBasedSentimentClassifier();
export const patternPurchaseIntentClassifier = new PatternPurchaseIntentClassifier();
