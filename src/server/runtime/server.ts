import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createProductAnalysisRuntime } from "./productAnalysisRuntime";
import { createProductionServer, productionAssetsReady } from "./productionServer";

function readPort(value: string | undefined): number {
  if (value === undefined) return 3000;
  if (!/^\d+$/.test(value)) throw new Error("invalid_server_port");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("invalid_server_port");
  return port;
}

const assetsDirectory = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const runtime = createProductAnalysisRuntime({
  assetsReady: () => productionAssetsReady(assetsDirectory),
});
const server = createProductionServer({ assetsDirectory, runtime });
const port = readPort(process.env.PORT);

server.listen(port);

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
