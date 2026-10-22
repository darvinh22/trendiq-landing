import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../../../../app/lib/data/search/client";
import { DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH } from "../../../../app/lib/data/reviews/client";
import { createAnalysisSpendTracker, type AnalysisSpendLedger } from "../costAccounting";
import {
  AUDIT_LOG_NAME,
  OpenAnalysisFileStore,
  STORE_FILE_NAME,
  provisionOpenAnalysisStore,
} from "../fileStore";
import { FileSpendLedger, OpenAnalysisService } from "../openAnalysisService";

const tempDirs: string[] = [];
const children: ChildProcess[] = [];
const paidUrl = `https://fixture.invalid${DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH}`;
const now = new Date("2026-10-21T12:00:00.000Z");

afterEach(async () => {
  delete process.env.TRENDIQ_OPEN_ANALYSIS_LEDGER_WRITE_FAIL;
  for (const child of children.splice(0)) child.kill("SIGKILL");
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function readyDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "trendiq-paid-recovery-"));
  tempDirs.push(dir);
  expect(await provisionOpenAnalysisStore(dir, now)).toBe("created");
  return dir;
}

function jsonResponse(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => text };
}

function service(dataDir: string, fetchImpl: FetchLike, clock: () => Date = () => now, jobDeadlineMs = 55_000) {
  return new OpenAnalysisService({
    enabled: true,
    analysisEnabled: true,
    dataDir,
    now: clock,
    fetchImpl,
    apiBaseUrl: "https://fixture.invalid",
    login: "fixture-login",
    password: "fixture-password",
    liveConfigured: true,
    jobDeadlineMs,
  });
}

async function plantReserved(dataDir: string, id: string, createdAt: string, micros = 2_000): Promise<void> {
  const store = new OpenAnalysisFileStore(dataDir, { now: () => now });
  await store.update((document) => {
    const day = createdAt.slice(0, 10);
    document.spendByDay[day] = {
      micros,
      reservations: {
        [id]: {
          micros,
          createdAt,
          dayKey: day,
          cycleId: "cycle_planted",
          costState: "reserved",
        },
      },
      analysisCount: 0,
      paidOperationCount: micros > 0 ? 1 : 0,
    };
    document.cycles.cycle_planted = { dayKey: day, micros };
  });
}

function runRecover(directory: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/open-analysis-store-worker.mjs", "--recover", directory], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `recover exited ${code}`));
        return;
      }
      const match = stdout.match(/recovered (\d+)/);
      if (!match) {
        reject(new Error(stderr || "recover produced no count"));
        return;
      }
      resolve(Number(match[1]));
    });
  });
}

