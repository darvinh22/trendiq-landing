import type {
  SearchInterestClient,
  SearchInterestPoint,
  SearchInterestSeries,
  SearchInterestTimeRange,
  SearchInterestType,
  SearchVolumeClient,
  SearchVolumeSeries,
} from "./types";
import type { SearchProviderConfig } from "./types";

export const DATAFORSEO_TRENDS_EXPLORE_PATH = "/v3/keywords_data/dataforseo_trends/explore/live";
export const DATAFORSEO_GOOGLE_ADS_SEARCH_VOLUME_PATH = "/v3/keywords_data/google_ads/search_volume/live";

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<FetchResponseLike>;

interface DataForSeoTrendGraphPoint {
  date_from?: string;
  date_to?: string;
  timestamp?: number;
  values?: number[];
  missing_data?: boolean;
}

interface DataForSeoTrendGraphItem {
  type?: string;
  keywords?: string[];
  data?: DataForSeoTrendGraphPoint[];
  averages?: number[];
}

interface DataForSeoTrendResult {
  keywords?: string[];
  location_code?: number;
  datetime?: string;
  items?: DataForSeoTrendGraphItem[];
}

interface DataForSeoGoogleAdsMonthlySearch {
  year?: number;
  month?: number;
  search_volume?: number;
}

interface DataForSeoGoogleAdsSearchVolumeItem {
  keyword?: string;
  location_code?: number;
  language_code?: string;
  search_volume?: number | null;
  monthly_searches?: DataForSeoGoogleAdsMonthlySearch[];
}

interface DataForSeoTask<TResult = unknown> {
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

export interface DataForSeoTaskDiagnostic {
  statusCode?: number;
  statusMessage?: string;
}

export interface DataForSeoTrendsRequestPayload {
  keywords: string[];
  location_code: number;
  type: SearchInterestType;
  time_range: SearchInterestTimeRange;
  tag: string;
}

export interface DataForSeoGoogleAdsSearchVolumeRequestPayload {
  keywords: string[];
  location_code: number;
  language_code: string;
  search_partners: boolean;
  tag: string;
}

export type DataForSeoRequestPayload =
  | DataForSeoTrendsRequestPayload
  | DataForSeoGoogleAdsSearchVolumeRequestPayload;

export interface DataForSeoErrorDiagnostics {
  endpoint?: string;
  httpStatus?: number;
  dataForSeoStatusCode?: number;
  dataForSeoStatusMessage?: string;
  tasksError?: number;
  taskDiagnostics?: DataForSeoTaskDiagnostic[];
  requestPayload?: DataForSeoRequestPayload[];
  responseBodyParsed?: boolean;
}

export class SearchProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly diagnostics?: DataForSeoErrorDiagnostics
  ) {
    super(message);
    this.name = "SearchProviderError";
  }
}

function getFetch(fetchImpl?: FetchLike): FetchLike {
  const runtimeFetch = (globalThis as { fetch?: FetchLike }).fetch;

  if (fetchImpl) return fetchImpl;
  if (runtimeFetch) return runtimeFetch;

  throw new SearchProviderError("No fetch implementation is available for search provider requests");
}

function encodeBasicAuth(login: string, password: string): string {
  const raw = `${login}:${password}`;
  const browserBtoa = (globalThis as { btoa?: (value: string) => string }).btoa;
  const nodeBuffer = (globalThis as {
    Buffer?: { from(value: string): { toString(encoding: string): string } };
  }).Buffer;

  if (browserBtoa) return browserBtoa(raw);
  if (nodeBuffer) return nodeBuffer.from(raw).toString("base64");

  throw new SearchProviderError("No base64 encoder is available for DataForSEO authentication");
}

function asDataForSeoResponse<TResult = unknown>(value: unknown): DataForSeoResponse<TResult> {
  return value && typeof value === "object" ? value as DataForSeoResponse<TResult> : {};
}

