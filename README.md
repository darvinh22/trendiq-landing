
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
  process. It is not Vite preview. See `docs/PRIVATE_ALPHA_OPERATIONS.md`
  before allowing invited users to access it.
