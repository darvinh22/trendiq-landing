#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DETAILED_REVIEWS_TASK_GET_ADVANCED_PATH_PREFIX =
  "/v3/merchant/google/reviews/task_get/advanced";
export const DETAILED_REVIEWS_TASK_POST_PATH = "/v3/merchant/google/reviews/task_post";
export const PRODUCTS_PATH_FRAGMENT = "/v3/merchant/google/products/";
export const APPROVED_DATAFORSEO_ORIGIN = "https://api.dataforseo.com";
export const DETAILED_REVIEW_TASK_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export const DETAILED_REVIEW_RETRIEVAL_STATES = Object.freeze({
  providerPending: "provider_pending",
  providerNoResult: "provider_no_result",
  providerError: "provider_error",
  malformedResponse: "malformed_response",
  readyForReviewValidation: "ready_for_review_validation",
  reviewsValidated: "reviews_validated",
  identityInconclusive: "identity_inconclusive",
});

const DATAFORSEO_TASK_SUCCESS_STATUS_CODE = 20000;
const DATAFORSEO_TASK_PENDING_STATUS_CODES = new Set([20100, 20101, 40601, 40602]);
const DATAFORSEO_TASK_PROVIDER_ERROR_STATUS_CODES = new Set([
  40000,
  40100,
  40200,
  40400,
  40401,
  40500,
  50000,
]);

export const CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS = Object.freeze({
  product: "Garmin Venu 4",
  productId: "user-search-garmin-venu-4",
  canonicalSearchQuery: "Garmin Venu 4",
  productTitle: "Garmin Venu 4",
  brand: "Garmin",
  model: "Venu 4",
  locationCode: 2840,
  languageCode: "en",
  recentReviewsDepth: 10,
  recentReviewsWindowDays: 90,
  recentReviewsMinimumScoringSampleSize: 30,
  recentReviewsProvisionalSampleSize: 10,
  taskPollAttempts: 3,
  taskPollIntervalMs: 2000,
  maxTaskGetCalls: 3,
  maxHttpRequests: 3,
});

const REQUIRED_TRUE_FLAGS = [
  "confirm-live",
  "retrieval-only",
  "no-task-post",
  "no-aggregate",
  "no-fallback",
  "no-persistence",
];

const REQUIRED_VALUES = {
  product: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.product,
  "max-task-get": String(CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.maxTaskGetCalls),
  "task-poll-attempts": String(CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.taskPollAttempts),
  "task-poll-interval-ms": String(CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.taskPollIntervalMs),
};

const REQUIRED_VALUE_FLAGS = new Set(["task-id"]);
const OPTIONAL_VALUE_FLAGS = new Set([
  "gid",
  "provider-product-id",
  "data-docid",
  "trusted-task-post-cost",
  "identity-provider",
  "identity-product-id",
  "identity-match-decision",
  "identity-match-confidence",
  "identity-matched-title",
  "identity-observed-at",
  "identity-match-reasons",
]);
const OPTIONAL_TRUE_FLAGS = new Set(["dry-run"]);
const ALLOWED_ARGS = new Set([
  ...REQUIRED_TRUE_FLAGS,
  ...Object.keys(REQUIRED_VALUES),
  ...REQUIRED_VALUE_FLAGS,
  ...OPTIONAL_VALUE_FLAGS,
  ...OPTIONAL_TRUE_FLAGS,
]);
const EPHEMERAL_IDENTITY_VALUE_FLAGS = [
  "identity-provider",
  "identity-product-id",
  "identity-match-decision",
  "identity-match-confidence",
  "identity-matched-title",
  "identity-observed-at",
  "identity-match-reasons",
];
const EPHEMERAL_IDENTITY_PROVIDER = "dataforseo";
const EPHEMERAL_IDENTITY_SOURCE = "google_shopping_aggregate_candidate";
const EPHEMERAL_IDENTITY_MATCH_DECISIONS = new Set(["match", "needs_identity", "reject"]);
const EPHEMERAL_IDENTITY_MATCH_CONFIDENCES = new Set(["high", "medium", "low", "rejected"]);
const EPHEMERAL_IDENTITY_REASON_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;

export class DetailedRetrievalGuardError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "DetailedRetrievalGuardError";
    this.details = details;
  }
}

export function parseArgs(argv) {
  return argv.reduce((parsed, rawArg) => {
    if (!rawArg.startsWith("--")) {
      parsed.positionals.push(rawArg);
      return parsed;
    }

    const equalsIndex = rawArg.indexOf("=");
    const key = equalsIndex === -1 ? rawArg.slice(2) : rawArg.slice(2, equalsIndex);
    const value = equalsIndex === -1 ? "true" : rawArg.slice(equalsIndex + 1);

    if (parsed.values[key] !== undefined) parsed.duplicates.push(key);
    parsed.values[key] = value;
    return parsed;
  }, { values: {}, positionals: [], duplicates: [] });
}

function finiteNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteCostOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function stringOrUndefined(value) {
  return typeof value === "string" && value.length ? value : undefined;
}

function sanitizedProviderString(value) {
  if (typeof value !== "string") return null;
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 200);
}

function looksLikeUrlScheme(value) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function validateSafeIdentifier(value, label, options = { required: false }) {
  if (value === undefined || value === null || value === "") {
    if (options.required) {
      throw new DetailedRetrievalGuardError("Required provider identifier is missing.", {
        field: label,
      });
    }

    return undefined;
  }

  if (
    typeof value !== "string" ||
    !DETAILED_REVIEW_TASK_ID_PATTERN.test(value) ||
    value.includes("..") ||
    looksLikeUrlScheme(value)
  ) {
    throw new DetailedRetrievalGuardError("Provider identifier failed safety validation.", {
      field: label,
      identifierPresent: typeof value === "string" && value.length > 0,
      identifierLength: typeof value === "string" ? value.length : undefined,
      allowedPattern: DETAILED_REVIEW_TASK_ID_PATTERN.source,
    });
  }

  return value;
}

