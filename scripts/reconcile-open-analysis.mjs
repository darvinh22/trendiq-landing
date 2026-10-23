#!/usr/bin/env node
/**
 * Reconcile one open-analysis hold from an operator-supplied provider cost.
 *
 * Accepts an unknown hold, including one startup recovery converted from
 * reserved. A paid hold still reserved after a crash is converted to unknown
 * under the same lock and then reconciled. Does not contact DataForSEO. Does
 * not edit the ledger by hand. Reads TRENDIQ_DATA_DIR and appends one line to
 * open-analysis-audit.log.
 *
 *   TRENDIQ_DATA_DIR=/var/lib/trendiq node scripts/reconcile-open-analysis.mjs <holdId> <providerCostUsd> <evidenceRef>
 *
 * How to choose the cost and evidence ref: docs/OPEN_ANALYSIS.md
 */
import { reconcileVerifiedHold } from "../src/server/analysis/openAnalysis/storeFile.mjs";

const [holdId, costArg, evidenceRef] = process.argv.slice(2);
if (!holdId || costArg === undefined || evidenceRef === undefined) {
  console.error("usage: node scripts/reconcile-open-analysis.mjs <holdId> <providerCostUsd> <evidenceRef>");
  console.error("Reads TRENDIQ_DATA_DIR. Does not contact a provider. See docs/OPEN_ANALYSIS.md.");
  process.exit(1);
}

const directory = process.env.TRENDIQ_DATA_DIR?.trim() ?? "";
if (!directory) {
  console.error("TRENDIQ_DATA_DIR is required.");
  process.exit(1);
}

if (!/^\d+(?:\.\d+)?$/.test(costArg)) {
  console.error("open_analysis_reconciliation_unverified");
  process.exit(1);
}

function configuredJobDeadlineMs() {
  const raw = process.env.TRENDIQ_ANALYSIS_JOB_DEADLINE_MS;
  if (raw === undefined || raw.trim() === "") return undefined;
  if (!/^\d+$/.test(raw.trim())) return undefined;
  const parsed = Number(raw.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 120_000) return undefined;
  return parsed;
}

try {
  const result = await reconcileVerifiedHold(directory, {
    holdId,
    providerCostUsd: Number(costArg),
    evidenceRef,
    jobDeadlineMs: configuredJobDeadlineMs(),
  });
  console.log(result.idempotent ? "already reconciled; counters unchanged" : "reconciled unknown hold");
} catch (error) {
  console.error(error instanceof Error ? error.message : "open_analysis_reconciliation_unverified");
  process.exit(1);
}
