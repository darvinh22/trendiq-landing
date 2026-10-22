import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LOCK_STALE_MS, OpenAnalysisFileStore, STORE_FILE_NAME, provisionOpenAnalysisStore } from "../fileStore";

const tempDirs: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function readyDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "trendiq-lock-race-"));
  tempDirs.push(dir);
  await provisionOpenAnalysisStore(dir);
  return dir;
}

function runWorker(directory: string, count: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/open-analysis-store-worker.mjs", directory, String(count)], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `worker exited ${code}`));
    });
  });
}

describe("open analysis lock across processes", () => {
  it("keeps an exact counter when four processes increment together", async () => {
    const dataDir = await readyDir();
    const processes = 4;
    const each = 20;
    await Promise.all(Array.from({ length: processes }, () => runWorker(dataDir, each)));
    const document = await new OpenAnalysisFileStore(dataDir).read();
    expect(document.resolveCountByDay["2026-10-21"]).toBe(processes * each);
  });

  it("holds a fresh lock through a dead owner, a restart, and overlapping deploy, then takes a stale one", async () => {
    const dataDir = await readyDir();
    const lockPath = join(dataDir, `${STORE_FILE_NAME}.lock`);
    const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
    children.push(sleeper);
    const liveFresh = JSON.stringify({
      pid: sleeper.pid,
      createdAt: new Date().toISOString(),
      token: "deploy-overlap",
    });
    await writeFile(lockPath, liveFresh);
    const overlapping = new OpenAnalysisFileStore(dataDir, { lockWaitMs: 80 });
    await expect(overlapping.update((document) => {
      document.resolveCountByDay["2026-10-21"] = 1;
    })).rejects.toThrow("open_analysis_store_lock_timeout");
    expect(await readFile(lockPath, "utf8")).toBe(liveFresh);

    sleeper.kill("SIGKILL");
    await new Promise((resolve) => sleeper.once("exit", resolve));
    const afterRestart = new OpenAnalysisFileStore(dataDir, { lockWaitMs: 80 });
    await expect(afterRestart.update((document) => {
      document.resolveCountByDay["2026-10-21"] = 1;
    })).rejects.toThrow("open_analysis_store_lock_timeout");
    expect(await readFile(lockPath, "utf8")).toBe(liveFresh);
    const ledger = JSON.parse(await readFile(join(dataDir, STORE_FILE_NAME), "utf8")) as {
      resolveCountByDay?: Record<string, number>;
    };
    expect(ledger.resolveCountByDay?.["2026-10-21"]).toBeUndefined();

    const exited = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    const deadFresh = JSON.stringify({
      pid: exited.pid,
      createdAt: new Date().toISOString(),
      token: "restart-fresh",
    });
    await writeFile(lockPath, deadFresh);
    await expect(new OpenAnalysisFileStore(dataDir, { lockWaitMs: 80 }).update((document) => {
      document.resolveCountByDay["2026-10-21"] = 2;
    })).rejects.toThrow("open_analysis_store_lock_timeout");
    expect(await readFile(lockPath, "utf8")).toBe(deadFresh);

    await writeFile(lockPath, JSON.stringify({
      pid: exited.pid,
      createdAt: new Date(Date.now() - LOCK_STALE_MS - 1_000).toISOString(),
      token: "restart-stale",
    }));
    await new OpenAnalysisFileStore(dataDir).update((document) => {
      document.resolveCountByDay["2026-10-21"] = 3;
    });
    expect((await new OpenAnalysisFileStore(dataDir).read()).resolveCountByDay["2026-10-21"]).toBe(3);
  });
});
