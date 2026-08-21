import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const SNAPSHOT_FILE = path.join(process.cwd(), ".trendiq", "live-snapshots.json");

function parseArgs(argv) {
  return argv.reduce((parsed, arg) => {
    if (!arg.startsWith("--")) return parsed;
    const [key, value = "true"] = arg.slice(2).split("=");
    return { ...parsed, [key]: value };
  }, {});
}

function readDotEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return {};

  return fs.readFileSync(envPath, "utf8").split(/\r?\n/).reduce((env, rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return env;

    const index = line.indexOf("=");
    if (index < 1) return env;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    return { ...env, [key]: value };
  }, {});
}

function readSnapshotFile() {
  if (!fs.existsSync(SNAPSHOT_FILE)) return [];

  const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
  return Array.isArray(parsed.snapshots) ? parsed.snapshots : [];
}

function writeSnapshotFile(snapshots) {
  fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
  fs.writeFileSync(
    SNAPSHOT_FILE,
    `${JSON.stringify({
      schemaVersion: 1,
      snapshots,
    }, null, 2)}\n`,
    "utf8"
  );
}

function summarizeProvenance(provenance) {
  return provenance?.sources?.map((source) => ({
    source: source.source,
    label: source.label,
    signalCount: source.signalCount,
    lastUpdated: source.lastUpdated,
  })) ?? [];
}

const args = parseArgs(process.argv.slice(2));
const productId = args.product;
if (!productId) {
  console.error("Missing required --product=ray-ban-meta");
  process.exit(1);
}

const dotenv = readDotEnv();
if (!dotenv.DATAFORSEO_LOGIN || !dotenv.DATAFORSEO_PASSWORD) {
  console.error(JSON.stringify({
    ok: false,
    status: "missing_credentials",
    dataforseoLoginPresent: Boolean(dotenv.DATAFORSEO_LOGIN),
    dataforseoPasswordPresent: Boolean(dotenv.DATAFORSEO_PASSWORD),
  }, null, 2));
  process.exit(1);
}
process.env.TRENDIQ_SEARCH_MODE = "live";

const server = await createServer({
  root: process.cwd(),
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true },
});

let liveApiRequestsMade = 0;

try {
  const dailyRunnerModule = await server.ssrLoadModule("/src/app/lib/data/dailyLiveSnapshotRunner.ts");
  const snapshotStoreModule = await server.ssrLoadModule("/src/app/lib/data/snapshotStore.ts");
  const searchConfigModule = await server.ssrLoadModule("/src/app/lib/data/search/config.ts");
  const searchClientModule = await server.ssrLoadModule("/src/app/lib/data/search/client.ts");
  const searchProviderModule = await server.ssrLoadModule("/src/app/lib/data/search/provider.ts");

  const existingSnapshots = readSnapshotFile();
  const store = snapshotStoreModule.createLocalTrendSnapshotStore(existingSnapshots);
  const now = new Date();
  const config = searchConfigModule.readSearchProviderConfig({}, {
    mode: "live",
    apiLogin: dotenv.DATAFORSEO_LOGIN,
    apiPassword: dotenv.DATAFORSEO_PASSWORD,
    apiBaseUrl: (dotenv.DATAFORSEO_API_BASE_URL || "https://api.dataforseo.com").replace(/\/+$/, ""),
    now: () => now,
  });

  const countedFetch = async (url, init) => {
    liveApiRequestsMade += 1;
    if (liveApiRequestsMade > 2) {
      throw new Error("Daily live snapshot runner blocked more than two DataForSEO requests.");
    }

    return fetch(url, init);
  };
  const client = new searchClientModule.DataForSeoTrendsClient(config, countedFetch);
  const volumeClient = new searchClientModule.DataForSeoGoogleAdsSearchVolumeClient(config, countedFetch);
  const searchProvider = new searchProviderModule.SearchTrendSignalProvider(config, { client, volumeClient });
  const result = await dailyRunnerModule.runDailyLiveSnapshot({
    productId,
    store,
    searchProvider,
    timestamp: now.toISOString(),
  });

  if (result.status === "created") {
    writeSnapshotFile(store.list(productId, { sourceMode: "live" }));
  }

  console.log(JSON.stringify({
    status: result.status,
    message: result.message,
    product: result.summary.productId,
    timestamp: result.summary.timestamp,
    utcDay: result.summary.utcDay,
    scoreVersion: result.summary.scoreVersion,
    finalIQ: result.summary.finalIQ,
    confidence: result.summary.confidence,
    trendStatus: result.summary.trendStatus,
    providerProvenance: summarizeProvenance(result.summary.provenance),
    liveSignalCount: result.summary.liveSignalCount,
    mockSignalCount: result.summary.mockSignalCount,
    historicalMomentum: result.summary.historicalMomentum,
    liveApiRequestsMade,
    persistedTo: SNAPSHOT_FILE,
  }, null, 2));

  if (result.status === "unsupported_product" || result.status === "failed_no_live_data") {
    process.exit(1);
  }
} finally {
  await server.close();
}
