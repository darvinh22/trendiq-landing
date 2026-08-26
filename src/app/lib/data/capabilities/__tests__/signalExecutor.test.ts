import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ControlledSignalExecutor,
  InMemorySignalExecutionStateStore,
  buildSignalExecutionPlan,
  executeApprovedSignal,
  resolveProductQuery,
} from "../index";
import type {
  LiveDataCapability,
  LiveProviderId,
  ProviderExecutionAdapter,
  SignalExecutionApproval,
  SignalExecutionPlan,
  SignalExecutionState,
  SignalExecutionStateStore,
  SignalExecutionStep,
} from "../types";

const now = new Date("2026-08-24T12:00:00.000Z");

function step(
  plan: SignalExecutionPlan,
  provider: LiveProviderId,
  capability: LiveDataCapability
): SignalExecutionStep {
  const match = plan.steps.find((candidate) =>
    candidate.provider === provider && candidate.capability === capability
  );

  expect(match).toBeDefined();
  return match!;
}

function approval(
  plan: SignalExecutionPlan,
  selectedStep: SignalExecutionStep,
  overrides: Partial<SignalExecutionApproval> = {}
): SignalExecutionApproval {
  return {
    approved: true,
    executionId: "phase-3q-garmin-search-volume",
    planId: plan.planId,
    stepId: selectedStep.stepId,
    signal: selectedStep.signal,
    provider: selectedStep.provider,
    capability: selectedStep.capability,
    productId: plan.product.productId,
    canonicalProduct: plan.product.canonicalTitle,
    query: plan.product.query,
    approvedAt: now.toISOString(),
    maxOperations: 1,
    ...overrides,
  };
}

function adapter(
  selectedStep: SignalExecutionStep,
  overrides: Partial<ProviderExecutionAdapter> = {}
): ProviderExecutionAdapter {
  return {
    provider: selectedStep.provider,
    capability: selectedStep.capability,
    signal: selectedStep.signal,
    logicalOperationCount: 1,
    expectedHttpRequestCount: 0,
    execute: vi.fn(async () => ({
      provenance: {
        mode: "derived-live",
        provider: selectedStep.provider,
        observedAt: now.toISOString(),
        notes: "Mock adapter result for controlled-execution validation.",
      },
      observedAt: now.toISOString(),
      operationCount: 1,
      httpRequestCount: 0,
      paidLiveOperationsPerformed: 0,
      reportedProviderCost: 0,
      providerOperationId: "mock-operation",
      metadata: {
        monthlySearchVolume: 12345,
        query: selectedStep.query,
        authorization: "Basic must-not-leak",
        apiKey: "must-not-leak",
      },
    })),
    ...overrides,
  };
}

async function garminPlan(): Promise<SignalExecutionPlan> {
  const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });
  return buildSignalExecutionPlan(profile, { now: () => now });
}

class CompletionFailingStateStore implements SignalExecutionStateStore {
  private readonly states = new Map<string, SignalExecutionState>();

  async get(executionId: string): Promise<SignalExecutionState | undefined> {
    return this.states.get(executionId);
  }

  async reserveStarted(state: SignalExecutionState): Promise<{
    reserved: boolean;
    existing?: SignalExecutionState;
  }> {
    const existing = this.states.get(state.executionId);
    if (existing) return { reserved: false, existing };

    this.states.set(state.executionId, state);
    return { reserved: true };
  }

  async setCompleted(): Promise<void> {
    throw new Error("state completion write failed");
  }

  async setFailed(state: SignalExecutionState): Promise<void> {
    this.states.set(state.executionId, state);
  }
}

