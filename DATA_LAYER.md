# TrendIQ Data Layer v1

TrendIQ Data Layer v1 prepares the app to move from static demo inputs to real trend signals without changing the TrendIQ Score Engine. It is mock-only for now: no external APIs, databases, auth, or paid services are connected.

## Architecture

The flow is:

1. Provider adapters return normalized signals.
2. `signalAggregator` translates those signals into `TrendIQSignalInputs`.
3. The existing TrendIQ Score Engine v1 calculates score, components, and penalties.
4. The existing Confidence Engine calculates confidence from data-layer coverage and freshness.
5. `snapshotEngine` packages the score, confidence, trend status, raw signals, and provenance into a `ProductTrendSnapshot`.

Ray-Ban Meta Glasses is the first proof-of-concept product using this flow. Other products still use the existing mock score inputs.

## Provider Interface

Providers live in `src/app/lib/data/providers/` and implement:

```ts
interface TrendSignalProvider {
  id: TrendIQDataSource;
  label: string;
  getSignals(productId: string): NormalizedTrendSignal[];
}
```

Current mock providers:

- `searchProvider` for generic Search/Web interest, with DataForSEO live mode available behind the same interface
- `redditProvider`
- `reviewsProvider`
- `socialProvider`
- `merchantProvider`

Each provider is deterministic and returns mock data only.

## Normalized Signal Model

`NormalizedTrendSignal` includes:

- `source`
- `signalType`
- `productId`
- `value`
- `normalizedValue` from 0-100
- `previousValue`
- `percentChange`
- `sampleSize`
- `timestamp`
- `confidence`
- `metadata`

Provider-level `normalizedValue` is for data quality, debugging, and future UI context. It is not the TrendIQ component score. The score engine still receives raw v1 fields through `TrendIQSignalInputs`.

## Aggregation

`signalAggregator` is the only place where provider signals become score-engine inputs. It reads `metadata.engineField` and `metadata.engineValue`, averages multiple provider claims for the same field, and builds the complete `TrendIQSignalInputs` object.

Aggregation rules are intentionally isolated from scoring so future changes to provider weighting, source trust, or field mapping do not require changes to TrendIQ Score v1 formulas.

## Snapshots And History

`ProductTrendSnapshot` contains:

- `productId`
- `timestamp`
- `rawSignals`
- `aggregatedSignals`
- `trendIQScore`
- `confidence`
- `trendStatus`
- `provenance`

Mock historical snapshots are stored in `history.ts` for all existing products. They support 7-day momentum now and are shaped so 30-day momentum can be added later by expanding the stored series.

## Adding A Real Provider

To replace a mock provider with real data:

1. Keep the same `TrendSignalProvider` interface.
2. Fetch source data outside the score engine.
3. Convert source metrics into `NormalizedTrendSignal[]`.
4. Include raw score-engine values in `metadata.engineField` and `metadata.engineValue`.
5. Add provider normalization tests with fixed fixtures.
6. Run the full score integration test to confirm deterministic output.

The score engine should not know whether the source is Google Trends, Reddit, reviews, social, merchant, or another future provider.

## Commerce Separation

Products can optionally include commerce metadata:

```ts
commerce: {
  merchants: [
    { merchantName, productUrl, affiliateUrl?, price?, currency?, lastUpdated? }
  ]
}
```

Commerce data is not read by the TrendIQ Score Engine, Confidence Engine, or momentum calculations. Affiliate relationships must never influence TrendIQ Score.
