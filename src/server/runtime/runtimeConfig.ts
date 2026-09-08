export const APPROVED_DATAFORSEO_ORIGIN = "https://api.dataforseo.com";
export const DEFAULT_ALPHA_JOB_DEADLINE_MS = 55_000;

export type RuntimeEnvironment = Record<string, string | undefined>;

export type ReadinessFailureReason =
  | "analysis_disabled"
  | "build_assets_unavailable"
  | "catalog_not_ready"
  | "invalid_job_deadline"
  | "invalid_paid_operation_ceiling"
  | "invalid_provider_configuration"
  | "live_evidence_path_not_configured"
  | "process_paid_operation_ceiling_exhausted"
  | "provider_credentials_missing"
  | "unapproved_provider_origin";

export interface PrivateAlphaRuntimeConfig {
  analysisEnabled: boolean;
  dataForSeoApiBaseUrl: string;
  jobDeadlineMs: number | null;
  paidOperationCeiling: number | null;
  reviewsLive: boolean;
  searchLive: boolean;
  validationFailure: ReadinessFailureReason | null;
  providerEnvironment: RuntimeEnvironment;
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value?.trim() || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function validMode(value: string | undefined): value is "live" | "mock" {
  return value === "live" || value === "mock";
}

function approvedDataForSeoBaseUrl(value: string | undefined): string | null {
  const candidate = value?.trim() || APPROVED_DATAFORSEO_ORIGIN;
  try {
    const parsed = new URL(candidate);
    if (
      parsed.origin !== APPROVED_DATAFORSEO_ORIGIN ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return APPROVED_DATAFORSEO_ORIGIN;
  } catch {
    return null;
  }
}

export function readPrivateAlphaRuntimeConfig(
  env: RuntimeEnvironment = process.env
): PrivateAlphaRuntimeConfig {
  const searchMode = env.TRENDIQ_SEARCH_MODE;
  const reviewsMode = env.TRENDIQ_REVIEWS_MODE;
  const searchLive = searchMode === "live";
  const reviewsLive = reviewsMode === "live";
  const analysisEnabled = env.TRENDIQ_ANALYSIS_ENABLED === "true";
  const paidOperationCeiling = parsePositiveInteger(env.TRENDIQ_PROCESS_MAX_PAID_OPERATIONS);
  const configuredDeadline = env.TRENDIQ_ANALYSIS_JOB_DEADLINE_MS;
  const jobDeadlineMs = configuredDeadline === undefined
    ? DEFAULT_ALPHA_JOB_DEADLINE_MS
    : parsePositiveInteger(configuredDeadline);
  const approvedBaseUrl = approvedDataForSeoBaseUrl(env.DATAFORSEO_API_BASE_URL);
  const credentialsPresent = Boolean(env.DATAFORSEO_LOGIN?.trim() && env.DATAFORSEO_PASSWORD?.trim());

  let validationFailure: ReadinessFailureReason | null = null;
  if (!analysisEnabled) {
    validationFailure = "analysis_disabled";
  } else if (!validMode(searchMode) || !validMode(reviewsMode)) {
    validationFailure = "invalid_provider_configuration";
  } else if (
    (searchLive && env.TRENDIQ_SEARCH_PROVIDER !== "dataforseo") ||
    (reviewsLive && env.TRENDIQ_REVIEWS_PROVIDER !== "dataforseo")
  ) {
    validationFailure = "invalid_provider_configuration";
  } else if (!searchLive && !reviewsLive) {
    validationFailure = "live_evidence_path_not_configured";
  } else if (!credentialsPresent) {
    validationFailure = "provider_credentials_missing";
  } else if (!approvedBaseUrl) {
    validationFailure = "unapproved_provider_origin";
  } else if (paidOperationCeiling === null) {
    validationFailure = "invalid_paid_operation_ceiling";
  } else if (jobDeadlineMs === null || jobDeadlineMs < 1_000 || jobDeadlineMs > 120_000) {
    validationFailure = "invalid_job_deadline";
  }

  return {
    analysisEnabled,
    dataForSeoApiBaseUrl: approvedBaseUrl ?? APPROVED_DATAFORSEO_ORIGIN,
    jobDeadlineMs,
    paidOperationCeiling,
    reviewsLive,
    searchLive,
    validationFailure,
    providerEnvironment: {
      ...env,
      DATAFORSEO_API_BASE_URL: approvedBaseUrl ?? APPROVED_DATAFORSEO_ORIGIN,
    },
  };
}
