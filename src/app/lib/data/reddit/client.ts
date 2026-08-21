import type { RedditProviderConfig } from "./config";

export interface RedditApiPost {
  id: string;
  title: string;
  selftext: string;
  subreddit: string;
  author: string;
  createdUtc: number;
  score: number;
  commentCount: number;
  permalink: string;
}

export interface RedditSearchOptions {
  limit: number;
}

export interface RedditApiClient {
  searchPosts(query: string, options: RedditSearchOptions): Promise<RedditApiPost[]>;
}

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

interface RedditListingChild {
  data?: {
    id?: string;
    title?: string;
    selftext?: string;
    subreddit?: string;
    author?: string;
    created_utc?: number;
    score?: number;
    num_comments?: number;
    permalink?: string;
  };
}

interface RedditListingResponse {
  data?: {
    children?: RedditListingChild[];
  };
}

interface RedditTokenResponse {
  access_token?: string;
  expires_in?: number;
}

export interface RedditHttpDiagnostic {
  httpStatus?: number;
  ok: boolean;
  statusMessage?: string;
}

export interface RedditDiagnosticResult {
  oauth: RedditHttpDiagnostic;
  search?: RedditHttpDiagnostic & {
    posts: RedditApiPost[];
  };
}

export class RedditApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "RedditApiError";
  }
}

function getFetch(fetchImpl?: FetchLike): FetchLike {
  const runtimeFetch = (globalThis as { fetch?: FetchLike }).fetch;

  if (fetchImpl) return fetchImpl;
  if (runtimeFetch) return runtimeFetch;

  throw new RedditApiError("No fetch implementation is available for Reddit API requests");
}

function encodeBasicAuth(clientId: string, clientSecret: string): string {
  const raw = `${clientId}:${clientSecret}`;
  const browserBtoa = (globalThis as { btoa?: (value: string) => string }).btoa;
  const nodeBuffer = (globalThis as {
    Buffer?: { from(value: string): { toString(encoding: string): string } };
  }).Buffer;

  if (browserBtoa) return browserBtoa(raw);
  if (nodeBuffer) return nodeBuffer.from(raw).toString("base64");

  throw new RedditApiError("No base64 encoder is available for Reddit OAuth");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function mapRedditListingResponse(response: unknown): RedditApiPost[] {
  const listing = response as RedditListingResponse;

  return (listing.data?.children ?? [])
    .map((child): RedditApiPost | null => {
      const data = child.data;
      if (!data?.id || !data.title || !data.subreddit || !data.created_utc) return null;

      return {
        id: data.id,
        title: data.title,
        selftext: data.selftext ?? "",
        subreddit: data.subreddit,
        author: data.author ?? "",
        createdUtc: data.created_utc,
        score: data.score ?? 0,
        commentCount: data.num_comments ?? 0,
        permalink: data.permalink ?? "",
      };
    })
    .filter((post): post is RedditApiPost => Boolean(post));
}

export class RedditOAuthClient implements RedditApiClient {
  private accessToken?: string;
  private tokenExpiresAt = 0;
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly config: RedditProviderConfig,
    fetchImpl?: FetchLike
  ) {
    this.fetchImpl = getFetch(fetchImpl);
  }

  async searchPosts(query: string, options: RedditSearchOptions): Promise<RedditApiPost[]> {
    const accessToken = await this.getAccessToken();
    const searchUrl = this.buildSearchUrl(query, options);

    const response = await this.fetchImpl(searchUrl.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": this.config.userAgent ?? "TrendIQ/0.1",
      },
    });

    if (!response.ok) {
      throw new RedditApiError(`Reddit search failed with status ${response.status}`, response.status);
    }

    return mapRedditListingResponse(await response.json());
  }

  async runSingleSearchDiagnostic(query: string, options: RedditSearchOptions): Promise<RedditDiagnosticResult> {
    const tokenResult = await this.requestAccessTokenForDiagnostic();

    if (!tokenResult.accessToken) {
      return {
        oauth: tokenResult.diagnostic,
      };
    }

    const searchUrl = this.buildSearchUrl(query, options);
    const response = await this.fetchImpl(searchUrl.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenResult.accessToken}`,
        "User-Agent": this.config.userAgent ?? "TrendIQ/0.1",
      },
    });
    const parsed = await safeReadJson(response);

    return {
      oauth: tokenResult.diagnostic,
      search: {
        ok: response.ok,
        httpStatus: response.status,
        statusMessage: extractRedditStatusMessage(parsed),
        posts: response.ok ? mapRedditListingResponse(parsed) : [],
      },
    };
  }

  private async getAccessToken(): Promise<string> {
    const now = this.config.now().getTime();

    if (this.accessToken && this.tokenExpiresAt > now + 60000) {
      return this.accessToken;
    }

    if (!this.config.clientId || !this.config.clientSecret) {
      throw new RedditApiError("Reddit OAuth credentials are missing");
    }

    const body = new URLSearchParams();
    body.set("grant_type", "client_credentials");

    const response = await this.fetchImpl("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${encodeBasicAuth(this.config.clientId, this.config.clientSecret)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": this.config.userAgent ?? "TrendIQ/0.1",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new RedditApiError(`Reddit OAuth failed with status ${response.status}`, response.status);
    }

    const payload = asRecord(await response.json()) as RedditTokenResponse;

    if (!payload.access_token) {
      throw new RedditApiError("Reddit OAuth response did not include an access token");
    }

    this.accessToken = payload.access_token;
    this.tokenExpiresAt = now + (payload.expires_in ?? 3600) * 1000;

    return this.accessToken;
  }

  private buildSearchUrl(query: string, options: RedditSearchOptions): URL {
    const searchUrl = new URL("https://oauth.reddit.com/search.json");

    searchUrl.searchParams.set("q", `"${query}"`);
    searchUrl.searchParams.set("sort", "new");
    searchUrl.searchParams.set("type", "link");
    searchUrl.searchParams.set("restrict_sr", "false");
    searchUrl.searchParams.set("raw_json", "1");
    searchUrl.searchParams.set("t", "month");
    searchUrl.searchParams.set("limit", String(options.limit));

    return searchUrl;
  }

  private async requestAccessTokenForDiagnostic(): Promise<{
    accessToken?: string;
    diagnostic: RedditHttpDiagnostic;
  }> {
    if (!this.config.clientId || !this.config.clientSecret) {
      return {
        diagnostic: {
          ok: false,
          statusMessage: "Reddit OAuth credentials are missing",
        },
      };
    }

    const body = new URLSearchParams();
    body.set("grant_type", "client_credentials");

    const response = await this.fetchImpl("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${encodeBasicAuth(this.config.clientId, this.config.clientSecret)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": this.config.userAgent ?? "TrendIQ/0.1",
      },
      body: body.toString(),
    });
    const parsed = await safeReadJson(response);
    const payload = asRecord(parsed) as RedditTokenResponse;

    return {
      accessToken: response.ok ? payload.access_token : undefined,
      diagnostic: {
        ok: response.ok && Boolean(payload.access_token),
        httpStatus: response.status,
        statusMessage: response.ok && !payload.access_token
          ? "Reddit OAuth response did not include an access token"
          : extractRedditStatusMessage(parsed),
      },
    };
  }
}

async function safeReadJson(response: FetchResponseLike): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function extractRedditStatusMessage(payload: unknown): string | undefined {
  const record = asRecord(payload);
  const message = record.message ?? record.error_description ?? record.error;

  return typeof message === "string" ? message : undefined;
}
