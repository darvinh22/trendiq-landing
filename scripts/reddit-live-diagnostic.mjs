import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

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

const dotenv = readDotEnv();

process.env.TRENDIQ_REDDIT_MODE = "live";

const server = await createServer({
  root: process.cwd(),
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true },
});

const requestCounts = {
  oauth: 0,
  search: 0,
};

try {
  const diagnosticModule = await server.ssrLoadModule("/src/app/lib/data/reddit/diagnostic.ts");
  const clientModule = await server.ssrLoadModule("/src/app/lib/data/reddit/client.ts");
  const configModule = await server.ssrLoadModule("/src/app/lib/data/reddit/config.ts");
  const credentialStatus = diagnosticModule.validateRedditDiagnosticCredentials(dotenv);

  if (!credentialStatus.ok) {
    console.log(JSON.stringify({
      ok: false,
      status: "missing_credentials",
      redditClientIdPresent: credentialStatus.redditClientIdPresent,
      redditClientSecretPresent: credentialStatus.redditClientSecretPresent,
      redditUserAgentPresent: credentialStatus.redditUserAgentPresent,
    }, null, 2));
    process.exit(1);
  }

  const now = new Date();
  const countedFetch = async (url, init) => {
    if (String(url).includes("/api/v1/access_token")) {
      requestCounts.oauth += 1;
      if (requestCounts.oauth > 1) {
        throw new Error("Reddit diagnostic blocked a second OAuth request.");
      }
    } else if (String(url).includes("oauth.reddit.com/search.json")) {
      requestCounts.search += 1;
      if (requestCounts.search > 1) {
        throw new Error("Reddit diagnostic blocked a second search request.");
      }
    }

    return fetch(url, init);
  };
  const config = configModule.readRedditProviderConfig(dotenv, {
    mode: "live",
    maxPostsPerAlias: diagnosticModule.REDDIT_DIAGNOSTIC_MAX_RESULTS,
    now: () => now,
    productQueries: {
      "ray-ban-meta": {
        productId: "ray-ban-meta",
        aliases: [diagnosticModule.REDDIT_DIAGNOSTIC_ALIAS],
      },
    },
  });
  const client = new clientModule.RedditOAuthClient(config, countedFetch);
  const result = await diagnosticModule.runRedditLiveDiagnostic({
    env: dotenv,
    config,
    client,
    now,
    requestCounts,
  });

  console.log(JSON.stringify({
    ...result,
    requestCounts,
  }, null, 2));

  if (!result.ok) process.exit(1);
} finally {
  await server.close();
}
