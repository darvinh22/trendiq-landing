import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  APPROVED_DATAFORSEO_ORIGIN,
  CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS,
  DETAILED_REVIEW_RETRIEVAL_STATES,
  DETAILED_REVIEWS_TASK_GET_ADVANCED_PATH_PREFIX,
  DETAILED_REVIEWS_TASK_POST_PATH,
  DetailedRetrievalGuardError,
  createDetailedReviewRetrievalGuardedFetch,
  createPersistenceTrap,
  runDryRun,
  runLiveValidation,
  taskScopedDetailedReviewsTaskGetResponse,
  validateApprovedDataForSeoBaseUrl,
  validateCliGuards,
  validateDetailedReviewTaskId,
  classifyDetailedReviewsTaskGetState,
} from "../../../../../../scripts/reviews-detailed-retrieval-validation.mjs";

const taskId = "synthetic-detail-task-id";
const unrelatedTaskId = "synthetic-unrelated-task-id";
const providerProductId = "synthetic-provider-product-id";
const dataDocid = "synthetic-data-docid";
const gid = "synthetic-gid";
const trustedTaskPostCost = 0.0125;
const now = new Date("2026-08-31T12:00:00.000Z");

const baseArgs = [
  "--confirm-live",
  "--retrieval-only",
  `--task-id=${taskId}`,
  `--product=${CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.product}`,
  `--max-task-get=${CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.maxTaskGetCalls}`,
  `--task-poll-attempts=${CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.taskPollAttempts}`,
  `--task-poll-interval-ms=${CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.taskPollIntervalMs}`,
  "--no-task-post",
  "--no-aggregate",
  "--no-fallback",
  "--no-persistence",
  `--trusted-task-post-cost=${trustedTaskPostCost}`,
];

const identityContextArgs = [
  `--gid=${gid}`,
  `--provider-product-id=${providerProductId}`,
  `--data-docid=${dataDocid}`,
  "--identity-provider=dataforseo",
  `--identity-product-id=${CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.productId}`,
  "--identity-match-decision=match",
  "--identity-match-confidence=high",
  "--identity-matched-title=Garmin Venu 4 GPS Smartwatch",
  "--identity-observed-at=2026-08-31T11:55:00.000Z",
  "--identity-match-reasons=title_token_coverage:100,model_token_coverage:100,match_brand_model",
];

const validArgs = [...baseArgs, ...identityContextArgs];
const noIdentityContextArgs = [...baseArgs, `--gid=${gid}`, `--provider-product-id=${providerProductId}`];

function response(payload: unknown, options: { ok?: boolean; status?: number; statusText?: string } = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? "OK",
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function reviewItem(overrides: Record<string, unknown> = {}) {
  return {
    type: "google_shopping_review_item",
    rank_group: 1,
    rank_absolute: 1,
    url: "https://example.test/reviews/synthetic-garmin-venu-4",
    provided_by: "example.test",
    publication_date: "2026-08-30 00:00:00 +00:00",
    rating: {
      value: 5,
      rating_max: 5,
    },
    ...overrides,
  };
}

function reviewsResult(items: unknown[] = [reviewItem()], overrides: Record<string, unknown> = {}) {
  return {
    product_id: providerProductId,
    datetime: "2026-08-31 12:00:00 +00:00",
    reviews_count: items.length,
    items_count: items.length,
    items,
    ...overrides,
  };
}

function taskGetPayload(taskOverrides: Record<string, unknown> = {}) {
  return {
    status_code: 20000,
    status_message: "Ok.",
    tasks_error: 0,
    tasks: [
      {
        id: taskId,
        status_code: 20000,
        status_message: "Ok.",
        cost: 0,
        result_count: 1,
        result: [reviewsResult()],
        ...taskOverrides,
      },
    ],
  };
}

function pendingPayload(statusCode = 40602, cost = 0) {
  return taskGetPayload({
    status_code: statusCode,
    status_message: "Task In Queue.",
    cost,
    result_count: 0,
    result: undefined,
  });
}

function providerErrorPayload() {
  return taskGetPayload({
    status_code: 50000,
    status_message: "Internal error.",
    cost: 0.02,
    result_count: 0,
    result: undefined,
  });
}

function fakeFetchWithResponses(responses: Array<ReturnType<typeof response>>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected fetch call");

    return next;
  });

  return { calls, fetchImpl };
}

