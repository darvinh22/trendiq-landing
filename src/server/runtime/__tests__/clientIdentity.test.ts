import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisEvidenceCollector } from "../../analysis/productionEvidenceCollector";
import { OPEN_PRODUCT_BATTERY } from "../../analysis/fixtures/openProductBattery/v1/battery";
import { provisionOpenAnalysisStore } from "../../analysis/openAnalysis/fileStore";
import { OpenAnalysisService } from "../../analysis/openAnalysis/openAnalysisService";
import { readShoppingCandidates } from "../../analysis/openAnalysis/productResolver";
import { clientIdentity } from "../productAnalysisHttp";

const dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function request(input: {
  peer: string;
  email?: string;
  forwarded?: string;
}) {
  return {
    headers: {
      ...(input.email ? { "cf-access-authenticated-user-email": input.email } : {}),
      ...(input.forwarded ? { "x-forwarded-for": input.forwarded } : {}),
    },
    socket: { remoteAddress: input.peer },
  };
}

describe("open analysis client identity", () => {
  it("ignores spoofed access and forwarded headers from a public peer", () => {
    const peer = "203.0.113.20";
    const first = clientIdentity(request({
      peer,
      email: "ada@example.com",
      forwarded: "198.51.100.4",
    }));
    const rotated = clientIdentity(request({
      peer,
      email: "other@example.com",
      forwarded: "198.51.100.9, 203.0.113.20",
    }));
    expect(first).toBe(`peer:${peer}`);
    expect(rotated).toBe(first);
  });

  it("trusts the access email only from the loopback proxy and ignores forwarded rotation", () => {
    const email = clientIdentity(request({
      peer: "127.0.0.1",
      email: "Ada@Example.com",
      forwarded: "198.51.100.4",
    }));
    const rotatedForwarded = clientIdentity(request({
      peer: "127.0.0.1",
      email: "ada@example.com",
      forwarded: "203.0.113.9",
    }));
    const otherUser = clientIdentity(request({
      peer: "::1",
      email: "bea@example.com",
    }));
    expect(email).toBe("access:ada@example.com");
    expect(rotatedForwarded).toBe(email);
    expect(otherUser).not.toBe(email);
    expect(clientIdentity(request({ peer: "127.0.0.1" }))).toBe("peer:127.0.0.1");
  });

  it("keeps a rotated forwarded header in the same analysis bucket", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "trendiq-client-"));
    dirs.push(dataDir);
    await provisionOpenAnalysisStore(dataDir);
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const collect = vi.fn(async (profile: { productId: string }) => {
      await gate;
      return {
        productId: profile.productId,
        searchStatus: "unavailable" as const,
        reviewStatus: "unavailable" as const,
        signals: [],
        usage: { httpRequestCount: 0, paidOperationCount: 0, taskPostCount: 0 },
      };
    });
    const product = OPEN_PRODUCT_BATTERY.products.find((entry) => entry.id === "sony-wh-1000xm5");
    if (!product) throw new Error("missing fixture");
    const service = new OpenAnalysisService({
      enabled: true,
      analysisEnabled: true,
      dataDir,
      now: () => new Date("2026-10-21T00:00:00.000Z"),
      idFactory: () => "analysis_clientidentity01",
      evidenceCollector: { collect } as unknown as AnalysisEvidenceCollector,
      searchCandidates: async () => readShoppingCandidates(product.providerResponse),
    });
    const resolved = await service.resolveOpenProduct({ query: product.query });
    if (resolved.body.status !== "resolved") throw new Error("expected resolved");
    const firstKey = clientIdentity(request({ peer: "203.0.113.20", forwarded: "198.51.100.4", email: "ada@example.com" }));
    const rotatedKey = clientIdentity(request({ peer: "203.0.113.20", forwarded: "198.51.100.8", email: "bea@example.com" }));
    const started = await service.analyzeResolution({
      resolutionId: resolved.body.resolutionId,
      clientKey: firstKey,
    });
    expect(started.status).toBe("pending");
    const blocked = await service.analyzeResolution({
      resolutionId: resolved.body.resolutionId,
      clientKey: rotatedKey,
    });
    expect(blocked).toEqual({ status: "unavailable", reason: "rate_limited" });
    expect(collect).toHaveBeenCalledTimes(1);
    release();
    if (started.status !== "pending") throw new Error("expected pending");
    // release() lets the blocked collector finish. The job then writes the
    // ledger (lock temp, ledger temp, and a flock helper). That write is part
    // of the job; waiting here finishes it before the temp directory is removed.
    const settled = await service.waitForSettled(started.analysisId);
    expect(settled.status).not.toBe("pending");
    expect((await readdir(dataDir)).filter((name) => name.endsWith(".tmp") || name.endsWith(".lock"))).toEqual([]);
  });
});