export function validateDetailedReviewTaskId(taskId) {
  try {
    return validateSafeIdentifier(taskId, "taskId", { required: true });
  } catch (error) {
    if (error instanceof DetailedRetrievalGuardError) {
      throw new DetailedRetrievalGuardError("Detailed-review task_get task ID failed safety validation.", {
        ...error.details,
      });
    }

    throw error;
  }
}

function parseTrustedTaskPostCost(value) {
  const cost = finiteCostOrNull(value);
  if (value !== undefined && cost === null) {
    throw new DetailedRetrievalGuardError("Trusted detailed-review task_post cost is invalid.", {
      trustedTaskPostCostPresent: true,
    });
  }

  return cost;
}

function validateSafeText(value, label, options = { required: false, maxLength: 200 }) {
  if (value === undefined || value === null || value === "") {
    if (options.required) {
      throw new DetailedRetrievalGuardError("Required ephemeral identity text is missing.", {
        field: label,
      });
    }

    return undefined;
  }

  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length > (options.maxLength ?? 200) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new DetailedRetrievalGuardError("Ephemeral identity text failed safety validation.", {
      field: label,
      valuePresent: typeof value === "string" && value.length > 0,
      valueLength: typeof value === "string" ? value.length : undefined,
    });
  }

  return value;
}

function validateEnumValue(value, label, allowed, options = { required: false }) {
  if (value === undefined || value === null || value === "") {
    if (options.required) {
      throw new DetailedRetrievalGuardError("Required ephemeral identity enum is missing.", {
        field: label,
      });
    }

    return undefined;
  }

  if (typeof value !== "string" || !allowed.has(value)) {
    throw new DetailedRetrievalGuardError("Ephemeral identity enum failed safety validation.", {
      field: label,
      allowedValues: [...allowed],
    });
  }

  return value;
}

function validateObservedAt(value) {
  const observedAt = validateSafeText(value, "identityObservedAt", { required: false, maxLength: 80 });
  if (observedAt === undefined) return undefined;

  const parsed = Date.parse(observedAt);
  if (!Number.isFinite(parsed)) {
    throw new DetailedRetrievalGuardError("Ephemeral identity observed-at timestamp failed safety validation.", {
      field: "identityObservedAt",
    });
  }

  return observedAt;
}

function parseIdentityMatchReasons(value) {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value !== "string" || value !== value.trim() || value.length > 1000) {
    throw new DetailedRetrievalGuardError("Ephemeral identity match reasons failed safety validation.", {
      field: "identityMatchReasons",
    });
  }

  const reasons = value.split(",").filter(Boolean);
  if (!reasons.length || reasons.length > 20) {
    throw new DetailedRetrievalGuardError("Ephemeral identity match reasons failed safety validation.", {
      field: "identityMatchReasons",
      reasonCount: reasons.length,
    });
  }

  for (const reason of reasons) {
    if (!EPHEMERAL_IDENTITY_REASON_PATTERN.test(reason) || reason.includes("..")) {
      throw new DetailedRetrievalGuardError("Ephemeral identity match reason failed safety validation.", {
        field: "identityMatchReasons",
        allowedPattern: EPHEMERAL_IDENTITY_REASON_PATTERN.source,
      });
    }
  }

  return reasons;
}

function parseEphemeralIdentityContext(values, providerIdentity) {
  const hasIdentityContext = EPHEMERAL_IDENTITY_VALUE_FLAGS.some((flag) => values[flag] !== undefined);
  if (!hasIdentityContext) return undefined;

  const provider = validateEnumValue(
    values["identity-provider"],
    "identityProvider",
    new Set([EPHEMERAL_IDENTITY_PROVIDER]),
    { required: true }
  );
  const productId = validateSafeIdentifier(values["identity-product-id"], "identityProductId", {
    required: true,
  });
  const matchDecision = validateEnumValue(
    values["identity-match-decision"],
    "identityMatchDecision",
    EPHEMERAL_IDENTITY_MATCH_DECISIONS,
    { required: true }
  );
  const matchConfidence = validateEnumValue(
    values["identity-match-confidence"],
    "identityMatchConfidence",
    EPHEMERAL_IDENTITY_MATCH_CONFIDENCES,
    { required: true }
  );
  const matchedProductTitle = validateSafeText(values["identity-matched-title"], "identityMatchedTitle", {
    required: true,
    maxLength: 200,
  });

  return {
    provider,
    productId,
    identifiers: {
      gid: validateSafeIdentifier(values.gid, "gid", { required: true }),
      ...(providerIdentity.productId ? { productId: providerIdentity.productId } : {}),
      ...(providerIdentity.dataDocid ? { dataDocid: providerIdentity.dataDocid } : {}),
    },
    evidence: {
      source: EPHEMERAL_IDENTITY_SOURCE,
      matchDecision,
      matchConfidence,
      matchedProductTitle,
      matchReasons: parseIdentityMatchReasons(values["identity-match-reasons"]),
      observedAt: validateObservedAt(values["identity-observed-at"]) ?? "runtime_ephemeral_identity_context",
    },
  };
}

