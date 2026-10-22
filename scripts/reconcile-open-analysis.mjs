#!/usr/bin/env node
/**
 * Reconcile one unknown open-analysis hold from an operator-supplied provider cost.
 *
 * Does not contact DataForSEO. Does not edit the ledger by hand. Reads
 * TRENDIQ_DATA_DIR and appends one line to open-analysis-audit.log.
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

try {
  const result = await reconcileVerifiedHold(directory, {
    holdId,
    providerCostUsd: Number(costArg),
    evidenceRef,
  });
  console.log(result.idempotent ? "already reconciled; counters unchanged" : "reconciled unknown hold");
} catch (error) {
  console.error(error instanceof Error ? error.message : "open_analysis_reconciliation_unverified");
  process.exit(1);
}
