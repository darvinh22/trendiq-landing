import { describe, expect, it } from "vitest";
import {
  averageSearchInterestForWindow,
  buildSearchWindows,
  calculateAliasCoveragePercent,
  calculatePercentChange,
} from "../normalization";
import type { SearchInterestPoint } from "../types";

const points: SearchInterestPoint[] = [
  {
    dateFrom: "2026-07-30",
    dateTo: "2026-08-05",
    timestamp: 1785369600,
    valuesByAlias: {
      "Ray-Ban Meta": 40,
      "Ray Ban Meta": 42,
    },
  },
  {
    dateFrom: "2026-08-06",
    dateTo: "2026-08-12",
    timestamp: 1785974400,
    valuesByAlias: {
      "Ray-Ban Meta": 70,
      "Ray Ban Meta": 68,
    },
  },
];

describe("search normalization", () => {
  it("builds current and previous 7-day/30-day windows", () => {
    expect(buildSearchWindows(new Date("2026-08-12T00:00:00.000Z"))).toMatchObject({
      dateFrom: "2026-07-14",
      dateTo: "2026-08-12",
      current7d: {
        dateFrom: "2026-08-06",
        dateTo: "2026-08-12",
      },
      previous7d: {
        dateFrom: "2026-07-30",
        dateTo: "2026-08-05",
      },
      prior7d: {
        dateFrom: "2026-07-23",
        dateTo: "2026-07-29",
      },
    });
  });

  it("calculates 7-day interest averages from provider points", () => {
    const windows = buildSearchWindows(new Date("2026-08-12T00:00:00.000Z"));

    expect(averageSearchInterestForWindow(points, windows.current7d)).toEqual({
      interest: 69,
      pointCount: 1,
    });
    expect(averageSearchInterestForWindow(points, windows.previous7d)).toEqual({
      interest: 41,
      pointCount: 1,
    });
  });

  it("calculates percent changes and alias coverage deterministically", () => {
    expect(calculatePercentChange(69, 41)).toBe(68.3);
    expect(calculatePercentChange(10, 0)).toBe(100);
    expect(calculateAliasCoveragePercent(points, ["Ray-Ban Meta", "Ray Ban Meta", "Meta smart glasses"])).toBe(66.7);
  });
});
