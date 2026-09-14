# TrendIQ Search Provider

TrendIQ's Search/Web live-data adapter uses **DataForSEO Trends API** for relative interest and **DataForSEO Google Ads Search Volume API** for absolute keyword volume behind a generic `searchWeb` provider abstraction.

The provider is mock-first. It does not make live calls unless `TRENDIQ_SEARCH_MODE=live` and valid DataForSEO credentials are available in the server/runtime environment.

## Provider Selected

Initial vendor: DataForSEO.

Endpoints used by the adapter:

```text
/v3/keywords_data/dataforseo_trends/explore/live
/v3/keywords_data/google_ads/search_volume/live
```

The Trends endpoint is treated in TrendIQ as **Search Interest** / **Search Momentum**, not as official Google Trends data. The adapter intentionally does not use DataForSEO's separate `google_trends` endpoint as the default provider.

The Google Ads Search Volume endpoint is treated as an absolute monthly keyword-volume observation. TrendIQ converts that monthly observation into an explicit derived 7-day estimate for the existing `searchVolume7d` score input.

The provider abstraction is generic so a future official Google Trends API adapter can replace DataForSEO without changing the Score Engine.

## Authentication

Create a DataForSEO account at:

```text
https://dataforseo.com/
```

Then get API credentials from the DataForSEO API Access dashboard.

Required local environment variables:

```env
TRENDIQ_SEARCH_MODE=mock
TRENDIQ_SEARCH_PROVIDER=dataforseo
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
DATAFORSEO_API_BASE_URL=https://api.dataforseo.com
TRENDIQ_SEARCH_CACHE_TTL_MS=900000
TRENDIQ_SEARCH_MIN_SAMPLE_SIZE=2
TRENDIQ_SEARCH_LOCATION_CODE=2840
TRENDIQ_SEARCH_LANGUAGE_CODE=en
```

Do not expose these values through `VITE_` environment variables. DataForSEO credentials must stay server-side.

## Product Scope

Live mode is enabled only for:

```text
ray-ban-meta
```

Search aliases:

- `Ray-Ban Meta`
- `Ray Ban Meta`
- `Meta smart glasses`
- `Ray-Ban smart glasses`

Aliases live in `src/app/lib/data/search/config.ts`.

## Signals

Live-capable signals:

- `searchMomentum.searchGrowthPercent`
- `searchMomentum.searchVolume7d` as a derived 7-day estimate from live monthly search volume
- `growthVelocity.trendChangePercent`
- `growthVelocity.accelerationPercent`
- `growthVelocity.consecutiveGrowthDays`

Context-only signals:

- current 7-day Search Interest
- previous 7-day Search Interest
- current/previous 30-day Search Interest when enough returned points exist
- alias coverage
- observation count
- freshness

Still mocked:

- `searchMomentum.queryShareOfCategoryPercent`
- sentiment
- purchase intent
- review quality
- Reddit
- TikTok/social creator metrics
- hype sustainability
- commerce and affiliate data

## Windows

The adapter requests the provider's `past_30_days` Search Interest range and computes:

- current 7-day window
- previous 7-day window
- current 30-day window
- previous 30-day window

The provider does not fabricate historical snapshots. If a future runtime does not have enough historical granularity, TrendIQ keeps the existing mock historical snapshots.

## Normalization

DataForSEO Trends values are relative Search Interest values from 0 to 100. TrendIQ keeps them as provider-level normalized values.

DataForSEO Google Ads Search Volume returns monthly-style absolute keyword volume. TrendIQ stores the provider monthly observation as `live` context and derives `searchVolume7d` as:

```text
monthlySearchVolume * (7 / 30.4375)
```

Score-affecting fields use the existing score-engine raw input fields:

- monthly Search Volume maps to `searchMomentum.searchVolume7d` only after the explicit 7-day conversion above
- 7-day Search Interest change maps to `searchGrowthPercent`
- 7-day Search Interest change maps to `growthVelocity.trendChangePercent`
- 7-day minus 30-day growth maps to `growthVelocity.accelerationPercent`

The score engine still owns all component normalization and weighting.

## Cache

The MVP uses an in-memory cache keyed by:

- provider
- product
- aliases
- location
- language
- interest type
- date window

The TTL is controlled by:

```env
TRENDIQ_SEARCH_CACHE_TTL_MS=900000
```

## Fallback

The provider falls back to mock Search/Web signals when:

- credentials are missing
- mode is `mock`
- DataForSEO is unavailable
- rate limits are hit
- response JSON is malformed
- returned data is insufficient
- product is not configured for live mode

The UI should never crash because the external provider is unavailable.

## Switching Mock And Live

Mock mode:

```env
TRENDIQ_SEARCH_MODE=mock
```

Live mode:

```env
TRENDIQ_SEARCH_MODE=live
```

Live mode also requires `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD`.

## Limitations

- DataForSEO Trends is a proprietary Search Interest metric, not official Google Trends.
- Google Ads Search Volume is monthly-style keyword volume, not a direct 7-day observation.
- It should not be used for sentiment, reviews, purchase intent, or social platform sentiment.
- Live credentials must be used only from a server-side context.
- Alias ambiguity can still pull broad smart-glasses interest that is not purely Ray-Ban Meta.
- Cost scales with product count, alias count, endpoint count, and refresh cadence, so batching and caching matter.

## Replacing The Provider Later

To replace DataForSEO with another vendor or official Google Trends access:

1. Keep the `SearchInterestClient` interface.
2. Map vendor responses into `SearchInterestSeries`.
3. Keep output as `NormalizedTrendSignal[]`.
4. Preserve `searchWeb` as the source unless the source taxonomy is intentionally revised.
5. Do not change TrendIQ Score Engine weights or formulas.