export function validateCliGuards(argv) {
  const parsed = parseArgs(argv);
  const errors = [];

  for (const positional of parsed.positionals) {
    errors.push(`unexpected positional argument: ${positional}`);
  }

  for (const duplicate of parsed.duplicates) {
    errors.push(`duplicate argument: --${duplicate}`);
  }

  for (const key of Object.keys(parsed.values)) {
    if (!ALLOWED_ARGS.has(key)) errors.push(`unexpected argument: --${key}`);
  }

  for (const flag of REQUIRED_TRUE_FLAGS) {
    if (parsed.values[flag] !== "true") errors.push(`missing or invalid required flag: --${flag}`);
  }

  for (const [key, expected] of Object.entries(REQUIRED_VALUES)) {
    if (parsed.values[key] !== expected) {
      errors.push(`missing or invalid required value: --${key}=${expected}`);
    }
  }

  for (const key of REQUIRED_VALUE_FLAGS) {
    if (!parsed.values[key] || parsed.values[key] === "true") {
      errors.push(`missing required value: --${key}`);
    }
  }

  for (const key of OPTIONAL_VALUE_FLAGS) {
    if (parsed.values[key] === "true") errors.push(`missing value for optional argument: --${key}`);
  }

  for (const flag of OPTIONAL_TRUE_FLAGS) {
    if (parsed.values[flag] !== undefined && parsed.values[flag] !== "true") {
      errors.push(`missing or invalid optional flag: --${flag}`);
    }
  }

  if (errors.length) {
    throw new DetailedRetrievalGuardError("Controlled detailed-review retrieval CLI guard failed before env access.", {
      errors,
    });
  }

  const providerIdentity = {
    gid: validateSafeIdentifier(parsed.values.gid, "gid", { required: false }),
    productId: validateSafeIdentifier(parsed.values["provider-product-id"], "providerProductId", {
      required: false,
    }),
    dataDocid: validateSafeIdentifier(parsed.values["data-docid"], "dataDocid", { required: false }),
  };

  return {
    dryRun: parsed.values["dry-run"] === "true",
    product: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.product,
    productId: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.productId,
    canonicalSearchQuery: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.canonicalSearchQuery,
    productTitle: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.productTitle,
    brand: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.brand,
    model: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.model,
    locationCode: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.locationCode,
    languageCode: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.languageCode,
    recentReviewsDepth: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.recentReviewsDepth,
    recentReviewsWindowDays: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.recentReviewsWindowDays,
    recentReviewsMinimumScoringSampleSize:
      CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.recentReviewsMinimumScoringSampleSize,
    recentReviewsProvisionalSampleSize:
      CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.recentReviewsProvisionalSampleSize,
    taskPollAttempts: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.taskPollAttempts,
    taskPollIntervalMs: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.taskPollIntervalMs,
    maxTaskGetCalls: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.maxTaskGetCalls,
    maxHttpRequests: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.maxHttpRequests,
    taskId: validateDetailedReviewTaskId(parsed.values["task-id"]),
    providerIdentity,
    ephemeralIdentityContext: parseEphemeralIdentityContext(parsed.values, providerIdentity),
    trustedTaskPostCost: parseTrustedTaskPostCost(parsed.values["trusted-task-post-cost"]),
  };
}

function safeUrlDetails(parsed) {
  return {
    protocol: parsed.protocol,
    origin: parsed.origin,
    pathname: parsed.pathname,
    usernamePresent: Boolean(parsed.username),
    passwordPresent: Boolean(parsed.password),
    searchPresent: Boolean(parsed.search),
    hashPresent: Boolean(parsed.hash),
  };
}

function parseUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    throw new DetailedRetrievalGuardError("Blocked provider request with invalid URL before network access.", {
      urlParseable: false,
    });
  }

  return parsed;
}

function hasExplicitDataForSeoPort(rawUrl) {
  return /^https:\/\/api\.dataforseo\.com:\d+(?:[/?#]|$)/i.test(String(rawUrl));
}

export function validateApprovedDataForSeoBaseUrl(rawBaseUrl) {
  const effectiveBaseUrl = rawBaseUrl || APPROVED_DATAFORSEO_ORIGIN;
  const parsed = parseUrl(effectiveBaseUrl);
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== APPROVED_DATAFORSEO_ORIGIN ||
    hasExplicitDataForSeoPort(effectiveBaseUrl) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname.replace(/\/+$/, "") !== ""
  ) {
    throw new DetailedRetrievalGuardError("Blocked unapproved DataForSEO API base URL before network access.", {
      approvedOrigin: APPROVED_DATAFORSEO_ORIGIN,
      observed: safeUrlDetails(parsed),
    });
  }

  return APPROVED_DATAFORSEO_ORIGIN;
}

function approvedProviderPathname(rawUrl) {
  const parsed = parseUrl(rawUrl);
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== APPROVED_DATAFORSEO_ORIGIN ||
    hasExplicitDataForSeoPort(rawUrl) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new DetailedRetrievalGuardError("Blocked provider request outside approved DataForSEO origin before network access.", {
      approvedOrigin: APPROVED_DATAFORSEO_ORIGIN,
      observed: safeUrlDetails(parsed),
    });
  }

  return parsed.pathname.replace(/\/+$/, "");
}

function requestMethod(init) {
  return String(init?.method ?? "GET").toUpperCase();
}

export function buildGarminReviewIdentity() {
  return {
    productId: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.productId,
    canonicalSearchQuery: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.canonicalSearchQuery,
    productTitle: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.productTitle,
    brand: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.brand,
    generation: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.model,
  };
}

