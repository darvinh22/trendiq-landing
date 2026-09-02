import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import { handleProductAnalysisApiRequest } from "./productAnalysisApi";
import { ProductAnalysisOrchestrator } from "./productAnalysisOrchestrator";

const MAX_BODY_BYTES = 4096;

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("request_body_too_large");
    chunks.push(buffer);
  }
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}

function middleware(orchestrator: ProductAnalysisOrchestrator): Connect.NextHandleFunction {
  return async (request, response, next) => {
    const pathname = new URL(request.url ?? "/", "http://trendiq.local").pathname;
    if (pathname !== "/api/product-analysis" && !pathname.startsWith("/api/product-analysis/")) {
      next();
      return;
    }

    try {
      const body = request.method === "POST" ? await readJsonBody(request) : undefined;
      const result = handleProductAnalysisApiRequest({
        method: request.method ?? "GET",
        pathname,
        body,
      }, orchestrator);
      sendJson(response, result.statusCode, result.body);
    } catch {
      sendJson(response, 400, { status: "error", reason: "invalid_request" });
    }
  };
}

export function productAnalysisApiPlugin(): Plugin {
  const orchestrator = new ProductAnalysisOrchestrator();
  const handler = middleware(orchestrator);

  return {
    name: "trendiq-controlled-product-analysis-api",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
