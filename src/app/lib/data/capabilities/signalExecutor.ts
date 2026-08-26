import type {
  FutureExecutionEligibility,
  ProductIdentityConfidence,
  ProviderExecutionAdapter,
  SignalExecutionAdapterOutput,
  SignalExecutionApproval,
  SignalExecutionBlockReason,
  SignalExecutionPlan,
  SignalExecutionResult,
  SignalExecutionState,
  SignalExecutionStateStore,
  SignalExecutionStep,
} from "./types";

export interface ExecuteApprovedSignalInput {
  plan: SignalExecutionPlan;
  step: SignalExecutionStep;
  approval?: SignalExecutionApproval;
  adapter: ProviderExecutionAdapter;
  stateStore?: SignalExecutionStateStore;
  now?: () => Date;
}

export class InMemorySignalExecutionStateStore implements SignalExecutionStateStore {
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

  async setCompleted(state: SignalExecutionState): Promise<void> {
    this.states.set(state.executionId, state);
  }

  async setFailed(state: SignalExecutionState): Promise<void> {
    this.states.set(state.executionId, state);
  }

  clear(): void {
    this.states.clear();
  }
}

const IDENTITY_BLOCK_REASONS: Record<FutureExecutionEligibility, SignalExecutionBlockReason> = {
  eligible: "explicit_live_approval_required",
  needs_identity: "needs_product_identity",
  needs_guardrail: "needs_guardrail",
  blocked: "blocked_by_provider_policy",
  unsupported: "unsupported_capability",
};

const FORBIDDEN_METADATA_KEY = /(authorization|auth|password|secret|token|api[_-]?key|credential|header)/i;

function confidenceRank(confidence: ProductIdentityConfidence): number {
  const ranks: Record<ProductIdentityConfidence, number> = {
    low: 1,
    medium: 2,
    high: 3,
  };

  return ranks[confidence];
}

