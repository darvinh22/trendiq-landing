# Private Alpha Operations

This runbook applies only to the controlled three-user Ray-Ban Meta private
alpha. It does not describe a public or multi-replica deployment.

## Deployment contract

- Run exactly one Node process and exactly one deployment replica. This is a
  hard requirement for open-analysis spend, not only for the Ray-Ban Meta job
  map. The spend ledger is one JSON file guarded by a local lock file. The lock
  is not shared across hosts or NFS. Creation is a temp file plus `link`. A
  fresh lock stays held when its pid is dead, including across a restart or a
  deploy overlap. An unreadable lock stays held. A live pid is never taken,
  even after 60 seconds. Takeover requires a dead pid, age over 60 seconds,
  the same token, and the kernel flock on that inode. The lock file is not
  renamed. Release unlinks only the owner's pid and token while holding that
  flock. A second replica can still spend again. Do not add a second process,
  a second container, or a second host against the same `TRENDIQ_DATA_DIR`.
  Disable auto-scaling and rolling overlap so two application processes are
  never active at the same time. The host needs `flock` from util-linux.
- Build with `npm run build` and start with `npm start`. Vite preview is not the
  production server.
- `PORT` defaults to 3000. Leave `HOST` unset to listen on all interfaces, which
  is the previous behavior. Set `HOST=127.0.0.1` when the edge proxy on the same
  machine forwards to loopback, so the Node process does not accept connections
  on other interfaces. A blank `HOST` is invalid and the process will refuse to
  start. `HOST` is an address only (for example `127.0.0.1` or `::1`), with no
  scheme or port.
- Terminate HTTPS at the deployment edge.
- Require the deployment platform's password gate before both the static UI and
  every API route. Disable any direct-origin URL that bypasses that gate.
- Store provider credentials only as server runtime secrets. Never use `VITE_`
  variables for credentials.
- Set `TRENDIQ_ANALYSIS_ENABLED=true` only while the alpha is open.
- Set `TRENDIQ_PROCESS_MAX_PAID_OPERATIONS` to a deliberate finite positive
  process-lifetime ceiling. The ceiling does not reset automatically.
- Keep `DATAFORSEO_API_BASE_URL` at the approved exact origin documented in
  `.env.example`. Configure at least one evidence path as `live`, with its
  provider set to `dataforseo` and credentials present.

## Opening and operating the alpha

1. Start the single process and confirm `GET /health` returns 200.
2. Confirm `GET /ready` returns 200 before sharing access. Neither endpoint
   contacts a provider.
3. Confirm the password gate protects `/`, `/about.html`, `/health`, `/ready`,
   and `/api/product-analysis` with no direct-origin bypass.
4. Monitor the sanitized JSON lifecycle/cost logs while an invited user runs an
   analysis. Treat the application analysis ID as the support correlation ID.
5. Do not enable automated retries. Analyze and Retry remain explicit user
   actions.

`/health` is the liveness signal. `/ready` is an operator readiness and
operational signal; it must not be configured to trigger automatic process
restart. In particular, process paid-operation ceiling exhaustion makes
`/ready` fail closed and must not cause a restart, because a deliberate restart
resets the process-lifetime paid-operation counter.

## Kill switch and cost ceiling

To stop new provider work, set `TRENDIQ_ANALYSIS_ENABLED=false` and perform a
graceful restart. The catalog remains available, but analysis starts and
free-text name resolution return a safe disabled state and readiness fails
closed. Neither path calls a provider while that switch is false.

The same-host proxy is the only trusted client-identity hop. Run with
`HOST=127.0.0.1` so only that proxy can connect. The proxy must overwrite
`cf-access-authenticated-user-email` and must not let a client-supplied
`x-forwarded-for` become the rate-limit key. See `docs/OPEN_ANALYSIS.md`.

When the process paid-operation ceiling is exhausted, readiness fails and new
analysis starts are rejected before provider work. Raising the configured
ceiling requires an explicit configuration change and graceful restart; the
in-memory counter resets only on deliberate process restart.

## Graceful restart procedure

When `TRENDIQ_DATA_DIR` has an open-analysis ledger, complete "Drain before
every deploy" before the termination signal. That includes a restart that
only changes configuration, and it includes a host where
`TRENDIQ_OPEN_ANALYSIS_ENABLED` is already false.

1. Close private-alpha access so new requests cannot reach Node. Leave the
   replica up until the drain check shows no paid hold still reserved.
2. Review sanitized lifecycle logs and paid-operation counts before restarting.
3. Allow the process to receive its termination signal and stop accepting new
   traffic.
4. Restart exactly one replica, verify `/health` and `/ready`, then follow
   "After restart" before reopening the password gate.

