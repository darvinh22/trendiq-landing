import { describe, expect, it } from "vitest";
import {
  APPROVED_DATAFORSEO_ORIGIN,
  CONTROLLED_REVIEW_HARNESS,
  PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX,
  PRODUCTS_TASK_POST_PATH,
  REVIEWS_TASK_PATH_FRAGMENT,
  buildGarminRequestPayload,
  classifyProductsTaskGetState,
  createGuardedFetch,
  createPersistenceTrap,
  runDryRun,
  runLiveValidation,
  validateApprovedDataForSeoBaseUrl,
  validateCliGuards,
} from "../../../../../../scripts/reviews-aggregate-live-validation.mjs";

const validArgs = [
  "--confirm-live",
  `--run-token=${CONTROLLED_REVIEW_HARNESS.runToken}`,
  `--product=${CONTROLLED_REVIEW_HARNESS.product}`,
  "--aggregate-only",
  `--max-logical-tasks=${CONTROLLED_REVIEW_HARNESS.maxLogicalTasks}`,
  `--max-task-post=${CONTROLLED_REVIEW_HARNESS.maxTaskPostCalls}`,
  `--task-poll-attempts=${CONTROLLED_REVIEW_HARNESS.taskPollAttempts}`,
  `--task-poll-interval-ms=${CONTROLLED_REVIEW_HARNESS.taskPollIntervalMs}`,
  `--depth=${CONTROLLED_REVIEW_HARNESS.depth}`,
  "--no-detailed-reviews",
  "--no-identity-discovery",
  "--no-fallback",
  "--no-persistence",
];

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

function nativeJsonResponse(payload: unknown, options: { status?: number; statusText?: string } = {}) {
  return new Response(JSON.stringify(payload), {
    status: options.status ?? 200,
    statusText: options.statusText ?? "OK",
    headers: {
      "content-type": "application/json",
    },
  });
}

function malformedJsonResponse(secret = "DATAFORSEO_PASSWORD=secret") {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      throw new Error(`malformed provider JSON: ${secret}`);
    },
    async text() {
      return secret;
    },
  };
}

function httpErrorResponse(secret = "DATAFORSEO_PASSWORD=secret") {
  return {
    ok: false,
    status: 502,
    statusText: "Bad Gateway",
    async json() {
      return { status_message: secret };
    },
    async text() {
      return secret;
    },
  };
}

function taskPostResponse(taskId = "controlled-task-id", taskOverrides: Record<string, unknown> = {}) {
  return response({
    status_code: 20000,
    status_message: "Ok.",
    tasks: [
      {
        id: taskId,
        status_code: 20100,
        status_message: "Task Created.",
        ...taskOverrides,
      },
    ],
  });
}

function taskPostResponseWithoutTaskId() {
  return response({
    status_code: 20000,
    status_message: "Ok.",
    tasks: [
      {
        status_code: 20100,
        status_message: "Task Created.",
      },
    ],
  });
}

function aggregateProductItem(overrides: Record<string, unknown> = {}) {
  return {
    type: "google_shopping_serp",
    rank_group: 1,
    rank_absolute: 1,
    title: "Garmin Venu 4 GPS Smartwatch",
    seller: "Garmin",
    product_id: "candidate-product-id",
    data_docid: "candidate-data-docid",
    gid: "candidate-gid",
    product_rating: {
      value: 4.6,
      rating_max: 5,
      votes_count: 120,
    },
    ...overrides,
  };
}

function productsPayload(items: unknown[] = [aggregateProductItem()], taskOverrides: Record<string, unknown> = {}) {
  return {
    status_code: 20000,
    status_message: "Ok.",
    tasks: [
      {
        id: "controlled-task-id",
        status_code: 20000,
        status_message: "Ok.",
        cost: 0.0123,
        result: [
          {
            datetime: "2026-08-28 00:00:00 +00:00",
            items,
          },
        ],
        ...taskOverrides,
      },
    ],
  };
}

function productsResponse(items: unknown[] = [aggregateProductItem()], taskOverrides: Record<string, unknown> = {}) {
  return response(productsPayload(items, taskOverrides));
}

function pendingTaskGetResponse(cost?: number) {
  return response({
    status_code: 20000,
    status_message: "Ok.",
    tasks: [
      {
        id: "controlled-task-id",
        status_code: 20100,
        status_message: "Task In Queue",
        ...(cost === undefined ? {} : { cost }),
      },
    ],
  });
}

function providerErrorTaskGetResponse() {
  return response({
    status_code: 20000,
    status_message: "Ok.",
    tasks: [
      {
        id: "controlled-task-id",
        status_code: 50000,
        status_message: "Internal error.",
        cost: 0.045,
      },
    ],
  });
}

function malformedTasksResponse() {
  return response({
    status_code: 20000,
    status_message: "Ok.",
  });
}

function nativeTaskPostResponse(taskId = "controlled-task-id", taskOverrides: Record<string, unknown> = {}) {
  return nativeJsonResponse({
    status_code: 20000,
    status_message: "Ok.",
    tasks: [
      {
        id: taskId,
        status_code: 20100,
        status_message: "Task Created.",
        ...taskOverrides,
      },
    ],
  });
}

function nativeProductsResponse(items: unknown[] = [aggregateProductItem()], taskOverrides: Record<string, unknown> = {}) {
  return nativeJsonResponse(productsPayload(items, taskOverrides));
}

function nativePendingTaskGetResponse(cost?: number) {
  return nativeJsonResponse({
    status_code: 20000,
    status_message: "Ok.",
    tasks: [
      {
        id: "controlled-task-id",
        status_code: 20100,
        status_message: "Task In Queue",
        ...(cost === undefined ? {} : { cost }),
      },
    ],
  });
}

function nativeProviderErrorTaskGetResponse() {
  return nativeJsonResponse({
    status_code: 20000,
    status_message: "Ok.",
    tasks: [
      {
        id: "controlled-task-id",
        status_code: 50000,
        status_message: "Internal error.",
        cost: 0.045,
      },
    ],
  });
}

function nativeMalformedTasksResponse() {
  return nativeJsonResponse({
    status_code: 20000,
    status_message: "Ok.",
  });
}

function readyTaskGetTask(
  id = "controlled-task-id",
  items: unknown[] = [aggregateProductItem()],
  taskOverrides: Record<string, unknown> = {}
) {
  return {
    id,
    status_code: 20000,
    status_message: "Ok.",
    cost: 0.0123,
    result: [
      {
        datetime: "2026-08-28 00:00:00 +00:00",
        items,
      },
    ],
    ...taskOverrides,
  };
}

function pendingTaskGetTask(id = "controlled-task-id", taskOverrides: Record<string, unknown> = {}) {
  return {
    id,
    status_code: 20100,
    status_message: "Task In Queue",
    ...taskOverrides,
  };
}

function errorTaskGetTask(id = "controlled-task-id", taskOverrides: Record<string, unknown> = {}) {
  return {
    id,
    status_code: 50000,
    status_message: "Internal error.",
    ...taskOverrides,
  };
}

function nativeTaskGetTasksResponse(tasks: unknown[]) {
  return nativeJsonResponse({
    status_code: 20000,
    status_message: "Ok.",
    tasks,
  });
}

