import { describe, expect, it } from "vitest";
import type { RedditApiPost } from "../client";
import {
  runRedditLiveDiagnostic,
  validateRedditDiagnosticCredentials,
} from "../diagnostic";

const now = new Date("2026-08-13T12:00:00.000Z");
const env = {
  REDDIT_CLIENT_ID: "client-id-secret-value",
  REDDIT_CLIENT_SECRET: "client-secret-value",
  REDDIT_USER_AGENT: "web:trendiq-test:v1.0.0 (by /u/test)",
  TRENDIQ_REDDIT_MIN_SAMPLE_SIZE: "20",
};

function post(id: string, title = "Ray-Ban Meta is amazing and worth it", subreddit = "gadgets"): RedditApiPost {
  return {
    id,
    title,
    selftext: "",
    subreddit,
    author: `author-${id}`,
    createdUtc: Date.parse("2026-08-13T10:00:00.000Z") / 1000,
    score: 10,
    commentCount: 2,
    permalink: `/r/${subreddit}/comments/${id}`,
  };
}

describe("Reddit live diagnostic", () => {
  it("validates required credentials without revealing values", () => {
    expect(validateRedditDiagnosticCredentials({
      REDDIT_CLIENT_ID: "id",
      REDDIT_CLIENT_SECRET: "",
      REDDIT_USER_AGENT: "agent",
    })).toEqual({
      ok: false,
      redditClientIdPresent: true,
      redditClientSecretPresent: false,
      redditUserAgentPresent: true,
    });
  });

  it("returns a sanitized pending-approval diagnostic without querying Reddit", async () => {
    const requestCounts = { oauth: 1, search: 1 };
    const calls: Array<{ query: string; limit: number }> = [];
    const client = {
      async runSingleSearchDiagnostic(query: string, options: { limit: number }) {
        calls.push({ query, limit: options.limit });

        return {
          oauth: { ok: true, httpStatus: 200 },
          search: {
            ok: true,
            httpStatus: 200,
            posts: Array.from({ length: 10 }, (_, index) =>
              post(String(index), index % 2 ? "Ray-Ban Meta battery is bad" : "Ray-Ban Meta is amazing and worth it")
            ),
          },
        };
      },
    };

    const result = await runRedditLiveDiagnostic({
      env,
      client,
      now,
      requestCounts,
    });
    const output = JSON.stringify(result);

    expect(calls).toEqual([]);
    expect(result.requestCounts).toEqual({ oauth: 1, search: 1 });
    expect(result.postsReturned).toBe(0);
    expect(result.uniqueSubredditCount).toBe(0);
    expect(result.uniqueAuthorCount).toBe(0);
    expect(result.minimumSampleSizeMet).toBe(false);
    expect(result.liveUseQualified).toBe(false);
    expect(result.approvalStatus).toBe("pending");
    expect(result.liveApiRequestMade).toBe(false);
    expect(result.oauth.statusMessage).toContain("approval is pending");
    expect(result.search.statusMessage).toContain("pending");
    expect(result.calculatedSignals).toBeUndefined();
    expect(output).not.toContain(env.REDDIT_CLIENT_ID);
    expect(output).not.toContain(env.REDDIT_CLIENT_SECRET);
    expect(output).not.toContain("Bearer");
    expect(output).not.toContain("Authorization");
    expect(output).not.toContain("access-token");
  });

  it("does not reach OAuth failure paths while approval is pending", async () => {
    const calls: Array<{ query: string; limit: number }> = [];
    const client = {
      async runSingleSearchDiagnostic(query: string, options: { limit: number }) {
        calls.push({ query, limit: options.limit });

        return {
          oauth: { ok: false, httpStatus: 401, statusMessage: "Unauthorized" },
        };
      },
    };

    const result = await runRedditLiveDiagnostic({
      env,
      client,
      now,
      requestCounts: { oauth: 1, search: 0 },
    });

    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.oauth.succeeded).toBe(false);
    expect(result.oauth.statusMessage).toContain("approval is pending");
    expect(result.search.succeeded).toBe(false);
    expect(result.generatedSignals).toEqual([]);
    expect(result.postsReturned).toBe(0);
  });

  it("returns before network-capable client use when credentials are missing", async () => {
    let called = false;
    const result = await runRedditLiveDiagnostic({
      env: {
        REDDIT_CLIENT_ID: "",
        REDDIT_CLIENT_SECRET: "",
        REDDIT_USER_AGENT: "",
      },
      client: {
        async runSingleSearchDiagnostic() {
          called = true;
          throw new Error("should not be called");
        },
      },
      now,
    });

    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.oauth.statusMessage).toBe("Missing required Reddit credentials");
    expect(result.requestCounts).toEqual({ oauth: 0, search: 0 });
  });

  it("does not write snapshots or permanently change production provider configuration", async () => {
    const beforeMode = process.env.TRENDIQ_REDDIT_MODE;
    const client = {
      async runSingleSearchDiagnostic() {
        return {
          oauth: { ok: true, httpStatus: 200 },
          search: {
            ok: true,
            httpStatus: 200,
            posts: [post("one")],
          },
        };
      },
    };

    await runRedditLiveDiagnostic({ env, client, now });

    expect(process.env.TRENDIQ_REDDIT_MODE).toBe(beforeMode);
  });
});