A restart resets the process-wide counter and loses all in-memory jobs, results,
analysis IDs, deduplication state, and provider-task continuation. A provider
task may still finish remotely after local state is lost. Never restart merely
to bypass the paid-operation ceiling.

## User recovery expectations

- Refreshing the browser loses the displayed in-memory analysis ID. The user may
  reselect the controlled product and explicitly choose Analyze; while the same
  process and controlled window remain active, the server deduplicates that work.
- A server restart makes old analysis IDs unavailable. After the operator has
  restored readiness and reviewed cost logs, the user may explicitly analyze
  again; duplicate paid provider work is possible for the in-memory catalog
  path.
- An open-analysis restart does not start a second paid provider call while a
  paid reservation from the previous process is still unsettled, or while an
  unknown cost is unresolved. Reconcile that hold from the invoice before paid
  calls can resume.
- A browser polling timeout or server job deadline never starts a second
  analysis automatically. Results remain degraded or unavailable rather than
  being fabricated.

## Open product analysis data directory

Free-text analysis stays off until `TRENDIQ_OPEN_ANALYSIS_ENABLED=true`. The
Ray-Ban Meta catalog, its in-memory jobs, and `TRENDIQ_ANALYSIS_ENABLED` do not
change when that flag is false.

Before turning the flag on, an operator with root on the host must create the
data directory and give the service user write access. The application does not
do this itself:

```text
sudo mkdir -p /var/lib/trendiq
sudo chown <service-user>:<service-group> /var/lib/trendiq
sudo chmod 750 /var/lib/trendiq
```

Set `TRENDIQ_DATA_DIR=/var/lib/trendiq`. Do not leave it empty. An empty value
does not fall back to a `.trendiq` directory in the working directory, and the
process will not create `/var/lib/trendiq` or a new ledger on startup.

After the directory exists, provision the ledger once. This is the only step
that may create a zeroed spend file:

```text
TRENDIQ_DATA_DIR=/var/lib/trendiq node scripts/provision-open-analysis-store.mjs
```

The process requires Node `>=22.7.0 <23` (`.nvmrc` is `22.23.4`). Restart and
recovery do not provision that file again. With
`TRENDIQ_OPEN_ANALYSIS_ENABLED` not the exact string `true`, restart does not
open the ledger. If the configured
directory is missing, the ledger file is missing after it was provisioned, or
the JSON is corrupt, open analysis refuses paid calls and does not write a
replacement with counters at zero. After a paid POST, a timeout, connection
reset, HTTP 5xx, or any result that does not prove zero consumption records an
unknown cost. HTTP 500 and above stay unknown even when the body says `cost`
0. A 4xx response with `cost` 0 can clear the hold. The unknown hold blocks
new paid calls on every UTC day and every cycle until it is reconciled. A
restart does not clear it. A late response does not clear it by itself.

If the process stops while a paid hold is still `reserved`, that row looks the
same whether the POST was sent or not. See "Reserved holds do not show
whether the POST was sent". The server converts those holds on the first
locked `OpenAnalysisFileStore` operation, and it constructs that store only when
`TRENDIQ_OPEN_ANALYSIS_ENABLED` is the exact string `true`. While the process
stays up, a later read converts a paid `reserved` hold that has sat past the
job deadline. Neither step deletes the record, changes the held amount, or
clears it on another restart. New paid calls stay blocked, including a second
paid call for the same product, until you reconcile that hold with the script
below. Do not edit the JSON by hand. This is one replica. It is not
cross-replica deduplication.

## Drain before every deploy

F1, required before activation. Do this before every deploy and before every
restart of the one replica. Finish with no paid hold still `reserved`.
`TRENDIQ_OPEN_ANALYSIS_ENABLED` stays false until the gate 2 checklist
passes. This runbook does not turn it on and does not change spend caps.

1. Turn open analysis off for the next process. Set
   `TRENDIQ_OPEN_ANALYSIS_ENABLED` false in the configuration that process
   will start with. Only the exact string `true` enables it. The running
   process already read the variable at startup. Changing it does not drain
   the process that is up, and restarting to apply it converts every
   unsettled paid `reserved` hold. Leave this replica running.
2. Stop new requests that can reach Node, including
   `POST /api/product-resolve` and an open-analysis analyze call. Close the
   password gate and any direct-origin URL. Work already inside the process
   keeps running until it settles.
3. Wait until no paid hold is still reserved. A paid hold has `micros`
   greater than 0, `costState` `reserved` or absent, and no `actualMicros` or
   `reconciledAt`. A `micros` of 0 is not a paid hold. After the last accepted
   request, wait at least the job deadline (55 seconds, or
   `TRENDIQ_ANALYSIS_JOB_DEADLINE_MS` when that is a whole number from 1000
   to 120000). Then run the check in the next section.
   `pendingPaidReserved`, `pendingJobs`, and `inFlight` must all be empty
   before the termination signal.
