# Open product analysis

Free-text analysis evaluates a product name that is not in the controlled
catalog. The catalog remains the single product `ray-ban-meta`. Unknown
`productId` values still return `product_not_supported`.

The switch `TRENDIQ_OPEN_ANALYSIS_ENABLED` defaults to false. While it is false
the server does not create the data file and does not call a provider for
`POST /api/product-resolve`.

## Switches

Both `TRENDIQ_ANALYSIS_ENABLED=true` and `TRENDIQ_OPEN_ANALYSIS_ENABLED=true`
are required before a name resolution or an open analysis calls a provider.
Readiness, the process paid-operation ceiling, live provider configuration,
credentials, the approved DataForSEO origin, and a writable data directory are
checked first. The identity shopping task also reserves one process
paid-operation. `TRENDIQ_ANALYSIS_ENABLED=false` stops new provider work,
including name resolution.

## Caps

All provider calls, errors, and retries count. Resolve and analysis share one
cycle ledger. There is no separate identity allowance on top of the cycle limit.

- $0.15 maximum for one resolution plus its analysis.
- $3 maximum for one UTC day.
- 100 name resolutions per UTC day, 5 analyses per client per hour, 20 per
  client per day, and one analysis in flight per client.
- This deployment is one Node process and one replica. The file lock is the
  concurrency control. It is not safe on two replicas, two hosts, or NFS.
  Lock creation is a temp file plus `link`, which fails if the lock already
  exists. A fresh lock is held even when its pid is dead, so a restart or a
  deploy overlap does not clear it. An unreadable lock is held. A lock older
  than 60 seconds is removed only after a second check that its pid,
  `createdAt`, and token are still the stale identity. Release removes a lock
  only when that same pid and token still own it. A second replica can still
  spend at the same time. Do not scale this service out.

### What the money control guarantees

Before a call, the process atomically reserves the published list price for
that request. The reservation is refused when it would put the cycle over
$0.15 or the UTC day of the reservation over $3. The reservation stays on that
UTC day. A response that arrives after midnight is reconciled to the same day.
A refusal before the POST is sent keeps the reservation at the published list
price. It is not refunded and it is not moved to the next day. A crash leaves
the reservation in place.

After the POST is sent, a timeout, a connection reset or interrupted socket,
an HTTP 5xx, or any other result that does not prove there was no billable
consumption is `unknown`. An explicit cost of zero is that proof and clears
the hold. A successful response with a finite `cost` records that cost. The
list price is not booked as the final cost of an unknown hold.

An unknown hold blocks every new paid operation on every UTC day and every
cycle until an explicit reconciliation. Restart does not clear it, and retention
does not delete it. A late response that arrives by itself does not clear the
hold. A late body with no finite `cost` does not clear it either. There is no
automatic release. Reconciliation keeps the reservation and marks it
`reconciled`. It does not delete the record.

This is not a hard invoice cap. DataForSEO can return a `cost` higher than the
published list price for the same request. That higher amount is recorded after
the call and can put the cycle or the day above the limit. There is no
published pre-call maximum that the provider promises not to exceed.

Product Owner decision still required: accept this published-list-price
pre-authorization, and leave the open-analysis switch off until that residual
overage is an accepted risk, or keep the switch off until DataForSEO exposes a
pre-call maximum. The switch stays false in this repository.

Published list prices checked on 2026-10-20. They are the pre-send estimate,
not a bill, and not the settlement for an unknown hold.

| Call | Estimate |
| --- | --- |
| Shopping products task, identity, depth 40, one paid POST | $0.002 |
| Trends explore live | $0.0012 |
| Google Ads search volume live | $0.09 |
| Shopping products task inside reviews | $0.002 |
| Shopping reviews at recent depth 200 | $0.03 |

A typical full cycle is about $0.1252, including the $0.002 identity task.
At that estimate the $3 day cap allows 23 full cycles. Ads search volume is
most of the cost. The code records the same figures from
`estimateOpenAnalysisSpend()`.

