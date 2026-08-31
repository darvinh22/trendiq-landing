#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCTS_TASK_POST_PATH = "/v3/merchant/google/products/task_post";
export const PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX = "/v3/merchant/google/products/task_get/advanced";
export const REVIEWS_TASK_PATH_FRAGMENT = "/v3/merchant/google/reviews/";
export const APPROVED_DATAFORSEO_ORIGIN = "https://api.dataforseo.com";
export const PROVIDER_TASK_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export const TASK_GET_READINESS_STATES = Object.freeze({
  providerPending: "provider_pending",
  providerNoResult: "provider_no_result",
  providerError: "provider_error",
  malformedResponse: "malformed_response",
  readyForIdentity: "ready_for_identity",
  identityInconclusive: "identity_inconclusive",
  candidateSelected: "candidate_selected",
});

const DATAFORSEO_TASK_SUCCESS_STATUS_CODE = 20000;
// DataForSEO queue states: 40601 = Task Handed, 40602 = Task In Queue.
// Queue states must remain pending so bounded polling can continue.
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

export const CONTROLLED_REVIEW_HARNESS = Object.freeze({
  product: "Garmin Venu 4",
  productId: "user-search-garmin-venu-4",
  runToken: "phase-3u-2a-2-garmin-venu-4-aggregate-only",
  canonicalSearchQuery: "Garmin Venu 4",
  productTitle: "Garmin Venu 4",
  brand: "Garmin",
  model: "Venu 4",
  locationCode: 2840,
  languageCode: "en",
  depth: 10,
  tag: "trendiq:controlled:phase-3u-2a-2:garmin-venu-4:aggregate-only",
  taskPollAttempts: 3,
  taskPollIntervalMs: 2000,
  maxLogicalTasks: 1,
  maxTaskPostCalls: 1,
  maxHttpRequests: 4,
});

const REQUIRED_TRUE_FLAGS = [
  "confirm-live",
  "aggregate-only",
  "no-detailed-reviews",
  "no-identity-discovery",
  "no-fallback",
  "no-persistence",
];

const REQUIRED_VALUES = {
  "run-token": CONTROLLED_REVIEW_HARNESS.runToken,
  product: CONTROLLED_REVIEW_HARNESS.product,
  "max-logical-tasks": String(CONTROLLED_REVIEW_HARNESS.maxLogicalTasks),
  "max-task-post": String(CONTROLLED_REVIEW_HARNESS.maxTaskPostCalls),
  "task-poll-attempts": String(CONTROLLED_REVIEW_HARNESS.taskPollAttempts),
  "task-poll-interval-ms": String(CONTROLLED_REVIEW_HARNESS.taskPollIntervalMs),
  depth: String(CONTROLLED_REVIEW_HARNESS.depth),
};

const OPTIONAL_FLAGS = new Set(["dry-run"]);
const ALLOWED_ARGS = new Set([...REQUIRED_TRUE_FLAGS, ...Object.keys(REQUIRED_VALUES), ...OPTIONAL_FLAGS]);

export class HarnessGuardError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "HarnessGuardError";
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
    if (equalsIndex === -1) {
      parsed.values[rawArg.slice(2)] = "true";
      return parsed;
    }

    const key = rawArg.slice(2, equalsIndex);
    const value = rawArg.slice(equalsIndex + 1);
    parsed.values[key] = value;
    return parsed;
  }, { values: {}, positionals: [] });
}

