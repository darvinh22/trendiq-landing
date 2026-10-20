import type { Server } from "node:http";
import { isIP } from "node:net";

const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

export interface ProductionListenTarget {
  host?: string;
  port: number;
}

export function readListenPort(value: string | undefined): number {
  if (value === undefined) return 3000;
  if (!/^\d+$/.test(value)) throw new Error("invalid_server_port");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("invalid_server_port");
  return port;
}

// Absent HOST keeps the historical all-interfaces bind. A present but blank
// value is invalid so a mis-set variable does not silently expose every NIC.
export function readListenHost(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const host = value.trim();
  if (host === "") throw new Error("invalid_server_host");
  if (isIP(host) !== 0) return host;
  if (HOSTNAME.test(host)) return host;
  throw new Error("invalid_server_host");
}

export function readProductionListenTarget(env: {
  HOST?: string;
  PORT?: string;
}): ProductionListenTarget {
  const port = readListenPort(env.PORT);
  const host = readListenHost(env.HOST);
  return host === undefined ? { port } : { port, host };
}

export function listenProductionServer(server: Server, target: ProductionListenTarget): Server {
  if (target.host === undefined) server.listen(target.port);
  else server.listen(target.port, target.host);
  return server;
}