4. Setting `TRENDIQ_ANALYSIS_ENABLED=false` and restarting is not the drain.
   If a paid hold is still `reserved` past the deadline while this process
   stays up, the next locked read converts it to `unknown` and paid calls
   block. Follow "Persistent unknown-cost blocks". Do not restart to clear
   it.

## Verify pending reservations before restart

Immediately before the termination signal, read the ledger. This command does
not take the store lock and does not write. Do not edit `open-analysis.json`.
A read while new requests are still arriving is not proof.

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

- `pendingPaidReserved` must be empty. Otherwise do not restart.
- `pendingJobs` and `inFlight` must be empty.
- `unknown` may be non-empty. Restart will not clear it. Reconcile those
  holds before paid calls can resume.

## After restart

Look in `$TRENDIQ_DATA_DIR/open-analysis-audit.log` for new lines whose
`action` is `expire_reserved_to_unknown`. Reconcile every hold id in
`holdIds` with `scripts/reconcile-open-analysis.mjs` and the invoice cost.
Do not skip an id. Do not hand-edit the ledger.

```text
grep expire_reserved_to_unknown "$TRENDIQ_DATA_DIR/open-analysis-audit.log"
```

A process-start conversion looks like this. `holdIds` can contain more than
one id:

```text
{"at":"<UTC ISO time>","action":"expire_reserved_to_unknown","holdIds":["<holdId>"],"reason":"process_startup"}
```

A conversion while the process stays up, and a conversion the reconcile
script makes for some other hold past the job deadline, uses
`"reason":"job_deadline_exceeded"`. A later pass does not append another line
when nothing is left to convert.

The server appends `process_startup` on the first locked
`OpenAnalysisFileStore` operation. It constructs that store only when
`TRENDIQ_OPEN_ANALYSIS_ENABLED` is the exact string `true`. The read-only
check above does not convert holds and does not append the line. While the
switch is false, restart alone does not append the line and does not convert
reserved holds. Still read the ledger. Any paid `reserved` hold left by a
mid-job restart has to be reconciled before paid calls can resume.

## Do not reconcile a running job

Never reconcile a hold whose job is still running.

`scripts/reconcile-open-analysis.mjs` calls `reconcileVerifiedHold` in
`src/server/analysis/openAnalysis/storeFile.mjs`. That function allows it.
Operators must not. It converts the named paid `reserved` hold, including one
younger than the job deadline, sets `costState` to `unknown`, and reconciles
it in the same locked write. It does not check that a job is in flight.

Treat the job as still running while this replica is up and the pre-restart
check shows a pending job, an in-flight client, or a paid `reserved` hold
younger than the job deadline. Wait until the process settles that work, or
until the replica has stopped after a completed drain. A live job can still
call `markUnknown` or in-process `reconcile` after the script. In-process
`reconcile` can delete the reservation and apply another micros delta.
`markUnknown` can set the hold back to `unknown`.

## Persistent unknown-cost blocks

An unresolved unknown cost keeps blocking paid calls. The caller sees
`daily_capacity_reached`. The $1 day cap and the $0.15 cycle cap use that
same reason. Read the ledger. Do not raise a cap. Restart, retention, a late
response with no finite cost, and a second provision do not clear the hold.
Do not delete or hand-edit `open-analysis.json`.

1. Stop new open-analysis requests. Confirm the job for each hold you will
   touch is not still running.
2. List every reservation with `costState` `unknown`, and every id on an
   `expire_reserved_to_unknown` audit line.
3. In DataForSEO billing or API usage for that UTC day, match time, endpoint,
   and task id.
4. If a row matches, reconcile with that row's USD cost, not the published
   list price.
5. If no row matches, the POST may never have fired. Reconcile at `0` only
   then. The evidence ref must say so, for example
   `no-invoice-row hold:<holdId> date:YYYY-MM-DD`.
6. Run, once per hold:

```text
TRENDIQ_DATA_DIR=/var/lib/trendiq node scripts/reconcile-open-analysis.mjs <holdId> <providerCostUsd> "<evidenceRef>"
```

7. Read the ledger again. Those holds are `reconciled`. The same evidence ref
   and the same cost do not apply twice. If the script prints
   `open_analysis_reconciliation_unverified`, stop and do not guess a cost.
8. Leave the open-analysis switch false until every blocking hold is
   reconciled and the gate 2 checklist passes.

## Reserved holds do not show whether the POST was sent