export function readDotEnv(cwd = process.cwd()) {
  const envPath = path.join(cwd, ".env");
  if (!fs.existsSync(envPath)) return {};

  return fs.readFileSync(envPath, "utf8").split(/\r?\n/).reduce((env, rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return env;

    const index = line.indexOf("=");
    if (index < 1) return env;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    return { ...env, [key]: value };
  }, {});
}

function runtimeEnv(overrides) {
  return {
    ...readDotEnv(),
    ...process.env,
    ...(overrides ?? {}),
  };
}

export function credentialStatus(env = runtimeEnv()) {
  return {
    dataforseoLoginPresent: Boolean(env.DATAFORSEO_LOGIN),
    dataforseoPasswordPresent: Boolean(env.DATAFORSEO_PASSWORD),
    apiBaseUrlPresent: Boolean(env.DATAFORSEO_API_BASE_URL),
  };
}

export function buildDryRunReport(command) {
  return {
    ok: true,
    mode: "dry-run",
    retrievalOnly: true,
    providerNetworkCallsMade: 0,
    dryRunHttpRequests: 0,
    product: command.product,
    taskIdValidated: true,
    detailedReviewTaskPostCalls: 0,
    aggregateCalls: 0,
    fallbackCalls: 0,
    persistenceWrites: 0,
    request: {
      method: "GET",
      allowedTaskGetPathPrefix: DETAILED_REVIEWS_TASK_GET_ADVANCED_PATH_PREFIX,
      taskPostAllowed: false,
    },
    limits: {
      maxTaskGetCalls: command.maxTaskGetCalls,
      maxHttpRequests: command.maxHttpRequests,
      taskPollAttempts: command.taskPollAttempts,
      taskPollIntervalMs: command.taskPollIntervalMs,
    },
  };
}

export function createPersistenceTrap() {
  const calls = {
    providerIdentityCacheWrites: 0,
    productResolutionCacheWrites: 0,
    reviewSignalCacheWrites: 0,
    snapshotWrites: 0,
    canonicalIdentityMutations: 0,
    filesystemWrites: 0,
    fallbackCalls: 0,
  };

  return {
    calls,
    writeProviderIdentityCache() {
      calls.providerIdentityCacheWrites += 1;
      throw new DetailedRetrievalGuardError("Persistence trap blocked provider identity cache write.");
    },
    writeProductResolutionCache() {
      calls.productResolutionCacheWrites += 1;
      throw new DetailedRetrievalGuardError("Persistence trap blocked product resolution cache write.");
    },
    writeReviewSignalCache() {
      calls.reviewSignalCacheWrites += 1;
      throw new DetailedRetrievalGuardError("Persistence trap blocked review signal cache write.");
    },
    writeSnapshot() {
      calls.snapshotWrites += 1;
      throw new DetailedRetrievalGuardError("Persistence trap blocked snapshot write.");
    },
    mutateCanonicalIdentity() {
      calls.canonicalIdentityMutations += 1;
      throw new DetailedRetrievalGuardError("Persistence trap blocked canonical identity mutation.");
    },
    writeFilesystem() {
      calls.filesystemWrites += 1;
      throw new DetailedRetrievalGuardError("Persistence trap blocked filesystem write.");
    },
    callFallback() {
      calls.fallbackCalls += 1;
      throw new DetailedRetrievalGuardError("Persistence trap blocked fallback call.");
    },
  };
}

export function createDetailedReviewRetrievalGuardedFetch(fetchImpl, command) {
  if (typeof fetchImpl !== "function") {
    throw new DetailedRetrievalGuardError("No fetch implementation was provided for retrieval.");
  }

  const validatedTaskId = validateDetailedReviewTaskId(command.taskId);
  const counters = {
    detailedReviewTaskPostCalls: 0,
    aggregateCalls: 0,
    taskGetCalls: 0,
    totalHttpRequests: 0,
    fallbackCalls: 0,
  };

  async function guardedFetch(url, init) {
    const pathname = approvedProviderPathname(url);
    const method = requestMethod(init);

    if (init?.redirect !== "error") {
      throw new DetailedRetrievalGuardError("Blocked provider request without redirect:error before network access.", {
        method,
        pathname,
      });
    }

    if (method !== "GET") {
      throw new DetailedRetrievalGuardError("Blocked non-GET request before network access.", {
        method,
        pathname,
      });
    }

    if (pathname === DETAILED_REVIEWS_TASK_POST_PATH || pathname.includes("/task_post")) {
      throw new DetailedRetrievalGuardError("Blocked detailed-review task_post before network access.", {
        method,
        pathname,
      });
    }

    if (pathname.includes(PRODUCTS_PATH_FRAGMENT)) {
      throw new DetailedRetrievalGuardError("Blocked aggregate Products endpoint before network access.", {
        method,
        pathname,
      });
    }

    const allowedPrefix = `${DETAILED_REVIEWS_TASK_GET_ADVANCED_PATH_PREFIX}/`;
    if (!pathname.startsWith(allowedPrefix)) {
      throw new DetailedRetrievalGuardError("Blocked unexpected detailed-review retrieval path before network access.", {
        method,
        pathname,
      });
    }

    const observedTaskId = validateDetailedReviewTaskId(pathname.slice(allowedPrefix.length));
    if (observedTaskId !== validatedTaskId) {
      throw new DetailedRetrievalGuardError("Blocked detailed-review task_get for an unexpected task ID before network access.", {
        expectedTaskIdValidated: true,
        observedTaskIdValidated: true,
      });
    }

    if (counters.taskGetCalls >= command.maxTaskGetCalls) {
      throw new DetailedRetrievalGuardError("Blocked detailed-review task_get because bounded polling attempts were exhausted.", {
        counters: { ...counters },
      });
    }

    if (counters.totalHttpRequests + 1 > command.maxHttpRequests) {
      throw new DetailedRetrievalGuardError("Blocked detailed-review task_get because max HTTP request count would be exceeded.", {
        counters: { ...counters },
      });
    }

    counters.taskGetCalls += 1;
    counters.totalHttpRequests += 1;
    return fetchImpl(url, init);
  }

  return {
    fetch: guardedFetch,
    counters,
    taskId: validatedTaskId,
  };
}

