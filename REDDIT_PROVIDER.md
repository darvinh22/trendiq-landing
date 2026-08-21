# TrendIQ Reddit Provider

The Reddit provider is the first live-data proof of concept for TrendIQ Data Layer v1. It is mock-first and only supports Ray-Ban Meta Glasses in this phase.

## Mode

Default mode is mock:

```env
TRENDIQ_REDDIT_MODE=mock
```

Live mode must be explicit:

```env
TRENDIQ_REDDIT_MODE=live
```

If live mode is enabled but credentials are missing, OAuth fails, Reddit is unavailable, rate limits are hit, or the sample size is too small, the provider falls back to the existing Reddit mock signals.

## Authentication

Required environment variables:

```env
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_USER_AGENT=web:trendiq-local:v1.0.0 (by /u/your_reddit_username)
```

Do not commit real credentials. Keep them in a local `.env` or deployment secret store.

## Product Scope

Only `ray-ban-meta` is configured for live Reddit data.

Search aliases:

- `Ray-Ban Meta`
- `Ray Ban Meta`
- `Meta smart glasses`
- `Ray-Ban smart glasses`

Aliases live in `src/app/lib/data/reddit/config.ts`.

## Data Windows

The MVP collects a current 7-day period and a previous 7-day period from recent Reddit search results. It does not attempt broad historical crawling.

## Signals Replaced

Live Reddit can replace only the Reddit-derived version of:

- `sentiment.positiveMentionPercent`
- `sentiment.negativeMentionPercent`
- `purchaseIntent.buyingKeywordSharePercent`
- `socialMomentum.mentionGrowthPercent`

Other provider mocks remain in place, including Google/search, review quality, merchant, broad social creator data, and mock historical snapshots.

## Sentiment V1

Sentiment is deterministic and rule-based. It classifies text as `positive`, `neutral`, or `negative` with transparent regex patterns in `classifiers.ts`.

Limitations:

- It does not understand sarcasm.
- It may miss slang or misspellings.
- It treats posts as equally weighted.
- It does not use comments yet.

The classifier is behind an interface so it can later be replaced with a better NLP model.

## Purchase Intent V1

Purchase intent uses configurable regex patterns such as:

- `worth it`
- `should I buy`
- `should I get`
- `where can I buy`
- `ordered`
- `just bought`
- `buying`
- `price`
- `back in stock`
- `which one should I get`

Simple product mentions are not purchase intent.

## Caching

The MVP uses an in-memory cache with configurable TTL:

```env
TRENDIQ_REDDIT_CACHE_TTL_MS=900000
```

This avoids repeated Reddit calls during development. It is not a database and is not durable.

## Data Quality

Minimum sample size defaults to 20:

```env
TRENDIQ_REDDIT_MIN_SAMPLE_SIZE=20
```

Below that threshold, percentages are dampened and confidence is low. The live provider falls back to mock Reddit signals for the app-facing snapshot.

## Compliance

Production and commercial usage must comply with current Reddit Developer Terms and Data API Terms. TrendIQ should retain aggregated signal/provenance data only, not full post/comment bodies or raw usernames. Reddit content must not be added to training datasets.
