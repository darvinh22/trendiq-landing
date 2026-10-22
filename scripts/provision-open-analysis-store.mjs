#!/usr/bin/env node
/**
 * Explicit first-time provisioning of the open-analysis spend ledger.
 *
 * This is the only supported way to create a zeroed ledger. Restart does not
 * call it. A missing TRENDIQ_DATA_DIR does not fall back to cwd/.trendiq.
 * A missing directory is not created. A missing or corrupt ledger that was
 * already initialized is not replaced. No provider is contacted.
 *
 *   node scripts/provision-open-analysis-store.mjs
 */
import { provisionStore } from "../src/server/analysis/openAnalysis/storeFile.mjs";

const directory = process.env.TRENDIQ_DATA_DIR?.trim() ?? "";
if (!directory) {
  console.error("TRENDIQ_DATA_DIR is required. Refusing to create .trendiq in the working directory.");
  process.exit(1);
}

try {
  const result = await provisionStore(directory);
  if (result === "created") {
    console.log("provisioned empty spend ledger");
  } else {
    console.log("spend ledger already present; counters unchanged");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "provision_failed");
  process.exit(1);
}
