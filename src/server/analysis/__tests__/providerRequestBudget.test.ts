import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../../../app/lib/data/search/client";
import { ProviderRequestBudget } from "../providerRequestBudget";

function response() {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => "{}",
  };
}

describe("ProviderRequestBudget", () => {
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

  it("bounds a provider request that never settles", async () => {
    const fetchImpl = vi.fn(() => new Promise<never>(() => undefined)) as unknown as FetchLike;
    const budget = new ProviderRequestBudget(fetchImpl, 10, 4, 5);
    await expect(budget.fetch("https://provider.invalid/live/a", { method: "GET" }))
      .rejects.toThrow("controlled_provider_request_timeout");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