function isAtLeastConfidence(
  actual: ProductIdentityConfidence,
  required: ProductIdentityConfidence
): boolean {
  return confidenceRank(actual) >= confidenceRank(required);
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;

  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function emptyResult(input: {
  step: SignalExecutionStep;
  plan: SignalExecutionPlan;
  executionId?: string;
  status: SignalExecutionResult["status"];
  blockReason?: SignalExecutionBlockReason;
  observedAt: string;
  warnings: string[];
}): SignalExecutionResult {
  return {
    executionId: input.executionId ?? "unapproved",
    planId: input.plan.planId,
    stepId: input.step.stepId,
    provider: input.step.provider,
    capability: input.step.capability,
    signal: input.step.signal,
    status: input.status,
    blockReason: input.blockReason,
    canonicalProduct: input.step.canonicalTitle,
    query: input.step.query,
    provenance: {
      mode: "fallback",
      provider: input.step.provider,
      observedAt: input.observedAt,
      notes: "No provider observation was made.",
    },
    observedAt: input.observedAt,
    cacheState: input.step.cache,
    operationCount: 0,
    httpRequestCount: 0,
    paidLiveOperationsPerformed: 0,
    warnings: input.warnings,
  };
}

function approvalScopeMismatch(
  plan: SignalExecutionPlan,
  step: SignalExecutionStep,
  approval: SignalExecutionApproval
): string | undefined {
  if (approval.planId !== plan.planId) return "approval_plan_id_mismatch";
  if (approval.stepId !== step.stepId) return "approval_step_id_mismatch";
  if (approval.signal !== step.signal) return "approval_signal_mismatch";
  if (approval.provider !== step.provider) return "approval_provider_mismatch";
  if (approval.capability !== step.capability) return "approval_capability_mismatch";
  if (approval.productId !== plan.product.productId) return "approval_product_id_mismatch";
  if (approval.canonicalProduct !== plan.product.canonicalTitle) return "approval_canonical_product_mismatch";
  if (approval.query !== plan.product.query) return "approval_query_mismatch";
  if (!hasText(approval.approvedAt)) return "approval_timestamp_missing";
  if (
    !Number.isFinite(approval.maxOperations) ||
    !Number.isInteger(approval.maxOperations) ||
    approval.maxOperations < 1
  ) {
    return "approval_operation_budget_invalid";
  }

  return undefined;
}

function planStepScopeMismatch(
  plan: SignalExecutionPlan,
  step: SignalExecutionStep
): string | undefined {
  if (step.planId !== plan.planId) return "step_plan_id_mismatch";

  const planStep = plan.steps.find((candidate) => candidate.stepId === step.stepId);
  if (!planStep) return "step_not_in_plan";

  if (planStep.planId !== step.planId) return "plan_step_plan_id_mismatch";
  if (planStep.productId !== step.productId) return "plan_step_product_id_mismatch";
  if (planStep.canonicalTitle !== step.canonicalTitle) return "plan_step_canonical_product_mismatch";
  if (planStep.query !== step.query) return "plan_step_query_mismatch";
  if (planStep.provider !== step.provider) return "plan_step_provider_mismatch";
  if (planStep.capability !== step.capability) return "plan_step_capability_mismatch";
  if (planStep.signal !== step.signal) return "plan_step_signal_mismatch";
  if (planStep.identityMode !== step.identityMode) return "plan_step_identity_mode_mismatch";
  if (planStep.readiness !== step.readiness) return "plan_step_readiness_mismatch";
  if (planStep.futureExecutionEligibility !== step.futureExecutionEligibility) {
    return "plan_step_future_eligibility_mismatch";
  }
  if (planStep.executionAllowed !== step.executionAllowed) return "plan_step_execution_allowed_mismatch";
  if (planStep.blockReason !== step.blockReason) return "plan_step_block_reason_mismatch";
  if (planStep.estimatedPaidRequest !== step.estimatedPaidRequest) return "plan_step_paid_request_mismatch";
  if (planStep.estimatedCostCategory !== step.estimatedCostCategory) return "plan_step_cost_category_mismatch";
  if (!sameStringSet(planStep.requiredIdentityFields, step.requiredIdentityFields)) {
    return "plan_step_required_identity_mismatch";
  }
  if (!sameStringSet(planStep.missingIdentityFields, step.missingIdentityFields)) {
    return "plan_step_missing_identity_mismatch";
  }
  if (!sameStringSet(planStep.requirements, step.requirements)) return "plan_step_requirements_mismatch";
  if (planStep.providerIdentity.required !== step.providerIdentity.required) {
    return "plan_step_provider_identity_required_mismatch";
  }
  if (planStep.providerIdentity.identityMode !== step.providerIdentity.identityMode) {
    return "plan_step_provider_identity_mode_mismatch";
  }
  if (planStep.providerIdentity.providerIdsPresent !== step.providerIdentity.providerIdsPresent) {
    return "plan_step_provider_ids_present_mismatch";
  }
  if (!sameStringSet(
    planStep.providerIdentity.providerIdFieldsRequired,
    step.providerIdentity.providerIdFieldsRequired
  )) {
    return "plan_step_provider_id_requirements_mismatch";
  }
  if (!sameStringSet(
    planStep.providerIdentity.providerIdFieldsPresent,
    step.providerIdentity.providerIdFieldsPresent
  )) {
    return "plan_step_provider_id_fields_mismatch";
  }

  return undefined;
}

function routeBlockReason(step: SignalExecutionStep): SignalExecutionBlockReason {
  if (
    step.futureExecutionEligibility === "needs_identity" &&
    step.missingIdentityFields.includes("providerSpecificIds")
  ) {
    return "needs_provider_identity";
  }

  return IDENTITY_BLOCK_REASONS[step.futureExecutionEligibility];
}

function identityBlockReason(
  plan: SignalExecutionPlan,
  step: SignalExecutionStep
): SignalExecutionBlockReason | undefined {
  if (step.providerIdentity.required && !step.providerIdentity.providerIdsPresent) {
    return "needs_provider_identity";
  }

  if (
    step.requirements.includes("high_confidence_identity") &&
    !isAtLeastConfidence(plan.product.identityConfidence, "high")
  ) {
    return "needs_product_identity";
  }

  if (
    step.requirements.includes("medium_or_higher_identity") &&
    !isAtLeastConfidence(plan.product.identityConfidence, "medium")
  ) {
    return "needs_product_identity";
  }

  if (step.missingIdentityFields.includes("providerSpecificIds")) return "needs_provider_identity";
  if (step.missingIdentityFields.length > 0) return "needs_product_identity";

  return undefined;
}

function adapterMismatch(
  step: SignalExecutionStep,
  adapter: ProviderExecutionAdapter
): string | undefined {
  if (adapter.provider !== step.provider) return "adapter_provider_mismatch";
  if (adapter.capability !== step.capability) return "adapter_capability_mismatch";
  if (adapter.signal !== step.signal) return "adapter_signal_mismatch";
  return undefined;
}

function operationCountInvalid(value: number): boolean {
  return !Number.isFinite(value) || !Number.isInteger(value) || value < 1;
}

function reportedOperationCountInvalid(value: number): boolean {
  return !Number.isFinite(value) || !Number.isInteger(value) || value < 0;
}

function preflightOperationCountIssue(
  adapter: ProviderExecutionAdapter,
  approval: SignalExecutionApproval
): {
  reason: SignalExecutionBlockReason;
  warning: string;
} | undefined {
  if (operationCountInvalid(adapter.logicalOperationCount)) {
    return {
      reason: "operation_count_invalid",
      warning: "Adapter logicalOperationCount must be a finite positive integer.",
    };
  }

  if (adapter.logicalOperationCount > approval.maxOperations) {
    return {
      reason: "operation_budget_exceeded",
      warning: "Approved operation budget would be exceeded.",
    };
  }

  return undefined;
}

function sanitizedMetadata(
  metadata: SignalExecutionAdapterOutput["metadata"]
): Record<string, string | number | boolean | null> | undefined {
  if (!metadata) return undefined;

  const sanitized = Object.entries(metadata).reduce<Record<string, string | number | boolean | null>>(
    (result, [key, value]) => {
      if (FORBIDDEN_METADATA_KEY.test(key)) return result;
      if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        result[key] = value;
      }
      return result;
    },
    {}
  );

  return Object.keys(sanitized).length ? sanitized : undefined;
}

