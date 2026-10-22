#!/usr/bin/env node
/**
 * Test worker. Increments one counter under the shared file lock.
 * No provider calls.
 */
import { withStoreFile } from "../src/server/analysis/openAnalysis/storeFile.mjs";

const directory = process.argv[2];
const count = Number(process.argv[3]);
if (!directory || !Number.isInteger(count) || count < 1) {
  console.error("usage: node scripts/open-analysis-store-worker.mjs <directory> <count>");
  process.exit(1);
}

const day = "2026-10-21";
for (let index = 0; index < count; index += 1) {
  await withStoreFile(directory, { lockWaitMs: 30_000 }, (document) => {
    document.resolveCountByDay[day] = (document.resolveCountByDay[day] ?? 0) + 1;
  });
}
