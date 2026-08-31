import type { FetchLike } from "../search/client";
import { evaluateGoogleShoppingProductMatch, matchConfidenceMeetsThreshold } from "./matching";
import { buildRatingConsensusQuality } from "./ratingConsensus";
import type {
  EphemeralProviderIdentity,
  EphemeralProviderIdentityResult,
  EphemeralProviderIdentitySource,
  GoogleShoppingDetailedReviewsRequestPlan,
  GoogleShoppingProductCandidate,
  GoogleShoppingProductIdentifier,
  GoogleShoppingRecentReviewsClient,
  GoogleShoppingRecentReviewsObservation,
  GoogleShoppingReviewItemObservation,
  GoogleShoppingReviewsClient,
  GoogleShoppingReviewObservation,
  ProductMatchConfidence,
  RatingDistributionInput,
  ReviewIdentityDecision,
  ReviewProviderConfig,
  ReviewProductIdentityConfig,
} from "./types";

export const DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_POST_PATH = "/v3/merchant/google/products/task_post";
export const DATAFORSEO_GOOGLE_SHOPPING_PRODUCTS_TASK_GET_ADVANCED_PATH_PREFIX =
  "/v3/merchant/google/products/task_get/advanced";
export const DATAFORSEO_GOOGLE_SHOPPING_REVIEWS_TASK_POST_PATH = "/v3/merchant/google/reviews/task_post";
export const DATAFORSEO_GOOGLE_SHOPPING_REVIEWS_TASK_GET_ADVANCED_PATH_PREFIX =
  "/v3/merchant/google/reviews/task_get/advanced";

const SAFE_PROVIDER_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

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

interface DataForSeoGoogleShoppingReviewItem {
  type?: string;
  rank_group?: number;
  rank_absolute?: number;
  url?: string | null;
  provided_by?: string | null;
  publication_date?: string | null;
  rating?: DataForSeoGoogleShoppingRating | null;
}

