import type { FetchLike } from "../../../app/lib/data/search/client";
import { DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH } from "../../../app/lib/data/reviews/client";
import { ProviderRequestBudget } from "../providerRequestBudget";
import type { AnalysisSpendLedger } from "./costAccounting";
import { createAnalysisSpendTracker } from "./costAccounting";
import { readShoppingCandidates, type ShoppingCandidate } from "./productResolver";

export const OPEN_RESOLVE_DEPTH = 40;
const TASK_GET_PREFIX = "/v3/merchant/google/products/task_get/advanced";

export async function searchShoppingIdentity(input: {
  query: string;
  apiBaseUrl: string;
  login: string;
  password: string;
  fetchImpl: FetchLike;
  ledger: AnalysisSpendLedger;
  now: () => Date;
  allowPaidCall: boolean;
  locationCode?: number;
  languageCode?: string;
}): Promise<ShoppingCandidate[]> {
  if (!input.allowPaidCall) throw new Error("open_analysis_paid_call_blocked");
  const base = new URL(input.apiBaseUrl);
  if (base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("unapproved_provider_origin");
  }
  const tracker = createAnalysisSpendTracker({
    maxMicros: 2_000,
    ledger: input.ledger,
    now: input.now,
  });
  const budget = new ProviderRequestBudget(tracker.wrap(input.fetchImpl), 4, 1, 5_000);
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
  const posted = await budget.fetch(postUrl, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body,
  });
  if (!posted.ok) throw new Error("shopping_identity_post_failed");
  const taskId = taskIdFrom(await posted.json());
  if (!taskId) throw new Error("shopping_identity_task_missing");
  const getUrl = new URL(`${TASK_GET_PREFIX}/${encodeURIComponent(taskId)}`, base.origin).toString();
  let latest: ShoppingCandidate[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const polled = await budget.fetch(getUrl, {
      method: "GET",
      headers: { Authorization: authorization },
    });
    if (!polled.ok) throw new Error("shopping_identity_get_failed");
    const payload = await polled.json();
    latest = readShoppingCandidates(payload);
    if (latest.length) return latest;
  }
  return latest;
}

function taskIdFrom(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const tasks = (payload as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return null;
  for (const task of tasks) {
    if (!task || typeof task !== "object") continue;
    const id = (task as { id?: unknown }).id;
    if (typeof id === "string" && /^[A-Za-z0-9_-]{4,128}$/.test(id)) return id;
  }
  return null;
}