function defaultMapperObservation(overrides: Record<string, unknown> = {}) {
  return {
    status: "insufficient",
    totalReviewsFetched: 1,
    qualifyingReviewCount: 1,
    totalReviewsAvailable: 1,
    sourceDomains: ["example.test"],
    reviews: [
      {
        rating: 5,
        publicationDate: now.toISOString(),
        providedBy: "example.test",
      },
    ],
    ratingConsensus: undefined,
    ...overrides,
  };
}

function modules(overrides: {
  mapper?: ReturnType<typeof vi.fn>;
  matcher?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    mapDataForSeoGoogleShoppingReviewsResponse: overrides.mapper ?? vi.fn(() => defaultMapperObservation()),
    evaluateGoogleShoppingProductMatch: overrides.matcher ?? vi.fn(() => ({
      identityDecision: "match",
      confidence: "high",
      score: 95,
      reasons: ["match_brand_model"],
    })),
    close: vi.fn(async () => undefined),
  };
}

function liveOptions(responses: Array<ReturnType<typeof response>>, moduleOverrides = {}) {
  const { calls, fetchImpl } = fakeFetchWithResponses(responses);
  const loadedModules = modules(moduleOverrides);

  return {
    calls,
    options: {
      env: {
        DATAFORSEO_LOGIN: "synthetic-login",
        DATAFORSEO_PASSWORD: "synthetic-password",
        DATAFORSEO_API_BASE_URL: APPROVED_DATAFORSEO_ORIGIN,
      },
      fetchImpl,
      loadModules: async () => loadedModules,
      now: () => now,
    },
    modules: loadedModules,
  };
}

function scriptSource() {
  return readFileSync(new URL("../../../../../../scripts/reviews-detailed-retrieval-validation.mjs", import.meta.url), "utf8");
}