interface DataForSeoGoogleShoppingReviewsResult {
  product_id?: string | null;
  datetime?: string;
  reviews_count?: number | null;
  rating_groups?: DataForSeoGoogleShoppingRating[] | null;
  items_count?: number | null;
  items?: DataForSeoGoogleShoppingReviewItem[];
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

export interface DataForSeoGoogleShoppingReviewsRequestPayload {
  gid: string;
  product_id?: string;
  data_docid?: string;
  location_code: number;
  language_code: string;
  depth: number;
  priority: 1;
  tag: string;
}

type DataForSeoReviewRequestPayload =
  | DataForSeoGoogleShoppingProductsRequestPayload
  | DataForSeoGoogleShoppingReviewsRequestPayload;

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
  requestPayload?: DataForSeoReviewRequestPayload[];
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
  requestPayload?: DataForSeoReviewRequestPayload[];
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
  requestPayload?: DataForSeoReviewRequestPayload[];
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

function looksLikeUrlScheme(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function providerIdentifierIssue(
  value: unknown,
  field: keyof GoogleShoppingProductIdentifier,
  options: { required: boolean }
): string | undefined {
  if (value === undefined || value === null || value === "") {
    return options.required ? `missing_provider_id:${field}` : undefined;
  }

  if (typeof value !== "string") return `invalid_provider_id_type:${field}`;
  if (!value.trim()) return `missing_provider_id:${field}`;
  if (!SAFE_PROVIDER_IDENTIFIER_PATTERN.test(value) || value.includes("..") || looksLikeUrlScheme(value)) {
    return `unsafe_provider_id:${field}`;
  }

  return undefined;
}

function validateRequiredProviderIdentifier(
  value: unknown,
  field: keyof GoogleShoppingProductIdentifier
): string {
  const issue = providerIdentifierIssue(value, field, { required: true });
  if (issue) throw new ReviewProviderError(`Google Shopping provider identifier failed validation: ${issue}`);

  return value as string;
}

function validateOptionalProviderIdentifier(
  value: unknown,
  field: keyof GoogleShoppingProductIdentifier
): string | undefined {
  const issue = providerIdentifierIssue(value, field, { required: false });
  if (issue) throw new ReviewProviderError(`Google Shopping provider identifier failed validation: ${issue}`);

  return stringOrUndefined(value);
}

function canonicalIdentityIssue(identity: ReviewProductIdentityConfig): string | undefined {
  const requiredFields = ["productId", "canonicalSearchQuery", "productTitle", "brand"] as const;

  for (const field of requiredFields) {
    const value = identity[field];
    if (typeof value !== "string" || !value.trim()) return `missing_canonical_identity:${field}`;
    if (value !== value.trim()) return `unsafe_canonical_identity:${field}`;
  }

  if (identity.generation !== undefined) {
    if (typeof identity.generation !== "string" || !identity.generation.trim()) {
      return "missing_canonical_identity:generation";
    }

    if (identity.generation !== identity.generation.trim()) {
      return "unsafe_canonical_identity:generation";
    }
  }

  return undefined;
}

function semanticIdentityForAggregateEvidence(identity: ReviewProductIdentityConfig): ReviewProductIdentityConfig {
  return {
    productId: identity.productId,
    canonicalSearchQuery: identity.canonicalSearchQuery,
    productTitle: identity.productTitle,
    brand: identity.brand,
    generation: identity.generation,
    acceptedSellers: identity.acceptedSellers,
  };
}

function aggregateEvidenceTrustIssue(input: {
  title: string;
  seller?: string;
  identifiers: GoogleShoppingProductIdentifier;
  identity: ReviewProductIdentityConfig;
}): { status: "identity_not_ready" | "identity_inconclusive"; reason: string } | undefined {
  if (!input.title.trim()) {
    return {
      status: "identity_not_ready",
      reason: "missing_aggregate_candidate_title",
    };
  }

  const match = evaluateGoogleShoppingProductMatch(
    {
      title: input.title,
      seller: input.seller,
      identifiers: input.identifiers,
    },
    semanticIdentityForAggregateEvidence(input.identity)
  );

  if (match.identityDecision !== "match") {
    return {
      status: "identity_not_ready",
      reason: "aggregate_candidate_semantic_mismatch",
    };
  }

  if (match.confidence !== "high") {
    return {
      status: "identity_inconclusive",
      reason: "aggregate_candidate_semantic_confidence_not_high",
    };
  }

  return undefined;
}

function freezeDetailedReviewsRequestPlan(
  plan: GoogleShoppingDetailedReviewsRequestPlan
): GoogleShoppingDetailedReviewsRequestPlan {
  const identityEvidence = Object.freeze({
    ...plan.identityEvidence,
    matchReasons: Object.freeze([...plan.identityEvidence.matchReasons]) as unknown as string[],
  });

  return Object.freeze({
    ...plan,
    product: Object.freeze({ ...plan.product }),
    requiredProviderIds: Object.freeze({ ...plan.requiredProviderIds }),
    identityEvidence: identityEvidence as GoogleShoppingDetailedReviewsRequestPlan["identityEvidence"],
    requestPayload: Object.freeze(
      plan.requestPayload.map((payload) => Object.freeze({ ...payload }))
    ) as unknown as GoogleShoppingDetailedReviewsRequestPlan["requestPayload"],
  });
}

export function createEphemeralProviderIdentityFromAggregateObservation(input: {
  observation: GoogleShoppingReviewObservation;
  identity: ReviewProductIdentityConfig;
  candidateMatchDecision: ReviewIdentityDecision;
  source?: EphemeralProviderIdentitySource;
}): EphemeralProviderIdentityResult {
  const canonicalIssue = canonicalIdentityIssue(input.identity);
  if (canonicalIssue) {
    return {
      status: "identity_not_ready",
      reason: canonicalIssue,
    };
  }

  if (!input.observation.productId.trim()) {
    return {
      status: "identity_not_ready",
      reason: "missing_aggregate_observation_product_id",
    };
  }

  if (input.observation.productId !== input.identity.productId) {
    return {
      status: "identity_not_ready",
      reason: "aggregate_observation_product_mismatch",
    };
  }

  if (input.candidateMatchDecision !== "match") {
    return {
      status: "identity_not_ready",
      reason: "candidate_match_decision_not_match",
    };
  }

  if (input.observation.matchConfidence !== "high") {
    return {
      status: "identity_inconclusive",
      reason: "candidate_match_confidence_not_high",
    };
  }

  const gidIssue = providerIdentifierIssue(input.observation.identifiers.gid, "gid", { required: true });
  if (gidIssue) {
    return {
      status: "identity_not_ready",
      reason: gidIssue,
    };
  }

  const productIdIssue = providerIdentifierIssue(input.observation.identifiers.productId, "productId", {
    required: false,
  });
  if (productIdIssue) {
    return {
      status: "identity_not_ready",
      reason: productIdIssue,
    };
  }

  const dataDocidIssue = providerIdentifierIssue(input.observation.identifiers.dataDocid, "dataDocid", {
    required: false,
  });
  if (dataDocidIssue) {
    return {
      status: "identity_not_ready",
      reason: dataDocidIssue,
    };
  }

  const trustIssue = aggregateEvidenceTrustIssue({
    title: input.observation.matchedProductTitle,
    seller: input.observation.seller,
    identifiers: input.observation.identifiers,
    identity: input.identity,
  });
  if (trustIssue) return trustIssue;

  const observedProductId = stringOrUndefined(input.observation.identifiers.productId);
  const observedDataDocid = stringOrUndefined(input.observation.identifiers.dataDocid);

  return {
    status: "ready",
    identity: {
      provider: input.observation.provider,
      productId: input.observation.productId,
      identifiers: {
        gid: input.observation.identifiers.gid as string,
        ...(observedProductId ? { productId: observedProductId } : {}),
        ...(observedDataDocid ? { dataDocid: observedDataDocid } : {}),
      },
      evidence: {
        source: input.source ?? "google_shopping_aggregate_candidate",
        matchDecision: "match",
        matchConfidence: "high",
        matchedProductTitle: input.observation.matchedProductTitle,
        seller: input.observation.seller,
        matchReasons: input.observation.matchReasons,
        observedAt: input.observation.fetchedAt,
      },
    },
  };
}

export function buildDataForSeoGoogleShoppingReviewsRequestPlan(input: {
  productId: string;
  identity: ReviewProductIdentityConfig;
  ephemeralIdentity: EphemeralProviderIdentity;
  locationCode: number;
  languageCode: string;
  depth: number;
  tag?: string;
}): GoogleShoppingDetailedReviewsRequestPlan {
  if (input.ephemeralIdentity.provider !== "dataforseo") {
    throw new ReviewProviderError("Detailed review request plan requires a DataForSEO provider identity");
  }

  const canonicalIssue = canonicalIdentityIssue(input.identity);
  if (canonicalIssue) {
    throw new ReviewProviderError(
      `Detailed review request plan requires a valid canonical product identity: ${canonicalIssue}`
    );
  }

  if (!input.productId.trim() || input.productId !== input.productId.trim()) {
    throw new ReviewProviderError("Detailed review request plan product ID is invalid");
  }

  if (input.ephemeralIdentity.productId !== input.productId || input.identity.productId !== input.productId) {
    throw new ReviewProviderError("Detailed review request plan product identity mismatch");
  }

  if (
    input.ephemeralIdentity.evidence.source !== "google_shopping_aggregate_candidate" ||
    input.ephemeralIdentity.evidence.matchDecision !== "match" ||
    input.ephemeralIdentity.evidence.matchConfidence !== "high"
  ) {
    throw new ReviewProviderError("Detailed review request plan requires high-confidence aggregate identity evidence");
  }

  const gid = validateRequiredProviderIdentifier(input.ephemeralIdentity.identifiers.gid, "gid");
  const productId = validateOptionalProviderIdentifier(input.ephemeralIdentity.identifiers.productId, "productId");
  const dataDocid = validateOptionalProviderIdentifier(input.ephemeralIdentity.identifiers.dataDocid, "dataDocid");
  const trustIssue = aggregateEvidenceTrustIssue({
    title: input.ephemeralIdentity.evidence.matchedProductTitle,
    seller: input.ephemeralIdentity.evidence.seller,
    identifiers: {
      gid,
      ...(productId ? { productId } : {}),
      ...(dataDocid ? { dataDocid } : {}),
    },
    identity: input.identity,
  });

  if (trustIssue) {
    throw new ReviewProviderError(`Detailed review request plan evidence failed validation: ${trustIssue.reason}`);
  }

  const requestPayload: DataForSeoGoogleShoppingReviewsRequestPayload = {
    gid,
    location_code: input.locationCode,
    language_code: input.languageCode,
    depth: input.depth,
    priority: 1,
    tag: input.tag ?? `trendiq:${input.productId}:review-quality:google-shopping-reviews`,
  };

  if (productId) requestPayload.product_id = productId;
  if (dataDocid) requestPayload.data_docid = dataDocid;

  return freezeDetailedReviewsRequestPlan({
    provider: "dataforseo",
    providerCapability: "dataforseo_google_shopping_reviews",
    method: "POST",
    endpointPath: DATAFORSEO_GOOGLE_SHOPPING_REVIEWS_TASK_POST_PATH,
    networkAllowed: false,
    product: {
      productId: input.identity.productId,
      canonicalSearchQuery: input.identity.canonicalSearchQuery,
      productTitle: input.identity.productTitle,
      brand: input.identity.brand,
      ...(input.identity.generation ? { generation: input.identity.generation } : {}),
    },
    requiredProviderIds: {
      gid,
      ...(productId ? { productId } : {}),
      ...(dataDocid ? { dataDocid } : {}),
    },
    identityEvidence: input.ephemeralIdentity.evidence,
    requestPayload: [requestPayload],
  });
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

function parseDataForSeoTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const normalized = value.replace(" ", "T").replace(" +00:00", "Z");
  const parsed = new Date(normalized);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function isoDaysBefore(timestamp: string, days: number): string {
  const parsed = Date.parse(timestamp);
  const anchor = Number.isFinite(parsed) ? parsed : Date.now();

  return new Date(anchor - days * 24 * 60 * 60 * 1000).toISOString();
}

function roundTo(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sourceDomain(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value.replace(/^www\./, "");
  }
}

function uniqueSorted(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
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
      entry.match.identityDecision === "match" &&
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

function mapReviewItem(item: DataForSeoGoogleShoppingReviewItem): {
  rawPublicationDate?: string;
  publicationDate?: string;
  rating?: number;
  providedBy?: string;
  url?: string;
  rankGroup?: number;
  rankAbsolute?: number;
} {
  return {
    rawPublicationDate: stringOrUndefined(item.publication_date),
    publicationDate: parseDataForSeoTimestamp(stringOrUndefined(item.publication_date)),
    rating: finiteNumber(item.rating?.value),
    providedBy: stringOrUndefined(item.provided_by),
    url: stringOrUndefined(item.url),
    rankGroup: finiteNumber(item.rank_group),
    rankAbsolute: finiteNumber(item.rank_absolute),
  };
}

function integerCount(value: unknown): number | undefined {
  const numberValue = finiteNumber(value);
  return typeof numberValue === "number" && numberValue >= 0 ? Math.round(numberValue) : undefined;
}

function starBucket(value: unknown): 1 | 2 | 3 | 4 | 5 | undefined {
  const numberValue = finiteNumber(value);
  if (typeof numberValue !== "number") return undefined;

  const rounded = Math.round(numberValue);
  return rounded >= 1 && rounded <= 5 ? rounded as 1 | 2 | 3 | 4 | 5 : undefined;
}

function incrementStarCount(distribution: Omit<
  RatingDistributionInput,
  "distributionSource" | "distributionScope" | "distributionComposition"
>, star: 1 | 2 | 3 | 4 | 5, count: number) {
  if (star === 1) distribution.star1Count += count;
  if (star === 2) distribution.star2Count += count;
  if (star === 3) distribution.star3Count += count;
  if (star === 4) distribution.star4Count += count;
  if (star === 5) distribution.star5Count += count;
}

function providerRatingDistribution(
  ratingGroups: DataForSeoGoogleShoppingRating[] | null | undefined
): RatingDistributionInput | undefined {
  const distribution = {
    star1Count: 0,
    star2Count: 0,
    star3Count: 0,
    star4Count: 0,
    star5Count: 0,
  };

  for (const group of ratingGroups ?? []) {
    const star = starBucket(group.value);
    const count = integerCount(group.rating_count ?? group.votes_count);

    if (!star || typeof count !== "number") continue;
    incrementStarCount(distribution, star, count);
  }

  const totalDistributionCount = distribution.star1Count
    + distribution.star2Count
    + distribution.star3Count
    + distribution.star4Count
    + distribution.star5Count;

  if (!totalDistributionCount) return undefined;

  return {
    ...distribution,
    distributionSource: "provider_rating_groups",
    distributionScope: "full_provider_distribution",
    distributionComposition: "provider_rating_group_counts",
  };
}

function sampleRatingDistribution(items: Array<{ rating?: number }>): RatingDistributionInput | undefined {
  const distribution = {
    star1Count: 0,
    star2Count: 0,
    star3Count: 0,
    star4Count: 0,
    star5Count: 0,
  };

  for (const item of items) {
    const star = starBucket(item.rating);
    if (!star) continue;
    incrementStarCount(distribution, star, 1);
  }

  const totalDistributionCount = distribution.star1Count
    + distribution.star2Count
    + distribution.star3Count
    + distribution.star4Count
    + distribution.star5Count;

  if (!totalDistributionCount) return undefined;

  return {
    ...distribution,
    distributionSource: "review_items",
    distributionScope: "fetched_review_sample",
    distributionComposition: "valid_ratings_from_fetched_review_items",
  };
}

export function mapDataForSeoGoogleShoppingReviewsResponse(input: {
  response: unknown;
  productId: string;
  identifiers: {
    gid: string;
    productId?: string;
    dataDocid?: string;
  };
  locationCode: number;
  languageCode: string;
  fetchedAt: string;
  snapshotTimestamp: string;
  windowDays: number;
  minimumScoringSampleSize: number;
  provisionalSampleSize: number;
  aggregateAverageRating?: number;
  endpoint?: string;
}): GoogleShoppingRecentReviewsObservation {
  const task = findSuccessfulTask(
    asDataForSeoResponse<DataForSeoGoogleShoppingReviewsResult>(input.response),
    "DataForSEO response did not include a Google Shopping Reviews task"
  );
  const result = task.result?.[0];
  const sourceDatetime = stringOrUndefined(result?.datetime);
  const fetchedAt = toIsoTimestamp(sourceDatetime, input.fetchedAt);
  const windowEnd = parseDataForSeoTimestamp(input.snapshotTimestamp) ?? input.snapshotTimestamp;
  const windowStart = isoDaysBefore(windowEnd, input.windowDays);
  const windowStartMs = Date.parse(windowStart);
  const windowEndMs = Date.parse(windowEnd);
  const rawItems = (result?.items ?? []).filter((item) =>
    !item.type || item.type === "google_shopping_review_item"
  );
  const mappedItems = rawItems.map(mapReviewItem);
  const validRatingItems = mappedItems.filter((item) =>
    typeof item.rating === "number" && item.rating >= 1 && item.rating <= 5
  );
  const datedItems = validRatingItems.filter((item) => item.publicationDate);
  const qualifyingItems: GoogleShoppingReviewItemObservation[] = datedItems
    .filter((item) => {
      const publishedAt = Date.parse(String(item.publicationDate));
      return publishedAt >= windowStartMs && publishedAt <= windowEndMs;
    })
    .map((item) => ({
      rating: item.rating ?? 0,
      publicationDate: String(item.publicationDate),
      rawPublicationDate: item.rawPublicationDate,
      providedBy: item.providedBy,
      url: item.url,
      rankGroup: item.rankGroup,
      rankAbsolute: item.rankAbsolute,
    }));
  const computedAverage = qualifyingItems.length
    ? roundTo(qualifyingItems.reduce((sum, item) => sum + item.rating, 0) / qualifyingItems.length, 2)
    : undefined;
  const status = qualifyingItems.length >= input.minimumScoringSampleSize
    ? "derived-live"
    : qualifyingItems.length >= input.provisionalSampleSize
      ? "provisional"
      : "insufficient";
  const ratingDistribution = providerRatingDistribution(result?.rating_groups)
    ?? sampleRatingDistribution(validRatingItems);
  const ratingConsensus = ratingDistribution
    ? buildRatingConsensusQuality({
        ...ratingDistribution,
        aggregateAverageRating: input.aggregateAverageRating,
      })
    : undefined;

  return {
    provider: "dataforseo",
    productId: input.productId,
    identifiers: {
      gid: input.identifiers.gid,
      productId: input.identifiers.productId,
      dataDocid: input.identifiers.dataDocid,
    },
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    fetchedAt,
    sourceDatetime,
    endpoint: input.endpoint ?? DATAFORSEO_GOOGLE_SHOPPING_REVIEWS_TASK_GET_ADVANCED_PATH_PREFIX,
    snapshotTimestamp: windowEnd,
    windowStart,
    windowEnd,
    windowDays: input.windowDays,
    status,
    recentAverageRating: status === "derived-live" ? computedAverage : undefined,
    provisionalRecentAverageRating: status === "provisional" ? computedAverage : undefined,
    totalReviewsFetched: rawItems.length,
    datedReviewCount: datedItems.length,
    qualifyingReviewCount: qualifyingItems.length,
    excludedReviewCount: rawItems.length - qualifyingItems.length,
    undatedReviewCount: validRatingItems.length - datedItems.length,
    invalidRatingCount: rawItems.length - validRatingItems.length,
    outsideWindowReviewCount: datedItems.length - qualifyingItems.length,
    totalReviewsAvailable: finiteNumber(result?.reviews_count),
    sourceDomains: uniqueSorted(qualifyingItems
      .map((item) => sourceDomain(item.providedBy) ?? sourceDomain(item.url))),
    reviews: qualifyingItems,
    ratingConsensus,
    calculationMethod: "mean_rating_of_dated_reviews_in_trailing_90_days",
    datePrecision: "provider_observed_approximate_relative_timestamp",
    cost: task.cost,
  };
}

function taskIdFromPostResponse(response: unknown): string {
  const parsed = asDataForSeoResponse(response);

  if (parsed.status_code !== 20000) {
    throw new ReviewProviderError(
      parsed.status_message ?? "DataForSEO request failed",
      parsed.status_code,
      buildDataForSeoDiagnostics({ response: parsed, responseBodyParsed: true })
    );
  }

  const task = parsed.tasks?.find((candidate) =>
    stringOrUndefined(candidate.id) &&
    (candidate.status_code === 20000 || candidate.status_code === 20100 || candidate.status_code === 20101)
  );
  const id = stringOrUndefined(task?.id);

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

export class DataForSeoGoogleShoppingReviewsClient implements GoogleShoppingRecentReviewsClient {
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly config: ReviewProviderConfig,
    fetchImpl?: FetchLike
  ) {
    this.fetchImpl = getFetch(fetchImpl);
  }

  async getRecentProductReviews(input: {
    productId: string;
    identity: ReviewProductIdentityConfig;
    identifiers?: {
      gid?: string;
      productId?: string;
      dataDocid?: string;
    };
    locationCode: number;
    languageCode: string;
    snapshotTimestamp: string;
    aggregateAverageRating?: number;
  }): Promise<GoogleShoppingRecentReviewsObservation> {
    if (!this.config.apiLogin || !this.config.apiPassword) {
      throw new ReviewProviderError("DataForSEO credentials are missing");
    }

    const identifiers = {
      ...input.identity.providerProductIds,
      ...input.identifiers,
    };
    const gid = stringOrUndefined(identifiers.gid);

    if (!gid) {
      throw new ReviewProviderError("Google Shopping gid is missing for review item requests");
    }

    const postEndpoint = `${this.config.apiBaseUrl}${DATAFORSEO_GOOGLE_SHOPPING_REVIEWS_TASK_POST_PATH}`;
    const requestPayload: DataForSeoGoogleShoppingReviewsRequestPayload[] = [
      {
        gid,
        product_id: stringOrUndefined(identifiers.productId),
        data_docid: stringOrUndefined(identifiers.dataDocid),
        location_code: input.locationCode,
        language_code: input.languageCode,
        depth: this.config.recentReviewsDepth,
        priority: 1,
        tag: `trendiq:${input.productId}:review-quality:google-shopping-reviews`,
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
    const getEndpoint =
      `${this.config.apiBaseUrl}${DATAFORSEO_GOOGLE_SHOPPING_REVIEWS_TASK_GET_ADVANCED_PATH_PREFIX}/${taskId}`;
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
        return mapDataForSeoGoogleShoppingReviewsResponse({
          response: parsedResponse,
          productId: input.productId,
          identifiers: {
            gid,
            productId: stringOrUndefined(identifiers.productId),
            dataDocid: stringOrUndefined(identifiers.dataDocid),
          },
          locationCode: input.locationCode,
          languageCode: input.languageCode,
          fetchedAt: this.config.now().toISOString(),
          snapshotTimestamp: input.snapshotTimestamp,
          windowDays: this.config.recentReviewsWindowDays,
          minimumScoringSampleSize: this.config.recentReviewsMinimumScoringSampleSize,
          provisionalSampleSize: this.config.recentReviewsProvisionalSampleSize,
          aggregateAverageRating: input.aggregateAverageRating,
          endpoint: DATAFORSEO_GOOGLE_SHOPPING_REVIEWS_TASK_GET_ADVANCED_PATH_PREFIX,
        });
      } catch (error) {
        latestError = error;
      }
    }

    if (latestError instanceof ReviewProviderError) throw latestError;
    throw new ReviewProviderError("DataForSEO Google Shopping reviews task did not return usable review data");
  }
}
