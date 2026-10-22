#!/usr/bin/env node
/**
 * Test worker for the open-analysis file lock. No provider calls.
 *
 *   node scripts/open-analysis-store-worker.mjs <directory> <count>
 *   node scripts/open-analysis-store-worker.mjs --hold <directory> <ms>
 *   node scripts/open-analysis-store-worker.mjs --occupy <lockPath> <ms>
 *   node scripts/open-analysis-store-worker.mjs --disturb <lockPath> <ms>
 */
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { commitStaleSteal, releaseStoreLock, withStoreFile } from "../src/server/analysis/openAnalysis/storeFile.mjs";

const day = "2026-10-21";
const mode = process.argv[2];

if (mode === "--hold") {
  const directory = process.argv[3];
  const ms = Number(process.argv[4]);
  if (!directory || !Number.isInteger(ms) || ms < 0) process.exit(1);
  await withStoreFile(directory, { lockWaitMs: 5_000 }, async (document) => {
    process.stdout.write("held\n");
    await delay(ms);
    document.resolveCountByDay[day] = (document.resolveCountByDay[day] ?? 0) + 1;
  });
} else if (mode === "--occupy") {
  const lockPath = process.argv[3];
  const ms = Number(process.argv[4]);
  if (!lockPath || !Number.isInteger(ms) || ms < 0) process.exit(1);
  const fd = openSync(lockPath, "r");
  const child = spawn("flock", ["-x", "3", "sh", "-c", "printf ready\\n; exec cat >/dev/null"], {
    stdio: ["pipe", "pipe", "ignore", fd],
  });
  await new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
      if (out.includes("ready")) resolve();
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`occupy_exit_${code}`)));
  });
  process.stdout.write("occupied\n");
  await delay(ms);
  child.stdin.end();
  await new Promise((resolve) => child.once("exit", resolve));
} else if (mode === "--disturb") {
  const lockPath = process.argv[3];
  const ms = Number(process.argv[4]);
  if (!lockPath || !Number.isInteger(ms) || ms < 0) process.exit(1);
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await commitStaleSteal(lockPath, {
      pid: 1,
      createdAt: "2020-01-01T00:00:00.000Z",
      token: "not-the-owner",
    });
    await releaseStoreLock({ path: lockPath, token: "not-the-owner", pid: 1 });
    try {
      const current = JSON.parse(await readFile(lockPath, "utf8"));
      await releaseStoreLock({ path: lockPath, token: current.token, pid: current.pid });
      await commitStaleSteal(lockPath, {
        pid: current.pid,
        createdAt: current.createdAt,
        token: current.token,
      });
    } catch {
      // The lock is absent between holders. That is not a failure.
    }
  }
} else {
  const directory = process.argv[2];
  const count = Number(process.argv[3]);
  if (!directory || !Number.isInteger(count) || count < 1) {
    console.error("usage: node scripts/open-analysis-store-worker.mjs <directory> <count>");
    process.exit(1);
  }
  for (let index = 0; index < count; index += 1) {
    await withStoreFile(directory, { lockWaitMs: 30_000 }, (document) => {
      document.resolveCountByDay[day] = (document.resolveCountByDay[day] ?? 0) + 1;
    });
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