function completedResult(input: {
  plan: SignalExecutionPlan;
  step: SignalExecutionStep;
  approval: SignalExecutionApproval;
  adapter: ProviderExecutionAdapter;
  output: SignalExecutionAdapterOutput;
  observedAt: string;
}): SignalExecutionResult {
  const observedAt = input.output.observedAt ?? input.observedAt;

  return {
    executionId: input.approval.executionId,
    planId: input.plan.planId,
    stepId: input.step.stepId,
    provider: input.step.provider,
    capability: input.step.capability,
    signal: input.step.signal,
    status: "completed",
    canonicalProduct: input.step.canonicalTitle,
    query: input.step.query,
    provenance: {
      mode: input.output.provenance.mode,
      provider: input.step.provider,
      observedAt: input.output.provenance.observedAt,
      notes: input.output.provenance.notes,
    },
    observedAt,
    cacheState: input.output.cacheState ?? input.step.cache,
    operationCount: input.output.operationCount ?? input.adapter.logicalOperationCount,
    httpRequestCount: input.output.httpRequestCount ?? input.adapter.expectedHttpRequestCount,
    paidLiveOperationsPerformed: input.output.paidLiveOperationsPerformed ?? 0,
    reportedProviderCost: input.output.reportedProviderCost,
    providerOperationId: input.output.providerOperationId,
    warnings: input.output.warnings ?? [],
    metadata: sanitizedMetadata(input.output.metadata),
  };
}

function operationSafetyViolation(
  result: SignalExecutionResult,
  approval: SignalExecutionApproval
): string | undefined {
  if (reportedOperationCountInvalid(result.operationCount)) return "reported_operation_count_invalid";
  if (reportedOperationCountInvalid(result.paidLiveOperationsPerformed)) {
    return "reported_paid_operation_count_invalid";
  }
  if (result.operationCount > approval.maxOperations) return "reported_operation_count_exceeds_approval";
  if (result.paidLiveOperationsPerformed > approval.maxOperations) {
    return "reported_paid_operations_exceed_approval";
  }

  return undefined;
}

function failedAfterAdapterSuccess(
  result: SignalExecutionResult,
  reason: SignalExecutionBlockReason,
  warning: string
): SignalExecutionResult {
  return {
    ...result,
    status: "failed",
    blockReason: reason,
    warnings: [...result.warnings, warning],
  };
}

async function block(input: {
  plan: SignalExecutionPlan;
  step: SignalExecutionStep;
  approval?: SignalExecutionApproval;
  reason: SignalExecutionBlockReason;
  warning: string;
  now: Date;
}): Promise<SignalExecutionResult> {
  return emptyResult({
    plan: input.plan,
    step: input.step,
    executionId: input.approval?.executionId,
    status: "blocked",
    blockReason: input.reason,
    observedAt: input.now.toISOString(),
    warnings: [input.warning],
  });
}

