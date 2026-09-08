import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AnalysisEvidenceCollector } from "../../analysis/productionEvidenceCollector";
import { createProductAnalysisRuntime } from "../productAnalysisRuntime";
import {
  createProductionServer,
  productionAssetsReady,
} from "../productionServer";
import { APPROVED_DATAFORSEO_ORIGIN } from "../runtimeConfig";

interface HttpResult {
  body: string;
  headers: import("node:http").IncomingHttpHeaders;
  statusCode: number;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function requestServer(
  server: Server,
  pathname: string,
  options: { method?: string; jsonBody?: unknown } = {}
): Promise<HttpResult> {
  const address = server.address() as AddressInfo;
  const body = options.jsonBody === undefined ? undefined : JSON.stringify(options.jsonBody);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: address.port,
      path: pathname,
      method: options.method ?? "GET",
      headers: body === undefined ? undefined : {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        body: Buffer.concat(chunks).toString("utf8"),
        headers: response.headers,
        statusCode: response.statusCode ?? 0,
      }));
    });
    request.once("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

describe("single-process production runtime", () => {
  it("serves built assets and the analysis API from the same origin without provider work", async () => {
    const assetsDirectory = await mkdtemp(join(tmpdir(), "trendiq-runtime-"));
    await writeFile(join(assetsDirectory, "index.html"), "<!doctype html><title>TrendIQ app</title>");
    await writeFile(join(assetsDirectory, "about.html"), "<!doctype html><title>About TrendIQ</title>");
    const collect = vi.fn(async () => ({
      productId: "ray-ban-meta",
      searchStatus: "unavailable" as const,
      reviewStatus: "unavailable" as const,
      signals: [],
      usage: { httpRequestCount: 0, paidOperationCount: 0, taskPostCount: 0 },
    }));
    const providerFetch = vi.fn();
    const runtime = createProductAnalysisRuntime({
      env: {
        TRENDIQ_ANALYSIS_ENABLED: "true",
        TRENDIQ_PROCESS_MAX_PAID_OPERATIONS: "3",
        TRENDIQ_ANALYSIS_JOB_DEADLINE_MS: "55000",
        TRENDIQ_SEARCH_MODE: "live",
        TRENDIQ_SEARCH_PROVIDER: "dataforseo",
        TRENDIQ_REVIEWS_MODE: "mock",
        TRENDIQ_REVIEWS_PROVIDER: "dataforseo",
        DATAFORSEO_LOGIN: "fixture-login",
        DATAFORSEO_PASSWORD: "fixture-password",
        DATAFORSEO_API_BASE_URL: APPROVED_DATAFORSEO_ORIGIN,
      },
      assetsReady: () => productionAssetsReady(assetsDirectory),
      evidenceCollector: { collect } as AnalysisEvidenceCollector,
      fetchImpl: providerFetch,
      idFactory: () => "analysis_runtimefixture01",
      logger: { log: vi.fn() },
    });
    const server = createProductionServer({ assetsDirectory, runtime });

    try {
      await listen(server);

      const health = await requestServer(server, "/health");
      expect(health.statusCode).toBe(200);
      expect(JSON.parse(health.body)).toEqual({ status: "ok" });

      const ready = await requestServer(server, "/ready");
      expect(ready.statusCode).toBe(200);
      expect(JSON.parse(ready.body)).toEqual({ status: "ready" });

      const app = await requestServer(server, "/");
      expect(app.statusCode).toBe(200);
      expect(app.body).toContain("TrendIQ app");
      expect(app.headers["content-type"]).toContain("text/html");

      const about = await requestServer(server, "/about.html");
      expect(about.statusCode).toBe(200);
      expect(about.body).toContain("About TrendIQ");

      const clientRoute = await requestServer(server, "/controlled-product");
      expect(clientRoute.statusCode).toBe(200);
      expect(clientRoute.body).toContain("TrendIQ app");

      const catalog = await requestServer(server, "/api/product-analysis/catalog");
      expect(catalog.statusCode).toBe(200);
      expect(JSON.parse(catalog.body).products).toEqual([{
        productId: "ray-ban-meta",
        displayName: "Ray-Ban Meta Glasses",
        brand: "Ray-Ban",
        category: "Tech",
      }]);

      const started = await requestServer(server, "/api/product-analysis", {
        method: "POST",
        jsonBody: { productId: "ray-ban-meta" },
      });
      expect(started.statusCode).toBe(202);
      expect(JSON.parse(started.body)).toEqual({
        status: "pending",
        analysisId: "analysis_runtimefixture01",
      });

      await Promise.resolve();
      const settled = await requestServer(server, "/api/product-analysis/analysis_runtimefixture01");
      expect(settled.statusCode).toBe(503);
      expect(JSON.parse(settled.body)).toEqual({
        status: "unavailable",
        reason: "evidence_unavailable",
      });

      const reservedApiRoot = await requestServer(server, "/api");
      expect(reservedApiRoot.statusCode).toBe(404);
      expect(reservedApiRoot.body).not.toContain("TrendIQ app");

      const traversal = await requestServer(server, "/..%2Foutside.txt");
      expect(traversal.statusCode).toBe(404);

      expect(providerFetch).not.toHaveBeenCalled();
      expect(collect).toHaveBeenCalledTimes(1);
    } finally {
      if (server.listening) await close(server);
      await rm(assetsDirectory, { recursive: true, force: true });
    }
  });
});
