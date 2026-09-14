import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../../../app/lib/data/search/client";
import { ProcessPaidOperationGuard } from "../../runtime/processPaidOperationGuard";
import {
  CONTROLLED_MAX_HTTP_REQUESTS,
  CONTROLLED_MAX_PAID_OPERATIONS,
  CONTROLLED_MAX_TASK_POSTS,
  CONTROLLED_PROVIDER_REQUEST_TIMEOUT_MS,
  ProviderRequestBudget,
} from "../providerRequestBudget";

function response() {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => "{}",
  };
}

describe("ProviderRequestBudget", () => {
  it("keeps the frozen per-analysis limits at exactly 10 HTTP, 4 paid, 2 task POSTs, and 5 seconds", () => {
    expect(CONTROLLED_MAX_HTTP_REQUESTS).toBe(10);
    expect(CONTROLLED_MAX_PAID_OPERATIONS).toBe(4);
    expect(CONTROLLED_MAX_TASK_POSTS).toBe(2);
    expect(CONTROLLED_PROVIDER_REQUEST_TIMEOUT_MS).toBe(5_000);
  });

  it("blocks an unsafe retry of the same task_post", async () => {
    const fetchImpl = vi.fn(async () => response()) as unknown as FetchLike;
    const budget = new ProviderRequestBudget(fetchImpl);
    const url = "https://provider.invalid/v3/reviews/task_post";
    await budget.fetch(url, { method: "POST" });
    await expect(budget.fetch(url, { method: "POST" })).rejects.toThrow("unsafe_provider_post_retry_blocked");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(budget.usage()).toEqual({ httpRequestCount: 1, paidOperationCount: 1, taskPostCount: 1 });
  });

  it("allows bounded polling but stops at the HTTP ceiling", async () => {
    const fetchImpl = vi.fn(async () => response()) as unknown as FetchLike;
    const budget = new ProviderRequestBudget(fetchImpl, 3, 4);
    await budget.fetch("https://provider.invalid/task/1", { method: "GET" });
    await budget.fetch("https://provider.invalid/task/1", { method: "GET" });
    await budget.fetch("https://provider.invalid/task/1", { method: "GET" });
    await expect(budget.fetch("https://provider.invalid/task/1", { method: "GET" }))
      .rejects.toThrow("controlled_http_budget_exhausted");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("stops distinct paid operations at their explicit ceiling", async () => {
    const fetchImpl = vi.fn(async () => response()) as unknown as FetchLike;
    const budget = new ProviderRequestBudget(fetchImpl, 10, 2);
    await budget.fetch("https://provider.invalid/live/a", { method: "POST" });
    await budget.fetch("https://provider.invalid/live/b", { method: "POST" });
    await expect(budget.fetch("https://provider.invalid/live/c", { method: "POST" }))
      .rejects.toThrow("controlled_paid_operation_budget_exhausted");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("blocks a third distinct task POST before it reaches the provider", async () => {
    const fetchImpl = vi.fn(async () => response()) as unknown as FetchLike;
    const budget = new ProviderRequestBudget(fetchImpl);
    await budget.fetch("https://provider.invalid/a/task_post", { method: "POST" });
    await budget.fetch("https://provider.invalid/b/task_post", { method: "POST" });
    await expect(budget.fetch("https://provider.invalid/c/task_post", { method: "POST" }))
      .rejects.toThrow("controlled_task_post_budget_exhausted");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(budget.usage()).toEqual({ httpRequestCount: 2, paidOperationCount: 2, taskPostCount: 2 });
  });

  it("shares one finite paid-operation guard across separate analysis budgets", async () => {
    const fetchImpl = vi.fn(async () => response()) as unknown as FetchLike;
    const guard = new ProcessPaidOperationGuard(2);
    const firstRejected = vi.fn();
    const secondRejected = vi.fn();
    const firstAnalysis = new ProviderRequestBudget(fetchImpl, undefined, undefined, undefined, {
      onProcessPaidOperationRejected: firstRejected,
      processPaidOperationGuard: guard,
    });
    const secondAnalysis = new ProviderRequestBudget(fetchImpl, undefined, undefined, undefined, {
      onProcessPaidOperationRejected: secondRejected,
      processPaidOperationGuard: guard,
    });

    await firstAnalysis.fetch("https://provider.invalid/analysis-one/task_post", { method: "POST" });
    await secondAnalysis.fetch("https://provider.invalid/analysis-two/task_post", { method: "POST" });
    await expect(secondAnalysis.fetch("https://provider.invalid/analysis-two/other-paid", { method: "POST" }))
      .rejects.toThrow("process_paid_operation_ceiling_exhausted");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(firstRejected).not.toHaveBeenCalled();
    expect(secondRejected).toHaveBeenCalledTimes(1);
    expect(guard.snapshot()).toEqual({ maximum: 2, reserved: 2, rejected: 1, exhausted: true });
  });

  it("blocks requests after the server deadline without contacting the provider", async () => {
    const fetchImpl = vi.fn(async () => response()) as unknown as FetchLike;
    const budget = new ProviderRequestBudget(fetchImpl, undefined, undefined, undefined, {
      canRequest: () => false,
    });
    await expect(budget.fetch("https://provider.invalid/late", { method: "POST" }))
      .rejects.toThrow("controlled_analysis_deadline_exceeded");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds a provider request that never settles", async () => {
    const fetchImpl = vi.fn(() => new Promise<never>(() => undefined)) as unknown as FetchLike;
    const budget = new ProviderRequestBudget(fetchImpl, 10, 4, 5);
    await expect(budget.fetch("https://provider.invalid/live/a", { method: "GET" }))
      .rejects.toMatchObject({
        message: "controlled_provider_request_timeout",
        failureCategory: "provider_timeout",
      });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("classifies a controlled fetch rejection as a network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("uncontrolled-network-message");
    }) as unknown as FetchLike;
    const budget = new ProviderRequestBudget(fetchImpl);

    await expect(budget.fetch("https://provider.invalid/live/a", { method: "GET" }))
      .rejects.toMatchObject({
        message: "controlled_provider_network_error",
        failureCategory: "provider_network_error",
      });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