function buildDataForSeoDiagnostics(input: {
  response?: DataForSeoResponse;
  endpoint?: string;
  httpStatus?: number;
  requestPayload?: DataForSeoRequestPayload[];
  responseBodyParsed?: boolean;
}): DataForSeoErrorDiagnostics {
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
  requestPayload: DataForSeoRequestPayload[];
}): Promise<DataForSeoErrorDiagnostics> {
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

function createDataForSeoErrorMessage(httpStatus: number, diagnostics: DataForSeoErrorDiagnostics): string {
  const dataForSeoMessage = diagnostics.dataForSeoStatusMessage
    ?? diagnostics.taskDiagnostics?.find((task) => task.statusMessage)?.statusMessage;

  return dataForSeoMessage
    ? `DataForSEO request failed with HTTP ${httpStatus}: ${dataForSeoMessage}`
    : `DataForSEO request failed with HTTP ${httpStatus}`;
}

function mapValuesByAlias(aliases: string[], values: number[] | undefined): Record<string, number> {
  return aliases.reduce<Record<string, number>>((mapped, alias, index) => {
    const value = values?.[index];
    mapped[alias] = Number.isFinite(value) ? Number(value) : 0;
    return mapped;
  }, {});
}

function findGraph(response: DataForSeoResponse): {
  task: DataForSeoTask<DataForSeoTrendResult>;
  result: DataForSeoTrendResult;
  item: DataForSeoTrendGraphItem;
} {
  if (response.status_code !== 20000) {
    throw new SearchProviderError(
      response.status_message ?? "DataForSEO request failed",
      response.status_code,
      buildDataForSeoDiagnostics({ response, responseBodyParsed: true })
    );
  }

  const task = response.tasks?.find((candidate) => candidate.status_code === 20000) as
    | DataForSeoTask<DataForSeoTrendResult>
    | undefined;
  const result = task?.result?.[0];
  const item = result?.items?.find((candidate) => candidate.type === "dataforseo_trends_graph");

  if (!task || !result || !item) {
    throw new SearchProviderError("DataForSEO response did not include a trends graph");
  }

  return { task, result, item };
}

export function mapDataForSeoTrendsResponse(input: {
  response: unknown;
  productId: string;
  aliases: string[];
  locationCode: number;
  interestType: SearchInterestType;
  timeRange?: SearchInterestTimeRange;
  fetchedAt: string;
}): SearchInterestSeries {
  const { task, item } = findGraph(asDataForSeoResponse(input.response));
  const aliases = item.keywords?.length ? item.keywords : input.aliases;
  const points: SearchInterestPoint[] = (item.data ?? [])
    .filter((point) => point.date_from && point.date_to && Number.isFinite(point.timestamp))
    .map((point) => ({
      dateFrom: point.date_from ?? "",
      dateTo: point.date_to ?? "",
      timestamp: point.timestamp ?? 0,
      valuesByAlias: mapValuesByAlias(aliases, point.values),
      missingData: point.missing_data,
    }));

  return {
    provider: "dataforseo",
    productId: input.productId,
    aliases,
    locationCode: input.locationCode,
    interestType: input.interestType,
    timeRange: input.timeRange,
    fetchedAt: input.fetchedAt,
    cost: task.cost,
    points,
    averagesByAlias: mapValuesByAlias(aliases, item.averages),
  };
}

function findSearchVolumeTask(
  response: DataForSeoResponse<DataForSeoGoogleAdsSearchVolumeItem>
): DataForSeoTask<DataForSeoGoogleAdsSearchVolumeItem> {
  if (response.status_code !== 20000) {
    throw new SearchProviderError(
      response.status_message ?? "DataForSEO request failed",
      response.status_code,
      buildDataForSeoDiagnostics({ response, responseBodyParsed: true })
    );
  }

  const task = response.tasks?.find((candidate) => candidate.status_code === 20000);

  if (!task?.result?.length) {
    throw new SearchProviderError("DataForSEO response did not include Google Ads search volume results");
  }

  return task;
}

function mapMonthlySearches(monthlySearches: DataForSeoGoogleAdsMonthlySearch[] | undefined) {
  return (monthlySearches ?? [])
    .filter((month) =>
      Number.isFinite(month.year) &&
      Number.isFinite(month.month) &&
      Number.isFinite(month.search_volume)
    )
    .map((month) => ({
      year: Number(month.year),
      month: Number(month.month),
      searchVolume: Number(month.search_volume),
    }));
}

export function mapDataForSeoGoogleAdsSearchVolumeResponse(input: {
  response: unknown;
  productId: string;
  aliases: string[];
  locationCode: number;
  languageCode: string;
  fetchedAt: string;
  endpoint?: string;
}): SearchVolumeSeries {
  const task = findSearchVolumeTask(
    asDataForSeoResponse<DataForSeoGoogleAdsSearchVolumeItem>(input.response)
  );
  const observations = (task.result ?? [])
    .filter((item) => typeof item.keyword === "string" && Number.isFinite(item.search_volume))
    .map((item) => ({
      keyword: item.keyword ?? "",
      locationCode: Number.isFinite(item.location_code) ? Number(item.location_code) : input.locationCode,
      languageCode: item.language_code ?? input.languageCode,
      monthlySearchVolume: Number(item.search_volume),
      monthlySearches: mapMonthlySearches(item.monthly_searches),
    }))
    .filter((item) => item.monthlySearchVolume >= 0);

  if (!observations.length) {
    throw new SearchProviderError("DataForSEO response did not include usable monthly search volume");
  }

  return {
    provider: "dataforseo",
    productId: input.productId,
    aliases: input.aliases,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    fetchedAt: input.fetchedAt,
    cost: task.cost,
    endpoint: input.endpoint ?? DATAFORSEO_GOOGLE_ADS_SEARCH_VOLUME_PATH,
    monthlySearchVolume: observations.reduce((sum, item) => sum + item.monthlySearchVolume, 0),
    observations,
  };
}

export class DataForSeoTrendsClient implements SearchInterestClient {
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly config: SearchProviderConfig,
    fetchImpl?: FetchLike
  ) {
    this.fetchImpl = getFetch(fetchImpl);
  }

  async getSearchInterest(input: {
    productId: string;
    aliases: string[];
    locationCode: number;
    interestType: SearchInterestType;
    timeRange: SearchInterestTimeRange;
  }): Promise<SearchInterestSeries> {
    if (!this.config.apiLogin || !this.config.apiPassword) {
      throw new SearchProviderError("DataForSEO credentials are missing");
    }

    const endpoint = `${this.config.apiBaseUrl}${DATAFORSEO_TRENDS_EXPLORE_PATH}`;
    const requestPayload: DataForSeoTrendsRequestPayload[] = [
      {
        keywords: input.aliases.slice(0, 5),
        location_code: input.locationCode,
        type: input.interestType,
        time_range: input.timeRange,
        tag: `trendiq:${input.productId}:search-interest`,
      },
    ];

    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${encodeBasicAuth(this.config.apiLogin, this.config.apiPassword)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const diagnostics = await readDataForSeoDiagnostics({ response, endpoint, requestPayload });

      throw new SearchProviderError(
        createDataForSeoErrorMessage(response.status, diagnostics),
        response.status,
        diagnostics
      );
    }

    const parsedResponse = await response.json();

    try {
      return mapDataForSeoTrendsResponse({
        response: parsedResponse,
        productId: input.productId,
        aliases: input.aliases.slice(0, 5),
        locationCode: input.locationCode,
        interestType: input.interestType,
        timeRange: input.timeRange,
        fetchedAt: this.config.now().toISOString(),
      });
    } catch (error) {
      if (error instanceof SearchProviderError) {
        throw new SearchProviderError(error.message, error.status, {
          ...error.diagnostics,
          endpoint,
          httpStatus: response.status,
          requestPayload,
          responseBodyParsed: true,
        });
      }

      throw error;
    }
  }
}

