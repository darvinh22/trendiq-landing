# Open product analysis

Free-text analysis evaluates a product name that is not in the controlled
catalog. The catalog remains the single product `ray-ban-meta`. Unknown
`productId` values still return `product_not_supported`.

The switch `TRENDIQ_OPEN_ANALYSIS_ENABLED` defaults to false. While it is false
the server does not create the data file and does not call a provider for
`POST /api/product-resolve`.

## Caps

All provider calls, errors, and retries count.

- $0.15 maximum for one analysis.
- $3 maximum for one UTC day, including the identity search.
- 100 name resolutions per UTC day, 5 analyses per client per hour, 20 per
  client per day, and one analysis in flight per client.
- A call is not started when its list-price estimate would pass either dollar
  cap. One response already in flight can exceed a cap only by the gap between
  that estimate and the returned `cost`.

Published list prices checked on 2026-10-20, used only when a response omits
`cost` or the call errors. This is an estimate, not a bill.

| Call | Estimate |
| --- | --- |
| Shopping products task, identity, depth 40, one paid POST | $0.002 |
| Trends explore live | $0.0012 |
| Google Ads search volume live | $0.09 |
| Shopping products task inside reviews | $0.002 |
| Shopping reviews at recent depth 200 | $0.03 |

A typical full cycle is about $0.1252. At that estimate the $3 day cap allows
23 full cycles. Ads search volume is most of the cost. The code records the
same figures from `estimateOpenAnalysisSpend()`.

## Cache

Identity and specs are kept for 30 days. Price and availability are kept for
24 hours and are marked stale after that. A repeated analysis of the same
resolved product within 24 hours returns the stored result and does not spend
again. The evidence date is included on the resolve response and on the result.

The store is one JSON file under `TRENDIQ_DATA_DIR` (default `.trendiq` in the
working directory). Writes use a temp file plus rename, and a lock file.
Creating `/var/lib/trendiq` on a production host needs root. This repository
does not create that directory. See `docs/PRIVATE_ALPHA_OPERATIONS.md`.

## What this build does not do

There is no affiliate program integration.

A later live check of real provider responses is described in
`scripts/open-analysis-capped-live-validation.mjs`. That script always exits
before a network call. A future run needs a separate owner authorization and a
budget of at most $5. Do not set
`TRENDIQ_OPEN_ANALYSIS_LIVE_VALIDATION=authorized` in this build.

Legal disclaimer, terms, privacy, affiliate disclosure, and onboarding are a
separate change and are not implemented here.
