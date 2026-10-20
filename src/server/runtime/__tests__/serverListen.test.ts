import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createProductAnalysisRuntime } from "../productAnalysisRuntime";
import { createProductionServer } from "../productionServer";
import {
  listenProductionServer,
  readListenHost,
  readListenPort,
  readProductionListenTarget,
  type ProductionListenTarget,
} from "../serverListen";

function listen(server: Server, target: ProductionListenTarget): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    listenProductionServer(server, target);
    server.once("listening", () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("expected a tcp address"));
        return;
      }
      resolve(address);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function getHealth(port: number, hostname: string): Promise<{ body: string; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname,
      port,
      path: "/health",
      method: "GET",
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        body: Buffer.concat(chunks).toString("utf8"),
        statusCode: response.statusCode ?? 0,
      }));
    });
    request.once("error", reject);
    request.end();
  });
}

function productionServer(): Server {
  const runtime = createProductAnalysisRuntime({
    env: { TRENDIQ_ANALYSIS_ENABLED: "false" },
    assetsReady: () => false,
  });
  return createProductionServer({ assetsDirectory: "/tmp/trendiq-listen-unused", runtime });
}

describe("production listen target", () => {
  it("keeps port 3000 and an all-interfaces bind when PORT and HOST are unset", () => {
    expect(readListenPort(undefined)).toBe(3000);
    expect(readListenHost(undefined)).toBeUndefined();
    expect(readProductionListenTarget({})).toEqual({ port: 3000 });
  });

  it("rejects invalid ports and hosts", () => {
    expect(() => readListenPort("")).toThrow("invalid_server_port");
    expect(() => readListenPort("0")).toThrow("invalid_server_port");
    expect(() => readListenPort("65536")).toThrow("invalid_server_port");
    expect(() => readListenPort("3000abc")).toThrow("invalid_server_port");
    expect(() => readListenHost("")).toThrow("invalid_server_host");
    expect(() => readListenHost("   ")).toThrow("invalid_server_host");
    expect(() => readListenHost("*")).toThrow("invalid_server_host");
    expect(() => readListenHost("127.0.0.1:3000")).toThrow("invalid_server_host");
  });

  it("binds to the configured HOST and serves loopback clients", async () => {
    const server = productionServer();
    try {
      const configured = readProductionListenTarget({ HOST: "127.0.0.1", PORT: "3000" });
      expect(configured).toEqual({ port: 3000, host: "127.0.0.1" });

      const address = await listen(server, { port: 0, host: configured.host });
      expect(address.address).toBe("127.0.0.1");
      expect(address.family).toBe("IPv4");

      const health = await getHealth(address.port, "127.0.0.1");
      expect(health.statusCode).toBe(200);
      expect(JSON.parse(health.body)).toEqual({ status: "ok" });
    } finally {
      if (server.listening) await close(server);
    }
  });

  it("binds every interface when HOST is omitted", async () => {
    const server = productionServer();
    try {
      const configured = readProductionListenTarget({ PORT: "4312" });
      expect(configured).toEqual({ port: 4312 });

      const address = await listen(server, { ...configured, port: 0 });
      expect(["0.0.0.0", "::"]).toContain(address.address);
      const health = await getHealth(address.port, "127.0.0.1");
      expect(health.statusCode).toBe(200);
      expect(JSON.parse(health.body)).toEqual({ status: "ok" });
    } finally {
      if (server.listening) await close(server);
    }
  });
});
