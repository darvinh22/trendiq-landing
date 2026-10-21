import type { FetchLike } from "../../../app/lib/data/search/client";
import { DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH } from "../../../app/lib/data/reviews/client";
import { readReviewProviderConfig } from "../../../app/lib/data/reviews/config";
import { ProviderRequestBudget } from "../providerRequestBudget";
import type { ProcessPaidOperationGuard } from "../../runtime/processPaidOperationGuard";
import {
  OPEN_ANALYSIS_MAX_MICROS,
  type AnalysisSpendLedger,
  createAnalysisSpendTracker,
} from "./costAccounting";
import { readShoppingCandidates, type ShoppingCandidate } from "./productResolver";

export const OPEN_RESOLVE_DEPTH = 40;
const TASK_GET_PREFIX = "/v3/merchant/google/products/task_get/advanced";

/**
 * Same DataForSEO queue codes the reviews task_get classifier treats as still
 * pending: created/queued/handed, not an empty result.
 */
const PENDING_TASK_STATUS = new Set([20100, 20101, 40601, 40602]);
const SUCCESS_STATUS = 20000;

export type ShoppingPollState = "ready" | "empty" | "pending" | "error";

export async function searchShoppingIdentity(input: {
  query: string;
  apiBaseUrl: string;
  login: string;
  password: string;
  fetchImpl: FetchLike;
  ledger: AnalysisSpendLedger;
  now: () => Date;
  cycleId: string;
  allowPaidCall: boolean;
  locationCode?: number;
  languageCode?: string;
  processPaidOperationGuard?: ProcessPaidOperationGuard;
  pollAttempts?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  clockMs?: () => number;
  deadlineAtMs?: number;
  env?: Record<string, string | undefined>;
}): Promise<ShoppingCandidate[]> {
  if (!input.allowPaidCall) throw new Error("open_analysis_paid_call_blocked");
  if (input.processPaidOperationGuard?.isExhausted()) {
    throw new Error("process_paid_operation_ceiling_exhausted");
  }
  const base = new URL(input.apiBaseUrl);
  if (base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("unapproved_provider_origin");
  }
  const reviewPolling = readReviewProviderConfig(input.env);
  const attempts = input.pollAttempts ?? reviewPolling.taskPollAttempts;
  const intervalMs = input.pollIntervalMs ?? reviewPolling.taskPollIntervalMs;
  const sleep = input.sleep ?? defaultSleep;
  const clock = input.clockMs ?? Date.now;
  const deadlineAt = input.deadlineAtMs ?? Number.POSITIVE_INFINITY;
  const tracker = createAnalysisSpendTracker({
    maxMicros: OPEN_ANALYSIS_MAX_MICROS,
    ledger: input.ledger,
    now: input.now,
    cycleId: input.cycleId,
  });
  const budget = new ProviderRequestBudget(input.fetchImpl, 8, 1, 5_000, {
    canRequest: () => clock() < deadlineAt,
    processPaidOperationGuard: input.processPaidOperationGuard,
  });
  const tracked = tracker.wrap(budget.fetch);
  const authorization = `Basic ${Buffer.from(`${input.login}:${input.password}`).toString("base64")}`;
  const postUrl = new URL(DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH, base.origin).toString();
  const body = JSON.stringify([{
    keyword: input.query,
    location_code: input.locationCode ?? 2840,
    language_code: input.languageCode ?? "en",
    depth: OPEN_RESOLVE_DEPTH,
    priority: 1,
    tag: "trendiq:open-resolve",
  }]);
  if (clock() >= deadlineAt) throw new Error("shopping_identity_pending");
  const posted = await tracked(postUrl, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body,
  });
  if (!posted.ok) throw new Error("shopping_identity_failed");
  const taskId = taskIdFrom(await posted.json());
  if (!taskId) throw new Error("shopping_identity_failed");
  const getUrl = new URL(`${TASK_GET_PREFIX}/${encodeURIComponent(taskId)}`, base.origin).toString();
  let sawPending = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      if (clock() >= deadlineAt) throw new Error("shopping_identity_pending");
      await sleep(intervalMs);
    }
    if (clock() >= deadlineAt) throw new Error("shopping_identity_pending");
    const polled = await tracked(getUrl, {
      method: "GET",
      headers: { Authorization: authorization },
    });
    if (!polled.ok) throw new Error("shopping_identity_failed");
    const payload = await polled.json();
    const state = classifyShoppingPoll(payload, taskId);
    if (state === "ready") return readShoppingCandidates(payload);
    if (state === "empty") return [];
    if (state === "pending") {
      sawPending = true;
      continue;
    }
    throw new Error("shopping_identity_failed");
  }
  if (sawPending) throw new Error("shopping_identity_pending");
  throw new Error("shopping_identity_failed");
}

export function classifyShoppingPoll(payload: unknown, taskId: string): ShoppingPollState {
  if (!payload || typeof payload !== "object") return "error";
  const response = payload as { status_code?: unknown; tasks?: unknown };
  if (response.status_code !== SUCCESS_STATUS) return "error";
  if (!Array.isArray(response.tasks)) return "error";
  const task = response.tasks.find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return (entry as { id?: unknown }).id === taskId;
  }) as { status_code?: unknown; result?: unknown } | undefined;
  if (!task) return "error";
  if (typeof task.status_code !== "number") return "error";
  if (PENDING_TASK_STATUS.has(task.status_code)) return "pending";
  if (task.status_code !== SUCCESS_STATUS) return "error";
  return shoppingItems(task).length > 0 ? "ready" : "empty";
}

function shoppingItems(task: { result?: unknown }): unknown[] {
  if (!Array.isArray(task.result)) return [];
  const items: unknown[] = [];
  for (const result of task.result) {
    if (!result || typeof result !== "object") continue;
    const raw = (result as { items?: unknown }).items;
    if (Array.isArray(raw)) items.push(...raw);
  }
  return items;
}

function taskIdFrom(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const tasks = (payload as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return null;
  for (const task of tasks) {
    if (!task || typeof task !== "object") continue;
    const id = (task as { id?: unknown }).id;
    const status = (task as { status_code?: unknown }).status_code;
    const created = status === undefined || status === SUCCESS_STATUS || PENDING_TASK_STATUS.has(Number(status));
    if (created && typeof id === "string" && /^[A-Za-z0-9_-]{4,128}$/.test(id)) return id;
  }
  return null;
}

async function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}
