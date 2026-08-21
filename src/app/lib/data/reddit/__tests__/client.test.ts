import { describe, expect, it } from "vitest";
import { RedditOAuthClient, mapRedditListingResponse, type FetchLike } from "../client";
import { readRedditProviderConfig } from "../config";

function response(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

describe("Reddit OAuth client", () => {
  it("maps Reddit listing responses into minimal post records", () => {
    const posts = mapRedditListingResponse({
      data: {
        children: [
          {
            data: {
              id: "abc",
              title: "Ray-Ban Meta worth it?",
              selftext: "Thinking about buying",
              subreddit: "gadgets",
              author: "example-user",
              created_utc: 1786406400,
              score: 42,
              num_comments: 9,
              permalink: "/r/gadgets/comments/abc",
            },
          },
        ],
      },
    });

    expect(posts).toEqual([
      {
        id: "abc",
        title: "Ray-Ban Meta worth it?",
        selftext: "Thinking about buying",
        subreddit: "gadgets",
        author: "example-user",
        createdUtc: 1786406400,
        score: 42,
        commentCount: 9,
        permalink: "/r/gadgets/comments/abc",
      },
    ]);
  });

  it("uses OAuth and maps search responses through an injected fetch", async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({
        url,
        auth: init?.headers?.Authorization,
      });

      if (url.includes("access_token")) {
        return response({ access_token: "test-token", expires_in: 3600 });
      }

      return response({
        data: {
          children: [
            {
              data: {
                id: "abc",
                title: "Ray-Ban Meta is amazing",
                subreddit: "gadgets",
                created_utc: 1786406400,
              },
            },
          ],
        },
      });
    };
    const config = readRedditProviderConfig({}, {
      mode: "live",
      clientId: "client-id",
      clientSecret: "client-secret",
      userAgent: "web:trendiq-test:v1.0.0 (by /u/test)",
      now: () => new Date("2026-08-11T00:00:00.000Z"),
    });
    const client = new RedditOAuthClient(config, fetchImpl);
    const posts = await client.searchPosts("Ray-Ban Meta", { limit: 10 });

    expect(posts).toHaveLength(1);
    expect(calls[0].url).toBe("https://www.reddit.com/api/v1/access_token");
    expect(calls[0].auth).toMatch(/^Basic /);
    expect(calls[1].url).toContain("https://oauth.reddit.com/search.json");
    expect(calls[1].url).toContain("q=%22Ray-Ban+Meta%22");
    expect(calls[1].auth).toBe("Bearer test-token");
  });

  it("returns sanitized diagnostic status without exposing access tokens", async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({
        url,
        auth: init?.headers?.Authorization,
      });

      if (url.includes("access_token")) {
        return response({ access_token: "sensitive-token", expires_in: 3600 });
      }

      return response({
        data: {
          children: [
            {
              data: {
                id: "abc",
                title: "Ray-Ban Meta is amazing",
                subreddit: "gadgets",
                author: "author-name",
                created_utc: 1786406400,
              },
            },
          ],
        },
      });
    };
    const config = readRedditProviderConfig({}, {
      mode: "live",
      clientId: "client-id",
      clientSecret: "client-secret",
      userAgent: "web:trendiq-test:v1.0.0 (by /u/test)",
      now: () => new Date("2026-08-11T00:00:00.000Z"),
    });
    const client = new RedditOAuthClient(config, fetchImpl);
    const diagnostic = await client.runSingleSearchDiagnostic("Ray-Ban Meta", { limit: 10 });
    const output = JSON.stringify(diagnostic);

    expect(calls).toHaveLength(2);
    expect(diagnostic.oauth).toEqual({ ok: true, httpStatus: 200 });
    expect(diagnostic.search?.ok).toBe(true);
    expect(diagnostic.search?.httpStatus).toBe(200);
    expect(diagnostic.search?.posts).toHaveLength(1);
    expect(output).not.toContain("sensitive-token");
    expect(output).not.toContain("Basic ");
    expect(output).not.toContain("Bearer ");
  });
});
