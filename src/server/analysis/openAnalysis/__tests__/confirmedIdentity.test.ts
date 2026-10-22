import { describe, expect, it } from "vitest";
import { runControlledLiveSearchToScore } from "../../../../app/lib/data/controlledLiveSearchPipeline";
import type { ProductProfile } from "../../../../app/lib/data/capabilities/types";
import type { SearchInterestClient, SearchVolumeClient } from "../../../../app/lib/data/search/types";

const OPEN_ID = "open-0123456789abcdef0123";

function confirmedProfile(): ProductProfile {
  return {
    productId: OPEN_ID,
    source: "resolved_provider",
    query: "Example Headphones",
    canonicalTitle: "Example Headphones",
    brand: "Example",
    aliases: ["Example Headphones"],
    productType: "hardware",
    category: "Audio",
    identityConfidence: "high",
    guardrails: {
      requireExactBrandMatch: true,
      excludeAccessories: true,
      excludeBundles: true,
      excludeRefurbished: true,
    },
  };
}

describe("confirmed open product identity", () => {
  it("does not mint a user-search id after the profile is confirmed", async () => {
    const seen: string[] = [];
    const searchClient: SearchInterestClient = {
      async getSearchInterest(input) {
        seen.push(input.productId);
        return {
          provider: "dataforseo",
          productId: input.productId,
          aliases: input.aliases,
          locationCode: input.locationCode,
          interestType: input.interestType,
          timeRange: input.timeRange,
          fetchedAt: "2026-10-21T00:00:00.000Z",
          cost: 0,
          points: [],
          averagesByAlias: {},
        };
      },
    };
    const searchVolumeClient: SearchVolumeClient = {
      async getSearchVolume(input) {
        seen.push(input.productId);
        return {
          provider: "dataforseo",
          productId: input.productId,
          aliases: input.aliases,
          locationCode: input.locationCode,
          languageCode: input.languageCode,
          fetchedAt: "2026-10-21T00:00:00.000Z",
          cost: 0,
          endpoint: "/fixture",
          monthlySearchVolume: 0,
          observations: [],
        };
      },
    };
    const result = await runControlledLiveSearchToScore({
      query: "someone typed a different name",
      confirmedProfile: confirmedProfile(),
      searchClient,
      searchVolumeClient,
      now: () => new Date("2026-10-21T00:00:00.000Z"),
    });
    expect(result.resolution.profile.productId).toBe(OPEN_ID);
    expect(result.plan.product.productId).toBe(OPEN_ID);
    expect(result.snapshot.productId).toBe(OPEN_ID);
    expect(result.rawSignals.every((signal) => signal.productId === OPEN_ID)).toBe(true);
    expect(seen.every((id) => id === OPEN_ID)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("user-search-");
  });
});
