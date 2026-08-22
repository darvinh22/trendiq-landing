import type { FetchLike } from "../search/client";
import { evaluateGoogleShoppingProductMatch, matchConfidenceMeetsThreshold } from "./matching";
import type {
  GoogleShoppingProductCandidate,
  GoogleShoppingReviewsClient,
  GoogleShoppingReviewObservation,
  ProductMatchConfidence,
  ReviewProviderConfig,
  ReviewProductIdentityConfig,
} from "./types";

export const DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH = "/v3/merchant/google/products/task_post";
export const DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX =
  "/v3/merchant/google/products/task_get/advanced";

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

interface DataForSeoGoogleShoppingRating {
  value?: number | null;
  rating_max?: number | null;
  rating_count?: number | null;
  votes_count?: number | null;
}

interface DataForSeoGoogleShoppingProductItem {
  type?: string;
  rank_group?: number;
  rank_absolute?: number;
  title?: string;
  seller?: string;
  product_id?: string | null;
  data_docid?: string | null;
  gid?: string | null;
  reviews_count?: number | null;
  product_rating?: DataForSeoGoogleShoppingRating | null;
  is_best_match?: boolean;
}

interface DataForSeoGoogleShoppingProductsResult {
  datetime?: string;
  items?: DataForSeoGoogleShoppingProductItem[];
}

interface DataForSeoTask<TResult = unknown> {
  id?: string;
  status_code?: number;
  status_message?: string;
  cost?: number;
  result?: TResult[];
}

interface DataForSeoResponse<TResult = unknown> {
  status_code?: number;
  status_message?: string;
  tasks_error?: number;
  tasks?: DataForSeoTask<TResult>[];
}

export interface DataForSeoGoogleShoppingProductsRequestPayload {
  keyword: string;
  location_code: number;
  language_code: string;
  depth: number;
  tag: string;
}

export interface ReviewProviderErrorDiagnostics {
  endpoint?: string;
  httpStatus?: number;
  dataForSeoStatusCode?: number;
  dataForSeoStatusMessage?: string;
  tasksError?: number;
  taskDiagnostics?: Array<{
    statusCode?: number;
    statusMessage?: string;
  }>;
  requestPayload?: DataForSeoGoogleShoppingProductsRequestPayload[];
  responseBodyParsed?: boolean;
}

export class ReviewProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly diagnostics?: ReviewProviderErrorDiagnostics
  ) {
    super(message);
    this.name = "ReviewProviderError";
  }
}

function getFetch(fetchImpl?: FetchLike): FetchLike {
  const runtimeFetch = (globalThis as { fetch?: FetchLike }).fetch;

  if (fetchImpl) return fetchImpl;
  if (runtimeFetch) return runtimeFetch;

  throw new ReviewProviderError("No fetch implementation is available for review provider requests");
}

function encodeBasicAuth(login: string, password: string): string {
  const raw = `${login}:${password}`;
  const browserBtoa = (globalThis as { btoa?: (value: string) => string }).btoa;
  const nodeBuffer = (globalThis as {
    Buffer?: { from(value: string): { toString(encoding: string): string } };
  }).Buffer;

  if (browserBtoa) return browserBtoa(raw);
  if (nodeBuffer) return nodeBuffer.from(raw).toString("base64");

  throw new ReviewProviderError("No base64 encoder is available for DataForSEO authentication");
}

function asDataForSeoResponse<TResult = unknown>(value: unknown): DataForSeoResponse<TResult> {
  return value && typeof value === "object" ? value as DataForSeoResponse<TResult> : {};
}

function buildDataForSeoDiagnostics(input: {
  response?: DataForSeoResponse;
  endpoint?: string;
  httpStatus?: number;
  requestPayload?: DataForSeoGoogleShoppingProductsRequestPayload[];
  responseBodyParsed?: boolean;
}): ReviewProviderErrorDiagnostics {
  const response = input.response ?? {};
  const taskDiagnostics = response.tasks
    ?.map((task) => ({
      statusCode: task.status_code,
      statusMessage: task.status_message,
    }))
    .filter((task) => task.statusCode !== undefined || task.statusMessage !== undefined);

  return {
    endpoint: input.endpoint,
    httpStatus: input.httpStatus,
    dataForSeoStatusCode: response.status_code,
    dataForSeoStatusMessage: response.status_message,
    tasksError: response.tasks_error,
    taskDiagnostics: taskDiagnostics?.length ? taskDiagnostics : undefined,
    requestPayload: input.requestPayload,
    responseBodyParsed: input.responseBodyParsed,
  };
}

