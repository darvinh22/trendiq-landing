import { describe, expect, it } from "vitest";
import {
  DATAFORSEO_TRENDS_EXPLORE_PATH,
  DataForSeoTrendsClient,
  mapDataForSeoTrendsResponse,
  SearchProviderError,
  type FetchLike,
} from "../client";
import { readSearchProviderConfig } from "../config";

function fixtureResponse() {
  return {
    version: "0.1",
    status_code: 20000,
    status_message: "Ok.",
    tasks_error: 0,
    tasks: [
      {
        status_code: 20000,
        status_message: "Ok.",
        cost: 0.0012,
        result_count: 1,
        result: [
          {
            keywords: ["Ray-Ban Meta"],
            location_code: 2840,
            datetime: "2026-08-12 00:00:00 +00:00",
            items: [
              {
                type: "dataforseo_trends_graph",
                keywords: ["Ray-Ban Meta"],
                averages: [22],
                data: [
                  {
                    date_from: "2026-07-13",
                    date_to: "2026-07-13",
                    timestamp: 1783900800,
                    values: [22],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function response(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

describe("DataForSeoTrendsClient", () => {
  it("maps DataForSEO Trends responses into a generic SearchInterestSeries", () => {
    const series = mapDataForSeoTrendsResponse({
      response: fixtureResponse(),
      productId: "ray-ban-meta",
      aliases: ["Ray-Ban Meta"],
      locationCode: 2840,
      interestType: "web",
      timeRange: "past_30_days",
      fetchedAt: "2026-08-12T00:00:00.000Z",
    });

    expect(series.provider).toBe("dataforseo");
    expect(series.cost).toBe(0.0012);
    expect(series.timeRange).toBe("past_30_days");
    expect(series.points[0].valuesByAlias).toEqual({
      "Ray-Ban Meta": 22,
    });
    expect(series.averagesByAlias["Ray-Ban Meta"]).toBe(22);
  });

  it("uses the DataForSEO Trends endpoint and not the Google Trends endpoint", async () => {
    const calls: Array<{ url: string; auth?: string; body?: string }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({
        url,
        auth: init?.headers?.Authorization,
        body: init?.body,
      });
      return response(fixtureResponse());
    };
    const config = readSearchProviderConfig({}, {
      mode: "live",
      apiLogin: "login",
      apiPassword: "password",
      apiBaseUrl: "https://api.dataforseo.com",
      now: () => new Date("2026-08-12T00:00:00.000Z"),
    });
    const client = new DataForSeoTrendsClient(config, fetchImpl);

    await client.getSearchInterest({
      productId: "ray-ban-meta",
      aliases: ["Ray-Ban Meta"],
      locationCode: 2840,
      interestType: "web",
      timeRange: "past_30_days",
    });

    expect(calls[0].url).toBe(`https://api.dataforseo.com${DATAFORSEO_TRENDS_EXPLORE_PATH}`);
    expect(calls[0].url).not.toContain("google_trends");
    expect(calls[0].auth).toMatch(/^Basic /);
    expect(calls[0].body).toContain("\"type\":\"web\"");
    expect(calls[0].body?.trim().startsWith("[")).toBe(true);

    const requestBody = JSON.parse(calls[0].body ?? "null");
    expect(Array.isArray(requestBody)).toBe(true);
    expect(requestBody).toHaveLength(1);
    expect(requestBody[0]).toMatchObject({
      keywords: ["Ray-Ban Meta"],
      location_code: 2840,
      type: "web",
      time_range: "past_30_days",
      tag: "trendiq:ray-ban-meta:search-interest",
    });
    expect(requestBody[0]).not.toHaveProperty("date_from");
    expect(requestBody[0]).not.toHaveProperty("date_to");
  });

  it("attaches sanitized diagnostics when a DataForSEO Trends HTTP request fails", async () => {
    const calls: Array<{ url: string; auth?: string; body?: string }> = [];
    const errorPayload = {
      status_code: 50000,
      status_message: "Internal server error.",
      tasks_error: 1,
      tasks: [
        {
          status_code: 50000,
          status_message: "Internal server error.",
        },
      ],
    };
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({
        url,
        auth: init?.headers?.Authorization,
        body: init?.body,
      });
      return response(errorPayload, false, 500);
    };
    const config = readSearchProviderConfig({}, {
      mode: "live",
      apiLogin: "sensitive-login",
      apiPassword: "sensitive-password",
      apiBaseUrl: "https://api.dataforseo.com",
      now: () => new Date("2026-08-12T00:00:00.000Z"),
    });
    const client = new DataForSeoTrendsClient(config, fetchImpl);
    let caught: SearchProviderError | undefined;

    try {
      await client.getSearchInterest({
        productId: "ray-ban-meta",
        aliases: ["Ray-Ban Meta"],
        locationCode: 2840,
        interestType: "web",
        timeRange: "past_30_days",
      });
    } catch (error) {
      caught = error as SearchProviderError;
    }

    expect(caught).toBeInstanceOf(SearchProviderError);
    expect(caught?.status).toBe(500);
    expect(caught?.message).toContain("HTTP 500");
    expect(caught?.diagnostics).toEqual({
      endpoint: `https://api.dataforseo.com${DATAFORSEO_TRENDS_EXPLORE_PATH}`,
      httpStatus: 500,
      dataForSeoStatusCode: 50000,
      dataForSeoStatusMessage: "Internal server error.",
      tasksError: 1,
      taskDiagnostics: [
        {
          statusCode: 50000,
          statusMessage: "Internal server error.",
        },
      ],
      requestPayload: [
        {
          keywords: ["Ray-Ban Meta"],
          location_code: 2840,
          type: "web",
          time_range: "past_30_days",
          tag: "trendiq:ray-ban-meta:search-interest",
        },
      ],
      responseBodyParsed: true,
    });

    const diagnosticsText = JSON.stringify(caught?.diagnostics);
    expect(calls[0].auth).toMatch(/^Basic /);
    expect(diagnosticsText).not.toContain("sensitive-login");
    expect(diagnosticsText).not.toContain("sensitive-password");
    expect(diagnosticsText).not.toContain(calls[0].auth ?? "");
    expect(diagnosticsText).not.toContain("Authorization");
  });

  it("does not copy unparseable DataForSEO error bodies into diagnostics", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
      text: async () => "<html>internal server error</html>",
    });
    const config = readSearchProviderConfig({}, {
      mode: "live",
      apiLogin: "sensitive-login",
      apiPassword: "sensitive-password",
      apiBaseUrl: "https://api.dataforseo.com",
      now: () => new Date("2026-08-12T00:00:00.000Z"),
    });
    const client = new DataForSeoTrendsClient(config, fetchImpl);
    let caught: SearchProviderError | undefined;

    try {
      await client.getSearchInterest({
        productId: "ray-ban-meta",
        aliases: ["Ray-Ban Meta"],
        locationCode: 2840,
        interestType: "web",
        timeRange: "past_30_days",
      });
    } catch (error) {
      caught = error as SearchProviderError;
    }

    expect(caught).toBeInstanceOf(SearchProviderError);
    expect(caught?.diagnostics?.responseBodyParsed).toBe(false);
    expect(JSON.stringify(caught?.diagnostics)).not.toContain("<html>");
  });

  it("adds endpoint and sanitized request payload to DataForSEO 200-level API errors", async () => {
    const fetchImpl: FetchLike = async () => response({
      status_code: 40000,
      status_message: "Bad request.",
      tasks_error: 1,
      tasks: [
        {
          status_code: 40001,
          status_message: "Invalid field.",
        },
      ],
    });
    const config = readSearchProviderConfig({}, {
      mode: "live",
      apiLogin: "sensitive-login",
      apiPassword: "sensitive-password",
      apiBaseUrl: "https://api.dataforseo.com",
      now: () => new Date("2026-08-12T00:00:00.000Z"),
    });
    const client = new DataForSeoTrendsClient(config, fetchImpl);
    let caught: SearchProviderError | undefined;

    try {
      await client.getSearchInterest({
        productId: "ray-ban-meta",
        aliases: ["Ray-Ban Meta"],
        locationCode: 2840,
        interestType: "web",
        timeRange: "past_30_days",
      });
    } catch (error) {
      caught = error as SearchProviderError;
    }

    expect(caught).toBeInstanceOf(SearchProviderError);
    expect(caught?.status).toBe(40000);
    expect(caught?.diagnostics?.endpoint).toBe(`https://api.dataforseo.com${DATAFORSEO_TRENDS_EXPLORE_PATH}`);
    expect(caught?.diagnostics?.httpStatus).toBe(200);
    expect(caught?.diagnostics?.dataForSeoStatusCode).toBe(40000);
    expect(caught?.diagnostics?.taskDiagnostics?.[0]).toEqual({
      statusCode: 40001,
      statusMessage: "Invalid field.",
    });
    expect(caught?.diagnostics?.requestPayload?.[0].tag).toBe("trendiq:ray-ban-meta:search-interest");
    expect(JSON.stringify(caught?.diagnostics)).not.toContain("sensitive-password");
  });
});
