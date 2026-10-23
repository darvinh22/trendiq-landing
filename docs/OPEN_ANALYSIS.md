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
  deploy overlap does not clear it. An unreadable lock is held. A live pid is
  never removed, including after 60 seconds (`kill(pid, 0)`). A dead pid's
  lock is removed only when it is older than 60 seconds, the token still
  matches, and this process holds the kernel flock on that inode. The lock
  file is never renamed. Release unlinks only that same pid and token, and
  only while it holds the flock, so another process cannot take the path in
  between. A second replica can still spend at the same time. Do not scale
  this service out.

### What the money control guarantees

Before a call, the process atomically reserves the published list price for
that request. The reservation is refused when it would put the cycle over
$0.15 or the UTC day of the reservation over $3. The reservation stays on that
UTC day. A response that arrives after midnight is reconciled to the same day.
A refusal before the POST is sent keeps the reservation at the published list
price. It is not refunded and it is not moved to the next day. A crash after
the reservation is written, including a crash after the paid POST and before
the cost is marked unknown or reconciled, leaves that reservation `reserved`.
The row does not record whether the POST was sent. A crash after `reserve`
and before `fetch` leaves the same paid `reserved` shape. See "Reserved holds
do not show whether the POST was sent".

The next locked ledger operation on `OpenAnalysisFileStore` converts a paid
reservation that is still `reserved` and has no confirmed settlement into
`unknown` when its job can no longer be running. On the first locked
operation after process start, that is every such reservation: the previous
process and its deadline timer are gone. The server performs that operation
only when `TRENDIQ_OPEN_ANALYSIS_ENABLED` is the exact string `true`. While
the switch is false, process start does not convert the holds. While
this process stays up, the same conversion runs once the reservation is older
than the job deadline (55 seconds unless `TRENDIQ_ANALYSIS_JOB_DEADLINE_MS`
is set). The write is atomic under the existing file lock. It does not change
the held amount and it does not delete the record. Running that recovery again
does not change the hold a second time. Unknown records are never deleted by a
restart or by retention. New paid calls stay blocked, including a second paid
call for the same product, until the reconcile script matches the hold to the
provider invoice. Do not hand-edit `open-analysis.json`. This is still one
replica. It is not cross-replica deduplication.

After the POST is sent, a timeout, a connection reset or interrupted socket,
or any HTTP status 500 or higher is `unknown`. A 5xx body that reports `cost`
0 is still unknown. It does not release the reservation. An explicit cost of
zero on a 2xx or a 4xx is proof that nothing billable was consumed and can
clear the hold. A successful 2xx response with a finite `cost` records that
cost. The list price is not booked as the final cost of an unknown hold.

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

Runtime is Node `>=22.7.0 <23` and pnpm `>=10.33.4 <11`. `.nvmrc` pins
`22.23.4`. `packageManager` is `pnpm@10.33.4`. Install with
`pnpm install --frozen-lockfile`. `.github/workflows/ci.yml` uses that Node
version, pnpm 10.33.4, and the frozen lockfile. It does not deploy.

## Reconciling an unknown hold

The reconcile script does not call DataForSEO and does not edit the ledger by
hand. Read the cost from the provider first:

1. In the DataForSEO dashboard, open Billing or the API usage transactions for
   the UTC day of the hold.
2. Match the row by time, endpoint, and task id when the call returned one.
   Use that row's cost in USD. Do not substitute the published list price.
3. Build an evidence ref that identifies the row, with no line breaks, for
   example `task:<id> date:YYYY-MM-DD` or the billing transaction id.
4. The hold id is the key under `spendByDay.<day>.reservations`. Do not run
   the script while that hold's job is still running. Recovery converts an
   orphaned paid `reserved` hold to `unknown`. The script resolves that
   converted hold. `reconcileVerifiedHold` in
   `src/server/analysis/openAnalysis/storeFile.mjs` also converts the named
   paid `reserved` hold under the lock and then reconciles it when you run
   the script first, including when the hold is younger than the job
   deadline. That allowance is not an operator procedure. See "Do not
   reconcile a running job". Other paid `reserved` holds are converted only
   after the job deadline. The script reads
   `TRENDIQ_ANALYSIS_JOB_DEADLINE_MS` when that value is a whole number from
   1000 to 120000. Otherwise the deadline is 55 seconds. A reconciled hold
   with the same evidence ref and the same micros is left unchanged. Any
   other state is refused.

```text
TRENDIQ_DATA_DIR=/var/lib/trendiq node scripts/reconcile-open-analysis.mjs <holdId> <providerCostUsd> "<evidenceRef>"
```