describe("controlled detailed-review retrieval harness", () => {
  it("accepts the valid retrieval-only CLI contract", () => {
    expect(validateCliGuards(validArgs)).toMatchObject({
      product: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.product,
      taskId,
      maxTaskGetCalls: 3,
      maxHttpRequests: 3,
      providerIdentity: {
        gid,
        productId: providerProductId,
        dataDocid,
      },
      ephemeralIdentityContext: {
        provider: "dataforseo",
        productId: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.productId,
        identifiers: {
          gid,
          productId: providerProductId,
          dataDocid,
        },
        evidence: {
          source: "google_shopping_aggregate_candidate",
          matchDecision: "match",
          matchConfidence: "high",
          matchedProductTitle: "Garmin Venu 4 GPS Smartwatch",
          matchReasons: ["title_token_coverage:100", "model_token_coverage:100", "match_brand_model"],
          observedAt: "2026-08-31T11:55:00.000Z",
        },
      },
      trustedTaskPostCost,
    });
  });

  it.each([
    { name: "missing confirm-live", args: validArgs.filter((arg) => arg !== "--confirm-live") },
    { name: "extra flag", args: [...validArgs, "--extra=true"] },
    { name: "wrong product", args: validArgs.map((arg) => arg.startsWith("--product=") ? "--product=Wrong" : arg) },
    { name: "duplicate task id", args: [...validArgs, "--task-id=second-synthetic-task"] },
    { name: "missing optional value", args: [...validArgs, "--gid"] },
  ])("aborts before env/network initialization for $name", async ({ args }) => {
    const fetchImpl = vi.fn();
    const loadModules = vi.fn();

    await expect(runLiveValidation(args, {
      env: {
        DATAFORSEO_LOGIN: "synthetic-login",
        DATAFORSEO_PASSWORD: "synthetic-password",
      },
      fetchImpl,
      loadModules,
    })).rejects.toThrow(DetailedRetrievalGuardError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(loadModules).not.toHaveBeenCalled();
  });

  it.each([
    "",
    " ",
    "task/with/slash",
    "task\\with\\backslash",
    "task?query=true",
    "task#fragment",
    "task%2Fencoded",
    "task%2e%2eencoded",
    "../task",
    "https://example.test/task",
    "https:example-task",
    "mailto:example-task",
    "t".repeat(129),
  ])("rejects unsafe task ID forms before URL construction: %s", (unsafeTaskId) => {
    expect(() => validateDetailedReviewTaskId(unsafeTaskId)).toThrow(DetailedRetrievalGuardError);
  });

  it.each([
    { flag: "provider-product-id", value: "https:unsafe-product" },
    { flag: "data-docid", value: "file:unsafe-doc" },
  ])("rejects unsafe optional provider ID --$flag before network initialization", async ({ flag, value }) => {
    const args = validArgs.map((arg) => (
      arg.startsWith(`--${flag}=`) ? `--${flag}=${value}` : arg
    ));
    const fetchImpl = vi.fn();
    const loadModules = vi.fn();

    await expect(runLiveValidation(args, {
      env: {
        DATAFORSEO_LOGIN: "synthetic-login",
        DATAFORSEO_PASSWORD: "synthetic-password",
        DATAFORSEO_API_BASE_URL: APPROVED_DATAFORSEO_ORIGIN,
      },
      fetchImpl,
      loadModules,
    })).rejects.toThrow(DetailedRetrievalGuardError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(loadModules).not.toHaveBeenCalled();
  });

  it.each([
    "http://api.dataforseo.com",
    "https://api.dataforseo.com:443",
    "https://user@api.dataforseo.com",
    "https://api.dataforseo.com/base",
    "https://api.dataforseo.com?query=1",
    "https://api.dataforseo.com#hash",
    "https://example.test",
  ])("rejects unapproved DataForSEO origins or base URL decorations: %s", (baseUrl) => {
    expect(() => validateApprovedDataForSeoBaseUrl(baseUrl)).toThrow(DetailedRetrievalGuardError);
  });

  it("allows only the exact approved DataForSEO origin", () => {
    expect(validateApprovedDataForSeoBaseUrl(APPROVED_DATAFORSEO_ORIGIN)).toBe(APPROVED_DATAFORSEO_ORIGIN);
  });

  it("requires redirect:error before network access", async () => {
    const command = validateCliGuards(validArgs);
    const fetchImpl = vi.fn();
    const guard = createDetailedReviewRetrievalGuardedFetch(fetchImpl, command);

    await expect(guard.fetch(
      `${APPROVED_DATAFORSEO_ORIGIN}${DETAILED_REVIEWS_TASK_GET_ADVANCED_PATH_PREFIX}/${taskId}`,
      { method: "GET", redirect: "follow" }
    )).rejects.toThrow(DetailedRetrievalGuardError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows GET only", async () => {
    const command = validateCliGuards(validArgs);
    const fetchImpl = vi.fn();
    const guard = createDetailedReviewRetrievalGuardedFetch(fetchImpl, command);

    await expect(guard.fetch(
      `${APPROVED_DATAFORSEO_ORIGIN}${DETAILED_REVIEWS_TASK_GET_ADVANCED_PATH_PREFIX}/${taskId}`,
      { method: "POST", redirect: "error" }
    )).rejects.toThrow(DetailedRetrievalGuardError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks detailed-review task_post before network access", async () => {
    const command = validateCliGuards(validArgs);
    const fetchImpl = vi.fn();
    const guard = createDetailedReviewRetrievalGuardedFetch(fetchImpl, command);

    await expect(guard.fetch(
      `${APPROVED_DATAFORSEO_ORIGIN}${DETAILED_REVIEWS_TASK_POST_PATH}`,
      { method: "POST", redirect: "error" }
    )).rejects.toThrow(DetailedRetrievalGuardError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(guard.counters.detailedReviewTaskPostCalls).toBe(0);
  });

  it("blocks aggregate Products endpoints before network access", async () => {
    const command = validateCliGuards(validArgs);
    const fetchImpl = vi.fn();
    const guard = createDetailedReviewRetrievalGuardedFetch(fetchImpl, command);

    await expect(guard.fetch(
      `${APPROVED_DATAFORSEO_ORIGIN}/v3/merchant/google/products/task_get/advanced/${taskId}`,
      { method: "GET", redirect: "error" }
    )).rejects.toThrow(DetailedRetrievalGuardError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(guard.counters.aggregateCalls).toBe(0);
  });

  it("blocks wrong task IDs before network access", async () => {
    const command = validateCliGuards(validArgs);
    const fetchImpl = vi.fn();
    const guard = createDetailedReviewRetrievalGuardedFetch(fetchImpl, command);

    await expect(guard.fetch(
      `${APPROVED_DATAFORSEO_ORIGIN}${DETAILED_REVIEWS_TASK_GET_ADVANCED_PATH_PREFIX}/other-synthetic-task`,
      { method: "GET", redirect: "error" }
    )).rejects.toThrow(DetailedRetrievalGuardError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("enforces max GET = 3 before fetch", async () => {
    const command = validateCliGuards(validArgs);
    const fetchImpl = vi.fn(async () => response(pendingPayload()));
    const guard = createDetailedReviewRetrievalGuardedFetch(fetchImpl, command);
    const url = `${APPROVED_DATAFORSEO_ORIGIN}${DETAILED_REVIEWS_TASK_GET_ADVANCED_PATH_PREFIX}/${taskId}`;

    await guard.fetch(url, { method: "GET", redirect: "error" });
    await guard.fetch(url, { method: "GET", redirect: "error" });
    await guard.fetch(url, { method: "GET", redirect: "error" });
    await expect(guard.fetch(url, { method: "GET", redirect: "error" })).rejects.toThrow(DetailedRetrievalGuardError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(guard.counters.taskGetCalls).toBe(3);
  });

  it("enforces max HTTP = 3 before fetch", async () => {
    const command = {
      ...validateCliGuards(validArgs),
      maxTaskGetCalls: 10,
      maxHttpRequests: 3,
    };
    const fetchImpl = vi.fn(async () => response(pendingPayload()));
    const guard = createDetailedReviewRetrievalGuardedFetch(fetchImpl, command);
    const url = `${APPROVED_DATAFORSEO_ORIGIN}${DETAILED_REVIEWS_TASK_GET_ADVANCED_PATH_PREFIX}/${taskId}`;

    await guard.fetch(url, { method: "GET", redirect: "error" });
    await guard.fetch(url, { method: "GET", redirect: "error" });
    await guard.fetch(url, { method: "GET", redirect: "error" });
    await expect(guard.fetch(url, { method: "GET", redirect: "error" })).rejects.toThrow(DetailedRetrievalGuardError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(guard.counters.totalHttpRequests).toBe(3);
  });

  it("polls pending states to completed reviews", async () => {
    const mapper = vi.fn(() => defaultMapperObservation({ totalReviewsFetched: 2, qualifyingReviewCount: 2 }));
    const { options, modules: loadedModules } = liveOptions([
      response(pendingPayload(20100, 0)),
      response(pendingPayload(40602, 0)),
      response(taskGetPayload({ cost: 0, result: [reviewsResult([reviewItem(), reviewItem()])] })),
    ], { mapper });

    const result = await runLiveValidation(validArgs, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.reviewsValidated);
    expect(result.counters.taskGetCalls).toBe(3);
    expect(result.reviewEvidence?.totalReviewsFetched).toBe(2);
    expect(mapper).toHaveBeenCalledTimes(1);
    expect(loadedModules.close).toHaveBeenCalledTimes(1);
  });

  it("returns identity_inconclusive for completed reviews without ephemeral identity context", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const { options } = liveOptions([
      response(taskGetPayload()),
    ], { mapper });

    const result = await runLiveValidation(noIdentityContextArgs, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.identityInconclusive);
    expect(result.reason).toBe("missing_ephemeral_identity_context");
    expect(mapper).not.toHaveBeenCalled();
  });

  it("returns identity_inconclusive when ephemeral identity references a different canonical product", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const args = validArgs.map((arg) => (
      arg.startsWith("--identity-product-id=") ? "--identity-product-id=other-product" : arg
    ));
    const { options } = liveOptions([
      response(taskGetPayload()),
    ], { mapper });

    const result = await runLiveValidation(args, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.identityInconclusive);
    expect(result.reason).toBe("ephemeral_identity_product_mismatch");
    expect(mapper).not.toHaveBeenCalled();
  });

  it("returns identity_inconclusive when ephemeral identity confidence is not high", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const args = validArgs.map((arg) => (
      arg === "--identity-match-confidence=high" ? "--identity-match-confidence=medium" : arg
    ));
    const { options } = liveOptions([
      response(taskGetPayload()),
    ], { mapper });

    const result = await runLiveValidation(args, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.identityInconclusive);
    expect(result.reason).toBe("ephemeral_identity_match_confidence_not_high");
    expect(mapper).not.toHaveBeenCalled();
  });

  it("returns identity_inconclusive when ephemeral identity is not a match", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const args = validArgs.map((arg) => (
      arg === "--identity-match-decision=match" ? "--identity-match-decision=needs_identity" : arg
    ));
    const { options } = liveOptions([
      response(taskGetPayload()),
    ], { mapper });

    const result = await runLiveValidation(args, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.identityInconclusive);
    expect(result.reason).toBe("ephemeral_identity_match_decision_not_match");
    expect(mapper).not.toHaveBeenCalled();
  });

  it("fails closed before network when ephemeral identity gid is invalid", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const args = validArgs.map((arg) => (
      arg.startsWith("--gid=") ? "--gid=unsafe/gid" : arg
    ));
    const fetchImpl = vi.fn();
    const loadModules = vi.fn(async () => modules({ mapper }));

    await expect(runLiveValidation(args, {
      env: {
        DATAFORSEO_LOGIN: "synthetic-login",
        DATAFORSEO_PASSWORD: "synthetic-password",
        DATAFORSEO_API_BASE_URL: APPROVED_DATAFORSEO_ORIGIN,
      },
      fetchImpl,
      loadModules,
      now: () => now,
    })).rejects.toThrow(DetailedRetrievalGuardError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(loadModules).not.toHaveBeenCalled();
    expect(mapper).not.toHaveBeenCalled();
  });

  it("returns provider_pending when all polls remain pending", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const { options } = liveOptions([
      response(pendingPayload(20100, 0)),
      response(pendingPayload(40601, 0)),
      response(pendingPayload(40602, 0)),
    ], { mapper });

    const result = await runLiveValidation(validArgs, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.providerPending);
    expect(result.reason).toBe("bounded_polling_exhausted");
    expect(result.counters.taskGetCalls).toBe(3);
    expect(mapper).not.toHaveBeenCalled();
  });

  it("classifies completed tasks with reviews as ready for review validation", () => {
    expect(classifyDetailedReviewsTaskGetState({
      response: taskGetPayload(),
      expectedTaskId: taskId,
      attempt: 1,
    })).toMatchObject({
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.readyForReviewValidation,
      resultCount: 1,
      itemsCount: 1,
      reviewCount: 1,
    });
  });

  it("classifies completed tasks with zero reviews as provider_no_result", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const { options } = liveOptions([
      response(taskGetPayload({ result: [reviewsResult([], { reviews_count: 0, items_count: 0 })] })),
    ], { mapper });

    const result = await runLiveValidation(validArgs, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.providerNoResult);
    expect(result.taskGetAttempts[0]).toMatchObject({
      resultCount: 1,
      itemsCount: 0,
      reviewCount: 0,
    });
    expect(mapper).not.toHaveBeenCalled();
  });

  it("classifies task-level provider errors as provider_error", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const { options } = liveOptions([response(providerErrorPayload())], { mapper });

    const result = await runLiveValidation(validArgs, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.providerError);
    expect(result.taskGetAttempts[0]).toMatchObject({
      taskStatusCode: 50000,
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.providerError,
    });
    expect(mapper).not.toHaveBeenCalled();
  });

  it("fails closed for unknown task status codes", () => {
    expect(classifyDetailedReviewsTaskGetState({
      response: taskGetPayload({
        status_code: 49999,
        status_message: "Unclassified synthetic status.",
        result: undefined,
      }),
      expectedTaskId: taskId,
      attempt: 1,
    })).toMatchObject({
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.malformedResponse,
      reason: "task_status_code_unclassified",
    });
  });

  it("fails closed for malformed tasks arrays", () => {
    expect(classifyDetailedReviewsTaskGetState({
      response: {
        status_code: 20000,
        status_message: "Ok.",
        tasks: null,
      },
      expectedTaskId: taskId,
      attempt: 1,
    })).toMatchObject({
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.malformedResponse,
      reason: "tasks_not_array",
    });
  });

  it("fails closed when the matching task is missing", () => {
    expect(classifyDetailedReviewsTaskGetState({
      response: {
        status_code: 20000,
        status_message: "Ok.",
        tasks: [
          {
            id: unrelatedTaskId,
            status_code: 20000,
            status_message: "Ok.",
            cost: 0.99,
            result: [reviewsResult()],
          },
        ],
      },
      expectedTaskId: taskId,
      attempt: 1,
    })).toMatchObject({
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.malformedResponse,
      reason: "matching_task_not_found",
    });
  });

  it("fails closed on duplicate same-ID tasks", () => {
    expect(classifyDetailedReviewsTaskGetState({
      response: {
        status_code: 20000,
        status_message: "Ok.",
        tasks: [
          { id: taskId, status_code: 40602, status_message: "Task In Queue.", cost: 0 },
          { id: taskId, status_code: 20000, status_message: "Ok.", cost: 0.99, result: [reviewsResult()] },
        ],
      },
      expectedTaskId: taskId,
      attempt: 1,
    })).toMatchObject({
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.malformedResponse,
      reason: "duplicate_matching_task_ids",
      detailedReviewObservationCost: null,
    });
  });

  it("does not let unrelated tasks supply status", () => {
    expect(classifyDetailedReviewsTaskGetState({
      response: {
        status_code: 20000,
        status_message: "Ok.",
        tasks: [
          { id: unrelatedTaskId, status_code: 20000, status_message: "Ok.", cost: 0.99, result: [reviewsResult()] },
          { id: taskId, status_code: 40602, status_message: "Task In Queue.", cost: 0 },
        ],
      },
      expectedTaskId: taskId,
      attempt: 1,
    })).toMatchObject({
      readinessState: DETAILED_REVIEW_RETRIEVAL_STATES.providerPending,
      taskStatusCode: 40602,
      detailedReviewObservationCost: 0,
    });
  });

  it("does not let unrelated tasks supply cost", () => {
    expect(classifyDetailedReviewsTaskGetState({
      response: {
        status_code: 20000,
        status_message: "Ok.",
        tasks: [
          { id: unrelatedTaskId, status_code: 20000, status_message: "Ok.", cost: 0.99, result: [reviewsResult()] },
          { id: taskId, status_code: 40602, status_message: "Task In Queue.", cost: 0 },
        ],
      },
      expectedTaskId: taskId,
      attempt: 1,
    })).toMatchObject({
      detailedReviewObservationCost: 0,
    });
  });

  it("does not let unrelated tasks supply reviews or invoke the mapper", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const { options } = liveOptions([
      response({
        status_code: 20000,
        status_message: "Ok.",
        tasks: [
          { id: unrelatedTaskId, status_code: 20000, status_message: "Ok.", result: [reviewsResult()] },
          { id: taskId, status_code: 40602, status_message: "Task In Queue.", cost: 0 },
        ],
      }),
      response(pendingPayload(40602, 0)),
      response(pendingPayload(40602, 0)),
    ], { mapper });

    const result = await runLiveValidation(validArgs, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.providerPending);
    expect(mapper).not.toHaveBeenCalled();
  });

  it("keeps GET cost 0 separate from trusted detailed-review task_post cost", async () => {
    const { options } = liveOptions([
      response(taskGetPayload({ cost: 0 })),
    ]);

    const result = await runLiveValidation(validArgs, options);

    expect(result.cost).toEqual({
      detailedReviewTaskCost: trustedTaskPostCost,
      detailedReviewObservationCost: 0,
    });
  });

  it("keeps unknown task_post cost unknown even when GET reports nonzero cost", async () => {
    const args = validArgs.filter((arg) => !arg.startsWith("--trusted-task-post-cost="));
    const { options } = liveOptions([
      response(taskGetPayload({ cost: 0.034 })),
    ]);

    const result = await runLiveValidation(args, options);

    expect(result.cost).toEqual({
      detailedReviewTaskCost: null,
      detailedReviewObservationCost: 0.034,
    });
  });

  it("does not call fallback or persistence traps", async () => {
    const trap = createPersistenceTrap();
    const { options } = liveOptions([
      response(taskGetPayload()),
    ]);

    await runLiveValidation(validArgs, options);

    expect(trap.calls).toEqual({
      providerIdentityCacheWrites: 0,
      productResolutionCacheWrites: 0,
      reviewSignalCacheWrites: 0,
      snapshotWrites: 0,
      canonicalIdentityMutations: 0,
      filesystemWrites: 0,
      fallbackCalls: 0,
    });
  });

  it("invokes the mapper only after completed usable review evidence", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const pending = liveOptions([response(pendingPayload()), response(pendingPayload()), response(pendingPayload())], {
      mapper,
    });
    await runLiveValidation(validArgs, pending.options);
    expect(mapper).not.toHaveBeenCalled();

    const zeroReviews = liveOptions([
      response(taskGetPayload({ result: [reviewsResult([], { reviews_count: 0, items_count: 0 })] })),
    ], { mapper });
    await runLiveValidation(validArgs, zeroReviews.options);
    expect(mapper).not.toHaveBeenCalled();

    const completed = liveOptions([response(taskGetPayload())], { mapper });
    await runLiveValidation(validArgs, completed.options);
    expect(mapper).toHaveBeenCalledTimes(1);
  });

  it("returns identity_inconclusive for product metadata mismatch", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const { options } = liveOptions([
      response(taskGetPayload({
        result: [reviewsResult([reviewItem()], { product_id: "other-provider-product-id" })],
      })),
    ], { mapper });

    const result = await runLiveValidation(validArgs, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.identityInconclusive);
    expect(result.reason).toBe("result_provider_product_id_mismatch");
    expect(mapper).not.toHaveBeenCalled();
  });

  it("returns identity_inconclusive for dataDocid metadata mismatch when echoed", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const { options } = liveOptions([
      response(taskGetPayload({
        result: [reviewsResult([reviewItem()], {
          product_id: providerProductId,
          data_docid: "other-data-docid",
        })],
      })),
    ], { mapper });

    const result = await runLiveValidation(validArgs, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.identityInconclusive);
    expect(result.reason).toBe("result_data_docid_mismatch");
    expect(mapper).not.toHaveBeenCalled();
  });

  it("returns identity_inconclusive for gid metadata mismatch when echoed", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const { options } = liveOptions([
      response(taskGetPayload({
        result: [reviewsResult([reviewItem()], {
          product_id: providerProductId,
          gid: "other-gid",
        })],
      })),
    ], { mapper });

    const result = await runLiveValidation(validArgs, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.identityInconclusive);
    expect(result.reason).toBe("result_gid_mismatch");
    expect(mapper).not.toHaveBeenCalled();
  });

  it("accepts matching dataDocid response metadata when product title is absent", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const args = validArgs.filter((arg) => !arg.startsWith("--provider-product-id="));
    const { options } = liveOptions([
      response(taskGetPayload({
        result: [reviewsResult([reviewItem()], {
          product_id: undefined,
          data_docid: dataDocid,
        })],
      })),
    ], { mapper });

    const result = await runLiveValidation(args, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.reviewsValidated);
    expect(result.reviewEvidence?.identityEvidence).toBe("result_data_docid_match");
    expect(mapper).toHaveBeenCalledTimes(1);
  });

  it("accepts valid gid-only ephemeral identity when response title metadata confirms the product", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const args = validArgs.filter((arg) => (
      !arg.startsWith("--provider-product-id=") && !arg.startsWith("--data-docid=")
    ));
    const { options } = liveOptions([
      response(taskGetPayload({
        result: [reviewsResult([reviewItem()], {
          product_id: undefined,
          product_title: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.productTitle,
        })],
      })),
    ], { mapper });

    const result = await runLiveValidation(args, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.reviewsValidated);
    expect(result.reviewEvidence?.identityEvidence).toBe("result_title_semantic_match");
    expect(mapper).toHaveBeenCalledTimes(1);
  });

  it("uses title identity evidence when provider product ID metadata is unavailable", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const matcher = vi.fn(() => ({
      identityDecision: "match",
      confidence: "high",
      score: 90,
      reasons: ["match_brand_model"],
    }));
    const args = validArgs.filter((arg) => !arg.startsWith("--provider-product-id="));
    const { options } = liveOptions([
      response(taskGetPayload({
        result: [reviewsResult([reviewItem()], {
          product_id: undefined,
          product_title: CONTROLLED_DETAILED_REVIEW_RETRIEVAL_HARNESS.productTitle,
        })],
      })),
    ], { mapper, matcher });

    const result = await runLiveValidation(args, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.reviewsValidated);
    expect(result.reviewEvidence?.identityEvidence).toBe("result_title_semantic_match");
    expect(matcher).toHaveBeenCalledTimes(2);
    expect(mapper).toHaveBeenCalledTimes(1);
  });

  it("returns identity_inconclusive when response title metadata conflicts with the canonical product", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const matcher = vi.fn(({ title }: { title: string }) => title.includes("Venu 4")
      ? {
          identityDecision: "match",
          confidence: "high",
          score: 90,
          reasons: ["match_brand_model"],
        }
      : {
          identityDecision: "reject",
          confidence: "rejected",
          score: 0,
          reasons: ["model_mismatch"],
        });
    const args = validArgs.filter((arg) => !arg.startsWith("--provider-product-id="));
    const { options } = liveOptions([
      response(taskGetPayload({
        result: [reviewsResult([reviewItem()], {
          product_id: undefined,
          product_title: "Garmin Venu 3 GPS Smartwatch",
        })],
      })),
    ], { mapper, matcher });

    const result = await runLiveValidation(args, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.identityInconclusive);
    expect(result.reason).toBe("result_title_semantic_mismatch");
    expect(mapper).not.toHaveBeenCalled();
  });

  it("returns identity_inconclusive when response title metadata looks like an accessory", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const matcher = vi.fn(({ title }: { title: string }) => title.includes("Charging Cable")
      ? {
          identityDecision: "needs_identity",
          confidence: "low",
          score: 25,
          reasons: ["accessory_contamination"],
        }
      : {
          identityDecision: "match",
          confidence: "high",
          score: 90,
          reasons: ["match_brand_model"],
        });
    const args = validArgs.filter((arg) => !arg.startsWith("--provider-product-id="));
    const { options } = liveOptions([
      response(taskGetPayload({
        result: [reviewsResult([reviewItem()], {
          product_id: undefined,
          product_title: "Garmin Venu 4 Charging Cable",
        })],
      })),
    ], { mapper, matcher });

    const result = await runLiveValidation(args, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.identityInconclusive);
    expect(result.reason).toBe("result_title_semantic_mismatch");
    expect(mapper).not.toHaveBeenCalled();
  });

  it("does not let product-B response metadata validate product-A reviews", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const matcher = vi.fn(({ title }: { title: string }) => title.includes("Garmin Venu 4")
      ? {
          identityDecision: "match",
          confidence: "high",
          score: 90,
          reasons: ["match_brand_model"],
        }
      : {
          identityDecision: "needs_identity",
          confidence: "low",
          score: 20,
          reasons: ["brand_model_mismatch"],
        });
    const args = validArgs.filter((arg) => !arg.startsWith("--provider-product-id="));
    const { options } = liveOptions([
      response(taskGetPayload({
        result: [reviewsResult([reviewItem()], {
          product_id: undefined,
          product_title: "Samsung Galaxy Ring Smart Ring",
        })],
      })),
    ], { mapper, matcher });

    const result = await runLiveValidation(args, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.identityInconclusive);
    expect(result.reason).toBe("result_title_semantic_mismatch");
    expect(mapper).not.toHaveBeenCalled();
  });

  it("fails closed when completed reviews lack usable product identity metadata", async () => {
    const mapper = vi.fn(() => defaultMapperObservation());
    const args = validArgs.filter((arg) => !arg.startsWith("--provider-product-id="));
    const { options } = liveOptions([
      response(taskGetPayload({
        result: [reviewsResult([reviewItem()], { product_id: undefined })],
      })),
    ], { mapper });

    const result = await runLiveValidation(args, options);

    expect(result.finalState).toBe(DETAILED_REVIEW_RETRIEVAL_STATES.identityInconclusive);
    expect(result.reason).toBe("missing_result_product_identity_metadata");
    expect(mapper).not.toHaveBeenCalled();
  });

  it("scopes mapper input to exactly one validated task", () => {
    expect(taskScopedDetailedReviewsTaskGetResponse({
      status_code: 20000,
      status_message: "Ok.",
      tasks: [
        { id: unrelatedTaskId, status_code: 20000, result: [reviewsResult([], { product_id: "other" })] },
        { id: taskId, status_code: 20000, result: [reviewsResult()] },
      ],
    }, taskId)).toMatchObject({
      tasks: [
        {
          id: taskId,
          result: [
            {
              product_id: providerProductId,
            },
          ],
        },
      ],
    });
  });

  it("supports dry-run without network or env access", async () => {
    const result = await runDryRun([...validArgs, "--dry-run"]);

    expect(result).toMatchObject({
      ok: true,
      mode: "dry-run",
      providerNetworkCallsMade: 0,
      dryRunHttpRequests: 0,
      detailedReviewTaskPostCalls: 0,
      aggregateCalls: 0,
      fallbackCalls: 0,
      persistenceWrites: 0,
    });
  });

  it("keeps tests and production harness free of historical live task IDs", () => {
    const source = `${scriptSource()}\n${readFileSync(new URL("./detailedReviewRetrievalHarness.test.ts", import.meta.url), "utf8")}`;

    expect(source).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
    expect(source).not.toMatch(/\b\d{12,}\b/);
    expect(source).not.toMatch(/Brands\s*Mart/i);
  });

  it("keeps sanitized output free of credentials and raw provider bodies", async () => {
    const { options } = liveOptions([response(taskGetPayload())]);

    const result = await runLiveValidation(validArgs, options);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("synthetic-login");
    expect(serialized).not.toContain("synthetic-password");
    expect(serialized).not.toMatch(/Authorization|Basic\s+[A-Za-z0-9+/=]+/i);
    expect(serialized).not.toContain("raw");
  });
});
