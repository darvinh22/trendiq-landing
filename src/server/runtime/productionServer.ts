import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, resolve, sep } from "node:path";
import { handleProductAnalysisHttpRequest, sendJson } from "./productAnalysisHttp";
import type { ProductAnalysisRuntime } from "./productAnalysisRuntime";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export interface ProductionServerOptions {
  assetsDirectory: string;
  runtime: ProductAnalysisRuntime;
}

export function productionAssetsReady(assetsDirectory: string): boolean {
  return ["index.html", "about.html"].every((file) => {
    const path = resolve(assetsDirectory, file);
    return existsSync(path) && statSync(path).isFile();
  });
}

function safeAssetPath(assetsDirectory: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const root = resolve(assetsDirectory);
  const candidate = resolve(root, relative);
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null;
}

function serveStatic(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, assetsDirectory: string): void {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { status: "error", reason: "method_not_allowed" });
    return;
  }

  const pathname = new URL(request.url ?? "/", "http://trendiq.local").pathname;
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    sendJson(response, 404, { status: "error", reason: "not_found" });
    return;
  }

  let assetPath = safeAssetPath(assetsDirectory, pathname);
  if (assetPath && (!existsSync(assetPath) || !statSync(assetPath).isFile()) && !extname(pathname)) {
    assetPath = resolve(assetsDirectory, "index.html");
  }
  if (!assetPath || !existsSync(assetPath) || !statSync(assetPath).isFile()) {
    sendJson(response, 404, { status: "error", reason: "not_found" });
    return;
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", CONTENT_TYPES[extname(assetPath).toLowerCase()] ?? "application/octet-stream");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", extname(assetPath) === ".html" ? "no-cache" : "public, max-age=3600");
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(assetPath).pipe(response);
}

export function createProductionServer(options: ProductionServerOptions): Server {
  return createServer(async (request, response) => {
    try {
      if (await handleProductAnalysisHttpRequest(request, response, options.runtime)) return;
      serveStatic(request, response, options.assetsDirectory);
    } catch {
      if (!response.headersSent) sendJson(response, 500, { status: "error", reason: "internal_error" });
      else response.destroy();
    }
  });
}