function retrievalAttemptState(input) {
  return {
    attempt: input.attempt,
    validatedTaskId: input.taskId,
    taskStatusCode: input.taskStatusCode ?? null,
    taskStatusMessage: sanitizedProviderString(input.taskStatusMessage),
    readinessState: input.readinessState,
    resultCount: input.resultCount ?? null,
    itemsCount: input.itemsCount ?? null,
    reviewCount: input.reviewCount ?? null,
    detailedReviewObservationCost: finiteNumberOrNull(input.taskCost),
    reason: input.reason,
  };
}

function resultReviewCount(resultRecord, itemsCount) {
  const reviewCount = finiteNumberOrNull(resultRecord?.reviews_count);
  return reviewCount ?? itemsCount ?? null;
}

function classifyCompletedDetailedReviewTask(input) {
  const result = input.task.result;
  if (result === undefined || result === null) {
    return retrievalAttemptState({
      ...input,
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.providerNoResult,
      resultCount: 0,
      reason: "completed_task_missing_result",
    });
  }

  if (!Array.isArray(result)) {
    return retrievalAttemptState({
      ...input,
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.malformedResponse,
      reason: "completed_task_result_not_array",
    });
  }

  const resultCount = result.length;
  if (resultCount === 0) {
    return retrievalAttemptState({
      ...input,
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.providerNoResult,
      resultCount,
      reason: "completed_task_empty_result",
    });
  }

  const firstResult = asRecord(result[0]);
  if (!firstResult) {
    return retrievalAttemptState({
      ...input,
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.malformedResponse,
      resultCount,
      reason: "completed_task_result_entry_not_object",
    });
  }

  const items = firstResult.items;
  if (items === undefined || items === null) {
    return retrievalAttemptState({
      ...input,
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.providerNoResult,
      resultCount,
      reason: "completed_task_missing_items",
      reviewCount: resultReviewCount(firstResult, null),
    });
  }

  if (!Array.isArray(items)) {
    return retrievalAttemptState({
      ...input,
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.malformedResponse,
      resultCount,
      reason: "completed_task_items_not_array",
    });
  }

  return retrievalAttemptState({
    ...input,
    readinessState: items.length
      ? DETAILED_REVIEW_RETRIEVAL_STATES.readyForReviewValidation
      : DETAILED_REVIEW_RETRIEVAL_STATES.providerNoResult,
    resultCount,
    itemsCount: items.length,
    reviewCount: resultReviewCount(firstResult, items.length),
    reason: items.length ? "completed_task_with_reviews" : "completed_task_empty_items",
  });
}

function matchingTaskRecords(tasks, taskId) {
  return tasks
    .map(asRecord)
    .filter((candidate) => candidate?.id === taskId);
}

export function taskScopedDetailedReviewsTaskGetResponse(responseBody, taskId) {
  const response = asRecord(responseBody);
  if (!response || !Array.isArray(response.tasks)) return responseBody;
  const matchingTasks = matchingTaskRecords(response.tasks, taskId);

  return {
    ...response,
    tasks: matchingTasks.length === 1 ? matchingTasks : [],
  };
}

export function classifyDetailedReviewsTaskGetState(input) {
  const taskId = validateDetailedReviewTaskId(input.expectedTaskId);
  const attempt = input.attempt;
  const response = asRecord(input.response);

  if (!response) {
    return retrievalAttemptState({
      attempt,
      taskId,
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.malformedResponse,
      reason: "response_not_object",
    });
  }

  const responseStatusCode = finiteNumberOrNull(response.status_code);
  if (responseStatusCode === null) {
    return retrievalAttemptState({
      attempt,
      taskId,
      taskStatusMessage: response.status_message,
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.malformedResponse,
      reason: "provider_response_status_missing_or_invalid",
    });
  }

  if (responseStatusCode !== DATAFORSEO_TASK_SUCCESS_STATUS_CODE) {
    return retrievalAttemptState({
      attempt,
      taskId,
      taskStatusCode: responseStatusCode,
      taskStatusMessage: response.status_message,
      readinessState: DATAFORSEO_TASK_PROVIDER_ERROR_STATUS_CODES.has(responseStatusCode)
        ? DETAILED_REVIEW_RETRIEVAL_STATES.providerError
        : DETAILED_REVIEW_RETRIEVAL_STATES.malformedResponse,
      reason: DATAFORSEO_TASK_PROVIDER_ERROR_STATUS_CODES.has(responseStatusCode)
        ? "provider_response_status_provider_error"
        : "provider_response_status_unclassified",
    });
  }

  if (!Array.isArray(response.tasks)) {
    return retrievalAttemptState({
      attempt,
      taskId,
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.malformedResponse,
      reason: "tasks_not_array",
    });
  }

  const matchingTasks = matchingTaskRecords(response.tasks, taskId);
  if (matchingTasks.length > 1) {
    return retrievalAttemptState({
      attempt,
      taskId,
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.malformedResponse,
      reason: "duplicate_matching_task_ids",
    });
  }

  const task = matchingTasks[0];
  if (!task) {
    return retrievalAttemptState({
      attempt,
      taskId,
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.malformedResponse,
      reason: "matching_task_not_found",
    });
  }

  const taskStatusCode = finiteNumberOrNull(task.status_code);
  const base = {
    attempt,
    taskId,
    task,
    taskStatusCode,
    taskStatusMessage: task.status_message,
    taskCost: task.cost,
  };

  if (taskStatusCode === null) {
    return retrievalAttemptState({
      ...base,
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.malformedResponse,
      reason: "task_status_code_missing_or_invalid",
    });
  }

  if (taskStatusCode === DATAFORSEO_TASK_SUCCESS_STATUS_CODE) {
    return classifyCompletedDetailedReviewTask(base);
  }

  if (DATAFORSEO_TASK_PENDING_STATUS_CODES.has(taskStatusCode)) {
    return retrievalAttemptState({
      ...base,
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.providerPending,
      reason: "task_status_code_pending",
    });
  }

  if (DATAFORSEO_TASK_PROVIDER_ERROR_STATUS_CODES.has(taskStatusCode)) {
    return retrievalAttemptState({
      ...base,
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.providerError,
      reason: "task_status_code_provider_error",
    });
  }

  return retrievalAttemptState({
    ...base,
    readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.malformedResponse,
    reason: "task_status_code_unclassified",
  });
}