describe("controlled signal execution", () => {
  it("blocks Garmin offline pre-live execution when approval is absent", async () => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const selectedAdapter = adapter(selectedStep);

    const result = await executeApprovedSignal({
      plan,
      step: selectedStep,
      adapter: selectedAdapter,
      now: () => now,
    });

    expect(selectedStep.signal).toBe("search_volume_google_ads");
    expect(selectedStep.query).toBe("Garmin Venu 4");
    expect(selectedStep.futureExecutionEligibility).toBe("eligible");
    expect(selectedStep.executionAllowed).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("explicit_live_approval_required");
    expect(selectedAdapter.execute).not.toHaveBeenCalled();
    expect(result.operationCount).toBe(0);
    expect(result.paidLiveOperationsPerformed).toBe(0);
  });

  it("blocks when approval is explicitly false", async () => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const selectedAdapter = adapter(selectedStep);

    const result = await executeApprovedSignal({
      plan,
      step: selectedStep,
      approval: approval(plan, selectedStep, { approved: false }),
      adapter: selectedAdapter,
      now: () => now,
    });

    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("approval_rejected");
    expect(selectedAdapter.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong provider", { provider: "dataforseo_trends" as const }],
    ["wrong capability", { capability: "reviews" as const }],
    ["wrong query", { query: "Garmin Venu 5" }],
    ["wrong product", { productId: "user-search-garmin-venu-5" }],
    ["wrong plan", { planId: "wrong-plan-id" }],
    ["wrong step", { stepId: "wrong-step-id" }],
  ])("blocks approval scope mismatch for %s", async (_label, override) => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const selectedAdapter = adapter(selectedStep);

    const result = await executeApprovedSignal({
      plan,
      step: selectedStep,
      approval: approval(plan, selectedStep, override),
      adapter: selectedAdapter,
      now: () => now,
    });

    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("approval_scope_mismatch");
    expect(selectedAdapter.execute).not.toHaveBeenCalled();
  });

  it("blocks approval scope mismatch when approvedAt is missing", async () => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const selectedAdapter = adapter(selectedStep);

    const result = await executeApprovedSignal({
      plan,
      step: selectedStep,
      approval: approval(plan, selectedStep, { approvedAt: "" }),
      adapter: selectedAdapter,
      now: () => now,
    });

    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("approval_scope_mismatch");
    expect(result.warnings).toContain("approval_timestamp_missing");
    expect(selectedAdapter.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["non-integer", 1.5],
  ])("blocks invalid approval maxOperations: %s", async (_label, maxOperations) => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const selectedAdapter = adapter(selectedStep);

    const result = await executeApprovedSignal({
      plan,
      step: selectedStep,
      approval: approval(plan, selectedStep, { maxOperations }),
      adapter: selectedAdapter,
      now: () => now,
    });

    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("approval_scope_mismatch");
    expect(result.warnings).toContain("approval_operation_budget_invalid");
    expect(selectedAdapter.execute).not.toHaveBeenCalled();
  });

  it("blocks when step planId does not match the plan", async () => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const mismatchedStep = { ...selectedStep, planId: "wrong-plan-id" };
    const selectedAdapter = adapter(mismatchedStep);

    const result = await executeApprovedSignal({
      plan,
      step: mismatchedStep,
      approval: approval(plan, mismatchedStep),
      adapter: selectedAdapter,
      now: () => now,
    });

    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("plan_step_scope_mismatch");
    expect(result.warnings).toContain("step_plan_id_mismatch");
    expect(selectedAdapter.execute).not.toHaveBeenCalled();
  });

  it("blocks when the supplied step is not contained in the plan", async () => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const mismatchedStep = { ...selectedStep, stepId: `${selectedStep.stepId}:stale-copy` };
    const selectedAdapter = adapter(mismatchedStep);

    const result = await executeApprovedSignal({
      plan,
      step: mismatchedStep,
      approval: approval(plan, mismatchedStep),
      adapter: selectedAdapter,
      now: () => now,
    });

    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("plan_step_scope_mismatch");
    expect(result.warnings).toContain("step_not_in_plan");
    expect(selectedAdapter.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["product", (selectedStep: SignalExecutionStep) => ({
      ...selectedStep,
      productId: "user-search-garmin-venu-5",
    })],
    ["provider", (selectedStep: SignalExecutionStep) => ({
      ...selectedStep,
      provider: "dataforseo_trends" as const,
    })],
    ["signal", (selectedStep: SignalExecutionStep) => ({
      ...selectedStep,
      signal: "search_momentum_trends" as const,
    })],
  ])("blocks plan-step %s scope mismatch before adapter invocation", async (_label, mutateStep) => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const mismatchedStep = mutateStep(selectedStep);
    const selectedAdapter = adapter(mismatchedStep);

    const result = await executeApprovedSignal({
      plan,
      step: mismatchedStep,
      approval: approval(plan, mismatchedStep, {
        provider: mismatchedStep.provider,
        signal: mismatchedStep.signal,
        productId: mismatchedStep.productId,
      }),
      adapter: selectedAdapter,
      now: () => now,
    });

    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("plan_step_scope_mismatch");
    expect(selectedAdapter.execute).not.toHaveBeenCalled();
  });

  it("blocks needs-identity Google Shopping Reviews even with matching approval", async () => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_shopping_reviews", "reviews");
    const selectedAdapter = adapter(selectedStep);

    const result = await executeApprovedSignal({
      plan,
      step: selectedStep,
      approval: approval(plan, selectedStep),
      adapter: selectedAdapter,
      now: () => now,
    });

    expect(selectedStep.futureExecutionEligibility).toBe("needs_identity");
    expect(selectedStep.providerIdentity.providerIdsPresent).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("needs_provider_identity");
    expect(selectedAdapter.execute).not.toHaveBeenCalled();
  });

  it("blocks Garmin aggregate Google Shopping when product-family identity is not high confidence", async () => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_shopping", "reviews");
    const selectedAdapter = adapter(selectedStep);

    const result = await executeApprovedSignal({
      plan,
      step: selectedStep,
      approval: approval(plan, selectedStep),
      adapter: selectedAdapter,
      now: () => now,
    });

    expect(plan.product.identityConfidence).toBe("medium");
    expect(selectedStep.futureExecutionEligibility).toBe("needs_identity");
    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("needs_product_identity");
    expect(selectedAdapter.execute).not.toHaveBeenCalled();
  });

  it("blocks approved execution without a duplicate-protection state store", async () => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const selectedAdapter = adapter(selectedStep);

    const result = await executeApprovedSignal({
      plan,
      step: selectedStep,
      approval: approval(plan, selectedStep),
      adapter: selectedAdapter,
      now: () => now,
    });

    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("execution_state_store_required");
    expect(selectedAdapter.execute).not.toHaveBeenCalled();
  });

  it("blocks SaaS Google Shopping routes for Claude", async () => {
    const { profile } = await resolveProductQuery("Claude", { now: () => now });
    const plan = buildSignalExecutionPlan(profile, { now: () => now });
    const selectedStep = step(plan, "dataforseo_google_shopping", "reviews");
    const selectedAdapter = adapter(selectedStep);

    const result = await executeApprovedSignal({
      plan,
      step: selectedStep,
      approval: approval(plan, selectedStep),
      adapter: selectedAdapter,
      now: () => now,
    });

    expect(selectedStep.futureExecutionEligibility).toBe("blocked");
    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("blocked_by_provider_policy");
    expect(selectedAdapter.execute).not.toHaveBeenCalled();
  });

  it("blocks low-confidence unknown products instead of making them executable", async () => {
    const { profile } = await resolveProductQuery("XYZ Quantum Blender 9000", { now: () => now });
    const plan = buildSignalExecutionPlan(profile, { now: () => now });
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const selectedAdapter = adapter(selectedStep);

    const result = await executeApprovedSignal({
      plan,
      step: selectedStep,
      approval: approval(plan, selectedStep),
      adapter: selectedAdapter,
      now: () => now,
    });

    expect(plan.product.identityConfidence).toBe("low");
    expect(selectedStep.futureExecutionEligibility).toBe("needs_identity");
    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("needs_product_identity");
    expect(selectedAdapter.execute).not.toHaveBeenCalled();
  });

  it("blocks when the approved operation budget would be exceeded", async () => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const selectedAdapter = adapter(selectedStep, { logicalOperationCount: 2 });

    const result = await executeApprovedSignal({
      plan,
      step: selectedStep,
      approval: approval(plan, selectedStep, { maxOperations: 1 }),
      adapter: selectedAdapter,
      now: () => now,
    });

    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("operation_budget_exceeded");
    expect(selectedAdapter.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["non-integer", 1.5],
  ])("blocks invalid adapter logicalOperationCount: %s", async (_label, logicalOperationCount) => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const selectedAdapter = adapter(selectedStep, { logicalOperationCount });

    const result = await executeApprovedSignal({
      plan,
      step: selectedStep,
      approval: approval(plan, selectedStep, { maxOperations: 2 }),
      adapter: selectedAdapter,
      now: () => now,
    });

    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("operation_count_invalid");
    expect(selectedAdapter.execute).not.toHaveBeenCalled();
  });

  it("blocks duplicate execution IDs before adapter invocation", async () => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const selectedAdapter = adapter(selectedStep);
    const stateStore = new InMemorySignalExecutionStateStore();
    const scopedApproval = approval(plan, selectedStep);

    const first = await executeApprovedSignal({
      plan,
      step: selectedStep,
      approval: scopedApproval,
      adapter: selectedAdapter,
      stateStore,
      now: () => now,
    });
    const second = await executeApprovedSignal({
      plan,
      step: selectedStep,
      approval: scopedApproval,
      adapter: selectedAdapter,
      stateStore,
      now: () => now,
    });

    expect(first.status).toBe("completed");
    expect(second.status).toBe("blocked");
    expect(second.blockReason).toBe("duplicate_execution");
    expect(selectedAdapter.execute).toHaveBeenCalledTimes(1);
  });

  it("blocks concurrent duplicate execution IDs with a single adapter invocation", async () => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const stateStore = new InMemorySignalExecutionStateStore();
    const selectedAdapter = adapter(selectedStep, {
      execute: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return {
          provenance: {
            mode: "derived-live",
            provider: selectedStep.provider,
            observedAt: now.toISOString(),
            notes: "Slow mock adapter result.",
          },
          observedAt: now.toISOString(),
          operationCount: 1,
          httpRequestCount: 0,
          paidLiveOperationsPerformed: 0,
        };
      }),
    });
    const scopedApproval = approval(plan, selectedStep);

    const results = await Promise.all([
      executeApprovedSignal({
        plan,
        step: selectedStep,
        approval: scopedApproval,
        adapter: selectedAdapter,
        stateStore,
        now: () => now,
      }),
      executeApprovedSignal({
        plan,
        step: selectedStep,
        approval: scopedApproval,
        adapter: selectedAdapter,
        stateStore,
        now: () => now,
      }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["blocked", "completed"]);
    expect(results.find((result) => result.status === "blocked")?.blockReason).toBe("duplicate_execution");
    expect(selectedAdapter.execute).toHaveBeenCalledTimes(1);
  });

  it("blocks adapter mismatch before adapter invocation", async () => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const wrongAdapter = adapter(selectedStep, {
      provider: "dataforseo_trends",
    });

    const result = await executeApprovedSignal({
      plan,
      step: selectedStep,
      approval: approval(plan, selectedStep),
      adapter: wrongAdapter,
      now: () => now,
    });

    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("adapter_mismatch");
    expect(wrongAdapter.execute).not.toHaveBeenCalled();
  });

  it("does not retry when an adapter throws", async () => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const throwingAdapter = adapter(selectedStep, {
      execute: vi.fn(async () => {
        throw new Error("first operation failed");
      }),
    });
    const result = await executeApprovedSignal({
      plan,
      step: selectedStep,
      approval: approval(plan, selectedStep),
      adapter: throwingAdapter,
      stateStore: new InMemorySignalExecutionStateStore(),
      now: () => now,
    });

    expect(result.status).toBe("failed");
    expect(result.blockReason).toBe("adapter_failed");
    expect(result.operationCount).toBe(1);
    expect(result.paidLiveOperationsPerformed).toBe(0);
    expect(throwingAdapter.execute).toHaveBeenCalledTimes(1);
  });

  it("surfaces adapter-reported operations above approval as a safety violation", async () => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const selectedAdapter = adapter(selectedStep, {
      execute: vi.fn(async () => ({
        provenance: {
          mode: "derived-live",
          provider: selectedStep.provider,
          observedAt: now.toISOString(),
          notes: "Adapter reports too many paid operations.",
        },
        observedAt: now.toISOString(),
        operationCount: 1,
        httpRequestCount: 0,
        paidLiveOperationsPerformed: 2,
        providerOperationId: "over-budget-operation",
      })),
    });

    const result = await executeApprovedSignal({
      plan,
      step: selectedStep,
      approval: approval(plan, selectedStep, { maxOperations: 1 }),
      adapter: selectedAdapter,
      stateStore: new InMemorySignalExecutionStateStore(),
      now: () => now,
    });

    expect(result.status).toBe("failed");
    expect(result.blockReason).toBe("operation_safety_violation");
    expect(result.paidLiveOperationsPerformed).toBe(2);
    expect(result.providerOperationId).toBe("over-budget-operation");
    expect(result.warnings).toContain("reported_paid_operations_exceed_approval");
  });

  it("does not classify state persistence failure after adapter success as adapter_failed", async () => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const selectedAdapter = adapter(selectedStep);

    const result = await executeApprovedSignal({
      plan,
      step: selectedStep,
      approval: approval(plan, selectedStep),
      adapter: selectedAdapter,
      stateStore: new CompletionFailingStateStore(),
      now: () => now,
    });

    expect(result.status).toBe("failed");
    expect(result.blockReason).toBe("state_persistence_failed");
    expect(result.blockReason).not.toBe("adapter_failed");
    expect(result.providerOperationId).toBe("mock-operation");
    expect(result.operationCount).toBe(1);
    expect(result.warnings.join(" ")).toContain("provider operation may already have succeeded");
    expect(selectedAdapter.execute).toHaveBeenCalledTimes(1);
  });

  it("executes a valid approved Garmin search-volume step through a mock adapter exactly once", async () => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const selectedAdapter = adapter(selectedStep);
    const executor = new ControlledSignalExecutor({
      stateStore: new InMemorySignalExecutionStateStore(),
      now: () => now,
    });

    const result = await executor.executeApprovedSignal({
      plan,
      step: selectedStep,
      approval: approval(plan, selectedStep),
      adapter: selectedAdapter,
    });

    expect(result.status).toBe("completed");
    expect(result.provider).toBe("dataforseo_google_ads");
    expect(result.signal).toBe("search_volume_google_ads");
    expect(result.operationCount).toBe(1);
    expect(result.httpRequestCount).toBe(0);
    expect(result.paidLiveOperationsPerformed).toBe(0);
    expect(result.metadata).toEqual({
      monthlySearchVolume: 12345,
      query: "Garmin Venu 4",
    });
    expect(selectedAdapter.execute).toHaveBeenCalledTimes(1);
  });

  it("keeps eligible distinct from executed", async () => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");

    expect(selectedStep.futureExecutionEligibility).toBe("eligible");
    expect(selectedStep.executionAllowed).toBe(false);
    expect(plan.executionAllowed).toBe(false);
    expect(selectedStep.requirements).toContain("explicit_live_approval");
  });

  it("does not fabricate provider IDs for Garmin and keeps Shopping Reviews at needs_identity", async () => {
    const plan = await garminPlan();
    const detailedReviews = step(plan, "dataforseo_google_shopping_reviews", "reviews");

    expect(plan.product.source).toBe("user_search");
    expect(detailedReviews.futureExecutionEligibility).toBe("needs_identity");
    expect(detailedReviews.providerIdentity.providerIdFieldsPresent).toEqual([]);
    expect(detailedReviews.providerIdentity.providerIdsPresent).toBe(false);
  });

  it("does not invoke fetch during approved mock execution", async () => {
    const plan = await garminPlan();
    const selectedStep = step(plan, "dataforseo_google_ads", "search");
    const selectedAdapter = adapter(selectedStep);
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(() => {
      throw new Error("fetch must not run during mock execution validation");
    });

    Object.defineProperty(globalThis, "fetch", {
      value: fetchSpy,
      configurable: true,
    });

    try {
      const result = await executeApprovedSignal({
        plan,
        step: selectedStep,
        approval: approval(plan, selectedStep),
        adapter: selectedAdapter,
        stateStore: new InMemorySignalExecutionStateStore(),
        now: () => now,
      });

      expect(result.status).toBe("completed");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(selectedAdapter.execute).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        value: originalFetch,
        configurable: true,
      });
    }
  });

  it("keeps provider HTTP imports and task endpoints out of the controlled executor", () => {
    const source = readFileSync(new URL("../signalExecutor.ts", import.meta.url), "utf8");

    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("task_post");
    expect(source).not.toContain("task_get");
    expect(source).not.toContain("../providers");
    expect(source).not.toContain("../reviews");
    expect(source).not.toContain("../search");
    expect(source).not.toContain("../reddit");
  });
});