function liveOptions(overrides: Record<string, unknown> = {}) {
  return {
    env: {
      DATAFORSEO_LOGIN: "login",
      DATAFORSEO_PASSWORD: "password",
      DATAFORSEO_API_BASE_URL: APPROVED_DATAFORSEO_ORIGIN,
    },
    loadModules: async () => ({
      mapDataForSeoGoogleShoppingProductsResponse: () => ({
        provider: "dataforseo",
        productId: CONTROLLED_REVIEW_HARNESS.productId,
        searchQuery: "Garmin Venu 4",
        locationCode: 2840,
        languageCode: "en",
        fetchedAt: "2026-08-28T00:00:00.000Z",
        endpoint: PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX,
        matchedProductTitle: "Garmin Venu 4 GPS Smartwatch",
        seller: "Garmin",
        identifiers: {
          productId: "candidate-product-id",
          dataDocid: "candidate-data-docid",
          gid: "candidate-gid",
        },
        averageRating: 4.6,
        matchConfidence: "high",
        matchScore: 90,
        matchReasons: ["match_brand_model"],
        providerVariantGrouping: "google_shopping_product_result_may_group_frame_and_lens_variants",
        cost: 0.0123,
      }),
    }),
    now: () => new Date("2026-08-28T00:00:00.000Z"),
    ...overrides,
  };
}

async function expectSanitizedRejection(promise: Promise<unknown>, secret = "DATAFORSEO_PASSWORD=secret") {
  try {
    await promise;
    throw new Error("Expected promise to reject.");
  } catch (error) {
    const serialized = JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      details: (error as { details?: unknown }).details,
    });
    expect(serialized).not.toContain(secret);
  }
}

async function captureHarnessRejection(promise: Promise<unknown>) {
  try {
    await promise;
    throw new Error("Expected promise to reject.");
  } catch (error) {
    if (error instanceof Error && error.message === "Expected promise to reject.") throw error;

    return error as { message?: string; details?: Record<string, unknown> };
  }
}

async function duplicateMatchingTaskRejection(tasks: unknown[], postOverrides: Record<string, unknown> = {}) {
  let mapperCalls = 0;
  const error = await captureHarnessRejection(runLiveValidation(validArgs, liveOptions({
    fetchImpl: async (_url, init) =>
      init?.method === "POST"
        ? nativeTaskPostResponse("controlled-task-id", postOverrides)
        : nativeTaskGetTasksResponse(tasks),
    loadModules: async () => ({
      mapDataForSeoGoogleShoppingProductsResponse: () => {
        mapperCalls += 1;
        throw new Error("mapper should not run for duplicate matching task ids");
      },
    }),
  })));

  return { error, mapperCalls };
}

function expectDuplicateMatchingTaskFailure(
  error: { details?: Record<string, unknown> },
  expectedTaskCost: number | null = null,
  expectedObservationCost: number | null = null
) {
  expect(error.details?.finalState).toBe("malformed_response");
  expect(error.details?.reason).toBe("duplicate_matching_task_ids");
  expect(error.details?.taskGetAttempts).toEqual([
    expect.objectContaining({
      taskId: "controlled-task-id",
      taskStatusCode: null,
      taskCost: null,
      readinessState: "malformed_response",
      reason: "duplicate_matching_task_ids",
    }),
  ]);
  expect(error.details?.cost).toEqual({
    taskCost: expectedTaskCost,
    observationCost: expectedObservationCost,
    sourceCostCompatibleValue: expectedTaskCost,
  });
  expect(error.details?.counters).toEqual({
    logicalTasksCreated: 1,
    taskPostCalls: 1,
    taskGetCalls: 1,
    totalHttpRequests: 2,
  });
}

async function runCandidateCostCase(input: { postCost?: unknown; getCost?: unknown }) {
  let mapperCalls = 0;
  const result = await runLiveValidation(validArgs, liveOptions({
    fetchImpl: async (_url, init) =>
      init?.method === "POST"
        ? taskPostResponse("controlled-task-id", { cost: input.postCost })
        : productsResponse([aggregateProductItem()], { cost: input.getCost }),
    loadModules: async () => ({
      mapDataForSeoGoogleShoppingProductsResponse: ({ response }: { response: { tasks?: Array<{ cost?: number }> } }) => {
        mapperCalls += 1;

        return {
          provider: "dataforseo",
          productId: CONTROLLED_REVIEW_HARNESS.productId,
          searchQuery: "Garmin Venu 4",
          locationCode: 2840,
          languageCode: "en",
          fetchedAt: "2026-08-28T00:00:00.000Z",
          endpoint: PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX,
          matchedProductTitle: "Garmin Venu 4 GPS Smartwatch",
          seller: "Garmin",
          identifiers: {},
          averageRating: 4.6,
          matchConfidence: "high",
          matchScore: 90,
          matchReasons: ["match_brand_model"],
          providerVariantGrouping: "google_shopping_product_result_may_group_frame_and_lens_variants",
          cost: response.tasks?.[0]?.cost,
        };
      },
    }),
  }));

  expect(mapperCalls).toBe(1);
  return result;
}

