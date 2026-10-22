
  # Build TrendIQ Mobile App

  This is a code bundle for Build TrendIQ Mobile App. The original project is available at https://www.figma.com/design/wsQzhnpGr7MD2Vzdz64cXR/Build-TrendIQ-Mobile-App.

  ## Running the code

  Node `22.23.4` (`.nvmrc`, engines `>=22.7.0 <23`) and pnpm `10.33.4`.
  Install with `pnpm install --frozen-lockfile`. CI is `.github/workflows/ci.yml`.

  Run `npm run dev` to start the development server.

  For the single-replica private-alpha runtime, configure the server-only
  variables documented in `.env.example`, then run:

  ```text
  npm run build
  npm start
  ```

  The production command serves the built UI and analysis API from one Node
  process. It listens on `PORT` (default 3000). Set `HOST` (for example
  `127.0.0.1`) to bind one address; when `HOST` is unset, the process listens
  on all interfaces. It is not Vite preview. See `docs/PRIVATE_ALPHA_OPERATIONS.md`
  before allowing invited users to access it.

  Free-text analysis of products outside the Ray-Ban Meta catalog is off unless
  `TRENDIQ_OPEN_ANALYSIS_ENABLED=true`. That path has its own spend caps and a
  file-backed store. See `docs/OPEN_ANALYSIS.md`. Affiliate programs are not
  connected.

  Open-analysis spend state is safe only on a single Node process and a single
  replica. The file lock is not a distributed lock. A fresh or unreadable lock
  is held, including when the owner pid is already dead. A live pid is never
  taken. Stale takeover unlinks only a dead pid's lock after checking the
  token, and only while holding the kernel flock. Do not run a second process
  against the same `TRENDIQ_DATA_DIR`.
  `TRENDIQ_DATA_DIR` does not fall back to `.trendiq` in the working directory.
  An operator provisions the ledger once; restart does not create a new zeroed
  ledger. See `docs/PRIVATE_ALPHA_OPERATIONS.md`.