function exactMatchingTask(responseBody, taskId) {
  const response = asRecord(responseBody);
  if (!response || !Array.isArray(response.tasks)) return undefined;
  const matchingTasks = matchingTaskRecords(response.tasks, taskId);
  return matchingTasks.length === 1 ? matchingTasks[0] : undefined;
}

function firstTaskResult(responseBody, taskId) {
  const task = exactMatchingTask(responseBody, taskId);
  const result = Array.isArray(task?.result) ? task.result[0] : undefined;
  return asRecord(result);
}

function reviewResultTitle(result) {
  return stringOrUndefined(result?.title)
    ?? stringOrUndefined(result?.product_title)
    ?? stringOrUndefined(result?.product_name);
}

function semanticTitleMatch(input) {
  if (typeof input.evaluateGoogleShoppingProductMatch !== "function") {
    return {
      accepted: false,
      reason: "missing_generic_product_matcher",
    };
  }

  const match = input.evaluateGoogleShoppingProductMatch({
    title: input.title,
    seller: input.seller,
    identifiers: input.identifiers ?? {},
  }, buildGarminReviewIdentity());

  return {
    accepted: match.identityDecision === "match" && match.confidence === "high",
    reason: match.identityDecision === "match" && match.confidence === "high"
      ? input.acceptedReason
      : input.rejectedReason,
  };
}

function ephemeralIdentityTrustDecision(input) {
  const context = input.command.ephemeralIdentityContext;
  if (!context) {
    return {
      accepted: false,
      reason: "missing_ephemeral_identity_context",
    };
  }

  if (context.provider !== EPHEMERAL_IDENTITY_PROVIDER) {
    return {
      accepted: false,
      reason: "ephemeral_identity_provider_mismatch",
    };
  }

  if (context.productId !== input.command.productId) {
    return {
      accepted: false,
      reason: "ephemeral_identity_product_mismatch",
    };
  }

  if (context.evidence.source !== EPHEMERAL_IDENTITY_SOURCE) {
    return {
      accepted: false,
      reason: "ephemeral_identity_source_mismatch",
    };
  }

  if (context.evidence.matchDecision !== "match") {
    return {
      accepted: false,
      reason: "ephemeral_identity_match_decision_not_match",
    };
  }

  if (context.evidence.matchConfidence !== "high") {
    return {
      accepted: false,
      reason: "ephemeral_identity_match_confidence_not_high",
    };
  }

  validateSafeIdentifier(context.identifiers.gid, "ephemeralIdentityGid", { required: true });
  validateSafeIdentifier(context.identifiers.productId, "ephemeralIdentityProductId", { required: false });
  validateSafeIdentifier(context.identifiers.dataDocid, "ephemeralIdentityDataDocid", { required: false });

  return semanticTitleMatch({
    title: context.evidence.matchedProductTitle,
    seller: context.evidence.seller,
    identifiers: context.identifiers,
    evaluateGoogleShoppingProductMatch: input.evaluateGoogleShoppingProductMatch,
    acceptedReason: "ephemeral_identity_context_valid",
    rejectedReason: "ephemeral_identity_semantic_mismatch",
  });
}

