import type { FetchLike } from "../../app/lib/data/search/client";
import type { ProcessPaidOperationGuard } from "../runtime/processPaidOperationGuard";

export const CONTROLLED_MAX_HTTP_REQUESTS = 10;
export const CONTROLLED_MAX_PAID_OPERATIONS = 4;
export const CONTROLLED_MAX_TASK_POSTS = 2;
export const CONTROLLED_PROVIDER_REQUEST_TIMEOUT_MS = 5_000;

export interface ProviderRequestUsage {
  httpRequestCount: number;
  paidOperationCount: number;
  taskPostCount: number;
}

export interface ProviderRequestBudgetOptions {
  canRequest?: () => boolean;
  onProcessPaidOperationRejected?: () => void;
  onUsage?: (usage: ProviderRequestUsage) => void;
  processPaidOperationGuard?: ProcessPaidOperationGuard;
}

export class ProviderRequestBudget {
  private httpRequestCount = 0;
  private paidOperationCount = 0;
  private taskPostCount = 0;
  private readonly postedPaths = new Set<string>();

  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly maxHttpRequests = CONTROLLED_MAX_HTTP_REQUESTS,
    private readonly maxPaidOperations = CONTROLLED_MAX_PAID_OPERATIONS,
    private readonly requestTimeoutMs = CONTROLLED_PROVIDER_REQUEST_TIMEOUT_MS,
    private readonly options: ProviderRequestBudgetOptions = {}
  ) {}

  readonly fetch: FetchLike = async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const path = new URL(url).pathname;
    const isPaidOperation = method === "POST";
    const isTaskPost = isPaidOperation && path.includes("/task_post");

    if (this.options.canRequest && !this.options.canRequest()) {
      throw new Error("controlled_analysis_deadline_exceeded");
    }

    if (this.httpRequestCount >= this.maxHttpRequests) {
      throw new Error("controlled_http_budget_exhausted");
    }
    if (isPaidOperation && this.paidOperationCount >= this.maxPaidOperations) {
      throw new Error("controlled_paid_operation_budget_exhausted");
    }
    if (isTaskPost && this.taskPostCount >= CONTROLLED_MAX_TASK_POSTS) {
      throw new Error("controlled_task_post_budget_exhausted");
    }
    if (isPaidOperation && this.postedPaths.has(path)) {
      throw new Error("unsafe_provider_post_retry_blocked");
    }

    if (isPaidOperation && this.options.processPaidOperationGuard) {
      try {
        this.options.processPaidOperationGuard.reserve();
      } catch (error) {
        this.options.onProcessPaidOperationRejected?.();
        throw error;
      }
    }

    this.httpRequestCount += 1;
    if (isPaidOperation) {
      this.paidOperationCount += 1;
      this.postedPaths.add(path);
      if (isTaskPost) this.taskPostCount += 1;
    }
    this.options.onUsage?.(this.usage());

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.fetchImpl(url, init),
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(() => reject(new Error("controlled_provider_request_timeout")), this.requestTimeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  usage(): ProviderRequestUsage {
    return {
      httpRequestCount: this.httpRequestCount,
      paidOperationCount: this.paidOperationCount,
      taskPostCount: this.taskPostCount,
    };
  }
}
