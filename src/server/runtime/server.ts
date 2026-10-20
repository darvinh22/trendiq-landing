import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createProductAnalysisRuntime } from "./productAnalysisRuntime";
import { createProductionServer, productionAssetsReady } from "./productionServer";
import { listenProductionServer, readProductionListenTarget } from "./serverListen";

const assetsDirectory = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const runtime = createProductAnalysisRuntime({
  assetsReady: () => productionAssetsReady(assetsDirectory),
});
const server = createProductionServer({ assetsDirectory, runtime });

listenProductionServer(server, readProductionListenTarget(process.env));

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close((error) => {
    process.exitCode = error ? 1 : 0;
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
