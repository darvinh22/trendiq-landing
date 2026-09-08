# Private Alpha Operations

This runbook applies only to the controlled three-user Ray-Ban Meta private
alpha. It does not describe a public or multi-replica deployment.

## Deployment contract

- Run exactly one Node process and exactly one deployment replica.
- Build with `npm run build` and start with `npm start`. Vite preview is not the
  production server.
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

## Kill switch and cost ceiling

To stop new provider work, set `TRENDIQ_ANALYSIS_ENABLED=false` and perform a
graceful restart. The catalog remains available, but analysis starts return a
safe disabled state and readiness fails closed.

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