async function readDataForSeoDiagnostics(input: {
  response: FetchResponseLike;
  endpoint: string;
  requestPayload?: DataForSeoGoogleShoppingProductsRequestPayload[];
}): Promise<ReviewProviderErrorDiagnostics> {
  try {
    const text = await input.response.text();
    const parsed = text ? JSON.parse(text) : undefined;

    return buildDataForSeoDiagnostics({
      response: asDataForSeoResponse(parsed),
      endpoint: input.endpoint,
      httpStatus: input.response.status,
      requestPayload: input.requestPayload,
      responseBodyParsed: true,
    });
  } catch {
    return buildDataForSeoDiagnostics({
      endpoint: input.endpoint,
      httpStatus: input.response.status,
      requestPayload: input.requestPayload,
      responseBodyParsed: false,
    });
  }
}

function createDataForSeoErrorMessage(httpStatus: number, diagnostics: ReviewProviderErrorDiagnostics): string {
  const dataForSeoMessage = diagnostics.dataForSeoStatusMessage
    ?? diagnostics.taskDiagnostics?.find((task) => task.statusMessage)?.statusMessage;

  return dataForSeoMessage
    ? `DataForSEO request failed with HTTP ${httpStatus}: ${dataForSeoMessage}`
    : `DataForSEO request failed with HTTP ${httpStatus}`;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function selectRatingEvidence(item: DataForSeoGoogleShoppingProductItem): Pick<
  GoogleShoppingProductCandidate,
  | "writtenReviewCount"
  | "ratingVoteCount"
  | "ratingCount"
  | "ratingEvidenceCount"
  | "ratingEvidenceSourceField"
  | "ratingEvidenceComposition"
> {
  const writtenReviewCount = finiteNumber(item.reviews_count);
  const ratingVoteCount = finiteNumber(item.product_rating?.votes_count);
  const ratingCount = finiteNumber(item.product_rating?.rating_count);

  if (typeof ratingCount === "number") {
    if (typeof writtenReviewCount === "number" && ratingCount < writtenReviewCount) {
      return {
        writtenReviewCount,
        ratingVoteCount,
        ratingCount,
        ratingEvidenceSourceField: "inconsistent_provider_counts",
        ratingEvidenceComposition: "inconsistent_rating_count_lt_reviews_count",
      };
    }

    return {
      writtenReviewCount,
      ratingVoteCount,
      ratingCount,
      ratingEvidenceCount: ratingCount,
      ratingEvidenceSourceField: "product_rating.rating_count",
      ratingEvidenceComposition: typeof writtenReviewCount === "number"
        ? "total_rating_count_with_written_reviews"
        : "total_rating_count",
    };
  }

  if (typeof ratingVoteCount === "number") {
    if (typeof writtenReviewCount === "number" && ratingVoteCount < writtenReviewCount) {
      return {
        writtenReviewCount,
        ratingVoteCount,
        ratingCount,
        ratingEvidenceSourceField: "inconsistent_provider_counts",
        ratingEvidenceComposition: "inconsistent_votes_count_lt_reviews_count",
      };
    }

    return {
      writtenReviewCount,
      ratingVoteCount,
      ratingCount,
      ratingEvidenceCount: ratingVoteCount,
      ratingEvidenceSourceField: "product_rating.votes_count",
      ratingEvidenceComposition: typeof writtenReviewCount === "number"
        ? "rating_votes_with_written_reviews"
        : "rating_votes_only",
    };
  }

  if (typeof writtenReviewCount === "number") {
    return {
      writtenReviewCount,
      ratingVoteCount,
      ratingCount,
      ratingEvidenceCount: writtenReviewCount,
      ratingEvidenceSourceField: "reviews_count",
      ratingEvidenceComposition: "written_reviews_only",
    };
  }

  return {
    writtenReviewCount,
    ratingVoteCount,
    ratingCount,
  };
}

function toIsoTimestamp(value: string | undefined, fallback: string): string {
  if (!value) return fallback;

  const normalized = value.replace(" ", "T").replace(" +00:00", "Z");
  const parsed = new Date(normalized);

  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function findSuccessfulTask<TResult>(
  response: DataForSeoResponse<TResult>,
  emptyMessage: string
): DataForSeoTask<TResult> {
  if (response.status_code !== 20000) {
    throw new ReviewProviderError(
      response.status_message ?? "DataForSEO request failed",
      response.status_code,
      buildDataForSeoDiagnostics({ response, responseBodyParsed: true })
    );
  }

  const task = response.tasks?.find((candidate) => candidate.status_code === 20000);

  if (!task) {
    throw new ReviewProviderError(emptyMessage);
  }

  return task;
}

function mapProductCandidate(item: DataForSeoGoogleShoppingProductItem): GoogleShoppingProductCandidate | undefined {
  const title = stringOrUndefined(item.title);
  if (!title) return undefined;
  const ratingEvidence = selectRatingEvidence(item);

  return {
    title,
    seller: stringOrUndefined(item.seller),
    identifiers: {
      productId: stringOrUndefined(item.product_id),
      dataDocid: stringOrUndefined(item.data_docid),
      gid: stringOrUndefined(item.gid),
    },
    averageRating: finiteNumber(item.product_rating?.value),
    ratingMax: finiteNumber(item.product_rating?.rating_max),
    ...ratingEvidence,
    rankGroup: finiteNumber(item.rank_group),
    rankAbsolute: finiteNumber(item.rank_absolute),
    isBestMatch: item.is_best_match,
  };
}

export function mapDataForSeoGoogleShoppingProductsResponse(input: {
  response: unknown;
  productId: string;
  identity: ReviewProductIdentityConfig;
  locationCode: number;
  languageCode: string;
  fetchedAt: string;
  endpoint?: string;
  minimumMatchConfidence?: ProductMatchConfidence;
}): GoogleShoppingReviewObservation {
  const task = findSuccessfulTask(
    asDataForSeoResponse<DataForSeoGoogleShoppingProductsResult>(input.response),
    "DataForSEO response did not include a Google Shopping Products task"
  );
  const result = task.result?.[0];
  const candidates = (result?.items ?? [])
    .filter((item) => !item.type || item.type === "google_shopping_serp")
    .map(mapProductCandidate)
    .filter((candidate): candidate is GoogleShoppingProductCandidate => Boolean(candidate));
  const scored = candidates
    .map((candidate) => ({
      candidate,
      match: evaluateGoogleShoppingProductMatch(candidate, input.identity),
    }))
    .filter((entry) =>
      typeof entry.candidate.averageRating === "number" &&
      matchConfidenceMeetsThreshold(entry.match.confidence, input.minimumMatchConfidence ?? "high")
    )
    .sort((a, b) => {
      if (b.match.score !== a.match.score) return b.match.score - a.match.score;
      return (a.candidate.rankAbsolute ?? 9999) - (b.candidate.rankAbsolute ?? 9999);
    });

  const selected = scored[0];

  if (!selected) {
    throw new ReviewProviderError("DataForSEO response did not include a high-confidence rated product match");
  }

  const sourceDatetime = stringOrUndefined(result?.datetime);

  return {
    provider: "dataforseo",
    productId: input.productId,
    searchQuery: input.identity.canonicalSearchQuery,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    fetchedAt: toIsoTimestamp(sourceDatetime, input.fetchedAt),
    sourceDatetime,
    endpoint: input.endpoint ?? DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX,
    matchedProductTitle: selected.candidate.title,
    seller: selected.candidate.seller,
    identifiers: selected.candidate.identifiers,
    averageRating: selected.candidate.averageRating ?? 0,
    ratingMax: selected.candidate.ratingMax,
    writtenReviewCount: selected.candidate.writtenReviewCount,
    ratingVoteCount: selected.candidate.ratingVoteCount,
    ratingCount: selected.candidate.ratingCount,
    ratingEvidenceCount: selected.candidate.ratingEvidenceCount,
    ratingEvidenceSourceField: selected.candidate.ratingEvidenceSourceField,
    ratingEvidenceComposition: selected.candidate.ratingEvidenceComposition,
    matchConfidence: selected.match.confidence,
    matchScore: selected.match.score,
    matchReasons: selected.match.reasons,
    providerVariantGrouping: "google_shopping_product_result_may_group_frame_and_lens_variants",
    rankGroup: selected.candidate.rankGroup,
    rankAbsolute: selected.candidate.rankAbsolute,
    isBestMatch: selected.candidate.isBestMatch,
    cost: task.cost,
  };
}

function taskIdFromPostResponse(response: unknown): string {
  const task = findSuccessfulTask(asDataForSeoResponse(response), "DataForSEO did not return a Google Shopping task id");
  const id = stringOrUndefined(task.id);

  if (!id) throw new ReviewProviderError("DataForSEO did not return a Google Shopping task id");

  return id;
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class DataForSeoGoogleShoppingProductsClient implements GoogleShoppingReviewsClient {
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly config: ReviewProviderConfig,
    fetchImpl?: FetchLike
  ) {
    this.fetchImpl = getFetch(fetchImpl);
  }

  async getProductReviewAggregate(input: {
    productId: string;
    identity: ReviewProductIdentityConfig;
    locationCode: number;
    languageCode: string;
  }): Promise<GoogleShoppingReviewObservation> {
    if (!this.config.apiLogin || !this.config.apiPassword) {
      throw new ReviewProviderError("DataForSEO credentials are missing");
    }

    const postEndpoint = `${this.config.apiBaseUrl}${DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH}`;
    const requestPayload: DataForSeoGoogleShoppingProductsRequestPayload[] = [
      {
        keyword: input.identity.canonicalSearchQuery,
        location_code: input.locationCode,
        language_code: input.languageCode,
        depth: this.config.taskDepth,
        tag: `trendiq:${input.productId}:review-quality:google-shopping`,
      },
    ];
    const postResponse = await this.fetchImpl(postEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${encodeBasicAuth(this.config.apiLogin, this.config.apiPassword)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestPayload),
    });

    if (!postResponse.ok) {
      const diagnostics = await readDataForSeoDiagnostics({
        response: postResponse,
        endpoint: postEndpoint,
        requestPayload,
      });

      throw new ReviewProviderError(
        createDataForSeoErrorMessage(postResponse.status, diagnostics),
        postResponse.status,
        diagnostics
      );
    }

    const taskId = taskIdFromPostResponse(await postResponse.json());
    const getEndpoint = `${this.config.apiBaseUrl}${DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX}/${taskId}`;
    let latestError: unknown;

    for (let attempt = 0; attempt < this.config.taskPollAttempts; attempt += 1) {
      if (attempt > 0) await delay(this.config.taskPollIntervalMs);

      const getResponse = await this.fetchImpl(getEndpoint, {
        method: "GET",
        headers: {
          Authorization: `Basic ${encodeBasicAuth(this.config.apiLogin, this.config.apiPassword)}`,
          "Content-Type": "application/json",
        },
      });

      if (!getResponse.ok) {
        const diagnostics = await readDataForSeoDiagnostics({
          response: getResponse,
          endpoint: getEndpoint,
        });

        throw new ReviewProviderError(
          createDataForSeoErrorMessage(getResponse.status, diagnostics),
          getResponse.status,
          diagnostics
        );
      }

      const parsedResponse = await getResponse.json();

      try {
        return mapDataForSeoGoogleShoppingProductsResponse({
          response: parsedResponse,
          productId: input.productId,
          identity: input.identity,
          locationCode: input.locationCode,
          languageCode: input.languageCode,
          fetchedAt: this.config.now().toISOString(),
          endpoint: DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX,
          minimumMatchConfidence: this.config.minimumMatchConfidence,
        });
      } catch (error) {
        latestError = error;
      }
    }

    if (latestError instanceof ReviewProviderError) throw latestError;
    throw new ReviewProviderError("DataForSEO Google Shopping task did not return usable review data");
  }
}