A successful run fsyncs the ledger, sets that reservation to `reconciled`,
keeps the record, and appends one JSON line to `open-analysis-audit.log`.
The same command again is idempotent and does not apply the cost a second
time. The audit log is append-only. A startup conversion also appends one
line, `expire_reserved_to_unknown`, and does not append it again when recovery
finds nothing left to convert. Reconcile every hold id on that line. See
"After restart" and "Persistent unknown-cost blocks".

## Drain before every deploy

F1, required before activation. Do this before every deploy and before every
restart of the one replica, including a configuration restart. Finish with no
paid hold still `reserved`. `TRENDIQ_OPEN_ANALYSIS_ENABLED` stays false in
this repository. This section does not turn it on and does not change spend
caps.

1. Turn open analysis off for the next process. Set
   `TRENDIQ_OPEN_ANALYSIS_ENABLED` false in the configuration that process
   will start with. Only the exact string `true` enables it. The running
   process already read the variable at startup. Changing the variable does
   not stop that process. Restarting so the new value applies is the restart
   this drain exists to prepare. Leave this replica up.
2. Stop new requests that can reach Node. That includes
   `POST /api/product-resolve` and an open-analysis analyze call. Close the
   password gate and any direct-origin URL. Work already running inside the
   process keeps running until it settles.
3. Wait until no paid hold is still reserved. A paid hold has `micros`
   greater than 0, `costState` of `reserved` or absent, and no `actualMicros`
   or `reconciledAt`. A reservation with `micros` of 0 is not a paid hold.
   Startup recovery does not convert it and it does not block new paid calls.
   After the last accepted request, wait at least the job deadline (55
   seconds, or `TRENDIQ_ANALYSIS_JOB_DEADLINE_MS` when that value is a whole
   number from 1000 to 120000). Then run the read-only check below.
   `pendingPaidReserved`, `pendingJobs`, and `inFlight` must all be empty
   before the termination signal.
4. Do not use `TRENDIQ_ANALYSIS_ENABLED=false` followed by a restart as the
   drain. That restart converts every unsettled paid `reserved` hold. If a
   paid hold is still `reserved` past the deadline while this process stays
   up, the next locked ledger read converts it to `unknown` with reason
   `job_deadline_exceeded` and paid calls block. That is not a finished
   drain. Follow "Persistent unknown-cost blocks". Do not restart to clear
   it.

## Verify pending reservations before restart

Read the ledger immediately before the termination signal. This does not take
the store lock and does not write. Do not edit `open-analysis.json`. A read
taken while new requests are still arriving is not proof.

```text
TRENDIQ_DATA_DIR=/var/lib/trendiq node --input-type=module <<'EOF'
import { readFile } from "node:fs/promises";
const doc = JSON.parse(await readFile(process.env.TRENDIQ_DATA_DIR + "/open-analysis.json", "utf8"));
const pendingPaidReserved = [];
const unknown = [];
for (const [day, spend] of Object.entries(doc.spendByDay ?? {})) {
  for (const [id, reservation] of Object.entries(spend.reservations ?? {})) {
    const state = reservation.costState ?? "reserved";
    if (state === "unknown") {
      unknown.push({ day, id, micros: reservation.micros, createdAt: reservation.createdAt, cycleId: reservation.cycleId });
    }
    if (reservation.micros > 0 && state === "reserved" && reservation.actualMicros == null && !reservation.reconciledAt) {
      pendingPaidReserved.push({ day, id, micros: reservation.micros, createdAt: reservation.createdAt, cycleId: reservation.cycleId });
    }
  }
}
const pendingJobs = Object.entries(doc.jobs ?? {})
  .filter(([, job]) => job && job.status === "pending")
  .map(([id, job]) => ({ id, createdAt: job.createdAt }));
const inFlight = Object.entries(doc.clients ?? {})
  .filter(([, client]) => client && client.inFlightAnalysisId)
  .map(([client, value]) => ({ client, inFlightAnalysisId: value.inFlightAnalysisId, inFlightSince: value.inFlightSince }));
console.log(JSON.stringify({ pendingPaidReserved, unknown, pendingJobs, inFlight }, null, 2));
EOF
```

Hold ids are the keys under `spendByDay.<UTC day>.reservations`. They are not
stored on `jobs`.

- `pendingPaidReserved` must be empty. If it is not, the drain is unfinished.
  Do not restart.
- `pendingJobs` and `inFlight` must be empty. A pending job may still be
  between reserve and settle.
- `unknown` may be non-empty. Restart does not clear those holds, and paid
  calls stay blocked until each one is reconciled. Treat that list as
  persistent-block work, not as a reason to restart.

## After restart

The first locked `OpenAnalysisFileStore` operation of a server process
converts every paid hold that is still `reserved` and has no confirmed
settlement into `unknown`. It passes `convertAllReserved`. The reconcile
script does not. That script converts other paid `reserved` holds only after
the job deadline, and it settles the named hold even when the hold is
younger. The server conversion does not change the held amount and it does
not delete the record. It appends one JSON line to
`$TRENDIQ_DATA_DIR/open-analysis-audit.log`:

