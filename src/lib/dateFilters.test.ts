// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { filterDateContext, resolveDateBound, resolveDateFilters } from "./dateFilters";

// Wednesday 7 and Thursday 8 January 2026, New York noon.
const wed = { ...filterDateContext("XNYS"), now: new Date("2026-01-07T17:00:00Z"), zone: "America/New_York" };
const thu = { ...wed, now: new Date("2026-01-08T17:00:00Z") };

describe("resolveDateBound", () => {
  it("keeps a YYYY-MM-DD bound fixed, whatever the clock", () => {
    expect(resolveDateBound("2026-01-05", wed)).toBe("2026-01-05");
    expect(resolveDateBound("2026-01-05", thu)).toBe("2026-01-05");
  });

  it("resolves a date expression to its day at the time it is asked", () => {
    expect(resolveDateBound("T-1bd", wed)).toBe("2026-01-06");
    expect(resolveDateBound("T-1bd", thu)).toBe("2026-01-07");
    expect(resolveDateBound("T", thu)).toBe("2026-01-08");
  });

  it("answers no bound, rather than throwing, for an expression that cannot resolve (review I1)", () => {
    for (const text of ["T@close", "T(FOO)"]) expect(resolveDateBound(text, wed)).toBeUndefined();
  });

  it("answers no bound for blank text, a range, or text that is not an expression", () => {
    for (const text of [undefined, "", "T/T-1", "T..T-1", "abc"]) expect(resolveDateBound(text, wed)).toBeUndefined();
  });
});

describe("resolveDateFilters", () => {
  it("resolves only date ranges and leaves the stored filters untouched", () => {
    const stored = [
      { id: "date", value: { from: "2026-01-02", to: "T-1bd" } },
      { id: "close", value: { min: 1 } },
      { id: "name", value: "T-1bd" },
    ];
    const copy = structuredClone(stored);
    expect(resolveDateFilters(stored, wed)).toEqual([
      { id: "date", value: { from: "2026-01-02", to: "2026-01-06" } },
      { id: "close", value: { min: 1 } },
      { id: "name", value: "T-1bd" },
    ]);
    expect(resolveDateFilters(stored, thu)[0].value).toEqual({ from: "2026-01-02", to: "2026-01-07" });
    expect(stored).toEqual(copy);
  });
});

describe("a saved date expression filter", () => {
  it("round-trips a BDOBB Workspace save as its text, not as a day", async () => {
    const { workspaceApp } = await import("./saveWorkspace");
    const { importApps } = await import("./appsJson");
    const { card } = await import("../test/fixtures");
    const filters = [{ id: "date", value: { from: "2026-01-02", to: "T-1bd" } }];
    const dashboard = { id: "d1", name: "Dates", tabs: [{ id: "t1", name: "Main", cards: [{ ...card(), table: { columnFilters: filters } }] }] };
    const saved = workspaceApp(dashboard, "bdobb");
    if (!saved.ok) throw new Error(saved.issue.message);
    const text = JSON.stringify([saved.value]);
    expect(text).toContain('"to":"T-1bd"');
    const back = importApps(JSON.parse(text), []).dashboards[0];
    expect(back.tabs[0].cards[0].table?.columnFilters).toEqual(filters);
  });
});

describe("a (24/7) bound (fix round 1, item 2)", () => {
  it("reads T-1d(24/7) as a bound, not as a range", () => {
    expect(resolveDateBound("T-1d(24/7)", { now: new Date("2026-10-21T15:00:00Z") })).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(resolveDateBound("T-1d(24/7)/T")).toBeUndefined();
  });
});