Identity search posts one Shopping products task, then polls `task_get` with
the same attempt count and wait as the reviews client. A task that is still
queued is not treated as "not found". The poll does not post a second task.

## Client rate-limit identity

The trusted proxy is the same-host reverse proxy that connects to Node on
loopback. It must strip any inbound `cf-access-authenticated-user-email` and
set that header itself. Node reads the header only when the TCP peer is
loopback. `x-forwarded-for` is never the client key.

## Cache

Identity and specs are kept for 30 days. Price and availability are kept for
24 hours and are marked stale after that. A repeated analysis of the same
resolved product within 24 hours returns the stored result and does not spend
again. The evidence date is included on the resolve response and on the result.

The store is one JSON file named `open-analysis.json`. `TRENDIQ_DATA_DIR` is
required. An unset or blank value does not fall back to `.trendiq` in the
working directory. The process does not create the directory and does not
create a ledger on startup or restart.

First use is an explicit provision, after the directory already exists:

```text
node scripts/provision-open-analysis-store.mjs
```

That command is the only path that may write a zeroed ledger. Running it again
does not reset counters. If the directory is missing, the provision marker
exists but the ledger file is gone, or the ledger JSON is corrupt, paid
open-analysis calls are refused and no new zeroed file is written. A restart
of a valid ledger reads the same counters.

Writes use a temp file plus rename, and a lock file. The lock is for one
process on one host. Creating `/var/lib/trendiq` on a production host needs
root. This repository does not create that directory. See
`docs/PRIVATE_ALPHA_OPERATIONS.md`.

Runtime is Node `>=22.7.0 <23`. `.nvmrc` pins `22.23.4`. Install with
`pnpm install --frozen-lockfile` (see `packageManager` in `package.json`).

## Reconciling an unknown hold

The reconcile script does not call DataForSEO and does not edit the ledger by
hand. Read the cost from the provider first:

1. In the DataForSEO dashboard, open Billing or the API usage transactions for
   the UTC day of the hold.
2. Match the row by time, endpoint, and task id when the call returned one.
   Use that row's cost in USD. Do not substitute the published list price.
3. Build an evidence ref that identifies the row, with no line breaks, for
   example `task:<id> date:YYYY-MM-DD` or the billing transaction id.
4. The hold id is the key under `spendByDay.<day>.reservations` whose
   `costState` is `unknown`.

```text
TRENDIQ_DATA_DIR=/var/lib/trendiq node scripts/reconcile-open-analysis.mjs <holdId> <providerCostUsd> "<evidenceRef>"
```

A successful run fsyncs the ledger, sets that reservation to `reconciled`,
keeps the record, and appends one JSON line to `open-analysis-audit.log`.
The same command again is idempotent and does not apply the cost a second
time. The audit log is append-only.

## Concurrency and recovery tests

`src/server/analysis/openAnalysis/__tests__/storeLockConcurrency.test.ts` runs
four processes against one ledger and covers a live fresh lock, a dead fresh
lock left by a restart, and stale takeover. `spendLedgerFailClosed.test.ts`
covers a missing directory, a missing or corrupt ledger, unknown holds across
UTC days, post-send errors, the reconcile script, and lock identity.
`openAnalysisLimits.test.ts` covers parallel in-process increments and a fresh
dead-pid lock that must not be taken. `rayBanMetaUnchanged` is the describe
name in `src/server/analysis/__tests__/rayBanMetaUnchanged.test.ts`.

## What this build does not do

There is no affiliate program integration.

A later live check of real provider responses is described in
`scripts/open-analysis-capped-live-validation.mjs`. That script always exits
before a network call. A future run needs a separate owner authorization and a
budget of at most $5. Do not set
`TRENDIQ_OPEN_ANALYSIS_LIVE_VALIDATION=authorized` in this build.

Legal disclaimer, terms, privacy, affiliate disclosure, and onboarding are a
separate change and are not implemented here.