```text
{"at":"<UTC ISO time>","action":"expire_reserved_to_unknown","holdIds":["<holdId>"],"reason":"process_startup"}
```

A later conversion while that same process stays up uses
`"reason":"job_deadline_exceeded"`. The reconcile script can append the same
action for other holds older than the job deadline. Another pass appends
nothing when nothing remains to convert.

After restart, read the audit log and reconcile every hold id on every new
`expire_reserved_to_unknown` line. Use
`scripts/reconcile-open-analysis.mjs` and the invoice cost for that hold. Do
not skip an id. Do not hand-edit the ledger.

```text
grep expire_reserved_to_unknown "$TRENDIQ_DATA_DIR/open-analysis-audit.log"
```

The server appends `process_startup` on the first locked
`OpenAnalysisFileStore` operation of that process. It constructs that store
only when `TRENDIQ_OPEN_ANALYSIS_ENABLED` is the exact string `true`. A
read-only look at `open-analysis.json`, including the check above, does not
append the line and does not convert holds. While the switch is false,
restart alone does not append the line and does not convert the holds. Still
read the ledger. A paid `reserved` hold left by a restart mid-job has to be
reconciled before paid calls can resume. The next process that runs a locked
store operation converts it and appends the audit line.

## Do not reconcile a running job

Never run `scripts/reconcile-open-analysis.mjs` for a hold whose job is still
running.

`reconcileVerifiedHold` in `src/server/analysis/openAnalysis/storeFile.mjs`
allows it. Operators must not. `recoverExpiredPaidReservations` converts a
paid `reserved` hold only after the job deadline, unless the process-start
pass sets `convertAllReserved`. The reconcile path does not set
`convertAllReserved`. It still settles the named hold when `costState` is
`reserved` or absent, including when `createdAt` is younger than the
deadline. It sets `costState` to `unknown` and reconciles in the same locked
write. There is no check that a job is in flight.

Treat the job as still running while this replica is up and any of these are
true: `pendingJobs` is non-empty, `inFlight` is non-empty, or the hold is a
paid `reserved` row younger than the job deadline. Wait until that process
settles the work, or until the replica has stopped after a completed drain.
A live job can still call `markUnknown` or the in-process `reconcile` after
the script returns. In-process `reconcile` ignores an `unknown` hold, and
otherwise deletes the reservation and applies another micros delta, including
when the script already set `reconciled`. `markUnknown` sets `costState`
back to `unknown` even after that.

## Persistent unknown-cost blocks

An unresolved unknown cost keeps blocking paid calls. Callers get
`daily_capacity_reached` (HTTP 503), including a repeat for the same product
and including the next UTC day. The $0.15 cycle cap and the $3 day cap use
that same reason. Read the ledger before deciding which one it is. Do not
raise either cap.

A hold blocks when `costState` is `unknown`, or when it is a paid reservation
still `reserved` with no confirmed settlement once the job deadline has
passed. Restart does not clear it. Retention does not delete a day that still
has an `unknown` reservation. A late body with no finite `cost` does not
clear it. Provision does not reset counters. Do not delete
`open-analysis.json`. Do not edit it by hand.

1. Stop new open-analysis requests. Confirm no job is still running for the
   holds you will reconcile.
2. List every `unknown` reservation and every id in
   `expire_reserved_to_unknown`.
3. For each id, open DataForSEO billing or API usage for that reservation's
   UTC day (`dayKey` or `createdAt`). Match time, endpoint, and task id when
   one was returned.
4. If a row matches, pass that row's USD cost. Do not substitute the published
   list price.
5. If no row matches, reconcile at `0`. Do that only when the invoice has no
   charge for the hold. Put that fact in the evidence ref, for example
   `no-invoice-row hold:<holdId> date:YYYY-MM-DD`. A real charge reconciled
   at `0` understates spend.
6. Run this once per hold. The script does not call DataForSEO:

```text
TRENDIQ_DATA_DIR=/var/lib/trendiq node scripts/reconcile-open-analysis.mjs <holdId> <providerCostUsd> "<evidenceRef>"
```

7. Read the ledger again. Each of those holds is `reconciled`. No `unknown`
   row remains, and no paid `reserved` hold is past the deadline. The same
   command with the same evidence ref and the same cost does not apply twice.
   `open_analysis_reconciliation_unverified` means stop. Do not guess another
   cost.
8. Paid calls stay blocked until every such hold is reconciled. Leave
   `TRENDIQ_OPEN_ANALYSIS_ENABLED` false until that is true and the gate 2
   checklist below passes.

## Reserved holds do not show whether the POST was sent