export class DataForSeoGoogleAdsSearchVolumeClient implements SearchVolumeClient {
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly config: SearchProviderConfig,
    fetchImpl?: FetchLike
  ) {
    this.fetchImpl = getFetch(fetchImpl);
  }

  async getSearchVolume(input: {
    productId: string;
    aliases: string[];
    locationCode: number;
    languageCode: string;
  }): Promise<SearchVolumeSeries> {
    if (!this.config.apiLogin || !this.config.apiPassword) {
      throw new SearchProviderError("DataForSEO credentials are missing");
    }

    const endpoint = `${this.config.apiBaseUrl}${DATAFORSEO_GOOGLE_ADS_SEARCH_VOLUME_PATH}`;
    const requestPayload: DataForSeoGoogleAdsSearchVolumeRequestPayload[] = [
      {
        keywords: input.aliases.slice(0, 1000),
        location_code: input.locationCode,
        language_code: input.languageCode,
        search_partners: false,
        tag: `trendiq:${input.productId}:search-volume`,
      },
    ];

    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${encodeBasicAuth(this.config.apiLogin, this.config.apiPassword)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const diagnostics = await readDataForSeoDiagnostics({ response, endpoint, requestPayload });

      throw new SearchProviderError(
        createDataForSeoErrorMessage(response.status, diagnostics),
        response.status,
        diagnostics
      );
    }

    const parsedResponse = await response.json();

    try {
      return mapDataForSeoGoogleAdsSearchVolumeResponse({
        response: parsedResponse,
        productId: input.productId,
        aliases: input.aliases.slice(0, 1000),
        locationCode: input.locationCode,
        languageCode: input.languageCode,
        fetchedAt: this.config.now().toISOString(),
        endpoint: DATAFORSEO_GOOGLE_ADS_SEARCH_VOLUME_PATH,
      });
    } catch (error) {
      if (error instanceof SearchProviderError) {
        throw new SearchProviderError(error.message, error.status, {
          ...error.diagnostics,
          endpoint,
          httpStatus: response.status,
          requestPayload,
          responseBodyParsed: true,
        });
      }

      throw error;
    }
  }
}