function reviewResultIdentityDecision(input) {
  const trustDecision = ephemeralIdentityTrustDecision(input);
  if (!trustDecision.accepted) return trustDecision;

  const context = input.command.ephemeralIdentityContext;
  const resultProductId = stringOrUndefined(input.result?.product_id);
  const resultDataDocid = stringOrUndefined(input.result?.data_docid);
  const resultGid = stringOrUndefined(input.result?.gid);
  const providerProductId = stringOrUndefined(context?.identifiers.productId);
  const providerDataDocid = stringOrUndefined(context?.identifiers.dataDocid);
  const providerGid = stringOrUndefined(context?.identifiers.gid);

  if (providerProductId && resultProductId && resultProductId !== providerProductId) {
    return {
      accepted: false,
      reason: "result_provider_product_id_mismatch",
    };
  }

  if (providerDataDocid && resultDataDocid && resultDataDocid !== providerDataDocid) {
    return {
      accepted: false,
      reason: "result_data_docid_mismatch",
    };
  }

  if (providerGid && resultGid && resultGid !== providerGid) {
    return {
      accepted: false,
      reason: "result_gid_mismatch",
    };
  }

  const title = reviewResultTitle(input.result);
  if (title) {
    const titleDecision = semanticTitleMatch({
      title,
      identifiers: {
        ...(resultProductId ? { productId: resultProductId } : {}),
        ...(resultDataDocid ? { dataDocid: resultDataDocid } : {}),
        ...(resultGid ? { gid: resultGid } : {}),
      },
      evaluateGoogleShoppingProductMatch: input.evaluateGoogleShoppingProductMatch,
      acceptedReason: providerProductId && resultProductId === providerProductId
        ? "result_provider_product_id_and_title_match"
        : "result_title_semantic_match",
      rejectedReason: "result_title_semantic_mismatch",
    });

    if (!titleDecision.accepted) return titleDecision;
    return titleDecision;
  }

  if (providerProductId && resultProductId === providerProductId) {
    return {
      accepted: true,
      reason: "result_provider_product_id_match",
    };
  }

  if (providerDataDocid && resultDataDocid === providerDataDocid) {
    return {
      accepted: true,
      reason: "result_data_docid_match",
    };
  }

  if (providerGid && resultGid === providerGid) {
    return {
      accepted: true,
      reason: "result_gid_match",
    };
  }

  return {
    accepted: false,
    reason: "missing_result_product_identity_metadata",
  };
}

function summarizeRecentReviews(observation, identityDecision) {
  return {
    identityEvidence: identityDecision.reason,
    status: observation.status,
    totalReviewsFetched: observation.totalReviewsFetched,
    qualifyingReviewCount: observation.qualifyingReviewCount,
    totalReviewsAvailable: observation.totalReviewsAvailable ?? null,
    sourceDomains: observation.sourceDomains,
    ratingSummary: {
      recentAverageRating: observation.recentAverageRating ?? null,
      provisionalRecentAverageRating: observation.provisionalRecentAverageRating ?? null,
      ratingConsensusStatus: observation.ratingConsensus?.status ?? null,
      ratingConsensusQuality: observation.ratingConsensus?.ratingConsensusQuality ?? null,
      distributionSource: observation.ratingConsensus?.distributionSource ?? null,
      distributionScope: observation.ratingConsensus?.distributionScope ?? null,
      star1Count: observation.ratingConsensus?.star1Count ?? null,
      star2Count: observation.ratingConsensus?.star2Count ?? null,
      star3Count: observation.ratingConsensus?.star3Count ?? null,
      star4Count: observation.ratingConsensus?.star4Count ?? null,
      star5Count: observation.ratingConsensus?.star5Count ?? null,
    },
  };
}

function costSummary(command, detailedReviewObservationCost) {
  return {
    detailedReviewTaskCost: finiteNumberOrNull(command.trustedTaskPostCost),
    detailedReviewObservationCost: finiteNumberOrNull(detailedReviewObservationCost),
  };
}

async function delay(ms) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseProviderJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function loadReviewModules() {
  const { createServer } = await import("vite");
  const server = await createServer({
    root: process.cwd(),
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true },
  });

  try {
    const clientModule = await server.ssrLoadModule("/src/app/lib/data/reviews/client.ts");
    const matchingModule = await server.ssrLoadModule("/src/app/lib/data/reviews/matching.ts");

    return {
      mapDataForSeoGoogleShoppingReviewsResponse: clientModule.mapDataForSeoGoogleShoppingReviewsResponse,
      evaluateGoogleShoppingProductMatch: matchingModule.evaluateGoogleShoppingProductMatch,
      close: () => server.close(),
    };
  } catch (error) {
    await server.close();
    throw error;
  }
}

