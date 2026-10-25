// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { CATALOGUE, UNMAPPED_SUFFIXES, calendarEntry, calendarSpelling, canonicalCalendar, isOvernight } from "./catalogue";

describe("the vendored catalogue", () => {
  it("holds every exchange_calendars calendar, once", () => {
    expect(CATALOGUE).toHaveLength(71);
    expect(new Set(CATALOGUE.map((e) => e.mic)).size).toBe(71);
    expect(CATALOGUE.every((e) => e.calendarId === `exchange:${e.mic}`)).toBe(true);
  });

  it("names zones the runtime can use", () => {
    for (const e of CATALOGUE) expect(() => new Intl.DateTimeFormat("en-US", { timeZone: e.timezone }), e.mic).not.toThrow();
  });

  it("marks exactly the five overnight calendars", () => {
    expect(CATALOGUE.filter((e) => e.overnight).map((e) => e.mic)).toEqual(["24/5", "24/7", "CMES", "IEPA", "us_futures"]);
    expect(isOvernight("CMES")).toBe(true);
    expect(isOvernight("XNYS")).toBe(false);
    expect(isOvernight("XNAS")).toBe(false);
  });

  it("finds a calendar by its own name, case-insensitively, and never by an alias (ruling RF3)", () => {
    expect(canonicalCalendar("us_futures")).toBe("us_futures");
    expect(canonicalCalendar("US_FUTURES")).toBe("us_futures");
    expect(canonicalCalendar(" xpar ")).toBe("XPAR");
    expect(canonicalCalendar("24/7")).toBe("24/7");
    for (const name of ["NYSE", "XNAS", "constructor", ""]) expect(canonicalCalendar(name), name).toBeUndefined();
    expect(calendarEntry("XSES")?.bounds).toEqual({ start: "1990-01-01", end: "2026-12-31" });
    expect(calendarEntry("xses")).toBeUndefined();
  });

  it("records the suffixes it drops", () => {
    expect(UNMAPPED_SUFFIXES.NX).toMatch(/Euronext/);
  });
});

describe("calendarSpelling (fix round 1, item 6)", () => {
  it("keeps a catalogue calendar's own spelling and upper-cases any other name, trimmed", () => {
    expect(calendarSpelling(" US_FUTURES ")).toBe("us_futures");
    expect(calendarSpelling("xpar")).toBe("XPAR");
    expect(calendarSpelling(" us ")).toBe("US");
    expect(calendarSpelling("xnas")).toBe("XNAS");
  });
});