The ledger cannot tell a reserved hold whose POST never fired from one whose
POST did. `reserve` runs before `fetch`, and the row does not store a sent
flag. Both crashes leave `costState` `reserved`, `micros` greater than 0, and
no `actualMicros`. `micros` is the list-price estimate either way. Every
restart that interrupts a job may need a manual reconcile of that hold,
possibly at provider cost `0` when the invoice has no charge, and at the invoice USD cost
when it does. Do not guess from how quickly the process died.

## Gate 2 checklist

Do not set `TRENDIQ_OPEN_ANALYSIS_ENABLED=true` until this checklist passes.
The default stays false.

- `TRENDIQ_OPEN_ANALYSIS_LEDGER_WRITE_FAIL` must never be set in production.
  It is not in `.env.example`. `atomicWriteJson` in
  `src/server/analysis/openAnalysis/storeFile.mjs` throws
  `open_analysis_ledger_write_failed` before the rename when the value is
  `1`. That is a test seam. The variable must be absent from the service
  environment, platform secrets, and any shell used to provision or
  reconcile. Do not set it to pause spending.
- The data directory exists, the ledger has been provisioned once, and
  exactly one replica uses `TRENDIQ_DATA_DIR`.
- No unresolved `unknown` hold remains, and no paid `reserved` hold is past
  its deadline.

Read the actual cost from DataForSEO billing or API usage for that UTC day.
Match the task by time, endpoint, and task id. Use that row's USD cost, not
the published list price. Then:

```text
TRENDIQ_DATA_DIR=/var/lib/trendiq node scripts/reconcile-open-analysis.mjs <holdId> <providerCostUsd> "task:<id> date:YYYY-MM-DD"
```

The script does not call DataForSEO. It resolves an `unknown` hold, including
one startup recovery converted from `reserved`. Do not run it while the job
is still running. `reconcileVerifiedHold` in
`src/server/analysis/openAnalysis/storeFile.mjs` will convert that named paid
`reserved` hold under the lock and then reconcile it, including when the hold
is younger than the job deadline. Operators must not use that behavior. See
"Do not reconcile a running job". The script keeps the reservation, marks it
reconciled, and appends one line to `open-analysis-audit.log`. A second run
with the same evidence does not apply the cost again. Do not hand-edit
`open-analysis.json`. See `docs/OPEN_ANALYSIS.md`.

## Recovering a stale open-analysis lock

Stop and verify before touching the lock file. Never delete a lock that a
live process holds.

1. Stop the one TrendIQ replica. Confirm the process list and the platform
   show no Node server, no container, and no provision or reconcile script
   using `TRENDIQ_DATA_DIR`.
2. PID 1 is a special case. Containers often run the server as PID 1. After a
   restart the new process is also PID 1, so `kill -0 1` succeeds and a stale
   lock looks live. Compare the lock `createdAt` with the current process or
   container start time. A matching pid that started later is not the owner.
   Do not remove the lock while that replica is running.
3. Read `pid`, `token`, and `createdAt` from
   `$TRENDIQ_DATA_DIR/open-analysis.json.lock`.
4. Check the inode. This does not create the file:

   ```text
   flock -n 3 3<"$TRENDIQ_DATA_DIR/open-analysis.json.lock"
   lsof "$TRENDIQ_DATA_DIR/open-analysis.json.lock"
   ```

   Continue only when `flock` exits 0 and `lsof` prints no process. If the
   lock is held, stop.
5. Confirm again that no store operation is in progress.
6. Delete only the lock file. Leave `open-analysis.json` unchanged.
7. Append one JSON line to `open-analysis-audit.log`. This is append-only.
   The command uses `>>`. Do not use `>`, and do not truncate the file:

   ```text
   printf '%s\n' '{"at":"<UTC ISO time>","action":"stale_lock_removed","pid":<pid>,"token":"<token>","createdAt":"<createdAt>","inodeCheck":"flock -n acquired; lsof empty"}' >> "$TRENDIQ_DATA_DIR/open-analysis-audit.log"
   ```

If the server reports `open_analysis_flock_missing`, the `flock` binary is
not installed. That error does not rewrite the ledger. The process removes
only a lock file that same attempt created when the pid and token still
match. A `flock` timeout does not remove a lock. Install `flock` from
util-linux, then use the steps above if a lock file is still present. See
`docs/OPEN_ANALYSIS.md`.

Leave `TRENDIQ_OPEN_ANALYSIS_ENABLED` false until the directory exists, the
ledger has been provisioned, the single-replica limit above is in place, and
the gate 2 checklist passes. `TRENDIQ_OPEN_ANALYSIS_LEDGER_WRITE_FAIL` stays
unset.
Spend counters, identity cache, and open-analysis jobs live in that file.
Ray-Ban Meta jobs stay in memory and are still lost on restart. See
`docs/OPEN_ANALYSIS.md`.