export async function executeApprovedSignal(input: ExecuteApprovedSignalInput): Promise<SignalExecutionResult> {
  const now = input.now?.() ?? new Date();
  const { plan, step, approval, adapter, stateStore } = input;

  if (!approval) {
    return block({
      plan,
      step,
      reason: "explicit_live_approval_required",
      warning: "Explicit scoped approval is required before signal execution.",
      now,
    });
  }

  if (!approval.approved) {
    return block({
      plan,
      step,
      approval,
      reason: "approval_rejected",
      warning: "Approval was present but not approved.",
      now,
    });
  }

  const planStepMismatch = planStepScopeMismatch(plan, step);
  if (planStepMismatch) {
    return block({
      plan,
      step,
      approval,
      reason: "plan_step_scope_mismatch",
      warning: planStepMismatch,
      now,
    });
  }

  const scopeMismatch = approvalScopeMismatch(plan, step, approval);
  if (scopeMismatch) {
    return block({
      plan,
      step,
      approval,
      reason: "approval_scope_mismatch",
      warning: scopeMismatch,
      now,
    });
  }

  if (step.futureExecutionEligibility !== "eligible") {
    return block({
      plan,
      step,
      approval,
      reason: routeBlockReason(step),
      warning: `Route is ${step.futureExecutionEligibility}; explicit approval cannot bypass routing guards.`,
      now,
    });
  }

  const identityReason = identityBlockReason(plan, step);
  if (identityReason) {
    return block({
      plan,
      step,
      approval,
      reason: identityReason,
      warning: "Identity requirements are not satisfied for this planned signal.",
      now,
    });
  }

  const adapterReason = adapterMismatch(step, adapter);
  if (adapterReason) {
    return block({
      plan,
      step,
      approval,
      reason: "adapter_mismatch",
      warning: adapterReason,
      now,
    });
  }

  const operationCountIssue = preflightOperationCountIssue(adapter, approval);
  if (operationCountIssue) {
    return block({
      plan,
      step,
      approval,
      reason: operationCountIssue.reason,
      warning: operationCountIssue.warning,
      now,
    });
  }

  if (
    !stateStore ||
    typeof stateStore.reserveStarted !== "function" ||
    typeof stateStore.setCompleted !== "function" ||
    typeof stateStore.setFailed !== "function"
  ) {
    return block({
      plan,
      step,
      approval,
      reason: "execution_state_store_required",
      warning: "Atomic execution-state reservation is required before approved signal execution.",
      now,
    });
  }

  const startedState = {
    executionId: approval.executionId,
    planId: plan.planId,
    stepId: step.stepId,
    provider: step.provider,
    capability: step.capability,
    signal: step.signal,
    status: "started",
    startedAt: now.toISOString(),
    operationCount: adapter.logicalOperationCount,
  } satisfies SignalExecutionState;

  let reservation: Awaited<ReturnType<SignalExecutionStateStore["reserveStarted"]>>;
  try {
    reservation = await stateStore.reserveStarted(startedState);
  } catch {
    return block({
      plan,
      step,
      approval,
      reason: "state_persistence_failed",
      warning: "Execution-state reservation failed before provider execution.",
      now,
    });
  }

  if (!reservation.reserved) {
    return block({
      plan,
      step,
      approval,
      reason: "duplicate_execution",
      warning: `Execution ${approval.executionId} is already ${reservation.existing?.status ?? "reserved"}.`,
      now,
    });
  }

  let output;
  try {
    output = await adapter.execute({ step, approval });
  } catch {
    try {
      await stateStore.setFailed({
        ...startedState,
        status: "failed",
        completedAt: now.toISOString(),
      });
    } catch {
      return {
        ...emptyResult({
          plan,
          step,
          executionId: approval.executionId,
          status: "failed",
          blockReason: "adapter_failed",
          observedAt: now.toISOString(),
          warnings: [
            "Adapter execution failed; no automatic retry was attempted.",
            "Failed execution state could not be persisted.",
          ],
        }),
        operationCount: adapter.logicalOperationCount,
      };
    }

    return {
      ...emptyResult({
        plan,
        step,
        executionId: approval.executionId,
        status: "failed",
        blockReason: "adapter_failed",
        observedAt: now.toISOString(),
        warnings: ["Adapter execution failed; no automatic retry was attempted."],
      }),
      operationCount: adapter.logicalOperationCount,
    };
  }

  const result = completedResult({
    plan,
    step,
    approval,
    adapter,
    output,
    observedAt: now.toISOString(),
  });
  const safetyViolation = operationSafetyViolation(result, approval);

  if (safetyViolation) {
    const failedResult = failedAfterAdapterSuccess(
      result,
      "operation_safety_violation",
      safetyViolation
    );

    try {
      await stateStore.setFailed({
        ...startedState,
        status: "failed",
        completedAt: failedResult.observedAt,
        operationCount: failedResult.operationCount,
      });
    } catch {
      return failedAfterAdapterSuccess(
        failedResult,
        "state_persistence_failed",
        "Provider adapter returned, but failed execution-state persistence also failed."
      );
    }

    return failedResult;
  }

  try {
    await stateStore.setCompleted({
      ...startedState,
      status: "completed",
      completedAt: result.observedAt,
      operationCount: result.operationCount,
    });
  } catch {
    return failedAfterAdapterSuccess(
      result,
      "state_persistence_failed",
      "Adapter completed but execution state persistence failed; provider operation may already have succeeded."
    );
  }

  return result;
}

export class ControlledSignalExecutor {
  constructor(private readonly options: {
    stateStore?: SignalExecutionStateStore;
    now?: () => Date;
  } = {}) {}

  async executeApprovedSignal(input: {
    plan: SignalExecutionPlan;
    step: SignalExecutionStep;
    approval?: SignalExecutionApproval;
    adapter: ProviderExecutionAdapter;
  }): Promise<SignalExecutionResult> {
    return executeApprovedSignal({
      ...input,
      stateStore: this.options.stateStore,
      now: this.options.now,
    });
  }
}
