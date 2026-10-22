# Private Alpha Operations

This runbook applies only to the controlled three-user Ray-Ban Meta private
alpha. It does not describe a public or multi-replica deployment.

## Deployment contract

- Run exactly one Node process and exactly one deployment replica. This is a
  hard requirement for open-analysis spend, not only for the Ray-Ban Meta job
  map. The spend ledger is one JSON file guarded by a local lock file. The lock
  is not shared across hosts. Stale-lock takeover removes a lock older than 60
  seconds, a lock whose pid is not alive on this machine, or a lock file that
  cannot be parsed. A second replica can pass that lock and spend again. Do not
  add a second process, a second container, or a second host against the same
  `TRENDIQ_DATA_DIR`. Disable auto-scaling and rolling overlap so two
  application processes are never active at the same time.
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

1. Close private-alpha access or set the analysis switch to disabled.
2. Review sanitized lifecycle logs and paid-operation counts before restarting.
3. Allow the process to receive its termination signal and stop accepting new
   traffic.
4. Restart exactly one replica, verify `/health` and `/ready`, then reopen the
   password gate.

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
  again; duplicate paid provider work is possible.
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
TRENDIQ_DATA_DIR=/var/lib/trendiq node --experimental-transform-types scripts/provision-open-analysis-store.mjs
```

Restart and recovery only open that file. They do not provision it again. If
the configured directory is missing, the ledger file is missing after it was
provisioned, or the JSON is corrupt, open analysis refuses paid calls and does
not write a replacement with counters at zero. A timeout after a paid request
was sent records an unknown cost and blocks new paid calls for that UTC day and
cycle until the provider `cost` is reconciled explicitly. A late response does
not clear that hold by itself.

Leave `TRENDIQ_OPEN_ANALYSIS_ENABLED` false until the directory exists, the
ledger has been provisioned, and the single-replica limit above is in place.
Spend counters, identity cache, and open-analysis jobs live in that file.
Ray-Ban Meta jobs stay in memory and are still lost on restart. See
`docs/OPEN_ANALYSIS.md`.
