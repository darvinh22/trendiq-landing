
  # Build TrendIQ Mobile App

  This is a code bundle for Build TrendIQ Mobile App. The original project is available at https://www.figma.com/design/wsQzhnpGr7MD2Vzdz64cXR/Build-TrendIQ-Mobile-App.

  ## Running the code

  Run `npm i` to install the dependencies.

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
  replica. The file lock, including stale-lock takeover, is not a distributed
  lock. Do not run a second process against the same `TRENDIQ_DATA_DIR`.
  `TRENDIQ_DATA_DIR` does not fall back to `.trendiq` in the working directory.
  An operator provisions the ledger once; restart does not create a new zeroed
  ledger. See `docs/PRIVATE_ALPHA_OPERATIONS.md`.