export function validateCliGuards(argv) {
  const parsed = parseArgs(argv);
  const errors = [];

  for (const positional of parsed.positionals) {
    errors.push(`unexpected positional argument: ${positional}`);
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

  if (parsed.values["dry-run"] !== undefined && parsed.values["dry-run"] !== "true") {
    errors.push("missing or invalid optional flag: --dry-run");
  }

  if (errors.length) {
    throw new HarnessGuardError("Controlled live review harness CLI guard failed before network access.", {
      errors,
    });
  }

  return {
    dryRun: parsed.values["dry-run"] === "true",
    product: CONTROLLED_REVIEW_HARNESS.product,
    productId: CONTROLLED_REVIEW_HARNESS.productId,
    runToken: CONTROLLED_REVIEW_HARNESS.runToken,
    maxLogicalTasks: CONTROLLED_REVIEW_HARNESS.maxLogicalTasks,
    maxTaskPostCalls: CONTROLLED_REVIEW_HARNESS.maxTaskPostCalls,
    taskPollAttempts: CONTROLLED_REVIEW_HARNESS.taskPollAttempts,
    taskPollIntervalMs: CONTROLLED_REVIEW_HARNESS.taskPollIntervalMs,
    maxHttpRequests: CONTROLLED_REVIEW_HARNESS.maxHttpRequests,
    depth: CONTROLLED_REVIEW_HARNESS.depth,
    locationCode: CONTROLLED_REVIEW_HARNESS.locationCode,
    languageCode: CONTROLLED_REVIEW_HARNESS.languageCode,
    tag: CONTROLLED_REVIEW_HARNESS.tag,
  };
}

export function buildGarminReviewIdentity() {
  return {
    productId: CONTROLLED_REVIEW_HARNESS.productId,
    canonicalSearchQuery: CONTROLLED_REVIEW_HARNESS.canonicalSearchQuery,
    productTitle: CONTROLLED_REVIEW_HARNESS.productTitle,
    brand: CONTROLLED_REVIEW_HARNESS.brand,
    generation: CONTROLLED_REVIEW_HARNESS.model,
  };
}

export function buildGarminRequestPayload() {
  return [
    {
      keyword: CONTROLLED_REVIEW_HARNESS.canonicalSearchQuery,
      location_code: CONTROLLED_REVIEW_HARNESS.locationCode,
      language_code: CONTROLLED_REVIEW_HARNESS.languageCode,
      depth: CONTROLLED_REVIEW_HARNESS.depth,
      tag: CONTROLLED_REVIEW_HARNESS.tag,
    },
  ];
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

export function buildDryRunReport(command, env = runtimeEnv()) {
  return {
    ok: true,
    mode: "dry-run",
    providerNetworkCallsMade: 0,
    dryRunHttpRequests: 0,
    product: command.product,
    identity: buildGarminReviewIdentity(),
    request: {
      method: "POST",
      allowedTaskPostPath: PRODUCTS_TASK_POST_PATH,
      allowedTaskGetPathPrefix: PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX,
      payload: buildGarminRequestPayload(),
    },
    limits: {
      maxLogicalProviderTasks: command.maxLogicalTasks,
      maxTaskPostCalls: command.maxTaskPostCalls,
      maxTaskGetCalls: command.taskPollAttempts,
      maxHttpRequests: command.maxHttpRequests,
      taskPollAttempts: command.taskPollAttempts,
      taskPollIntervalMs: command.taskPollIntervalMs,
    },
    forbidden: [
      "second task_post",
      "google shopping detailed reviews task",
      "identity discovery",
      "fallback provider",
      "pagination task",
      "automatic provider retry",
      "canonical identity mutation",
      "cache writes",
      "snapshot writes",
    ],
    persistencePolicy: {
      providerIdentityCacheWrites: false,
      productResolutionCacheWrites: false,
      reviewSignalCacheWrites: false,
      snapshotWrites: false,
      canonicalProviderIdentityMutation: false,
      filesystemWrites: false,
    },
    credentials: credentialStatus(env),
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
    throw new HarnessGuardError("Blocked provider request with invalid URL before network access.", {
      urlParseable: false,
    });
  }

  return parsed;
}

export function validateApprovedDataForSeoBaseUrl(rawBaseUrl) {
  const parsed = parseUrl(rawBaseUrl || APPROVED_DATAFORSEO_ORIGIN);
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== APPROVED_DATAFORSEO_ORIGIN ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname.replace(/\/+$/, "") !== ""
  ) {
    throw new HarnessGuardError("Blocked unapproved DataForSEO API base URL before network access.", {
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
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new HarnessGuardError("Blocked provider request outside approved DataForSEO origin before network access.", {
      approvedOrigin: APPROVED_DATAFORSEO_ORIGIN,
      observed: safeUrlDetails(parsed),
    });
  }

  return parsed.pathname.replace(/\/+$/, "");
}

function requestMethod(init) {
  return String(init?.method ?? "GET").toUpperCase();
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function finiteNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizedProviderString(value) {
  if (typeof value !== "string") return null;

  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 200);
}

function costSummary(sourceCost) {
  const costState = asRecord(sourceCost);
  if (costState) {
    const taskCost = finiteNumberOrNull(costState.postTaskCost ?? costState.taskCost);
    const observationCost = finiteNumberOrNull(costState.observationCost);

    return {
      taskCost,
      observationCost,
      sourceCostCompatibleValue: taskCost,
    };
  }

  const taskCost = finiteNumberOrNull(sourceCost);

  return {
    taskCost,
    observationCost: taskCost,
    sourceCostCompatibleValue: taskCost,
  };
}

export function extractTaskPostMetadata(responseBody) {
  const response = responseBody && typeof responseBody === "object" ? responseBody : {};
  if (response.status_code !== DATAFORSEO_TASK_SUCCESS_STATUS_CODE) {
    throw new HarnessGuardError("DataForSEO task_post response did not report provider success.", {
      dataForSeoStatusCode: response.status_code,
      dataForSeoStatusMessage: response.status_message,
    });
  }

  const task = Array.isArray(response.tasks)
    ? response.tasks.find((candidate) =>
      typeof candidate?.id === "string" &&
      (
        candidate.status_code === DATAFORSEO_TASK_SUCCESS_STATUS_CODE ||
        DATAFORSEO_TASK_PENDING_STATUS_CODES.has(candidate.status_code)
      )
    )
    : undefined;

  return {
    taskId: validateProviderTaskId(task?.id),
    taskCost: finiteNumberOrNull(task?.cost),
  };
}

export function extractTaskIdFromPostResponse(responseBody) {
  return extractTaskPostMetadata(responseBody).taskId;
}

export function validateProviderTaskId(taskId) {
  if (
    typeof taskId !== "string" ||
    !PROVIDER_TASK_ID_PATTERN.test(taskId) ||
    taskId.includes("..")
  ) {
    throw new HarnessGuardError("DataForSEO task_post response did not include a safe task id.", {
      taskIdPresent: typeof taskId === "string" && taskId.length > 0,
      taskIdLength: typeof taskId === "string" ? taskId.length : undefined,
      allowedPattern: PROVIDER_TASK_ID_PATTERN.source,
    });
  }

  return taskId;
}

function taskGetAttemptState(input) {
  return {
    attempt: input.attempt,
    taskId: input.taskId,
    taskStatusCode: input.taskStatusCode ?? null,
    taskStatusMessage: sanitizedProviderString(input.taskStatusMessage),
    readinessState: input.readinessState,
    resultCount: input.resultCount ?? null,
    itemsCount: input.itemsCount ?? null,
    taskCost: finiteNumberOrNull(input.taskCost),
    reason: input.reason,
  };
}

function classifyCompletedTaskGetTask(input) {
  const result = input.task.result;
  if (result === undefined || result === null) {
    return taskGetAttemptState({
      ...input,
      readinessState: TASK_GET_READINESS_STATES.providerNoResult,
      resultCount: 0,
      reason: "completed_task_missing_result",
    });
  }

  if (!Array.isArray(result)) {
    return taskGetAttemptState({
      ...input,
      readinessState: TASK_GET_READINESS_STATES.malformedResponse,
      reason: "completed_task_result_not_array",
    });
  }

  const resultCount = result.length;
  if (resultCount === 0) {
    return taskGetAttemptState({
      ...input,
      readinessState: TASK_GET_READINESS_STATES.providerNoResult,
      resultCount,
      reason: "completed_task_empty_result",
    });
  }

  const firstResult = asRecord(result[0]);
  if (!firstResult) {
    return taskGetAttemptState({
      ...input,
      readinessState: TASK_GET_READINESS_STATES.malformedResponse,
      resultCount,
      reason: "completed_task_result_entry_not_object",
    });
  }

  const items = firstResult.items;
  if (items === undefined || items === null) {
    return taskGetAttemptState({
      ...input,
      readinessState: TASK_GET_READINESS_STATES.providerNoResult,
      resultCount,
      reason: "completed_task_missing_items",
    });
  }

  if (!Array.isArray(items)) {
    return taskGetAttemptState({
      ...input,
      readinessState: TASK_GET_READINESS_STATES.malformedResponse,
      resultCount,
      reason: "completed_task_items_not_array",
    });
  }

  return taskGetAttemptState({
    ...input,
    readinessState: items.length
      ? TASK_GET_READINESS_STATES.readyForIdentity
      : TASK_GET_READINESS_STATES.providerNoResult,
    resultCount,
    itemsCount: items.length,
    reason: items.length ? "completed_task_with_products" : "completed_task_empty_items",
  });
}

function matchingTaskRecords(tasks, taskId) {
  return tasks
    .map(asRecord)
    .filter((candidate) => candidate?.id === taskId);
}

function taskScopedProductsTaskGetResponse(responseBody, taskId) {
  const response = asRecord(responseBody);
  if (!response || !Array.isArray(response.tasks)) return responseBody;
  const matchingTasks = matchingTaskRecords(response.tasks, taskId);

  return {
    ...response,
    tasks: matchingTasks.length === 1 ? matchingTasks : [],
  };
}

export function classifyProductsTaskGetState(input) {
  const taskId = validateProviderTaskId(input.expectedTaskId);
  const attempt = input.attempt;
  const response = asRecord(input.response);
  if (!response) {
    return taskGetAttemptState({
      attempt,
      taskId,
      readinessState: TASK_GET_READINESS_STATES.malformedResponse,
      reason: "response_not_object",
    });
  }

  if (response.status_code !== 20000) {
    return taskGetAttemptState({
      attempt,
      taskId,
      taskStatusCode: finiteNumberOrNull(response.status_code),
      taskStatusMessage: response.status_message,
      readinessState: TASK_GET_READINESS_STATES.providerError,
      reason: "provider_response_status_not_success",
    });
  }

  if (!Array.isArray(response.tasks)) {
    return taskGetAttemptState({
      attempt,
      taskId,
      readinessState: TASK_GET_READINESS_STATES.malformedResponse,
      reason: "tasks_not_array",
    });
  }

  const matchingTasks = matchingTaskRecords(response.tasks, taskId);
  if (matchingTasks.length > 1) {
    return taskGetAttemptState({
      attempt,
      taskId,
      readinessState: TASK_GET_READINESS_STATES.malformedResponse,
      reason: "duplicate_matching_task_ids",
    });
  }

  const task = matchingTasks[0];
  if (!task) {
    return taskGetAttemptState({
      attempt,
      taskId,
      readinessState: TASK_GET_READINESS_STATES.malformedResponse,
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
    return taskGetAttemptState({
      ...base,
      readinessState: TASK_GET_READINESS_STATES.malformedResponse,
      reason: "task_status_code_missing_or_invalid",
    });
  }

  if (taskStatusCode === DATAFORSEO_TASK_SUCCESS_STATUS_CODE) {
    return classifyCompletedTaskGetTask(base);
  }

  if (DATAFORSEO_TASK_PENDING_STATUS_CODES.has(taskStatusCode)) {
    return taskGetAttemptState({
      ...base,
      readinessState: TASK_GET_READINESS_STATES.providerPending,
      reason: "task_status_code_pending",
    });
  }

  if (DATAFORSEO_TASK_PROVIDER_ERROR_STATUS_CODES.has(taskStatusCode)) {
    return taskGetAttemptState({
      ...base,
      readinessState: TASK_GET_READINESS_STATES.providerError,
      reason: "task_status_code_provider_error",
    });
  }

  return taskGetAttemptState({
    ...base,
    readinessState: TASK_GET_READINESS_STATES.malformedResponse,
    reason: "task_status_code_unclassified",
  });
}

function wrapTaskPostResponse(response, onTaskId) {
  let parsedPromise;

  return new Proxy(response, {
    get(target, prop, receiver) {
      if (prop === "json") {
        return async () => {
          if (!parsedPromise) {
            parsedPromise = Promise.resolve(target.json()).then((body) => {
              onTaskId(extractTaskIdFromPostResponse(body));
              return body;
            });
          }

          return parsedPromise;
        };
      }

      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function createGuardedFetch(fetchImpl, limits = CONTROLLED_REVIEW_HARNESS) {
  if (typeof fetchImpl !== "function") {
    throw new HarnessGuardError("No fetch implementation was provided for the controlled harness.");
  }

  const counters = {
    logicalTasksCreated: 0,
    taskPostCalls: 0,
    taskGetCalls: 0,
    totalHttpRequests: 0,
  };
  let taskId;

  async function guardedFetch(url, init) {
    const pathname = approvedProviderPathname(url);
    const method = requestMethod(init);

    if (pathname.includes(REVIEWS_TASK_PATH_FRAGMENT)) {
      throw new HarnessGuardError("Blocked Google Shopping detailed reviews request before network access.", {
        pathname,
      });
    }

    if (method === "POST" && pathname === PRODUCTS_TASK_POST_PATH) {
      if (counters.taskPostCalls >= limits.maxTaskPostCalls) {
        throw new HarnessGuardError("Blocked second DataForSEO task_post before network access.", {
          counters: { ...counters },
        });
      }
      if (counters.totalHttpRequests + 1 > limits.maxHttpRequests) {
        throw new HarnessGuardError("Blocked task_post because max HTTP request count would be exceeded.", {
          counters: { ...counters },
        });
      }

      counters.taskPostCalls += 1;
      counters.totalHttpRequests += 1;
      const response = await fetchImpl(url, init);
      return wrapTaskPostResponse(response, (nextTaskId) => {
        if (taskId && taskId !== nextTaskId) {
          throw new HarnessGuardError("Blocked replacement DataForSEO task id.", {
            expectedTaskId: taskId,
            observedTaskId: nextTaskId,
          });
        }

        taskId = nextTaskId;
        counters.logicalTasksCreated = 1;
      });
    }

    const getPrefix = `${PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX}/`;
    if (method === "GET" && pathname.startsWith(getPrefix)) {
      const observedTaskId = pathname.slice(getPrefix.length);
      validateProviderTaskId(observedTaskId);
      if (!taskId) {
        throw new HarnessGuardError("Blocked task_get before task_post task id was recorded.", {
          observedTaskId,
        });
      }
      if (observedTaskId !== taskId) {
        throw new HarnessGuardError("Blocked task_get for an unexpected DataForSEO task id before network access.", {
          expectedTaskId: taskId,
          observedTaskId,
        });
      }
      if (counters.taskGetCalls >= limits.taskPollAttempts) {
        throw new HarnessGuardError("Blocked task_get because bounded polling attempts were exhausted.", {
          counters: { ...counters },
        });
      }
      if (counters.totalHttpRequests + 1 > limits.maxHttpRequests) {
        throw new HarnessGuardError("Blocked task_get because max HTTP request count would be exceeded.", {
          counters: { ...counters },
        });
      }

      counters.taskGetCalls += 1;
      counters.totalHttpRequests += 1;
      return fetchImpl(url, init);
    }

    throw new HarnessGuardError("Blocked unexpected provider request before network access.", {
      method,
      pathname,
    });
  }

  return {
    fetch: guardedFetch,
    counters,
    get taskId() {
      return taskId;
    },
  };
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

    return {
      mapDataForSeoGoogleShoppingProductsResponse: clientModule.mapDataForSeoGoogleShoppingProductsResponse,
      close: () => server.close(),
    };
  } catch (error) {
    await server.close();
    throw error;
  }
}

export function summarizeObservation(observation, fallbackCost = null) {
  const fallbackCostState = asRecord(fallbackCost);
  const cost = fallbackCostState
    ? costSummary(fallbackCostState)
    : costSummary(fallbackCost);

  return {
    selected: true,
    product: CONTROLLED_REVIEW_HARNESS.product,
    canonicalQuery: CONTROLLED_REVIEW_HARNESS.canonicalSearchQuery,
    brand: CONTROLLED_REVIEW_HARNESS.brand,
    model: CONTROLLED_REVIEW_HARNESS.model,
    candidateTitle: observation.matchedProductTitle,
    providerIdsObserved: observation.identifiers ?? {},
    providerIdsPersistence: "not_persisted",
    candidateSeller: observation.seller ?? null,
    candidateMatchDecision: "match",
    candidateMatchConfidence: observation.matchConfidence,
    canonicalIdentityStatus: "unchanged_observation_only",
    canonicalIdentityConfidence: "not_elevated_by_harness",
    matchReasons: observation.matchReasons,
    rejectionOrNeedsIdentityReason: null,
    cost,
  };
}

function taskGetTerminalDetails(input) {
  return {
    finalState: input.finalState,
    taskId: input.taskId,
    attempts: input.taskGetAttempts.length,
    taskGetAttempts: input.taskGetAttempts,
    reason: input.reason,
    cost: costSummary(input.costState ?? input.taskCost),
  };
}

function encodeBasicAuth(login, password) {
  return Buffer.from(`${login}:${password}`).toString("base64");
}

async function delay(ms) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseProviderJson(response, context) {
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof HarnessGuardError) throw error;

    throw new HarnessGuardError(`DataForSEO ${context.phase} response JSON could not be parsed; stopped without retry.`, {
      provider: "dataforseo",
      method: context.method,
      endpointPath: context.endpointPath,
      httpStatus: response.status,
      statusText: response.statusText,
      attempt: context.attempt,
      taskId: context.taskId,
    });
  }
}

async function executeAggregateProductsTask(input) {
  const {
    baseUrl,
    command,
    env,
    guardedFetch,
    mapDataForSeoGoogleShoppingProductsResponse,
    now,
  } = input;
  const postEndpoint = `${baseUrl}${PRODUCTS_TASK_POST_PATH}`;
  const postResponse = await guardedFetch(postEndpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: `Basic ${encodeBasicAuth(env.DATAFORSEO_LOGIN, env.DATAFORSEO_PASSWORD)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildGarminRequestPayload()),
  });

  if (!postResponse.ok) {
    throw new HarnessGuardError("DataForSEO task_post failed; stopped without retry.", {
      provider: "dataforseo",
      method: "POST",
      endpointPath: PRODUCTS_TASK_POST_PATH,
      httpStatus: postResponse.status,
      statusText: postResponse.statusText,
    });
  }

  const postBody = await parseProviderJson(postResponse, {
    phase: "task_post",
    method: "POST",
    endpointPath: PRODUCTS_TASK_POST_PATH,
  });
  const postTask = extractTaskPostMetadata(postBody);
  const taskId = postTask.taskId;
  const getEndpoint = `${baseUrl}${PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX}/${taskId}`;
  const taskGetAttempts = [];
  const postTaskCost = postTask.taskCost;
  let observationCost = null;
  const currentCostState = () => ({ postTaskCost, observationCost });
  const captureObservationCost = (nextCost) => {
    const nextObservationCost = finiteNumberOrNull(nextCost);
    if (nextObservationCost === null) return;

    observationCost = nextObservationCost;
  };

  for (let attempt = 0; attempt < command.taskPollAttempts; attempt += 1) {
    if (attempt > 0) await delay(command.taskPollIntervalMs);

    const getResponse = await guardedFetch(getEndpoint, {
      method: "GET",
      redirect: "error",
      headers: {
        Authorization: `Basic ${encodeBasicAuth(env.DATAFORSEO_LOGIN, env.DATAFORSEO_PASSWORD)}`,
        "Content-Type": "application/json",
      },
    });

    if (!getResponse.ok) {
      const taskState = taskGetAttemptState({
        attempt: attempt + 1,
        taskId,
        readinessState: TASK_GET_READINESS_STATES.providerError,
        reason: "task_get_http_error",
      });
      taskGetAttempts.push(taskState);

      throw new HarnessGuardError("DataForSEO task_get failed; stopped without fallback.", {
        provider: "dataforseo",
        method: "GET",
        endpointPath: PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX,
        httpStatus: getResponse.status,
        statusText: getResponse.statusText,
        attempt: attempt + 1,
        taskId,
        ...taskGetTerminalDetails({
          finalState: TASK_GET_READINESS_STATES.providerError,
          taskId,
          taskGetAttempts,
          costState: currentCostState(),
          reason: taskState.reason,
        }),
      });
    }

    let parsedResponse;
    try {
      parsedResponse = await parseProviderJson(getResponse, {
        phase: "task_get",
        method: "GET",
        endpointPath: PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX,
        attempt: attempt + 1,
        taskId,
      });
    } catch (error) {
      if (error instanceof HarnessGuardError) {
        const taskState = taskGetAttemptState({
          attempt: attempt + 1,
          taskId,
          readinessState: TASK_GET_READINESS_STATES.malformedResponse,
          reason: "task_get_json_parse_failed",
        });
        taskGetAttempts.push(taskState);

        throw new HarnessGuardError("DataForSEO task_get ended with malformed_response.", {
          provider: "dataforseo",
          method: "GET",
          endpointPath: PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX,
          httpStatus: getResponse.status,
          statusText: getResponse.statusText,
          ...taskGetTerminalDetails({
            finalState: TASK_GET_READINESS_STATES.malformedResponse,
            taskId,
            taskGetAttempts,
            costState: currentCostState(),
            reason: taskState.reason,
          }),
        });
      }

      throw error;
    }
    const taskState = classifyProductsTaskGetState({
      response: parsedResponse,
      expectedTaskId: taskId,
      attempt: attempt + 1,
    });
    taskGetAttempts.push(taskState);
    captureObservationCost(taskState.taskCost);

    if (taskState.readinessState === TASK_GET_READINESS_STATES.providerPending) {
      continue;
    }

    if (taskState.readinessState !== TASK_GET_READINESS_STATES.readyForIdentity) {
      throw new HarnessGuardError(`DataForSEO task_get ended with ${taskState.readinessState}.`, taskGetTerminalDetails({
        finalState: taskState.readinessState,
        taskId,
        taskGetAttempts,
        costState: currentCostState(),
        reason: taskState.reason,
      }));
    }

    const scopedResponse = taskScopedProductsTaskGetResponse(parsedResponse, taskId);
    try {
      const observation = mapDataForSeoGoogleShoppingProductsResponse({
        response: scopedResponse,
        productId: command.productId,
        identity: buildGarminReviewIdentity(),
        locationCode: command.locationCode,
        languageCode: command.languageCode,
        fetchedAt: now().toISOString(),
        endpoint: PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX,
        minimumMatchConfidence: "high",
      });
      captureObservationCost(observation.cost);

      return {
        finalState: TASK_GET_READINESS_STATES.candidateSelected,
        taskId,
        taskGetAttempts,
        cost: costSummary(currentCostState()),
        observation,
      };
    } catch (error) {
      throw new HarnessGuardError("DataForSEO aggregate candidate selection ended with identity_inconclusive.", taskGetTerminalDetails({
        finalState: TASK_GET_READINESS_STATES.identityInconclusive,
        taskId,
        taskGetAttempts,
        costState: currentCostState(),
        reason: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  throw new HarnessGuardError("DataForSEO task polling ended with provider_pending.", taskGetTerminalDetails({
    finalState: TASK_GET_READINESS_STATES.providerPending,
    taskId,
    taskGetAttempts,
    costState: currentCostState(),
    reason: "bounded_polling_exhausted",
  }));
}

export async function runDryRun(argv, options = {}) {
  const command = validateCliGuards(argv);
  return buildDryRunReport(command, runtimeEnv(options.env));
}

export async function runLiveValidation(argv, options = {}) {
  const command = validateCliGuards(argv);
  if (command.dryRun) return runDryRun(argv, options);

  const env = runtimeEnv(options.env);
  const approvedBaseUrl = validateApprovedDataForSeoBaseUrl(env.DATAFORSEO_API_BASE_URL);
  const credentials = credentialStatus(env);
  if (!credentials.dataforseoLoginPresent || !credentials.dataforseoPasswordPresent) {
    throw new HarnessGuardError("DataForSEO credentials are missing; stopped before network access.", {
      credentials,
    });
  }

  const modules = await (options.loadModules ?? loadReviewModules)();
  const guard = createGuardedFetch(options.fetchImpl ?? globalThis.fetch, CONTROLLED_REVIEW_HARNESS);

  try {
    const now = options.now ?? (() => new Date());
    const execution = await executeAggregateProductsTask({
      baseUrl: approvedBaseUrl,
      command,
      env,
      guardedFetch: guard.fetch,
      mapDataForSeoGoogleShoppingProductsResponse: modules.mapDataForSeoGoogleShoppingProductsResponse,
      now,
    });

    return {
      ok: true,
      mode: "live",
      aggregateOnly: true,
      finalState: execution.finalState,
      logicalProviderTasks: guard.counters.logicalTasksCreated,
      counters: { ...guard.counters },
      taskId: execution.taskId,
      taskGetAttempts: execution.taskGetAttempts,
      cost: execution.cost,
      result: summarizeObservation(execution.observation, execution.cost),
    };
  } catch (error) {
    if (error instanceof HarnessGuardError) {
      error.details = {
        ...error.details,
        logicalProviderTasks: guard.counters.logicalTasksCreated,
        counters: { ...guard.counters },
      };
    }

    throw error;
  } finally {
    await modules.close?.();
  }
}

export function createPersistenceTrap() {
  const calls = {
    providerIdentityCacheWrites: 0,
    productResolutionCacheWrites: 0,
    reviewSignalCacheWrites: 0,
    snapshotWrites: 0,
    canonicalIdentityMutations: 0,
  };

  return {
    calls,
    writeProviderIdentityCache() {
      calls.providerIdentityCacheWrites += 1;
      throw new HarnessGuardError("Persistence trap blocked provider identity cache write.");
    },
    writeProductResolutionCache() {
      calls.productResolutionCacheWrites += 1;
      throw new HarnessGuardError("Persistence trap blocked product resolution cache write.");
    },
    writeReviewSignalCache() {
      calls.reviewSignalCacheWrites += 1;
      throw new HarnessGuardError("Persistence trap blocked review signal cache write.");
    },
    writeSnapshot() {
      calls.snapshotWrites += 1;
      throw new HarnessGuardError("Persistence trap blocked snapshot write.");
    },
    mutateCanonicalIdentity() {
      calls.canonicalIdentityMutations += 1;
      throw new HarnessGuardError("Persistence trap blocked canonical identity mutation.");
    },
  };
}

function formatError(error) {
  if (error instanceof HarnessGuardError) {
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