`reserve` writes the hold before `fetch`. The reservation does not store
whether the paid POST was handed to DataForSEO. A crash after `reserve` and
before the POST, and a crash after the POST and before `markUnknown` or
`reconcile`, leave the same paid `reserved` row: `micros` greater than 0, no
`actualMicros`, no `reconciledAt`. `micros` is the published list-price
estimate in both cases. Startup recovery cannot tell them apart. With
`convertAllReserved`, the first locked read converts both and appends
`expire_reserved_to_unknown` with reason `process_startup`.

Every restart that interrupts a job can leave that row and can need a manual
reconcile. Match the invoice. Use `0` when the invoice has no charge. Use the
row's USD cost when it does. Do not infer "POST never sent" from a short
crash, and do not infer "POST sent" from the list-price `micros`.

## Gate 2 checklist

Do not set `TRENDIQ_OPEN_ANALYSIS_ENABLED=true` until this checklist passes
on the host. The default in this repository stays false.

- `TRENDIQ_OPEN_ANALYSIS_LEDGER_WRITE_FAIL` must never be set in production.
  It is not in `.env.example`. The only reader is `atomicWriteJson` in
  `src/server/analysis/openAnalysis/storeFile.mjs`. The value `1` throws
  `open_analysis_ledger_write_failed` before the ledger temp file is renamed.
  That path is a test seam. The variable must be absent from the service
  environment, from platform secrets, and from any shell that runs the server,
  provision, or reconcile. Do not set it to pause spending.
- `/var/lib/trendiq` exists, the ledger has been provisioned, and exactly one
  replica uses that `TRENDIQ_DATA_DIR`.
- No `unknown` hold is outstanding, and no paid `reserved` hold is past its
  deadline, or each of those holds has been reconciled from the invoice.

## Recovering a stale lock

Do this only after the checks below. The process never deletes a lock whose
inode is held. A missing `flock` binary fails closed with
`open_analysis_flock_missing` and does not rewrite the ledger. That attempt
removes only the lock file it just created, and only when the pid and token
still match. A timed-out `flock` does not remove the lock and does not drop
a hold. Install `flock` from util-linux. Do not delete `open-analysis.json`
to get past that error.

1. Stop the single TrendIQ replica and confirm it is gone. Check the process
   list and the platform replica count. Include `node`, the container, and
   any `provision-open-analysis-store.mjs` or `reconcile-open-analysis.mjs`
   process. Nothing that opens `TRENDIQ_DATA_DIR` may still be running.
2. In a container the application is often PID 1. `kill -0 1` succeeding does
   not mean the process that wrote the lock is still alive. A new container
   reuses PID 1, so a stale lock looks live. Compare the lock's `createdAt`
   with the start time of the current PID (`ps -o lstart= -p <pid>`, or the
   container start time). A pid that is alive but started after `createdAt`
   is a different process. Still do not remove the lock until this replica
   is stopped.
3. Read `open-analysis.json.lock`. It is JSON with `pid`, `token`, and
   `createdAt`. Write those three values down before changing anything.
4. Prove the inode is not held. This open does not create the file:

   ```text
   flock -n 3 3<"$TRENDIQ_DATA_DIR/open-analysis.json.lock"
   ```

   Exit 0 means nobody holds the flock. Any other exit means it is held, or
   `flock` is missing. `lsof "$TRENDIQ_DATA_DIR/open-analysis.json.lock"` must
   show no process. If either check shows a holder, stop. Do not delete the
   lock.
5. Confirm no store operation is in progress: no TrendIQ process, and the
   `flock -n` check above exited 0.
6. Remove only `open-analysis.json.lock`. Do not edit or remove
   `open-analysis.json`.
7. Append one JSON line to `open-analysis-audit.log`. This is append-only.
   The command uses `>>`. Do not use `>`, and do not rewrite the file:

   ```text
   printf '%s\n' '{"at":"<UTC ISO time>","action":"stale_lock_removed","pid":<pid>,"token":"<token>","createdAt":"<createdAt>","inodeCheck":"flock -n acquired; lsof empty"}' >> "$TRENDIQ_DATA_DIR/open-analysis-audit.log"
   ```

## Concurrency and recovery tests

`src/server/analysis/openAnalysis/__tests__/storeLockConcurrency.test.ts` runs
four processes against one ledger and covers a live fresh lock, a dead fresh
lock left by a restart, and stale takeover. `spendLedgerFailClosed.test.ts`
covers a missing directory, a missing or corrupt ledger, unknown holds across
UTC days, post-send errors, the reconcile script, and lock identity.
`openAnalysisLimits.test.ts` covers parallel in-process increments and a fresh
dead-pid lock that must not be taken. `paidReservationRecovery.test.ts` covers
a crash after the paid POST, the restart refusal, reconcile of the converted
hold, idempotent recovery, two recoverers racing a request, and fail-closed
read, recovery, and write. `rayBanMetaUnchanged` is the describe
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
