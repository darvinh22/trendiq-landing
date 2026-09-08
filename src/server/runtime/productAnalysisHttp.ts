import type { IncomingMessage, ServerResponse } from "node:http";
import { handleProductAnalysisApiRequest } from "../analysis/productAnalysisApi";
import type { ProductAnalysisRuntime } from "./productAnalysisRuntime";

export const MAX_ANALYSIS_BODY_BYTES = 4096;

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_ANALYSIS_BODY_BYTES) throw new Error("request_body_too_large");
    chunks.push(buffer);
  }
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}

export async function handleProductAnalysisHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ProductAnalysisRuntime
): Promise<boolean> {
  const pathname = new URL(request.url ?? "/", "http://trendiq.local").pathname;

  if (pathname === "/health") {
    if (request.method !== "GET") {
      sendJson(response, 405, { status: "error", reason: "method_not_allowed" });
    } else {
      sendJson(response, 200, runtime.health());
    }
    return true;
  }

  if (pathname === "/ready") {
    if (request.method !== "GET") {
      sendJson(response, 405, { status: "error", reason: "method_not_allowed" });
    } else {
      const readiness = runtime.readiness();
      sendJson(response, readiness.status === "ready" ? 200 : 503, readiness);
    }
    return true;
  }

  if (pathname !== "/api/product-analysis" && !pathname.startsWith("/api/product-analysis/")) {
    return false;
  }

  try {
    const body = request.method === "POST" ? await readJsonBody(request) : undefined;
    const result = handleProductAnalysisApiRequest({
      method: request.method ?? "GET",
      pathname,
      body,
    }, runtime);
    sendJson(response, result.statusCode, result.body);
  } catch {
    sendJson(response, 400, { status: "error", reason: "invalid_request" });
  }
  return true;
}
