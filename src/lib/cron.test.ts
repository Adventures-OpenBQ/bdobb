// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { cronMatches, cronNext, cronPrev, dataUpdateText, parseCron } from "./cron";

/** Local time, as cron is. Month is 1-based here for readability. */
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi);

describe("parseCron", () => {
  it.each([
    "* * * * *",
    "*/5 * * * *",
    "0 8 * * 1-5",
    "0 10 * * *",
    "0 0 * * 0",
    "0 0 * * 7",
    "0,30 9-17/2 1,15 1-12 *",
    "  0 10 * * *  ",
  ])("accepts %s", (expr) => {
    expect(parseCron(expr)).not.toBeNull();
  });

  it.each([
    "",
    "* * * *",
    "* * * * * *",
    "60 * * * *",
    "* 24 * * *",
    "* * 0 * *",
    "* * * 13 *",
    "* * * * 8",
    "5-1 * * * *",
    "*/0 * * * *",
    "5/2 * * * *",
    "1,,2 * * * *",
    "a * * * *",
    "-1 * * * *",
    "* * * JAN *",
  ])("rejects %j", (expr) => {
    expect(parseCron(expr)).toBeNull();
  });

  it("treats day-of-week 7 as Sunday, like 0", () => {
    const sunday = at(2026, 11, 1, 0, 0); // 1 Nov 2026 is a Sunday
    expect(cronMatches(parseCron("0 0 * * 7")!, sunday)).toBe(true);
    expect(cronMatches(parseCron("0 0 * * 0")!, sunday)).toBe(true);
  });
});

describe("cronMatches", () => {
  it("matches a day when EITHER restricted day field matches", () => {
    const c = parseCron("0 0 13 * 5")!; // the 13th, or any Friday
    expect(cronMatches(c, at(2026, 11, 13, 0, 0))).toBe(true); // Friday the 13th
    expect(cronMatches(c, at(2026, 10, 13, 0, 0))).toBe(true); // a Tuesday the 13th
    expect(cronMatches(c, at(2026, 10, 30, 0, 0))).toBe(true); // a Friday the 30th
    expect(cronMatches(c, at(2026, 10, 29, 0, 0))).toBe(false); // a Thursday the 29th
  });

  it("needs both when only one day field is restricted", () => {
    const c = parseCron("0 8 * * 1-5")!;
    expect(cronMatches(c, at(2026, 10, 29, 8, 0))).toBe(true); // Thursday
    expect(cronMatches(c, at(2026, 10, 31, 8, 0))).toBe(false); // Saturday
    expect(cronMatches(c, at(2026, 10, 29, 8, 1))).toBe(false);
  });
});

describe("cronNext / cronPrev", () => {
  it("finds the next boundary strictly after the given minute", () => {
    const c = parseCron("*/5 * * * *")!;
    expect(cronNext(c, at(2026, 10, 29, 10, 2))).toEqual(at(2026, 10, 29, 10, 5));
    expect(cronNext(c, at(2026, 10, 29, 10, 5))).toEqual(at(2026, 10, 29, 10, 10));
  });

  it("finds the latest boundary at or before the given time", () => {
    const c = parseCron("0 10 * * *")!;
    expect(cronPrev(c, at(2026, 10, 29, 12, 0))).toEqual(at(2026, 10, 29, 10, 0));
    expect(cronPrev(c, at(2026, 10, 29, 10, 0))).toEqual(at(2026, 10, 29, 10, 0));
    expect(cronPrev(c, at(2026, 10, 29, 9, 59))).toEqual(at(2026, 10, 28, 10, 0));
  });

  it("reaches a leap day within its four-year cap", () => {
    expect(cronNext(parseCron("0 0 29 2 *")!, at(2026, 10, 29, 0, 0))).toEqual(at(2028, 2, 29, 0, 0));
  });

  it("gives up, rather than looping, on a date that never comes", () => {
    expect(cronNext(parseCron("0 0 30 2 *")!, at(2026, 10, 29, 0, 0))).toBeNull();
  });
});

describe("dataUpdateText", () => {
  it("names the expression and the previous and next scheduled updates in local time", () => {
    const now = at(2026, 10, 29, 12, 0);
    expect(dataUpdateText("0 10 * * *", now)).toBe(
      `Data update: 0 10 * * * · last ${at(2026, 10, 29, 10, 0).toLocaleString()} · next ${at(2026, 10, 30, 10, 0).toLocaleString()}`,
    );
  });

  it("is undefined for an invalid expression", () => {
    expect(dataUpdateText("every day", new Date())).toBeUndefined();
  });
});
