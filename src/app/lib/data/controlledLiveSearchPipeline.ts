import { createDataForSeoGoogleAdsSearchVolumeExecutionAdapter } from "./capabilities/dataForSeoGoogleAdsSearchVolumeAdapter";
import { createDataForSeoTrendsExecutionAdapter } from "./capabilities/dataForSeoTrendsAdapter";
import {
  discoverProviderIdentity,
  executeApprovedSignal,
  resolveProductQuery,
  buildSignalExecutionPlan,
} from "./capabilities";
import { buildProductTrendSnapshotFromSignals } from "./snapshotEngine";
import type {
  ProductResolutionResult,
  ProviderIdentityDiscoveryResult,
  SignalExecutionApproval,
  SignalExecutionPlan,
  SignalExecutionResult,
  SignalExecutionStateStore,
  SignalExecutionStep,
} from "./capabilities";
import type { SearchInterestClient, SearchProviderConfig, SearchVolumeClient } from "./search/types";
import type { NormalizedTrendSignal, ProductTrendSnapshot } from "./types";

export interface ControlledLiveSearchApprovalContext {
  resolution: ProductResolutionResult;
  identity: ProviderIdentityDiscoveryResult;
  plan: SignalExecutionPlan;
  primaryStep: SignalExecutionStep;
  trendsSteps: SignalExecutionStep[];
  googleAdsSearchVolumeStep?: SignalExecutionStep;
  blockedSteps: SignalExecutionStep[];
}

export interface RunControlledLiveSearchToScoreOptions {
  query: string;
  approvals?: readonly SignalExecutionApproval[];
  approve?: (
    context: ControlledLiveSearchApprovalContext
  ) => readonly SignalExecutionApproval[] | Promise<readonly SignalExecutionApproval[]>;
  stateStore?: SignalExecutionStateStore;
  searchClient?: SearchInterestClient;
  searchVolumeClient?: SearchVolumeClient;
  searchConfig?: SearchProviderConfig;
  now?: () => Date;
  onExecutionDiagnostic?: (diagnostic: ControlledProviderExecutionDiagnostic) => void;
}

export interface ControlledProviderExecutionDiagnostic {
  provider: SignalExecutionResult["provider"];
  signal: SignalExecutionResult["signal"];
  executionStatus: SignalExecutionResult["status"];
  blockReason?: SignalExecutionResult["blockReason"];
  emittedSignalCount: number;
  warningCount: number;
}

export interface ControlledLiveSearchToScoreResult {
  resolution: ProductResolutionResult;
  identity: ProviderIdentityDiscoveryResult;
  plan: SignalExecutionPlan;
  primaryStep: SignalExecutionStep;
  producedSteps: SignalExecutionStep[];
  blockedSteps: SignalExecutionStep[];
  executionResults: SignalExecutionResult[];
  rawSignals: NormalizedTrendSignal[];
  snapshot: ProductTrendSnapshot;
}

function stableNow(now: (() => Date) | undefined): () => Date {
  const timestamp = (now?.() ?? new Date()).toISOString();
  return () => new Date(timestamp);
}

function isDataForSeoTrendsStep(step: SignalExecutionStep): boolean {
  return step.provider === "dataforseo_trends" &&
    (step.signal === "search_momentum_trends" || step.signal === "growth_velocity_trends");
}

