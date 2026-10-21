#!/usr/bin/env node
/**
 * DISABLED capped live validation for open product analysis.
 *
 * This file must not call DataForSEO or any other paid API.
 * A future owner-authorized run is capped at $5 total. This build does not
 * implement that run: the script always exits before a network call.
 *
 * Required later (do not set these in CI or production):
 *   TRENDIQ_OPEN_ANALYSIS_LIVE_VALIDATION=authorized
 *   TRENDIQ_OPEN_ANALYSIS_LIVE_VALIDATION_BUDGET_USD=5
 *   plus a separate written owner authorization outside this repository.
 *
 * Expected future set, still not executed here: 15 unseen products
 * (5 clear, 5 ambiguous or variant-heavy, 3 niche or low-data,
 * 2 prohibited or accessory). Pass condition draft: at least 80% sensible
 * identity or honest abstention, and zero false "verified" claims.
 * Record each response `cost`, outcome, and reasons. Never log secrets.
 */

const MAX_BUDGET_USD = 5;
const AUTHORIZED = "authorized";

function exitDisabled(message) {
  process.stdout.write(`${message}\n`);
  process.exit(0);
}

const flag = process.env.TRENDIQ_OPEN_ANALYSIS_LIVE_VALIDATION;
const budgetRaw = process.env.TRENDIQ_OPEN_ANALYSIS_LIVE_VALIDATION_BUDGET_USD;

if (flag !== AUTHORIZED) {
  exitDisabled(
    "Open-analysis live validation is disabled. No provider call was made. " +
      `A later run needs owner authorization and a budget of at most $${MAX_BUDGET_USD}.`
  );
}

const budget = Number(budgetRaw);
if (!Number.isFinite(budget) || budget <= 0 || budget > MAX_BUDGET_USD) {
  exitDisabled(
    `Refusing live validation: budget must be a positive number <= ${MAX_BUDGET_USD}. No provider call was made.`
  );
}

process.stderr.write(
  "Owner flags were present, but this build does not place live provider calls. " +
    "No request was sent. Authorization for a future $5 run is still required separately.\n"
);
process.exit(2);
