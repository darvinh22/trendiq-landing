import { calculateConfidenceScore } from "../scoring/confidenceEngine";
import { calculateTrendMomentum } from "../scoring/momentumEngine";
import { calculateTrendIQScore } from "../scoring/scoreEngine";
import { createDataForSeoTrendsExecutionAdapter } from "./capabilities/dataForSeoTrendsAdapter";
import {
  discoverProviderIdentity,
  executeApprovedSignal,
  resolveProductQuery,
  buildSignalExecutionPlan,
} from "./capabilities";
import { buildTrendIQSnapshotProvenanceSummary } from "./liveDataAudit";
import { aggregateSignals } from "./signalAggregator";
import type {
  ProductResolutionResult,
  ProviderIdentityDiscoveryResult,
  SignalExecutionApproval,
  SignalExecutionPlan,
  SignalExecutionResult,
  SignalExecutionStateStore,
  SignalExecutionStep,
} from "./capabilities";
import type { SearchInterestClient, SearchProviderConfig } from "./search/types";
import type { NormalizedTrendSignal, ProductTrendSnapshot } from "./types";

export interface ControlledLiveSearchApprovalContext {
  resolution: ProductResolutionResult;
  identity: ProviderIdentityDiscoveryResult;
  plan: SignalExecutionPlan;
  primaryStep: SignalExecutionStep;
  trendsSteps: SignalExecutionStep[];
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
  searchConfig?: SearchProviderConfig;
  now?: () => Date;
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

function buildSnapshot(input: {
  productId: string;
  timestamp: string;
  rawSignals: NormalizedTrendSignal[];
}): ProductTrendSnapshot {
  const aggregation = aggregateSignals(input.productId, input.rawSignals, input.timestamp);
  const trendIQScore = calculateTrendIQScore(aggregation.aggregatedSignals);
  const confidence = calculateConfidenceScore(aggregation.confidenceSignals);
  const trendStatus = calculateTrendMomentum({
    changePercent: aggregation.aggregatedSignals.growthVelocity.trendChangePercent,
    current7dRelativeInterest: aggregation.aggregatedSignals.searchMomentum.current7dRelativeInterest,
    previous7dRelativeInterest: aggregation.aggregatedSignals.searchMomentum.previous7dRelativeInterest,
    hasSearchGrowthContext: aggregation.aggregatedSignals.growthVelocity.hasSearchDerivedVelocity,
    hasLowBaseSearchGrowth: aggregation.aggregatedSignals.searchMomentum.hasLowBaseSearchGrowth,
  });
  const liveDataAudit = buildTrendIQSnapshotProvenanceSummary({
    sourceMode: "live",
    rawSignals: aggregation.rawSignals,
    trendIQScore,
    confidence,
    trendStatus,
  });

  return {
    productId: input.productId,
    timestamp: input.timestamp,
    sourceMode: "live",
    rawSignals: aggregation.rawSignals,
    aggregatedSignals: aggregation.aggregatedSignals,
    trendIQScore,
    confidence,
    trendStatus,
    provenance: aggregation.provenance,
    liveDataAudit,
  };
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
    blockedSteps,
  };
  const approvals = [
    ...(options.approvals ?? []),
    ...((await options.approve?.(context)) ?? []),
  ];
  const primaryApproval = matchingApproval(approvals, plan, primaryStep);
  const producedSteps = trendsSteps.filter((step) => matchingApproval(approvals, plan, step));
  const adapter = createDataForSeoTrendsExecutionAdapter({
    step: primaryStep,
    client: options.searchClient,
    config: options.searchConfig,
    now,
    producedSignals: producedSteps.map((step) => step.signal),
  });
  const executionResult = await executeApprovedSignal({
    plan,
    step: primaryStep,
    approval: primaryApproval,
    adapter,
    stateStore: options.stateStore,
    now,
  });
  const rawSignals = executionResult.status === "completed" ? executionResult.signals : [];
  const snapshot = buildSnapshot({
    productId: resolution.profile.productId,
    timestamp,
    rawSignals,
  });

  return {
    resolution,
    identity,
    plan,
    primaryStep,
    producedSteps,
    blockedSteps,
    executionResults: [executionResult],
    rawSignals,
    snapshot,
  };
}