function isDataForSeoGoogleAdsSearchVolumeStep(step: SignalExecutionStep): boolean {
  return step.provider === "dataforseo_google_ads" && step.signal === "search_volume_google_ads";
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function approvalMatchesStep(
  approval: SignalExecutionApproval,
  plan: SignalExecutionPlan,
  step: SignalExecutionStep
): boolean {
  return approval.approved === true &&
    approval.planId === plan.planId &&
    approval.stepId === step.stepId &&
    approval.signal === step.signal &&
    approval.provider === step.provider &&
    approval.capability === step.capability &&
    approval.productId === plan.product.productId &&
    approval.canonicalProduct === plan.product.canonicalTitle &&
    approval.query === plan.product.query &&
    hasText(approval.approvedAt) &&
    Number.isFinite(approval.maxOperations) &&
    Number.isInteger(approval.maxOperations) &&
    approval.maxOperations >= 1;
}

function matchingApproval(
  approvals: readonly SignalExecutionApproval[],
  plan: SignalExecutionPlan,
  step: SignalExecutionStep
): SignalExecutionApproval | undefined {
  return approvals.find((approval) => approvalMatchesStep(approval, plan, step));
}

function publishExecutionDiagnostic(
  callback: RunControlledLiveSearchToScoreOptions["onExecutionDiagnostic"],
  result: SignalExecutionResult
): void {
  if (!callback) return;

  try {
    callback({
      provider: result.provider,
      signal: result.signal,
      executionStatus: result.status,
      ...(result.blockReason ? { blockReason: result.blockReason } : {}),
      emittedSignalCount: result.signals.length,
      warningCount: result.warnings.length,
    });
  } catch {
    // Diagnostics must never change controlled execution or scoring behavior.
  }
}

export function createScopedSignalExecutionApproval(input: {
  plan: SignalExecutionPlan;
  step: SignalExecutionStep;
  executionId?: string;
  approved?: boolean;
  approvedAt?: string;
  maxOperations?: number;
}): SignalExecutionApproval {
  return {
    approved: input.approved ?? true,
    executionId: input.executionId ?? `controlled:${input.step.stepId}`,
    planId: input.plan.planId,
    stepId: input.step.stepId,
    signal: input.step.signal,
    provider: input.step.provider,
    capability: input.step.capability,
    productId: input.plan.product.productId,
    canonicalProduct: input.plan.product.canonicalTitle,
    query: input.plan.product.query,
    approvedAt: input.approvedAt ?? new Date(input.plan.generatedAt).toISOString(),
    maxOperations: input.maxOperations ?? 1,
  };
}

export async function runControlledLiveSearchToScore(
  options: RunControlledLiveSearchToScoreOptions
): Promise<ControlledLiveSearchToScoreResult> {
  const now = stableNow(options.now);
  const timestamp = now().toISOString();
  const resolution = await resolveProductQuery(options.query, { now });
  const identity = await discoverProviderIdentity({
    profile: resolution.profile,
    provider: "dataforseo_trends",
    capability: "search",
  }, { now });
  const plan = buildSignalExecutionPlan(resolution.profile, { now });
  const trendsSteps = plan.steps.filter(isDataForSeoTrendsStep);
  const primaryStep = trendsSteps.find((step) => step.signal === "search_momentum_trends") ?? trendsSteps[0];
  const googleAdsSearchVolumeStep = plan.steps.find(isDataForSeoGoogleAdsSearchVolumeStep);

  if (!primaryStep) {
    throw new Error(`No DataForSEO Trends execution step was planned for ${resolution.profile.productId}.`);
  }

  const blockedSteps = plan.steps.filter((step) => step.futureExecutionEligibility !== "eligible");
  const context: ControlledLiveSearchApprovalContext = {
    resolution,
    identity,
    plan,
    primaryStep,
    trendsSteps,
    googleAdsSearchVolumeStep,
    blockedSteps,
  };
  const approvals = [
    ...(options.approvals ?? []),
    ...((await options.approve?.(context)) ?? []),
  ];
  const primaryApproval = matchingApproval(approvals, plan, primaryStep);
  const googleAdsSearchVolumeApproval = googleAdsSearchVolumeStep
    ? matchingApproval(approvals, plan, googleAdsSearchVolumeStep)
    : undefined;
  const approvedTrendsSteps = trendsSteps.filter((step) => matchingApproval(approvals, plan, step));
  const producedSteps = [
    ...approvedTrendsSteps,
    ...(googleAdsSearchVolumeStep && googleAdsSearchVolumeApproval ? [googleAdsSearchVolumeStep] : []),
  ];
  const executionResults: SignalExecutionResult[] = [];
  const shouldExecutePrimaryTrendsStep = Boolean(primaryApproval) || !googleAdsSearchVolumeApproval;

  if (shouldExecutePrimaryTrendsStep) {
    const adapter = createDataForSeoTrendsExecutionAdapter({
      step: primaryStep,
      client: options.searchClient,
      config: options.searchConfig,
      now,
      producedSignals: approvedTrendsSteps.map((step) => step.signal),
    });
    const executionResult = await executeApprovedSignal({
      plan,
      step: primaryStep,
      approval: primaryApproval,
      adapter,
      stateStore: options.stateStore,
      now,
    });
    executionResults.push(executionResult);
    publishExecutionDiagnostic(options.onExecutionDiagnostic, executionResult);
  }

  if (googleAdsSearchVolumeStep && googleAdsSearchVolumeApproval) {
    const adapter = createDataForSeoGoogleAdsSearchVolumeExecutionAdapter({
      step: googleAdsSearchVolumeStep,
      client: options.searchVolumeClient,
      config: options.searchConfig,
      now,
    });
    const executionResult = await executeApprovedSignal({
      plan,
      step: googleAdsSearchVolumeStep,
      approval: googleAdsSearchVolumeApproval,
      adapter,
      stateStore: options.stateStore,
      now,
    });
    executionResults.push(executionResult);
    publishExecutionDiagnostic(options.onExecutionDiagnostic, executionResult);
  }

  const rawSignals = executionResults
    .filter((result) => result.status === "completed")
    .flatMap((result) => result.signals);
  const snapshot = buildProductTrendSnapshotFromSignals(resolution.profile.productId, rawSignals, {
    timestamp,
    sourceMode: "live",
  });

  return {
    resolution,
    identity,
    plan,
    primaryStep,
    producedSteps,
    blockedSteps,
    executionResults,
    rawSignals,
    snapshot,
  };
}