async function auditText(dataDir: string): Promise<string> {
  try {
    return await readFile(join(dataDir, AUDIT_LOG_NAME), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

describe("paid reservation recovery after a crash", () => {
  it("refuses the next paid request after a crash between POST and settlement", async () => {
    const dataDir = await readyDir();
    const store = new OpenAnalysisFileStore(dataDir, { now: () => now });
    const inner = new FileSpendLedger(store);
    const crashedFetch = vi.fn<FetchLike>(async () => jsonResponse({
      status_code: 20000,
      cost: 0.002,
      tasks: [{ id: "task_crash_1", status_code: 20100, cost: 0.002 }],
    }));
    const crashing: AnalysisSpendLedger = {
      reserve: (micros, at, context) => inner.reserve(micros, at, context),
      async reconcile() {
        throw new Error("process_exited_after_post");
      },
      async markUnknown() {
        throw new Error("process_exited_after_post");
      },
      async reconcileVerified() {
        throw new Error("process_exited_after_post");
      },
    };
    const wrapped = createAnalysisSpendTracker({
      maxMicros: 150_000,
      ledger: crashing,
      now: () => now,
      cycleId: "cycle_crash",
    }).wrap(crashedFetch);
    await expect(wrapped(paidUrl, { method: "POST" })).rejects.toThrow("process_exited_after_post");
    expect(crashedFetch).toHaveBeenCalledTimes(1);
    expect(String(crashedFetch.mock.calls[0]?.[0])).toContain("fixture.invalid");
    expect(String(crashedFetch.mock.calls[0]?.[0])).not.toContain("api.dataforseo.com");

    const crashed = JSON.parse(await readFile(join(dataDir, STORE_FILE_NAME), "utf8")) as {
      spendByDay: Record<string, { micros: number; reservations: Record<string, { costState?: string; micros: number }> }>;
    };
    const [holdId, hold] = Object.entries(crashed.spendByDay["2026-10-21"]?.reservations ?? {})[0] ?? [];
    if (!holdId || !hold) throw new Error("expected the paid reservation to remain");
    expect(hold.costState).toBe("reserved");
    expect(hold.micros).toBe(2_000);
    expect(crashed.spendByDay["2026-10-21"]?.micros).toBe(2_000);

    const restartedFetch = vi.fn<FetchLike>(async () => {
      throw new Error("provider_must_not_be_called");
    });
    const restarted = await service(dataDir, restartedFetch).resolveOpenProduct({
      query: "Sony WH-1000XM5",
      clientKey: "client-a",
    });
    expect(restarted).toEqual({ statusCode: 503, body: { status: "unavailable", reason: "daily_capacity_reached" } });
    expect(restartedFetch).not.toHaveBeenCalled();

    const recovered = await new OpenAnalysisFileStore(dataDir, { now: () => now }).read();
    expect(recovered.spendByDay["2026-10-21"]?.reservations[holdId]).toMatchObject({
      ...hold,
      costState: "unknown",
    });
    expect(recovered.spendByDay["2026-10-21"]?.micros).toBe(2_000);
    const ledger = new FileSpendLedger(new OpenAnalysisFileStore(dataDir, { now: () => now }));
    await ledger.reconcile(holdId, 2_000, now);
    const stillUnknown = await new OpenAnalysisFileStore(dataDir, { now: () => now }).read();
    expect(stillUnknown.spendByDay["2026-10-21"]?.reservations[holdId]?.costState).toBe("unknown");
    expect(stillUnknown.spendByDay["2026-10-21"]?.micros).toBe(2_000);
  });

  it("reconciles a converted hold and does not apply the invoice twice", async () => {
    const dataDir = await readyDir();
    await plantReserved(dataDir, "holdcrash01", now.toISOString());
    const recovered = await new OpenAnalysisFileStore(dataDir, { now: () => now }).read();
    expect(recovered.spendByDay["2026-10-21"]?.reservations.holdcrash01?.costState).toBe("unknown");
    expect(recovered.spendByDay["2026-10-21"]?.micros).toBe(2_000);

    const args = ["scripts/reconcile-open-analysis.mjs", "holdcrash01", "0.05", "task:task_crash_1 date:2026-10-21"];
    const run = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TRENDIQ_DATA_DIR: dataDir },
    });
    children.push(run);
    const stdout = await new Promise<string>((resolve, reject) => {
      let out = "";
      let err = "";
      run.stdout?.on("data", (chunk: Buffer) => {
        out += chunk.toString();
      });
      run.stderr?.on("data", (chunk: Buffer) => {
        err += chunk.toString();
      });
      run.on("exit", (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(err || `reconcile exited ${code}`));
      });
    });
    expect(stdout).toMatch(/reconciled unknown hold/);
    const settled = await new OpenAnalysisFileStore(dataDir, { now: () => now }).read();
    expect(settled.spendByDay["2026-10-21"]?.reservations.holdcrash01).toMatchObject({
      costState: "reconciled",
      heldMicros: 2_000,
      actualMicros: 50_000,
      micros: 50_000,
      evidenceRef: "task:task_crash_1 date:2026-10-21",
    });
    expect(settled.spendByDay["2026-10-21"]?.micros).toBe(50_000);
    expect(settled.cycles.cycle_planted?.micros).toBe(50_000);

    const again = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TRENDIQ_DATA_DIR: dataDir },
    });
    children.push(again);
    const second = await new Promise<string>((resolve, reject) => {
      let out = "";
      let err = "";
      again.stdout?.on("data", (chunk: Buffer) => {
        out += chunk.toString();
      });
      again.stderr?.on("data", (chunk: Buffer) => {
        err += chunk.toString();
      });
      again.on("exit", (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(err || `reconcile exited ${code}`));
      });
    });
    expect(second).toMatch(/already reconciled/);
    const reread = await new OpenAnalysisFileStore(dataDir, { now: () => now }).read();
    expect(reread.spendByDay["2026-10-21"]?.micros).toBe(50_000);
    expect(reread.spendByDay["2026-10-21"]?.reservations.holdcrash01?.costState).toBe("reconciled");
    const resumed = await new FileSpendLedger(new OpenAnalysisFileStore(dataDir, { now: () => now })).reserve(2_000, now, {
      cycleId: "cycle_after_invoice",
    });
    expect(resumed.ok).toBe(true);
  });

  it("resolves a paid reserved hold that recovery has not converted yet", async () => {
    const dataDir = await readyDir();
    await plantReserved(dataDir, "holdreserved1", now.toISOString());
    const raw = JSON.parse(await readFile(join(dataDir, STORE_FILE_NAME), "utf8")) as {
      spendByDay: Record<string, { reservations: Record<string, { costState?: string }> }>;
    };
    expect(raw.spendByDay["2026-10-21"]?.reservations.holdreserved1?.costState).toBe("reserved");
    const child = spawn(process.execPath, [
      "scripts/reconcile-open-analysis.mjs",
      "holdreserved1",
      "0.002",
      "task:task_reserved date:2026-10-21",
    ], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TRENDIQ_DATA_DIR: dataDir },
    });
    children.push(child);
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
    expect(code).toBe(0);
    const settled = JSON.parse(await readFile(join(dataDir, STORE_FILE_NAME), "utf8")) as {
      spendByDay: Record<string, { micros: number; reservations: Record<string, { costState?: string; actualMicros?: number }> }>;
    };
    expect(settled.spendByDay["2026-10-21"]?.reservations.holdreserved1?.costState).toBe("reconciled");
    expect(settled.spendByDay["2026-10-21"]?.reservations.holdreserved1?.actualMicros).toBe(2_000);
    expect(settled.spendByDay["2026-10-21"]?.micros).toBe(2_000);
  });

  it("is idempotent when recovery runs twice", async () => {
    const dataDir = await readyDir();
    await plantReserved(dataDir, "holdtwice01", "2026-10-21T11:00:00.000Z");
    const firstStore = new OpenAnalysisFileStore(dataDir, { now: () => now });
    const first = await firstStore.read();
    const firstAudit = await auditText(dataDir);
    expect(first.spendByDay["2026-10-21"]?.reservations.holdtwice01?.costState).toBe("unknown");
    expect(firstAudit).toContain("expire_reserved_to_unknown");
    expect(firstAudit.trim().split("\n")).toHaveLength(1);

    const second = await firstStore.read();
    const third = await new OpenAnalysisFileStore(dataDir, { now: () => now }).read();
    expect(second.spendByDay).toEqual(first.spendByDay);
    expect(third.spendByDay).toEqual(first.spendByDay);
    expect(third.cycles).toEqual(first.cycles);
    expect(await auditText(dataDir)).toBe(firstAudit);
    expect(third.spendByDay["2026-10-21"]?.micros).toBe(2_000);
  });

  it("keeps one conversion when two recoverers race a paid request", async () => {
    const dataDir = await readyDir();
    await plantReserved(dataDir, "holdrace001", now.toISOString());
    const left = new OpenAnalysisFileStore(dataDir, { now: () => now });
    const right = new OpenAnalysisFileStore(dataDir, { now: () => now });
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error("provider_must_not_be_called");
    });
    const [docLeft, docRight, resolved, workerA, workerB] = await Promise.all([
      left.read(),
      right.read(),
      service(dataDir, fetchImpl).resolveOpenProduct({ query: "Sony WH-1000XM5", clientKey: "client-a" }),
      runRecover(dataDir),
      runRecover(dataDir),
    ]);
    expect(resolved).toEqual({ statusCode: 503, body: { status: "unavailable", reason: "daily_capacity_reached" } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(docLeft.spendByDay["2026-10-21"]?.reservations.holdrace001?.costState).toBe("unknown");
    expect(docRight.spendByDay["2026-10-21"]?.reservations.holdrace001?.costState).toBe("unknown");
    expect(docLeft.spendByDay["2026-10-21"]?.micros).toBe(2_000);
    const final = JSON.parse(await readFile(join(dataDir, STORE_FILE_NAME), "utf8")) as {
      spendByDay: Record<string, { micros: number; paidOperationCount: number; reservations: Record<string, { costState?: string; micros: number }> }>;
    };
    expect(Object.keys(final.spendByDay["2026-10-21"]?.reservations ?? {})).toEqual(["holdrace001"]);
    expect(final.spendByDay["2026-10-21"]?.reservations.holdrace001).toMatchObject({
      costState: "unknown",
      micros: 2_000,
    });
    expect(final.spendByDay["2026-10-21"]?.micros).toBe(2_000);
    expect(final.spendByDay["2026-10-21"]?.paidOperationCount).toBe(1);
    const audits = (await auditText(dataDir)).trim().split("\n").filter(Boolean);
    expect(workerA + workerB + audits.length).toBe(1);
    const repeat = await Promise.all([runRecover(dataDir), runRecover(dataDir)]);
    expect(repeat).toEqual([0, 0]);
    const afterRepeat = JSON.parse(await readFile(join(dataDir, STORE_FILE_NAME), "utf8")) as typeof final;
    expect(afterRepeat.spendByDay).toEqual(final.spendByDay);
    expect((await auditText(dataDir)).trim().split("\n").filter(Boolean)).toEqual(audits);
  });

  it("converts a reserved hold that outlives the job deadline and then blocks", async () => {
    const dataDir = await readyDir();
    let clock = new Date("2026-10-21T12:00:00.000Z");
    const store = new OpenAnalysisFileStore(dataDir, { now: () => clock, jobDeadlineMs: 1_000 });
    await store.read();
    await store.update((document) => {
      document.spendByDay["2026-10-21"] = {
        micros: 2_000,
        reservations: {
          holddeadline: {
            micros: 2_000,
            createdAt: clock.toISOString(),
            dayKey: "2026-10-21",
            cycleId: "cycle_deadline",
            costState: "reserved",
          },
        },
        analysisCount: 0,
        paidOperationCount: 1,
      };
      document.cycles.cycle_deadline = { dayKey: "2026-10-21", micros: 2_000 };
    });
    const live = await new FileSpendLedger(store).reserve(2_000, clock, { cycleId: "cycle_other_live" });
    expect(live.ok).toBe(true);
    clock = new Date(clock.getTime() + 1_001);
    const expired = await store.read();
    expect(expired.spendByDay["2026-10-21"]?.reservations.holddeadline?.costState).toBe("unknown");
    expect(expired.spendByDay["2026-10-21"]?.micros).toBe(4_000);
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error("provider_must_not_be_called");
    });
    const blocked = await service(dataDir, fetchImpl, () => clock, 1_000).resolveOpenProduct({
      query: "Sony WH-1000XM5",
      clientKey: "client-a",
    });
    expect(blocked).toEqual({ statusCode: 503, body: { status: "unavailable", reason: "daily_capacity_reached" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("leaves a fresh in-flight reservation reserved until it is reconciled", async () => {
    const dataDir = await readyDir();
    const store = new OpenAnalysisFileStore(dataDir, { now: () => now, jobDeadlineMs: 55_000 });
    await store.read();
    const ledger = new FileSpendLedger(store);
    const reserved = await ledger.reserve(2_000, now, { cycleId: "cycle_live" });
    expect(reserved.ok).toBe(true);
    if (!reserved.id) throw new Error("expected reservation id");
    const mid = await store.read();
    expect(mid.spendByDay["2026-10-21"]?.reservations[reserved.id]?.costState).toBe("reserved");
    expect(await auditText(dataDir)).toBe("");
    await ledger.reconcile(reserved.id, 2_000, now);
    const settled = await store.read();
    expect(settled.spendByDay["2026-10-21"]?.reservations[reserved.id]).toBeUndefined();
    expect(settled.spendByDay["2026-10-21"]?.micros).toBe(2_000);
  });

  it("keeps an unknown hold across restart and does not drop an old converted day", async () => {
    const dataDir = await readyDir();
    const seeded = new OpenAnalysisFileStore(dataDir, { now: () => now });
    await seeded.read();
    const ledgerPath = join(dataDir, STORE_FILE_NAME);
    const raw = JSON.parse(await readFile(ledgerPath, "utf8")) as {
      spendByDay: Record<string, unknown>;
    };
    raw.spendByDay["2020-01-01"] = {
      micros: 2_000,
      reservations: {
        holdoldpaid1: {
          micros: 2_000,
          createdAt: "2020-01-01T00:00:00.000Z",
          dayKey: "2020-01-01",
          cycleId: "cycle_old_paid",
          costState: "reserved",
        },
      },
      analysisCount: 0,
      paidOperationCount: 1,
    };
    await import("node:fs/promises").then(({ writeFile }) => writeFile(ledgerPath, JSON.stringify(raw)));
    const recovered = await new OpenAnalysisFileStore(dataDir, { now: () => now }).read();
    expect(recovered.spendByDay["2020-01-01"]?.reservations.holdoldpaid1?.costState).toBe("unknown");
    const restarted = await new OpenAnalysisFileStore(dataDir, { now: () => now }).read();
    expect(restarted.spendByDay["2020-01-01"]?.reservations.holdoldpaid1?.costState).toBe("unknown");
    expect(restarted.spendByDay["2020-01-01"]?.micros).toBe(2_000);
    const blocked = await new FileSpendLedger(new OpenAnalysisFileStore(dataDir, { now: () => now })).reserve(2_000, now, {
      cycleId: "cycle_blocked",
    });
    expect(blocked).toEqual({ ok: false, micros: 0, reason: "unknown_cost" });
  });

  it("does not convert an unpaid reserved hold into an unknown block", async () => {
    const dataDir = await readyDir();
    await plantReserved(dataDir, "holdzero0001", now.toISOString(), 0);
    const recovered = await new OpenAnalysisFileStore(dataDir, { now: () => now }).read();
    expect(recovered.spendByDay["2026-10-21"]?.reservations.holdzero0001?.costState).toBe("reserved");
    const resumed = await new FileSpendLedger(new OpenAnalysisFileStore(dataDir, { now: () => now })).reserve(2_000, now, {
      cycleId: "cycle_unpaid",
    });
    expect(resumed.ok).toBe(true);
  });
});

describe("paid reservation recovery fails closed", () => {
  it("does not call the provider when the ledger cannot be read", async () => {
    const dataDir = await readyDir();
    const ledgerPath = join(dataDir, STORE_FILE_NAME);
    const corrupt = "{";
    await import("node:fs/promises").then(({ writeFile }) => writeFile(ledgerPath, corrupt));
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error("provider_must_not_be_called");
    });
    const refused = await service(dataDir, fetchImpl).resolveOpenProduct({ query: "Sony WH-1000XM5" });
    expect(refused).toEqual({ statusCode: 503, body: { status: "unavailable", reason: "runtime_not_ready" } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await readFile(ledgerPath, "utf8")).toBe(corrupt);
  });

  it("does not call the provider when recovery cannot classify a paid hold", async () => {
    const dataDir = await readyDir();
    const store = new OpenAnalysisFileStore(dataDir, { now: () => now });
    await store.update((document) => {
      document.spendByDay["2026-10-21"] = {
        micros: 2_000,
        reservations: {
          holdbadclock: {
            micros: 2_000,
            createdAt: "not-a-timestamp",
            dayKey: "2026-10-21",
            cycleId: "cycle_bad",
            costState: "reserved",
          },
        },
        analysisCount: 0,
        paidOperationCount: 1,
      };
    });
    const before = await readFile(join(dataDir, STORE_FILE_NAME), "utf8");
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error("provider_must_not_be_called");
    });
    const refused = await service(dataDir, fetchImpl).resolveOpenProduct({ query: "Sony WH-1000XM5" });
    expect(refused).toEqual({ statusCode: 503, body: { status: "unavailable", reason: "runtime_not_ready" } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await readFile(join(dataDir, STORE_FILE_NAME), "utf8")).toBe(before);
    expect(before).toContain("not-a-timestamp");
    expect(before).toContain("reserved");
  });

  it("does not call the provider when the recovered ledger cannot be written", async () => {
    const dataDir = await readyDir();
    await plantReserved(dataDir, "holdwrite001", now.toISOString());
    const before = await readFile(join(dataDir, STORE_FILE_NAME), "utf8");
    expect(before).toContain("\"reserved\"");
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error("provider_must_not_be_called");
    });
    const open = service(dataDir, fetchImpl);
    process.env.TRENDIQ_OPEN_ANALYSIS_LEDGER_WRITE_FAIL = "1";
    try {
      const refused = await open.resolveOpenProduct({ query: "Sony WH-1000XM5", clientKey: "client-a" });
      expect(refused).toEqual({ statusCode: 503, body: { status: "unavailable", reason: "runtime_not_ready" } });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(await readFile(join(dataDir, STORE_FILE_NAME), "utf8")).toBe(before);
    } finally {
      delete process.env.TRENDIQ_OPEN_ANALYSIS_LEDGER_WRITE_FAIL;
    }
    const stillRefused = await open.resolveOpenProduct({ query: "Sony WH-1000XM5", clientKey: "client-a" });
    expect(stillRefused).toEqual({ statusCode: 503, body: { status: "unavailable", reason: "daily_capacity_reached" } });
    expect(fetchImpl).not.toHaveBeenCalled();
    const recovered = JSON.parse(await readFile(join(dataDir, STORE_FILE_NAME), "utf8")) as {
      spendByDay: Record<string, { micros: number; reservations: Record<string, { costState?: string }> }>;
    };
    expect(recovered.spendByDay["2026-10-21"]?.reservations.holdwrite001?.costState).toBe("unknown");
    expect(recovered.spendByDay["2026-10-21"]?.micros).toBe(2_000);
  });
});