describe("controlled aggregate live reviews harness", () => {
  it("accepts the exact guarded CLI shape", () => {
    expect(validateCliGuards(validArgs)).toMatchObject({
      dryRun: false,
      product: "Garmin Venu 4",
      runToken: "phase-3u-2a-2-garmin-venu-4-aggregate-only",
      maxLogicalTasks: 1,
      maxTaskPostCalls: 1,
      taskPollAttempts: 3,
      depth: 10,
    });
  });

  it("fails before network when --confirm-live is missing", () => {
    expect(() => validateCliGuards(validArgs.filter((arg) => arg !== "--confirm-live")))
      .toThrow(/CLI guard failed/);
  });

  it("fails before network when an extra flag is present", () => {
    expect(() => validateCliGuards([...validArgs, "--extra-provider-call"]))
      .toThrow(/CLI guard failed/);
  });

  it("fails before network when product is not exactly Garmin Venu 4", () => {
    expect(() => validateCliGuards(validArgs.map((arg) =>
      arg.startsWith("--product=") ? "--product=Garmin Venu 5" : arg
    ))).toThrow(/CLI guard failed/);
  });

  it("fails before network when max-task-post differs from one", () => {
    expect(() => validateCliGuards(validArgs.map((arg) =>
      arg.startsWith("--max-task-post=") ? "--max-task-post=2" : arg
    ))).toThrow(/CLI guard failed/);
  });

  it("fails before network when poll attempts differ from three", () => {
    expect(() => validateCliGuards(validArgs.map((arg) =>
      arg.startsWith("--task-poll-attempts=") ? "--task-poll-attempts=2" : arg
    ))).toThrow(/CLI guard failed/);
  });

  it("does not let dry-run mode transition to live execution", async () => {
    let fetches = 0;
    let moduleLoads = 0;
    const result = await runLiveValidation(["--dry-run", ...validArgs], {
      env: {},
      fetchImpl: async () => {
        fetches += 1;
        return taskPostResponse();
      },
      loadModules: async () => {
        moduleLoads += 1;
        return {};
      },
    });

    expect(result.providerNetworkCallsMade).toBe(0);
    expect(result.dryRunHttpRequests).toBe(0);
    expect(fetches).toBe(0);
    expect(moduleLoads).toBe(0);
  });

  it("does not let default arguments silently enable network", async () => {
    let fetches = 0;
    let moduleLoads = 0;

    await expect(runLiveValidation([], {
      fetchImpl: async () => {
        fetches += 1;
        return taskPostResponse();
      },
      loadModules: async () => {
        moduleLoads += 1;
        return {};
      },
    })).rejects.toThrow(/CLI guard failed/);

    expect(fetches).toBe(0);
    expect(moduleLoads).toBe(0);
  });

  it("dry-run performs zero fetches", async () => {
    let fetches = 0;
    const result = await runDryRun(["--dry-run", ...validArgs], {
      env: {
        DATAFORSEO_LOGIN: "login",
        DATAFORSEO_PASSWORD: "password",
      },
      fetchImpl: async () => {
        fetches += 1;
        return taskPostResponse();
      },
    });

    expect(result.providerNetworkCallsMade).toBe(0);
    expect(result.dryRunHttpRequests).toBe(0);
    expect(fetches).toBe(0);
  });

  it("allows the exact approved HTTPS origin and task_post path", async () => {
    const calls: string[] = [];
    const guard = createGuardedFetch(async (url) => {
      calls.push(String(url));
      return taskPostResponse();
    });

    const first = await guard.fetch(`${APPROVED_DATAFORSEO_ORIGIN}${PRODUCTS_TASK_POST_PATH}`, {
      method: "POST",
    });
    await first.json();

    expect(calls).toEqual([`${APPROVED_DATAFORSEO_ORIGIN}${PRODUCTS_TASK_POST_PATH}`]);
  });

  it.each([
    `http://api.dataforseo.com${PRODUCTS_TASK_POST_PATH}`,
    `https://evil.example${PRODUCTS_TASK_POST_PATH}`,
    `https://api.dataforseo.com.evil.example${PRODUCTS_TASK_POST_PATH}`,
    `https://api.dataforseo.com:444${PRODUCTS_TASK_POST_PATH}`,
    `https://user:pass@api.dataforseo.com${PRODUCTS_TASK_POST_PATH}`,
    `https://api.dataforseo.com${PRODUCTS_TASK_POST_PATH}?next=https://evil.example`,
  ])("blocks unapproved origin or URL manipulation before network: %s", async (url) => {
    let fetches = 0;
    const guard = createGuardedFetch(async () => {
      fetches += 1;
      return taskPostResponse();
    });

    await expect(guard.fetch(url, { method: "POST" })).rejects.toThrow(/approved DataForSEO origin/);
    expect(fetches).toBe(0);
  });

  it("blocks unapproved DATAFORSEO_API_BASE_URL before loading modules or fetching", async () => {
    let fetches = 0;
    let moduleLoads = 0;

    await expect(runLiveValidation(validArgs, {
      env: {
        DATAFORSEO_LOGIN: "login",
        DATAFORSEO_PASSWORD: "password",
        DATAFORSEO_API_BASE_URL: `https://evil.example`,
      },
      fetchImpl: async () => {
        fetches += 1;
        return taskPostResponse();
      },
      loadModules: async () => {
        moduleLoads += 1;
        return {};
      },
    })).rejects.toThrow(/unapproved DataForSEO API base URL/);

    expect(fetches).toBe(0);
    expect(moduleLoads).toBe(0);
    expect(validateApprovedDataForSeoBaseUrl(`${APPROVED_DATAFORSEO_ORIGIN}/`))
      .toBe(APPROVED_DATAFORSEO_ORIGIN);
  });

  it("passes redirect:error on both POST and GET fetch calls", async () => {
    const redirects: Array<unknown> = [];

    await runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (url, init) => {
        redirects.push(init?.redirect);
        return init?.method === "POST" ? taskPostResponse() : productsResponse();
      },
    }));

    expect(redirects).toEqual(["error", "error"]);
  });

  it("blocks a second task_post before network", async () => {
    const calls: string[] = [];
    const guard = createGuardedFetch(async (url) => {
      calls.push(String(url));
      return taskPostResponse();
    });

    const first = await guard.fetch(`https://api.dataforseo.com${PRODUCTS_TASK_POST_PATH}`, { method: "POST" });
    await first.json();

    await expect(guard.fetch(`https://api.dataforseo.com${PRODUCTS_TASK_POST_PATH}`, { method: "POST" }))
      .rejects.toThrow(/second DataForSEO task_post/);
    expect(calls).toHaveLength(1);
  });

  it("blocks detailed reviews URLs before network", async () => {
    const guard = createGuardedFetch(async () => taskPostResponse());

    await expect(guard.fetch(`https://api.dataforseo.com${REVIEWS_TASK_PATH_FRAGMENT}task_post`, { method: "POST" }))
      .rejects.toThrow(/detailed reviews request/);
  });

  it("blocks wrong HTTP methods before network", async () => {
    let fetches = 0;
    const guard = createGuardedFetch(async () => {
      fetches += 1;
      return taskPostResponse();
    });

    await expect(guard.fetch(`${APPROVED_DATAFORSEO_ORIGIN}${PRODUCTS_TASK_POST_PATH}`, { method: "GET" }))
      .rejects.toThrow(/unexpected provider request/);
    expect(fetches).toBe(0);
  });

  it("blocks unexpected pathnames before network", async () => {
    let fetches = 0;
    const guard = createGuardedFetch(async () => {
      fetches += 1;
      return taskPostResponse();
    });

    await expect(guard.fetch(`${APPROVED_DATAFORSEO_ORIGIN}/v3/merchant/google/products/task_post_extra`, {
      method: "POST",
    })).rejects.toThrow(/unexpected provider request/);
    expect(fetches).toBe(0);
  });

  it("blocks task_get with an unexpected task id before network", async () => {
    const calls: string[] = [];
    const guard = createGuardedFetch(async (url) => {
      calls.push(String(url));
      return taskPostResponse("expected-task-id");
    });

    const first = await guard.fetch(`https://api.dataforseo.com${PRODUCTS_TASK_POST_PATH}`, { method: "POST" });
    await first.json();

    await expect(
      guard.fetch(`https://api.dataforseo.com${PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX}/wrong-task-id`, {
        method: "GET",
      })
    ).rejects.toThrow(/unexpected DataForSEO task id/);
    expect(calls).toHaveLength(1);
  });

  it("blocks the fourth task_get and fifth total HTTP request before network", async () => {
    const calls: string[] = [];
    const guard = createGuardedFetch(async (url) => {
      calls.push(String(url));
      return taskPostResponse();
    });

    const first = await guard.fetch(`${APPROVED_DATAFORSEO_ORIGIN}${PRODUCTS_TASK_POST_PATH}`, { method: "POST" });
    await first.json();

    for (let index = 0; index < 3; index += 1) {
      await guard.fetch(`${APPROVED_DATAFORSEO_ORIGIN}${PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX}/controlled-task-id`, {
        method: "GET",
      });
    }

    await expect(
      guard.fetch(`${APPROVED_DATAFORSEO_ORIGIN}${PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX}/controlled-task-id`, {
        method: "GET",
      })
    ).rejects.toThrow(/bounded polling attempts were exhausted/);
    expect(calls).toHaveLength(4);
  });

  it.each([
    "",
    "task/id",
    "task\\id",
    "task?id",
    "task#id",
    "task%id",
    "task id",
    "task\nid",
    "../task",
    "a".repeat(129),
  ])("rejects unsafe task ids before any GET: %j", async (taskId) => {
    const calls: string[] = [];
    const guard = createGuardedFetch(async (url) => {
      calls.push(String(url));
      return taskPostResponse(taskId);
    });

    const first = await guard.fetch(`${APPROVED_DATAFORSEO_ORIGIN}${PRODUCTS_TASK_POST_PATH}`, { method: "POST" });

    await expect(first.json()).rejects.toThrow(/safe task id/);
    expect(calls).toHaveLength(1);
  });

  it("rejects missing task ids before any GET", async () => {
    const calls: string[] = [];
    const guard = createGuardedFetch(async (url) => {
      calls.push(String(url));
      return taskPostResponseWithoutTaskId();
    });

    const first = await guard.fetch(`${APPROVED_DATAFORSEO_ORIGIN}${PRODUCTS_TASK_POST_PATH}`, { method: "POST" });

    await expect(first.json()).rejects.toThrow(/safe task id/);
    expect(calls).toHaveLength(1);
  });

  it("stops after POST HTTP error without GET and without raw body leakage", async () => {
    const calls: Array<{ method?: string }> = [];

    await expectSanitizedRejection(runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) => {
        calls.push({ method: init?.method });
        return httpErrorResponse();
      },
    })));

    expect(calls).toEqual([{ method: "POST" }]);
  });

  it("stops after POST malformed JSON without GET and without raw body leakage", async () => {
    const calls: Array<{ method?: string }> = [];

    await expectSanitizedRejection(runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) => {
        calls.push({ method: init?.method });
        return malformedJsonResponse();
      },
    })));

    expect(calls).toEqual([{ method: "POST" }]);
  });

  it("stops after POST without a valid task id and does not poll", async () => {
    const calls: Array<{ method?: string }> = [];

    await expect(runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) => {
        calls.push({ method: init?.method });
        return taskPostResponseWithoutTaskId();
      },
    }))).rejects.toThrow(/safe task id/);

    expect(calls).toEqual([{ method: "POST" }]);
  });

  it("stops after GET HTTP error without an additional GET or raw body leakage", async () => {
    const calls: Array<{ method?: string }> = [];

    const error = await captureHarnessRejection(runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) => {
        calls.push({ method: init?.method });
        return init?.method === "POST" ? taskPostResponse() : httpErrorResponse();
      },
    })));
    const serialized = JSON.stringify({ message: error.message, details: error.details });

    expect(serialized).not.toContain("DATAFORSEO_PASSWORD=secret");
    expect(error.details?.finalState).toBe("provider_error");
    expect(error.details?.reason).toBe("task_get_http_error");
    expect(error.details?.taskGetAttempts).toEqual([
      expect.objectContaining({ attempt: 1, readinessState: "provider_error" }),
    ]);
    expect(calls).toEqual([{ method: "POST" }, { method: "GET" }]);
  });

  it("stops after GET malformed JSON without an additional GET or raw body leakage", async () => {
    const calls: Array<{ method?: string }> = [];

    const error = await captureHarnessRejection(runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) => {
        calls.push({ method: init?.method });
        return init?.method === "POST" ? taskPostResponse() : malformedJsonResponse();
      },
    })));
    const serialized = JSON.stringify({ message: error.message, details: error.details });

    expect(serialized).not.toContain("DATAFORSEO_PASSWORD=secret");
    expect(error.details?.finalState).toBe("malformed_response");
    expect(error.details?.reason).toBe("task_get_json_parse_failed");
    expect(error.details?.taskGetAttempts).toEqual([
      expect.objectContaining({ attempt: 1, readinessState: "malformed_response" }),
    ]);
    expect(calls).toEqual([{ method: "POST" }, { method: "GET" }]);
  });

  it.each([
    [40601, "Task Handed."],
    [40602, "Task In Queue."],
  ])("classifies DataForSEO queue status %i as provider_pending", (statusCode, statusMessage) => {
    expect(classifyProductsTaskGetState({
      response: {
        status_code: 20000,
        status_message: "Ok.",
        tasks: [pendingTaskGetTask("controlled-task-id", {
          status_code: statusCode,
          status_message: statusMessage,
          cost: 0,
        })],
      },
      expectedTaskId: "controlled-task-id",
      attempt: 1,
    })).toEqual(expect.objectContaining({
      readinessState: "provider_pending",
      reason: "task_status_code_pending",
      taskStatusCode: statusCode,
      taskStatusMessage: statusMessage,
      taskCost: 0,
    }));
  });

  it("polls from 40602 queue state to completed products before selecting a candidate", async () => {
    const calls: Array<{ method?: string }> = [];
    const getResponses = [
      nativeTaskGetTasksResponse([
        pendingTaskGetTask("controlled-task-id", {
          status_code: 40602,
          status_message: "Task In Queue.",
          cost: 0,
        }),
      ]),
      nativeTaskGetTasksResponse([
        readyTaskGetTask("controlled-task-id", [aggregateProductItem()], { cost: 0.034 }),
      ]),
    ];
    let mapperCalls = 0;

    const result = await runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) => {
        calls.push({ method: init?.method });
        return init?.method === "POST"
          ? nativeTaskPostResponse("controlled-task-id", { cost: 0.019 })
          : getResponses.shift();
      },
      loadModules: async () => ({
        mapDataForSeoGoogleShoppingProductsResponse: ({ response }: { response: { tasks?: Array<{ cost?: number }> } }) => {
          mapperCalls += 1;

          return {
            provider: "dataforseo",
            productId: CONTROLLED_REVIEW_HARNESS.productId,
            searchQuery: "Garmin Venu 4",
            locationCode: 2840,
            languageCode: "en",
            fetchedAt: "2026-08-28T00:00:00.000Z",
            endpoint: PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX,
            matchedProductTitle: "Garmin Venu 4 GPS Smartwatch",
            seller: "Garmin",
            identifiers: {},
            averageRating: 4.6,
            matchConfidence: "high",
            matchScore: 90,
            matchReasons: ["match_brand_model"],
            providerVariantGrouping: "google_shopping_product_result_may_group_frame_and_lens_variants",
            cost: response.tasks?.[0]?.cost,
          };
        },
      }),
    }));

    expect(calls).toEqual([{ method: "POST" }, { method: "GET" }, { method: "GET" }]);
    expect(result.finalState).toBe("candidate_selected");
    expect(result.taskGetAttempts).toEqual([
      expect.objectContaining({ attempt: 1, readinessState: "provider_pending", taskStatusCode: 40602, taskCost: 0 }),
      expect.objectContaining({ attempt: 2, readinessState: "ready_for_identity", taskStatusCode: 20000, taskCost: 0.034 }),
    ]);
    expect(result.cost).toEqual({
      taskCost: 0.019,
      observationCost: 0.034,
      sourceCostCompatibleValue: 0.019,
    });
    expect(mapperCalls).toBe(1);
  });

  it("keeps 40602 pending for all three polls without mapper, second POST, or erased POST cost", async () => {
    const calls: Array<{ method?: string }> = [];
    let mapperCalls = 0;

    const error = await captureHarnessRejection(runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) => {
        calls.push({ method: init?.method });
        return init?.method === "POST"
          ? nativeTaskPostResponse("controlled-task-id", { cost: 0.019 })
          : nativeTaskGetTasksResponse([
            pendingTaskGetTask("controlled-task-id", {
              status_code: 40602,
              status_message: "Task In Queue.",
              cost: 0,
            }),
          ]);
      },
      loadModules: async () => ({
        mapDataForSeoGoogleShoppingProductsResponse: () => {
          mapperCalls += 1;
          throw new Error("mapper should not run while DataForSEO task is queued");
        },
      }),
    })));

    expect(error.details?.finalState).toBe("provider_pending");
    expect(error.details?.reason).toBe("bounded_polling_exhausted");
    expect(error.details?.taskGetAttempts).toEqual([
      expect.objectContaining({ attempt: 1, readinessState: "provider_pending", taskStatusCode: 40602, taskCost: 0 }),
      expect.objectContaining({ attempt: 2, readinessState: "provider_pending", taskStatusCode: 40602, taskCost: 0 }),
      expect.objectContaining({ attempt: 3, readinessState: "provider_pending", taskStatusCode: 40602, taskCost: 0 }),
    ]);
    expect(error.details?.cost).toEqual({
      taskCost: 0.019,
      observationCost: 0,
      sourceCostCompatibleValue: 0.019,
    });
    expect(error.details?.counters).toEqual({
      logicalTasksCreated: 1,
      taskPostCalls: 1,
      taskGetCalls: 3,
      totalHttpRequests: 4,
    });
    expect(calls).toEqual([{ method: "POST" }, { method: "GET" }, { method: "GET" }, { method: "GET" }]);
    expect(mapperCalls).toBe(0);
  });

  it.each([
    [40000, "Invalid request."],
    [40400, "Task not found."],
    [50000, "Internal error."],
  ])("classifies known terminal task error %i as provider_error", (statusCode, statusMessage) => {
    expect(classifyProductsTaskGetState({
      response: {
        status_code: 20000,
        status_message: "Ok.",
        tasks: [errorTaskGetTask("controlled-task-id", {
          status_code: statusCode,
          status_message: statusMessage,
          cost: 0.045,
        })],
      },
      expectedTaskId: "controlled-task-id",
      attempt: 1,
    })).toEqual(expect.objectContaining({
      readinessState: "provider_error",
      reason: "task_status_code_provider_error",
      taskStatusCode: statusCode,
      taskStatusMessage: statusMessage,
      taskCost: 0.045,
    }));
  });

  it.each([
    [undefined, "task_status_code_missing_or_invalid"],
    ["40602", "task_status_code_missing_or_invalid"],
    [40603, "task_status_code_unclassified"],
  ])("fails safely for malformed or unclassified task status %j", (statusCode, reason) => {
    const task = {
      id: "controlled-task-id",
      status_message: "Unexpected status.",
      ...(statusCode === undefined ? {} : { status_code: statusCode }),
    };

    expect(classifyProductsTaskGetState({
      response: {
        status_code: 20000,
        status_message: "Ok.",
        tasks: [task],
      },
      expectedTaskId: "controlled-task-id",
      attempt: 1,
    })).toEqual(expect.objectContaining({
      readinessState: "malformed_response",
      reason,
      taskCost: null,
    }));
  });

  it("represents task_get zero cost on the poll without erasing trusted POST cost", async () => {
    const result = await runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) =>
        init?.method === "POST"
          ? nativeTaskPostResponse("controlled-task-id", { cost: 0.019 })
          : nativeProductsResponse([aggregateProductItem()], { cost: 0 }),
      loadModules: async () => ({
        mapDataForSeoGoogleShoppingProductsResponse: ({ response }: { response: { tasks?: Array<{ cost?: number }> } }) => ({
          provider: "dataforseo",
          productId: CONTROLLED_REVIEW_HARNESS.productId,
          searchQuery: "Garmin Venu 4",
          locationCode: 2840,
          languageCode: "en",
          fetchedAt: "2026-08-28T00:00:00.000Z",
          endpoint: PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX,
          matchedProductTitle: "Garmin Venu 4 GPS Smartwatch",
          seller: "Garmin",
          identifiers: {},
          averageRating: 4.6,
          matchConfidence: "high",
          matchScore: 90,
          matchReasons: ["match_brand_model"],
          providerVariantGrouping: "google_shopping_product_result_may_group_frame_and_lens_variants",
          cost: response.tasks?.[0]?.cost,
        }),
      }),
    }));

    expect(result.taskGetAttempts).toEqual([
      expect.objectContaining({ readinessState: "ready_for_identity", taskCost: 0 }),
    ]);
    expect(result.cost).toEqual({
      taskCost: 0.019,
      observationCost: 0,
      sourceCostCompatibleValue: 0.019,
    });
    expect(result.result.cost).toEqual({
      taskCost: 0.019,
      observationCost: 0,
      sourceCostCompatibleValue: 0.019,
    });
  });

  it.each([
    [
      "POST 0.019 + GET 0",
      0.019,
      0,
      { taskCost: 0.019, observationCost: 0, sourceCostCompatibleValue: 0.019 },
    ],
    [
      "POST null + GET 0",
      undefined,
      0,
      { taskCost: null, observationCost: 0, sourceCostCompatibleValue: null },
    ],
    [
      "POST 0.019 + GET 0.034",
      0.019,
      0.034,
      { taskCost: 0.019, observationCost: 0.034, sourceCostCompatibleValue: 0.019 },
    ],
    [
      "POST 0 + GET null",
      0,
      undefined,
      { taskCost: 0, observationCost: null, sourceCostCompatibleValue: 0 },
    ],
    [
      "POST null + GET null",
      undefined,
      undefined,
      { taskCost: null, observationCost: null, sourceCostCompatibleValue: null },
    ],
    [
      "POST null + GET nonzero",
      undefined,
      0.034,
      { taskCost: null, observationCost: 0.034, sourceCostCompatibleValue: null },
    ],
    [
      "POST non-finite + GET 0",
      Number.NaN,
      0,
      { taskCost: null, observationCost: 0, sourceCostCompatibleValue: null },
    ],
  ])("preserves separate cost provenance for %s", async (_name, postCost, getCost, expectedCost) => {
    const result = await runCandidateCostCase({ postCost, getCost });
    const expectedAttemptCost = typeof getCost === "number" && Number.isFinite(getCost) ? getCost : null;

    expect(result.taskGetAttempts).toEqual([
      expect.objectContaining({ readinessState: "ready_for_identity", taskCost: expectedAttemptCost }),
    ]);
    expect(result.cost).toEqual(expectedCost);
    expect(result.result.cost).toEqual(expectedCost);
  });

  it("stops cleanly after all three GET polls remain pending and never creates a second task", async () => {
    const calls: Array<{ url: string; method?: string; redirect?: unknown }> = [];
    let mapperCalls = 0;

    const error = await captureHarnessRejection(runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), method: init?.method, redirect: init?.redirect });
        return init?.method === "POST" ? nativeTaskPostResponse() : nativePendingTaskGetResponse(0.031);
      },
      loadModules: async () => ({
        mapDataForSeoGoogleShoppingProductsResponse: () => {
          mapperCalls += 1;
          throw new Error("mapper should not run while provider is pending");
        },
      }),
    })));

    expect(error.message).toMatch(/provider_pending/);
    expect(error.details?.finalState).toBe("provider_pending");
    expect(error.details?.reason).toBe("bounded_polling_exhausted");
    expect(error.details?.cost).toEqual({
      taskCost: null,
      observationCost: 0.031,
      sourceCostCompatibleValue: null,
    });
    expect(error.details?.taskGetAttempts).toEqual([
      expect.objectContaining({ attempt: 1, readinessState: "provider_pending", taskCost: 0.031 }),
      expect.objectContaining({ attempt: 2, readinessState: "provider_pending", taskCost: 0.031 }),
      expect.objectContaining({ attempt: 3, readinessState: "provider_pending", taskCost: 0.031 }),
    ]);
    expect(calls).toEqual([
      {
        url: `${APPROVED_DATAFORSEO_ORIGIN}${PRODUCTS_TASK_POST_PATH}`,
        method: "POST",
        redirect: "error",
      },
      {
        url: `${APPROVED_DATAFORSEO_ORIGIN}${PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX}/controlled-task-id`,
        method: "GET",
        redirect: "error",
      },
      {
        url: `${APPROVED_DATAFORSEO_ORIGIN}${PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX}/controlled-task-id`,
        method: "GET",
        redirect: "error",
      },
      {
        url: `${APPROVED_DATAFORSEO_ORIGIN}${PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX}/controlled-task-id`,
        method: "GET",
        redirect: "error",
      },
    ]);
    expect(error.details?.counters).toEqual({
      logicalTasksCreated: 1,
      taskPostCalls: 1,
      taskGetCalls: 3,
      totalHttpRequests: 4,
    });
    expect(mapperCalls).toBe(0);
  });

  it("polls from pending to completed products before selecting a candidate", async () => {
    const calls: Array<{ url: string; method?: string; redirect?: unknown }> = [];
    const getResponses = [
      nativePendingTaskGetResponse(0.021),
      nativeProductsResponse([aggregateProductItem()], { cost: 0.034 }),
    ];
    let mapperCalls = 0;

    const result = await runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), method: init?.method, redirect: init?.redirect });
        return init?.method === "POST"
          ? nativeTaskPostResponse("controlled-task-id", { cost: 0.011 })
          : getResponses.shift();
      },
      loadModules: async () => ({
        mapDataForSeoGoogleShoppingProductsResponse: ({ response }: { response: { tasks?: Array<{ cost?: number }> } }) => {
          mapperCalls += 1;

          return {
            provider: "dataforseo",
            productId: CONTROLLED_REVIEW_HARNESS.productId,
            searchQuery: "Garmin Venu 4",
            locationCode: 2840,
            languageCode: "en",
            fetchedAt: "2026-08-28T00:00:00.000Z",
            endpoint: PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX,
            matchedProductTitle: "Garmin Venu 4 GPS Smartwatch",
            seller: "Garmin",
            identifiers: {},
            averageRating: 4.6,
            matchConfidence: "high",
            matchScore: 90,
            matchReasons: ["match_brand_model"],
            providerVariantGrouping: "google_shopping_product_result_may_group_frame_and_lens_variants",
            cost: response.tasks?.[0]?.cost,
          };
        },
      }),
    }));

    expect(calls).toEqual([
      {
        url: `${APPROVED_DATAFORSEO_ORIGIN}${PRODUCTS_TASK_POST_PATH}`,
        method: "POST",
        redirect: "error",
      },
      {
        url: `${APPROVED_DATAFORSEO_ORIGIN}${PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX}/controlled-task-id`,
        method: "GET",
        redirect: "error",
      },
      {
        url: `${APPROVED_DATAFORSEO_ORIGIN}${PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX}/controlled-task-id`,
        method: "GET",
        redirect: "error",
      },
    ]);
    expect(result.finalState).toBe("candidate_selected");
    expect(result.taskGetAttempts).toEqual([
      expect.objectContaining({ attempt: 1, readinessState: "provider_pending", taskCost: 0.021 }),
      expect.objectContaining({ attempt: 2, readinessState: "ready_for_identity", resultCount: 1, itemsCount: 1, taskCost: 0.034 }),
    ]);
    expect(result.cost).toEqual({
      taskCost: 0.011,
      observationCost: 0.034,
      sourceCostCompatibleValue: 0.011,
    });
    expect(mapperCalls).toBe(1);
  });

  it("preserves task_post cost when the selected observation has no cost", async () => {
    const result = await runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) =>
        init?.method === "POST"
          ? nativeTaskPostResponse("controlled-task-id", { cost: 0.019 })
          : nativeProductsResponse([aggregateProductItem()], { cost: undefined }),
      loadModules: async () => ({
        mapDataForSeoGoogleShoppingProductsResponse: () => ({
          provider: "dataforseo",
          productId: CONTROLLED_REVIEW_HARNESS.productId,
          searchQuery: "Garmin Venu 4",
          locationCode: 2840,
          languageCode: "en",
          fetchedAt: "2026-08-28T00:00:00.000Z",
          endpoint: PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX,
          matchedProductTitle: "Garmin Venu 4 GPS Smartwatch",
          seller: "Garmin",
          identifiers: {},
          averageRating: 4.6,
          matchConfidence: "high",
          matchScore: 90,
          matchReasons: ["match_brand_model"],
          providerVariantGrouping: "google_shopping_product_result_may_group_frame_and_lens_variants",
        }),
      }),
    }));

    expect(result.cost).toEqual({
      taskCost: 0.019,
      observationCost: null,
      sourceCostCompatibleValue: 0.019,
    });
    expect(result.result.cost).toEqual({
      taskCost: 0.019,
      observationCost: null,
      sourceCostCompatibleValue: 0.019,
    });
  });

  it("stops as provider_no_result for a completed task with empty products", async () => {
    let mapperCalls = 0;
    const error = await captureHarnessRejection(runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) =>
        init?.method === "POST" ? nativeTaskPostResponse() : nativeProductsResponse([], { cost: 0.066 }),
      loadModules: async () => ({
        mapDataForSeoGoogleShoppingProductsResponse: () => {
          mapperCalls += 1;
          throw new Error("mapper should not run without product items");
        },
      }),
    })));

    expect(error.message).toMatch(/provider_no_result/);
    expect(error.details?.finalState).toBe("provider_no_result");
    expect(error.details?.reason).toBe("completed_task_empty_items");
    expect(error.details?.cost).toEqual({
      taskCost: null,
      observationCost: 0.066,
      sourceCostCompatibleValue: null,
    });
    expect(error.details?.taskGetAttempts).toEqual([
      expect.objectContaining({ readinessState: "provider_no_result", resultCount: 1, itemsCount: 0 }),
    ]);
    expect(mapperCalls).toBe(0);
  });

  it("stops as provider_error for a task-level provider error", async () => {
    let mapperCalls = 0;
    const error = await captureHarnessRejection(runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) =>
        init?.method === "POST" ? nativeTaskPostResponse() : nativeProviderErrorTaskGetResponse(),
      loadModules: async () => ({
        mapDataForSeoGoogleShoppingProductsResponse: () => {
          mapperCalls += 1;
          throw new Error("mapper should not run for provider error");
        },
      }),
    })));

    expect(error.message).toMatch(/provider_error/);
    expect(error.details?.finalState).toBe("provider_error");
    expect(error.details?.taskGetAttempts).toEqual([
      expect.objectContaining({
        readinessState: "provider_error",
        taskStatusCode: 50000,
        taskStatusMessage: "Internal error.",
        taskCost: 0.045,
      }),
    ]);
    expect(error.details?.cost).toEqual({
      taskCost: null,
      observationCost: 0.045,
      sourceCostCompatibleValue: null,
    });
    expect(mapperCalls).toBe(0);
  });

  it("stops as malformed_response when tasks are missing", async () => {
    let mapperCalls = 0;
    const error = await captureHarnessRejection(runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) =>
        init?.method === "POST" ? nativeTaskPostResponse() : nativeMalformedTasksResponse(),
      loadModules: async () => ({
        mapDataForSeoGoogleShoppingProductsResponse: () => {
          mapperCalls += 1;
          throw new Error("mapper should not run for malformed task_get");
        },
      }),
    })));

    expect(error.details?.finalState).toBe("malformed_response");
    expect(error.details?.reason).toBe("tasks_not_array");
    expect(error.details?.cost).toEqual({
      taskCost: null,
      observationCost: null,
      sourceCostCompatibleValue: null,
    });
    expect(mapperCalls).toBe(0);
  });

  it("stops as malformed_response for malformed matching tasks", async () => {
    let mapperCalls = 0;
    const error = await captureHarnessRejection(runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) =>
        init?.method === "POST"
          ? nativeTaskPostResponse()
          : nativeJsonResponse({
            status_code: 20000,
            status_message: "Ok.",
            tasks: [{ id: "controlled-task-id", status_message: "Ok." }],
          }),
      loadModules: async () => ({
        mapDataForSeoGoogleShoppingProductsResponse: () => {
          mapperCalls += 1;
          throw new Error("mapper should not run for malformed task");
        },
      }),
    })));

    expect(error.details?.finalState).toBe("malformed_response");
    expect(error.details?.reason).toBe("task_status_code_missing_or_invalid");
    expect(error.details?.taskGetAttempts).toEqual([
      expect.objectContaining({ taskId: "controlled-task-id", taskStatusCode: null }),
    ]);
    expect(mapperCalls).toBe(0);
  });

  it("does not silently select another task from task_get", async () => {
    const error = await captureHarnessRejection(runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) =>
        init?.method === "POST"
          ? nativeTaskPostResponse("controlled-task-id")
          : nativeJsonResponse({
            status_code: 20000,
            status_message: "Ok.",
            tasks: [
              {
                id: "other-task-id",
                status_code: 20000,
                status_message: "Ok.",
                result: [{ items: [aggregateProductItem()] }],
              },
            ],
          }),
    })));

    expect(error.details?.finalState).toBe("malformed_response");
    expect(error.details?.reason).toBe("matching_task_not_found");
  });

  it("stops as malformed_response for duplicate same-id tasks when pending appears before ready", async () => {
    const { error, mapperCalls } = await duplicateMatchingTaskRejection([
      pendingTaskGetTask("controlled-task-id", { cost: 0.01 }),
      readyTaskGetTask("controlled-task-id", [aggregateProductItem()], { cost: 0.99 }),
    ]);

    expectDuplicateMatchingTaskFailure(error);
    expect(mapperCalls).toBe(0);
  });

  it("stops as malformed_response for duplicate same-id tasks when ready appears before pending", async () => {
    const { error, mapperCalls } = await duplicateMatchingTaskRejection([
      readyTaskGetTask("controlled-task-id", [aggregateProductItem()], { cost: 0.99 }),
      pendingTaskGetTask("controlled-task-id", { cost: 0.01 }),
    ]);

    expectDuplicateMatchingTaskFailure(error);
    expect(mapperCalls).toBe(0);
  });

  it("stops as malformed_response for duplicate same-id ready tasks with different costs", async () => {
    const { error, mapperCalls } = await duplicateMatchingTaskRejection([
      readyTaskGetTask("controlled-task-id", [aggregateProductItem()], { cost: 0.01 }),
      readyTaskGetTask("controlled-task-id", [aggregateProductItem()], { cost: 0.99 }),
    ]);

    expectDuplicateMatchingTaskFailure(error);
    expect(mapperCalls).toBe(0);
  });

  it("stops as malformed_response when duplicate same-id tasks disagree on product availability", async () => {
    const { error, mapperCalls } = await duplicateMatchingTaskRejection([
      readyTaskGetTask("controlled-task-id", [aggregateProductItem()], { cost: 0.05 }),
      readyTaskGetTask("controlled-task-id", [], { cost: 0.06 }),
    ]);

    expectDuplicateMatchingTaskFailure(error);
    expect(mapperCalls).toBe(0);
  });

  it("stops as malformed_response when duplicate same-id tasks mix error and ready states", async () => {
    const { error, mapperCalls } = await duplicateMatchingTaskRejection([
      errorTaskGetTask("controlled-task-id", { cost: 0.07 }),
      readyTaskGetTask("controlled-task-id", [aggregateProductItem()], { cost: 0.08 }),
    ]);

    expectDuplicateMatchingTaskFailure(error);
    expect(mapperCalls).toBe(0);
  });

  it("does not invoke the mapper or emit candidate evidence for duplicate same-id tasks", async () => {
    const { error, mapperCalls } = await duplicateMatchingTaskRejection([
      readyTaskGetTask("controlled-task-id", [
        aggregateProductItem({
          title: "Duplicate Garmin Venu 4",
          product_id: "duplicate-product-id",
          data_docid: "duplicate-data-docid",
          gid: "duplicate-gid",
        }),
      ], { cost: 0.01 }),
      readyTaskGetTask("controlled-task-id", [], { cost: 0.02 }),
    ]);
    const serializedDetails = JSON.stringify(error.details);

    expectDuplicateMatchingTaskFailure(error);
    expect(mapperCalls).toBe(0);
    expect(error.details?.result).toBeUndefined();
    expect(serializedDetails).not.toContain("Duplicate Garmin Venu 4");
    expect(serializedDetails).not.toContain("duplicate-product-id");
    expect(serializedDetails).not.toContain("duplicate-data-docid");
    expect(serializedDetails).not.toContain("duplicate-gid");
  });

  it("does not use duplicate task costs and only preserves trusted task_post cost", async () => {
    const duplicateTasks = [
      pendingTaskGetTask("controlled-task-id", { cost: 0.01 }),
      readyTaskGetTask("controlled-task-id", [aggregateProductItem()], { cost: 0.99 }),
    ];

    const withoutPostCost = await duplicateMatchingTaskRejection(duplicateTasks);
    const withPostCost = await duplicateMatchingTaskRejection(duplicateTasks, { cost: 0.019 });

    expectDuplicateMatchingTaskFailure(withoutPostCost.error);
    expectDuplicateMatchingTaskFailure(withPostCost.error, 0.019);
  });

  it("ignores unrelated duplicate task ids while mapping only the single validated task", async () => {
    const taskIdsSeenByMapper: Array<string | undefined> = [];
    const result = await runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) =>
        init?.method === "POST"
          ? nativeTaskPostResponse("controlled-task-id", { cost: 0.011 })
          : nativeTaskGetTasksResponse([
            readyTaskGetTask("other-task-id", [
              aggregateProductItem({
                title: "Unrelated Product Evidence",
                product_id: "unrelated-product-id",
                data_docid: "unrelated-data-docid",
                gid: "unrelated-gid",
              }),
            ], { cost: 0.98 }),
            readyTaskGetTask("other-task-id", [
              aggregateProductItem({
                title: "Second Unrelated Product Evidence",
                product_id: "second-unrelated-product-id",
                data_docid: "second-unrelated-data-docid",
                gid: "second-unrelated-gid",
              }),
            ], { cost: 0.99 }),
            readyTaskGetTask("controlled-task-id", [
              aggregateProductItem({
                title: "Validated Garmin Venu 4",
                product_id: "validated-product-id",
                data_docid: "validated-data-docid",
                gid: "validated-gid",
              }),
            ], { cost: 0.023 }),
          ]),
      loadModules: async () => ({
        mapDataForSeoGoogleShoppingProductsResponse: ({ response }: {
          response: {
            tasks?: Array<{
              id?: string;
              cost?: number;
              result?: Array<{
                items?: Array<{
                  title?: string;
                  seller?: string;
                  product_id?: string;
                  data_docid?: string;
                  gid?: string;
                }>;
              }>;
            }>;
          };
        }) => {
          const tasks = response.tasks ?? [];
          const task = tasks[0];
          const item = task?.result?.[0]?.items?.[0];
          taskIdsSeenByMapper.push(...tasks.map((candidate) => candidate.id));

          return {
            provider: "dataforseo",
            productId: CONTROLLED_REVIEW_HARNESS.productId,
            searchQuery: "Garmin Venu 4",
            locationCode: 2840,
            languageCode: "en",
            fetchedAt: "2026-08-28T00:00:00.000Z",
            endpoint: PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX,
            matchedProductTitle: item?.title ?? "missing-title",
            seller: item?.seller,
            identifiers: {
              productId: item?.product_id,
              dataDocid: item?.data_docid,
              gid: item?.gid,
            },
            averageRating: 4.6,
            matchConfidence: "high",
            matchScore: 90,
            matchReasons: ["match_brand_model"],
            providerVariantGrouping: "google_shopping_product_result_may_group_frame_and_lens_variants",
            cost: task?.cost,
          };
        },
      }),
    }));

    expect(taskIdsSeenByMapper).toEqual(["controlled-task-id"]);
    expect(result.taskGetAttempts).toEqual([
      expect.objectContaining({ readinessState: "ready_for_identity", taskCost: 0.023 }),
    ]);
    expect(result.result).toMatchObject({
      candidateTitle: "Validated Garmin Venu 4",
      providerIdsObserved: {
        productId: "validated-product-id",
        dataDocid: "validated-data-docid",
        gid: "validated-gid",
      },
      cost: {
        taskCost: 0.011,
        observationCost: 0.023,
        sourceCostCompatibleValue: 0.011,
      },
    });
  });

  it("keeps unique task matching stable when unrelated tasks are reordered", () => {
    const responseWithValidatedTaskLast = {
      status_code: 20000,
      status_message: "Ok.",
      tasks: [
        readyTaskGetTask("other-task-id", [aggregateProductItem()], { cost: 0.99 }),
        pendingTaskGetTask("controlled-task-id", { cost: 0.02 }),
      ],
    };
    const responseWithValidatedTaskFirst = {
      status_code: 20000,
      status_message: "Ok.",
      tasks: [
        pendingTaskGetTask("controlled-task-id", { cost: 0.02 }),
        readyTaskGetTask("other-task-id", [aggregateProductItem()], { cost: 0.99 }),
      ],
    };

    expect(classifyProductsTaskGetState({
      response: responseWithValidatedTaskLast,
      expectedTaskId: "controlled-task-id",
      attempt: 1,
    })).toEqual(expect.objectContaining({
      readinessState: "provider_pending",
      taskCost: 0.02,
      resultCount: null,
      itemsCount: null,
    }));
    expect(classifyProductsTaskGetState({
      response: responseWithValidatedTaskFirst,
      expectedTaskId: "controlled-task-id",
      attempt: 1,
    })).toEqual(expect.objectContaining({
      readinessState: "provider_pending",
      taskCost: 0.02,
      resultCount: null,
      itemsCount: null,
    }));
  });

  it("keeps normal unique matching task behavior unchanged", async () => {
    const result = await runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) =>
        init?.method === "POST"
          ? nativeTaskPostResponse("controlled-task-id", { cost: 0.011 })
          : nativeProductsResponse([aggregateProductItem()], { cost: 0.034 }),
    }));

    expect(result.finalState).toBe("candidate_selected");
    expect(result.taskGetAttempts).toEqual([
      expect.objectContaining({ readinessState: "ready_for_identity", resultCount: 1, itemsCount: 1, taskCost: 0.034 }),
    ]);
    expect(result.cost).toEqual({
      taskCost: 0.011,
      observationCost: 0.0123,
      sourceCostCompatibleValue: 0.011,
    });
  });

  it("stops as malformed_response for unexpected completed result shape", async () => {
    let mapperCalls = 0;
    const error = await captureHarnessRejection(runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) =>
        init?.method === "POST"
          ? nativeTaskPostResponse()
          : nativeProductsResponse([aggregateProductItem()], { result: { items: [aggregateProductItem()] } }),
      loadModules: async () => ({
        mapDataForSeoGoogleShoppingProductsResponse: () => {
          mapperCalls += 1;
          throw new Error("mapper should not run for malformed result shape");
        },
      }),
    })));

    expect(error.details?.finalState).toBe("malformed_response");
    expect(error.details?.reason).toBe("completed_task_result_not_array");
    expect(mapperCalls).toBe(0);
  });

  it("preserves no-candidate task cost as identity_inconclusive only after usable products reach the mapper", async () => {
    let mapperCalls = 0;
    const error = await captureHarnessRejection(runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) =>
        init?.method === "POST" ? nativeTaskPostResponse() : nativeProductsResponse([aggregateProductItem()], { cost: 0.077 }),
      loadModules: async () => ({
        mapDataForSeoGoogleShoppingProductsResponse: () => {
          mapperCalls += 1;
          throw new Error("DataForSEO response did not include a high-confidence rated product match");
        },
      }),
    })));

    expect(error.message).toMatch(/identity_inconclusive/);
    expect(error.details?.finalState).toBe("identity_inconclusive");
    expect(error.details?.reason).toBe("DataForSEO response did not include a high-confidence rated product match");
    expect(error.details?.taskGetAttempts).toEqual([
      expect.objectContaining({ readinessState: "ready_for_identity", resultCount: 1, itemsCount: 1, taskCost: 0.077 }),
    ]);
    expect(error.details?.cost).toEqual({
      taskCost: null,
      observationCost: 0.077,
      sourceCostCompatibleValue: null,
    });
    expect(mapperCalls).toBe(1);
  });

  it("keeps absent cost as null for terminal states", async () => {
    const error = await captureHarnessRejection(runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (_url, init) =>
        init?.method === "POST"
          ? nativeTaskPostResponse("controlled-task-id", { cost: undefined })
          : nativeProductsResponse([], { cost: undefined }),
    })));

    expect(error.details?.finalState).toBe("provider_no_result");
    expect(error.details?.cost).toEqual({
      taskCost: null,
      observationCost: null,
      sourceCostCompatibleValue: null,
    });
  });

  it("does not invoke persistence functions during dry-run", async () => {
    const trap = createPersistenceTrap();

    await runDryRun(["--dry-run", ...validArgs], {
      env: {
        DATAFORSEO_LOGIN: "login",
        DATAFORSEO_PASSWORD: "password",
      },
      persistenceTrap: trap,
    });

    expect(trap.calls).toEqual({
      providerIdentityCacheWrites: 0,
      productResolutionCacheWrites: 0,
      reviewSignalCacheWrites: 0,
      snapshotWrites: 0,
      canonicalIdentityMutations: 0,
    });
  });

  it("produces the expected Garmin aggregate request payload", () => {
    expect(buildGarminRequestPayload()).toEqual([
      {
        keyword: "Garmin Venu 4",
        location_code: 2840,
        language_code: "en",
        depth: 10,
        tag: "trendiq:controlled:phase-3u-2a-2:garmin-venu-4:aggregate-only",
      },
    ]);
  });

  it("executes the aggregate-only flow with the controlled tag and no persistence", async () => {
    const bodies: unknown[] = [];
    const trap = createPersistenceTrap();
    const result = await runLiveValidation(validArgs, {
      env: {
        DATAFORSEO_LOGIN: "login",
        DATAFORSEO_PASSWORD: "password",
        DATAFORSEO_API_BASE_URL: "https://api.dataforseo.com",
      },
      fetchImpl: async (url, init) => {
        if (init?.body) bodies.push(JSON.parse(String(init.body)));
        return init?.method === "POST" ? taskPostResponse() : productsResponse();
      },
      loadModules: liveOptions().loadModules,
      persistenceTrap: trap,
      now: () => new Date("2026-08-28T00:00:00.000Z"),
    });

    expect(bodies).toEqual([buildGarminRequestPayload()]);
    expect(result.counters).toEqual({
      logicalTasksCreated: 1,
      taskPostCalls: 1,
      taskGetCalls: 1,
      totalHttpRequests: 2,
    });
    expect(result.result.cost).toEqual({
      taskCost: null,
      observationCost: 0.0123,
      sourceCostCompatibleValue: null,
    });
    expect(result.result).toMatchObject({
      candidateMatchDecision: "match",
      candidateMatchConfidence: "high",
      canonicalIdentityStatus: "unchanged_observation_only",
      canonicalIdentityConfidence: "not_elevated_by_harness",
      providerIdsPersistence: "not_persisted",
      providerIdsObserved: {
        productId: "candidate-product-id",
        dataDocid: "candidate-data-docid",
        gid: "candidate-gid",
      },
    });
    expect(trap.calls).toEqual({
      providerIdentityCacheWrites: 0,
      productResolutionCacheWrites: 0,
      reviewSignalCacheWrites: 0,
      snapshotWrites: 0,
      canonicalIdentityMutations: 0,
    });
  });

  it("keeps native Response getters bound while parsing task_post before aggregate mapping", async () => {
    const calls: Array<{ url: string; method: unknown; redirect: unknown }> = [];
    const result = await runLiveValidation(validArgs, liveOptions({
      fetchImpl: async (url, init) => {
        calls.push({
          url: String(url),
          method: init?.method,
          redirect: init?.redirect,
        });

        return init?.method === "POST" ? nativeTaskPostResponse() : nativeProductsResponse();
      },
    }));

    expect(calls).toEqual([
      {
        url: `${APPROVED_DATAFORSEO_ORIGIN}${PRODUCTS_TASK_POST_PATH}`,
        method: "POST",
        redirect: "error",
      },
      {
        url: `${APPROVED_DATAFORSEO_ORIGIN}${PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX}/controlled-task-id`,
        method: "GET",
        redirect: "error",
      },
    ]);
    expect(result.counters).toEqual({
      logicalTasksCreated: 1,
      taskPostCalls: 1,
      taskGetCalls: 1,
      totalHttpRequests: 2,
    });
    expect(result.result).toMatchObject({
      candidateMatchDecision: "match",
      candidateMatchConfidence: "high",
      canonicalIdentityStatus: "unchanged_observation_only",
      providerIdsPersistence: "not_persisted",
    });
  });
});