async function executeDetailedReviewRetrieval(input) {
  const { baseUrl, command, guardedFetch, modules, now } = input;
  const endpoint =
    `${baseUrl}${DETAILED_REVIEWS_TASK_GET_ADVANCED_PATH_PREFIX}/${command.taskId}`;
  const taskGetAttempts = [];
  let detailedReviewObservationCost = null;

  for (let attempt = 0; attempt < command.taskPollAttempts; attempt += 1) {
    if (attempt > 0) await delay(command.taskPollIntervalMs);

    const getResponse = await guardedFetch(endpoint, {
      method: "GET",
      redirect: "error",
      headers: {
        Authorization: `Basic ${Buffer.from(`${input.env.DATAFORSEO_LOGIN}:${input.env.DATAFORSEO_PASSWORD}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
    });

    if (!getResponse.ok) {
      const taskState = retrievalAttemptState({
        attempt: attempt + 1,
        taskId: command.taskId,
        taskStatusCode: getResponse.status,
        taskStatusMessage: getResponse.statusText,
        readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.providerError,
        reason: "task_get_http_error",
      });
      taskGetAttempts.push(taskState);

      return {
        finalState: DETAILED_REVIEW_RETRIEVAL_STATES.providerError,
        taskId: command.taskId,
        taskGetAttempts,
        cost: costSummary(command, detailedReviewObservationCost),
        reason: taskState.reason,
      };
    }

    const parsedResponse = await parseProviderJson(getResponse);
    if (!parsedResponse) {
      const taskState = retrievalAttemptState({
        attempt: attempt + 1,
        taskId: command.taskId,
        taskStatusCode: getResponse.status,
        taskStatusMessage: getResponse.statusText,
        readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.malformedResponse,
        reason: "task_get_json_parse_failed",
      });
      taskGetAttempts.push(taskState);

      return {
        finalState: DETAILED_REVIEW_RETRIEVAL_STATES.malformedResponse,
        taskId: command.taskId,
        taskGetAttempts,
        cost: costSummary(command, detailedReviewObservationCost),
        reason: taskState.reason,
      };
    }

    const taskState = classifyDetailedReviewsTaskGetState({
      response: parsedResponse,
      expectedTaskId: command.taskId,
      attempt: attempt + 1,
    });
    taskGetAttempts.push(taskState);
    const nextObservationCost = finiteNumberOrNull(taskState.detailedReviewObservationCost);
    if (nextObservationCost !== null) detailedReviewObservationCost = nextObservationCost;

    if (taskState.readinessState === DETAILED_REVIEW_RETRIEVAL_STATES.providerPending) {
      continue;
    }

    if (taskState.readinessState === DETAILED_REVIEW_RETRIEVAL_STATES.readyForReviewValidation) {
      const scopedResponse = taskScopedDetailedReviewsTaskGetResponse(parsedResponse, command.taskId);
      const result = firstTaskResult(scopedResponse, command.taskId);
      const identityDecision = reviewResultIdentityDecision({
        result,
        command,
        evaluateGoogleShoppingProductMatch: modules.evaluateGoogleShoppingProductMatch,
      });

      if (!identityDecision.accepted) {
        return {
          finalState: DETAILED_REVIEW_RETRIEVAL_STATES.identityInconclusive,
          taskId: command.taskId,
          taskGetAttempts,
          cost: costSummary(command, detailedReviewObservationCost),
          reason: identityDecision.reason,
        };
      }

      if (!command.providerIdentity.gid) {
        return {
          finalState: DETAILED_REVIEW_RETRIEVAL_STATES.identityInconclusive,
          taskId: command.taskId,
          taskGetAttempts,
          cost: costSummary(command, detailedReviewObservationCost),
          reason: "missing_ephemeral_gid_for_review_mapping",
        };
      }

      try {
        const observation = modules.mapDataForSeoGoogleShoppingReviewsResponse({
          response: scopedResponse,
          productId: command.productId,
          identifiers: {
            gid: command.providerIdentity.gid,
            productId: command.providerIdentity.productId,
            dataDocid: command.providerIdentity.dataDocid,
          },
          locationCode: command.locationCode,
          languageCode: command.languageCode,
          fetchedAt: now().toISOString(),
          snapshotTimestamp: now().toISOString(),
          windowDays: command.recentReviewsWindowDays,
          minimumScoringSampleSize: command.recentReviewsMinimumScoringSampleSize,
          provisionalSampleSize: command.recentReviewsProvisionalSampleSize,
          endpoint: DETAILED_REVIEWS_TASK_GET_ADVANCED_PATH_PREFIX,
        });

        return {
          finalState: DETAILED_REVIEW_RETRIEVAL_STATES.reviewsValidated,
          taskId: command.taskId,
          taskGetAttempts,
          cost: costSummary(command, detailedReviewObservationCost),
          reviewEvidence: summarizeRecentReviews(observation, identityDecision),
        };
      } catch (error) {
        return {
          finalState: DETAILED_REVIEW_RETRIEVAL_STATES.malformedResponse,
          taskId: command.taskId,
          taskGetAttempts,
          cost: costSummary(command, detailedReviewObservationCost),
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return {
      finalState: taskState.readinessState,
      taskId: command.taskId,
      taskGetAttempts,
      cost: costSummary(command, detailedReviewObservationCost),
      reason: taskState.reason,
    };
  }

  return {
    finalState: DETAILED_REVIEW_RETRIEVAL_STATES.providerPending,
    taskId: command.taskId,
    taskGetAttempts,
    cost: costSummary(command, detailedReviewObservationCost),
    reason: "bounded_polling_exhausted",
  };
}

export async function runDryRun(argv) {
  const command = validateCliGuards(argv);
  return buildDryRunReport(command);
}

export async function runLiveValidation(argv, options = {}) {
  const command = validateCliGuards(argv);
  if (command.dryRun) return buildDryRunReport(command);

  const env = runtimeEnv(options.env);
  const approvedBaseUrl = validateApprovedDataForSeoBaseUrl(env.DATAFORSEO_API_BASE_URL);
  const credentials = credentialStatus(env);
  if (!credentials.dataforseoLoginPresent || !credentials.dataforseoPasswordPresent) {
    throw new DetailedRetrievalGuardError("DataForSEO credentials are missing; stopped before network access.", {
      credentials,
    });
  }

  const modules = await (options.loadModules ?? loadReviewModules)();
  const guard = createDetailedReviewRetrievalGuardedFetch(options.fetchImpl ?? globalThis.fetch, command);

  try {
    const now = options.now ?? (() => new Date());
    const execution = await executeDetailedReviewRetrieval({
      baseUrl: approvedBaseUrl,
      command,
      env,
      guardedFetch: guard.fetch,
      modules,
      now,
    });

    return {
      ok: true,
      mode: "live",
      retrievalOnly: true,
      finalState: execution.finalState,
      taskId: execution.taskId,
      taskGetAttempts: execution.taskGetAttempts,
      counters: { ...guard.counters },
      cost: execution.cost,
      reviewEvidence: execution.reviewEvidence,
      reason: execution.reason,
    };
  } catch (error) {
    if (error instanceof DetailedRetrievalGuardError) {
      error.details = {
        ...error.details,
        counters: { ...guard.counters },
      };
    }

    throw error;
  } finally {
    await modules.close?.();
  }
}

function formatError(error) {
  if (error instanceof DetailedRetrievalGuardError) {
    return {
      ok: false,
      error: error.message,
      details: error.details,
    };
  }

  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

async function main() {
  try {
    const result = await runLiveValidation(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify(formatError(error), null, 2));
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
