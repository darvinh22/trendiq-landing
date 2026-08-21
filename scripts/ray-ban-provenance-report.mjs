import { createServer } from "vite";

const server = await createServer({
  root: process.cwd(),
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true },
});

try {
  const dataModule = await server.ssrLoadModule("/src/app/lib/data/index.ts");
  const report = dataModule.formatRayBanMetaProvenanceReport(
    dataModule.VALIDATED_RAY_BAN_META_LIVE_SNAPSHOT
  );

  console.log(report);
} finally {
  await server.close();
}
