import { describe, expect, it, vi } from "vitest";
import {
  InMemoryProductResolutionCache,
  buildMeasurementQueryCandidates,
  createUserSearchProductProfile,
  resolveProductQuery,
} from "../index";
import type { ProductProfile } from "../types";

const now = new Date("2026-08-24T12:00:00.000Z");

function candidateSummary(profile: ProductProfile) {
  return profile.measurementQueries?.map((candidate) => ({
    rank: candidate.rank,
    kind: candidate.kind,
    query: candidate.query,
    currentlyExecutable: candidate.currentlyExecutable,
  }));
}

describe("query measurement candidates", () => {
  it("represents the exact query and derived model/family candidates for Garmin without product-specific code", async () => {
    const { profile } = await resolveProductQuery("Garmin Venu 4", { now: () => now });

    expect(candidateSummary(profile)).toEqual([
      {
        rank: 1,
        kind: "exact",
        query: "Garmin Venu 4",
        currentlyExecutable: true,
      },
      {
        rank: 2,
        kind: "model",
        query: "Venu 4",
        currentlyExecutable: false,
      },
      {
        rank: 3,
        kind: "product_family",
        query: "Garmin Venu",
        currentlyExecutable: false,
      },
    ]);
    expect(profile.measurementQueries?.[0].sourceFields).toEqual(["query", "canonicalTitle", "aliases"]);
    expect(profile.measurementQueries?.map((candidate) => candidate.query)).not.toContain("Garmin");
  });

  it("generates model candidates when structured model data exists", async () => {
    const { profile } = await resolveProductQuery("Ninja Creami Swirl", { now: () => now });

    expect(profile.measurementQueries?.find((candidate) => candidate.kind === "model")).toMatchObject({
      query: "Creami Swirl",
      sourceFields: ["modelGeneration"],
      currentlyExecutable: false,
    });
  });

  it("emits product-family candidates only when a broader family is safely derivable", async () => {
    const safe = await resolveProductQuery("Garmin Venu 4", { now: () => now });
    const unsafe = await resolveProductQuery("Samsung Galaxy Ring", { now: () => now });

    expect(safe.profile.measurementQueries?.some((candidate) =>
      candidate.kind === "product_family" && candidate.query === "Garmin Venu"
    )).toBe(true);
    expect(unsafe.profile.measurementQueries?.some((candidate) =>
      candidate.kind === "product_family"
    )).toBe(false);
  });

  it("deduplicates equivalent casing/spacing/punctuation while keeping deterministic order", () => {
    const profile = createUserSearchProductProfile("  Acme   Widget 3  ", {
      brand: "Acme",
      canonicalTitle: "ACME Widget 3",
      aliases: ["Acme Widget 3", "acme-widget-3", "  ACME   WIDGET 3  "],
      productType: "hardware",
      modelGeneration: "Widget 3",
      identityConfidence: "medium",
    });
    const first = buildMeasurementQueryCandidates(profile);
    const second = buildMeasurementQueryCandidates(profile);

    expect(first).toEqual(second);
    expect(first.map((candidate) => candidate.query)).toEqual([
      "Acme Widget 3",
      "Widget 3",
      "Acme Widget",
    ]);
    expect(first.map((candidate) => candidate.rank)).toEqual([1, 2, 3]);
  });

  it("rejects weak empty, numeric-only, and generated brand-only candidates", () => {
    const candidates = buildMeasurementQueryCandidates({
      productId: "weak-profile",
      source: "user_search",
      query: "   ",
      canonicalTitle: " ",
      brand: "Acme",
      aliases: ["", "  Acme  "],
      productType: "hardware",
      modelGeneration: "2025",
      identityConfidence: "medium",
    });

    expect(candidates).toEqual([]);
  });

  it("applies the same generic family rule to an unrelated product", () => {
    const profile = createUserSearchProductProfile("Acme Widget 3", {
      brand: "Acme",
      productType: "hardware",
      modelGeneration: "Widget 3",
      identityConfidence: "medium",
    });

    expect(candidateSummary(profile)).toEqual([
      {
        rank: 1,
        kind: "exact",
        query: "Acme Widget 3",
        currentlyExecutable: true,
      },
      {
        rank: 2,
        kind: "model",
        query: "Widget 3",
        currentlyExecutable: false,
      },
      {
        rank: 3,
        kind: "product_family",
        query: "Acme Widget",
        currentlyExecutable: false,
      },
    ]);
  });

  it("performs no provider or network calls", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(() => {
      throw new Error("query candidate generation must not fetch");
    });

    Object.defineProperty(globalThis, "fetch", {
      value: fetchSpy,
      configurable: true,
    });

    try {
      const resolved = await resolveProductQuery("Garmin Venu 4", { now: () => now });
      const candidates = buildMeasurementQueryCandidates(resolved.profile);

      expect(candidates).toHaveLength(3);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        value: originalFetch,
        configurable: true,
      });
    }
  });

  it("rebuilds candidates for cached profiles without changing the resolved identity", async () => {
    const cache = new InMemoryProductResolutionCache();
    const first = await resolveProductQuery("Garmin Venu 4", {
      cache,
      now: () => now,
    });
    const second = await resolveProductQuery("Garmin Venu 4", {
      cache,
      now: () => new Date(now.getTime() + 60_000),
    });

    expect(second.cacheStatus).toBe("hit");
    expect(second.resolution.resolutionSource).toBe("cached_resolution");
    expect(second.profile.productId).toBe(first.profile.productId);
    expect(candidateSummary(second.profile)).toEqual(candidateSummary(first.profile));
  });
});
