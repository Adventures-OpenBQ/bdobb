// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  bucketKey,
  bucketLabel,
  coarserBuckets,
  detectPeriodicity,
  expectedCount,
  straddles,
} from "./periodicity";

/** `n` ISO dates from `start`, stepping by `step(i)` days. */
function series(start: string, n: number, step: (i: number) => number): string[] {
  const out: string[] = [];
  let t = Date.parse(`${start}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += step(i) * 86_400_000;
  }
  return out;
}

describe("detectPeriodicity", () => {
  it("reads business days as daily despite weekend gaps", () => {
    // Mon..Fri, then a 3-day gap: 1,1,1,1,3 repeating. The median is 1.
    expect(detectPeriodicity(series("2024-01-01", 40, (i) => (i % 5 === 4 ? 3 : 1)))).toBe("daily");
  });
  it("reads weekly", () => {
    expect(detectPeriodicity(series("2024-01-05", 20, () => 7))).toBe("weekly");
  });
  it("reads month ends across 28- to 31-day gaps", () => {
    const ends = ["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30", "2024-05-31", "2024-06-30"];
    expect(detectPeriodicity(ends)).toBe("monthly");
  });
  it("reads quarterly and annual", () => {
    expect(detectPeriodicity(["2023-03-31", "2023-06-30", "2023-09-30", "2023-12-31", "2024-03-31"])).toBe("quarterly");
    expect(detectPeriodicity(["2020-12-31", "2021-12-31", "2022-12-31", "2023-12-31"])).toBe("annual");
  });
  it("dedupes repeated dates, as a long table of many symbols has", () => {
    const ends = ["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"];
    expect(detectPeriodicity([...ends, ...ends, ...ends])).toBe("monthly");
  });
  it("reads a datetime by its date part", () => {
    expect(detectPeriodicity(["2024-01-31T00:00:00", "2024-02-29T00:00:00Z", "2024-03-31 00:00:00", "2024-04-30"])).toBe("monthly");
  });
  it("keeps the annual band tight to 365-366 days, per the spec", () => {
    // A median gap of 364 or 367 days is not a clean annual cadence.
    expect(detectPeriodicity(series("2024-01-01", 3, () => 364))).toBe("irregular");
    expect(detectPeriodicity(series("2024-01-01", 3, () => 367))).toBe("irregular");
  });
  it("is irregular for event dates, too few dates, and non-dates", () => {
    expect(detectPeriodicity(["2024-01-03", "2024-01-19", "2024-03-02", "2024-03-04", "2024-07-30"])).toBe("irregular");
    expect(detectPeriodicity(["2024-01-31", "2024-02-29"])).toBe("irregular");
    expect(detectPeriodicity([null, undefined, 7, "soon"])).toBe("irregular");
  });
});

describe("buckets", () => {
  it("offers only coarser buckets", () => {
    expect(coarserBuckets("daily")).toEqual(["week", "month", "quarter", "year"]);
    expect(coarserBuckets("weekly")).toEqual(["month", "quarter", "year"]);
    expect(coarserBuckets("monthly")).toEqual(["quarter", "year"]);
    expect(coarserBuckets("quarterly")).toEqual(["year"]);
    expect(coarserBuckets("annual")).toEqual([]);
    // An event date is a point in time: it belongs to exactly one of each.
    expect(coarserBuckets("irregular")).toEqual(["week", "month", "quarter", "year"]);
  });
  it("says weekly straddles every coarser calendar period, and nothing else does", () => {
    expect(straddles("weekly", "month")).toBe(true);
    expect(straddles("weekly", "quarter")).toBe(true);
    expect(straddles("weekly", "year")).toBe(true);
    expect(straddles("weekly", "native")).toBe(false);
    expect(straddles("daily", "month")).toBe(false);
    expect(straddles("monthly", "quarter")).toBe(false);
  });
  it("knows how many observations a clean calendar nest holds", () => {
    expect(expectedCount("monthly", "quarter")).toBe(3);
    expect(expectedCount("monthly", "year")).toBe(12);
    expect(expectedCount("quarterly", "year")).toBe(4);
    expect(expectedCount("daily", "month")).toBeUndefined();
    expect(expectedCount("weekly", "month")).toBeUndefined();
    expect(expectedCount("monthly", "native")).toBeUndefined();
  });
  it("makes keys that sort chronologically as text", () => {
    expect(bucketKey("2024-03-31", "year")).toBe("2024");
    expect(bucketKey("2024-03-31", "quarter")).toBe("2024-Q1");
    expect(bucketKey("2024-04-01", "quarter")).toBe("2024-Q2");
    expect(bucketKey("2024-03-31T16:00:00Z", "month")).toBe("2024-03");
    expect(bucketKey("2024-03-31", "native")).toBe("2024-03-31");
    expect(bucketKey("soon", "month")).toBeNull();
  });
  it("uses the ISO week, whose year can differ from the calendar year", () => {
    expect(bucketKey("2024-03-27", "week")).toBe("2024-W13");
    expect(bucketKey("2024-12-30", "week")).toBe("2025-W01");
    expect(bucketKey("2021-01-03", "week")).toBe("2020-W53");
  });
  it("labels a key for people", () => {
    expect(bucketLabel("2024-Q1", "quarter")).toBe("2024 Q1");
    expect(bucketLabel("2024-03", "month")).toBe("2024-03");
    expect(bucketLabel("2024", "year")).toBe("2024");
  });
});
