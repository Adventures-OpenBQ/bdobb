// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { CalendarDate, parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import {
  fiscalPeriod,
  fiscalYearEndOf,
  fiscalYearSpan,
  formatQuarter,
  formatWeek,
  isFiscalType,
  isoWeek,
  midpoint,
  monthLabel,
  parseFiscalYear,
  parseFyEndMonth,
  parseQuarter,
  parseWeek,
  quarterSpan,
  relabel,
  unprefixLabel,
  weekSpan,
} from "./periods";

const d = (s: string) => parseDate(s);

describe("fiscalPeriod — the addendum's verification table, row for row", () => {
  it.each([
    ["AAPL", 9, "2024-12-28", 2025, 1],
    ["AAPL", 9, "2025-09-27", 2025, 4],
    ["MSFT", 6, "2026-09-30", 2027, 1],
    ["MSFT", 6, "2027-06-30", 2027, 4],
    ["WMT", 1, "2025-04-30", 2026, 1],
    ["WMT", 1, "2026-01-31", 2026, 4],
    ["Any Dec", 12, "2024-09-30", 2024, 3],
  ])("%s (FY ends %i): %s is Q%i… FY%i", (_issuer, fyEnd, end, fy, q) => {
    expect(fiscalPeriod(d(end), fyEnd)).toEqual({ fy, q });
  });
});

describe("quarterSpan and fiscalYearSpan are the inverses of fiscalPeriod", () => {
  it("names the calendar months of a quarter under each year end", () => {
    expect(quarterSpan({ fy: 2027, q: 1 }, 6)).toEqual({ start: d("2026-07-01"), end: d("2026-09-30") });
    expect(quarterSpan({ fy: 2025, q: 1 }, 9)).toEqual({ start: d("2024-10-01"), end: d("2024-12-31") });
    expect(quarterSpan({ fy: 2026, q: 1 }, 1)).toEqual({ start: d("2025-02-01"), end: d("2025-04-30") });
    expect(quarterSpan({ fy: 2026, q: 3 }, 12)).toEqual({ start: d("2026-07-01"), end: d("2026-09-30") });
  });

  it("names a fiscal year's first and last day", () => {
    expect(fiscalYearSpan(2027, 6)).toEqual({ start: d("2026-07-01"), end: d("2027-06-30") });
    expect(fiscalYearSpan(2026, 1)).toEqual({ start: d("2025-02-01"), end: d("2026-01-31") });
    expect(fiscalYearSpan(2026, 12)).toEqual({ start: d("2026-01-01"), end: d("2026-12-31") });
    // February's last day is not the 31st.
    expect(fiscalYearSpan(2028, 2)).toEqual({ start: d("2027-03-01"), end: d("2028-02-29") });
  });

  it("round-trips every quarter of every year end through fiscalPeriod", () => {
    for (let fyEnd = 1; fyEnd <= 12; fyEnd += 1) {
      for (let q = 1; q <= 4; q += 1) {
        const { start, end } = quarterSpan({ fy: 2026, q }, fyEnd);
        expect(fiscalPeriod(start, fyEnd)).toEqual({ fy: 2026, q });
        expect(fiscalPeriod(end, fyEnd)).toEqual({ fy: 2026, q });
      }
    }
  });
});

describe("parseFyEndMonth", () => {
  it("accepts 1..12 as a number or a numeric string", () => {
    expect(parseFyEndMonth(9)).toBe(9);
    expect(parseFyEndMonth("12")).toBe(12);
    expect(parseFyEndMonth(0)).toBeUndefined();
    expect(parseFyEndMonth(13)).toBeUndefined();
    expect(parseFyEndMonth(9.5)).toBeUndefined();
  });

  it("accepts a month name in any case with surrounding whitespace, and a three-letter abbreviation", () => {
    expect(parseFyEndMonth("September")).toBe(9);
    expect(parseFyEndMonth("  june ")).toBe(6);
    expect(parseFyEndMonth("JAN")).toBe(1);
  });

  it("rejects anything else rather than guessing", () => {
    expect(parseFyEndMonth("")).toBeUndefined();
    expect(parseFyEndMonth("Septembre")).toBeUndefined();
    expect(parseFyEndMonth(null)).toBeUndefined();
    expect(parseFyEndMonth(true)).toBeUndefined();
  });
});

describe("fiscalYearEndOf — the endpoint's response shapes", () => {
  it("reads a bare number, a bare month name, and an object with a fiscalYearEnd key", () => {
    expect(fiscalYearEndOf(6)).toBe(6);
    expect(fiscalYearEndOf("September")).toBe(9);
    expect(fiscalYearEndOf({ fiscalYearEnd: "January" })).toBe(1);
    expect(fiscalYearEndOf({ fiscalYearEnd: 3 })).toBe(3);
  });

  it("is undefined for anything else, so the caller falls through", () => {
    expect(fiscalYearEndOf(null)).toBeUndefined();
    expect(fiscalYearEndOf([9])).toBeUndefined();
    expect(fiscalYearEndOf({ month: 9 })).toBeUndefined();
  });
});

describe("labels", () => {
  it("formats and parses a quarter, a fiscal year and a week", () => {
    expect(formatQuarter({ fy: 2027, q: 1 })).toBe("2027-Q1");
    expect(parseQuarter("2027-Q1")).toEqual({ fy: 2027, q: 1 });
    expect(parseQuarter("2027-Q5")).toBeNull();
    expect(parseQuarter("T-1q")).toBeNull();
    expect(parseFiscalYear("2027")).toBe(2027);
    expect(parseFiscalYear("27")).toBeNull();
    expect(formatWeek({ year: 2026, week: 7 })).toBe("2026-W07");
    expect(parseWeek("2026-W37")).toEqual({ year: 2026, week: 37 });
    expect(parseWeek("2026-W54")).toBeNull();
    expect(parseWeek("2026-37")).toBeNull();
  });

  it("accepts W53 only in a year that has one", () => {
    // 2020 has 53 ISO weeks; 2025 does not, and its "W53" is 2026-W01's dates.
    expect(parseWeek("2020-W53")).toEqual({ year: 2020, week: 53 });
    expect(parseWeek("2025-W53")).toBeNull();
  });
});

describe("ISO weeks", () => {
  it("puts Jan 1 in the previous year's last week when it falls late in the week", () => {
    // 2027 starts on a Friday: its first three days belong to 2026-W53.
    expect(isoWeek(d("2027-01-01"))).toEqual({ year: 2026, week: 53 });
    // 2021 starts on a Friday too, and 2020 had 53 weeks.
    expect(isoWeek(d("2021-01-01"))).toEqual({ year: 2020, week: 53 });
    // 2026 starts on a Thursday, so Jan 1 is already in week 1.
    expect(isoWeek(d("2026-01-01"))).toEqual({ year: 2026, week: 1 });
  });

  it("puts Dec 31 in the next year's week 1 when it falls early in the week", () => {
    // 2024-12-31 is a Tuesday.
    expect(isoWeek(d("2024-12-31"))).toEqual({ year: 2025, week: 1 });
    expect(isoWeek(d("2025-12-29"))).toEqual({ year: 2026, week: 1 });
  });

  it("spans Monday to Sunday", () => {
    expect(weekSpan({ year: 2026, week: 37 })).toEqual({ start: d("2026-09-07"), end: d("2026-09-13") });
    expect(weekSpan({ year: 2026, week: 1 })).toEqual({ start: d("2025-12-29"), end: d("2026-01-04") });
    expect(weekSpan({ year: 2020, week: 53 })).toEqual({ start: d("2020-12-28"), end: d("2021-01-03") });
    expect(isoWeek(d("2026-09-13"))).toEqual({ year: 2026, week: 37 });
  });
});

describe("relabel between fiscal year ends", () => {
  it("is the identity for a December member, and for any value that is not a label", () => {
    expect(relabel("2026-Q3", 12, 12)).toBe("2026-Q3");
    expect(relabel("T-1q", 12, 9)).toBe("T-1q");
    expect(relabel("", 12, 9)).toBe("");
    expect(relabel("AAPL", 1, 12)).toBe("AAPL");
  });

  it.each([
    ["AAPL", 9, "2025-Q1", "2024-Q4"],
    ["MSFT", 6, "2027-Q1", "2026-Q3"],
    ["WMT", 1, "2027-Q3", "2026-Q3"],
    ["December", 12, "2026-Q2", "2026-Q2"],
  ])("%s (FY ends %i): %s is calendar %s, and reads back the same", (_issuer, fyEnd, own, calendar) => {
    expect(relabel(own, fyEnd, 12)).toBe(calendar);
    expect(relabel(calendar, 12, fyEnd)).toBe(own);
  });

  it.each([
    ["AAPL", 9, "2025", "2025"],
    ["MSFT", 6, "2027", "2026"],
    ["WMT", 1, "2026", "2025"],
  ])("%s (FY ends %i): fiscal year %s is calendar %s, and reads back the same", (_issuer, fyEnd, own, calendar) => {
    expect(relabel(own, fyEnd, 12)).toBe(calendar);
    expect(relabel(calendar, 12, fyEnd)).toBe(own);
  });

  it("uses the midpoint, so a non-coinciding quarter does not slide to a neighbour", () => {
    // WMT Aug–Oct 2026 midpoint is mid-September; its start (Aug 1) would
    // also be calendar Q3, but its end (Oct 31) would be Q4.
    expect(midpoint(d("2026-08-01"), d("2026-10-31"))).toEqual(d("2026-09-15"));
  });
});

describe("CalendarDate arithmetic this file relies on", () => {
  it("compare() counts days, and add() clamps a month's day to the target month", () => {
    expect(d("2026-03-01").compare(d("2026-02-01"))).toBe(28);
    expect(new CalendarDate(2026, 1, 31).add({ months: 1 })).toEqual(d("2026-02-28"));
    expect(new CalendarDate(2028, 1, 31).add({ months: 1 })).toEqual(d("2028-02-29"));
  });
});

describe("FY-prefixed labels and month labels (v5.4.0)", () => {
  it("reads FY2026-Q3 and FY2026 as the unprefixed labels", () => {
    expect(parseQuarter("FY2026-Q3")).toEqual({ fy: 2026, q: 3 });
    expect(parseFiscalYear("FY2026")).toBe(2026);
    expect(parseQuarter("FY26-Q3")).toBeNull();
    expect(unprefixLabel("FY2026-Q3")).toBe("2026-Q3");
    expect(unprefixLabel("FY2026")).toBe("2026");
    expect(unprefixLabel("FQ0")).toBe("FQ0");
    expect(unprefixLabel("FY-1")).toBe("FY-1");
  });

  it("names a month by its locale abbreviation", () => {
    expect(monthLabel(12, "en-US")).toBe("Dec");
    expect(monthLabel(9, "en-US")).toBe("Sep");
    expect(monthLabel(1, "fr-FR")).toBe("janv.");
    expect(monthLabel(12, "fr-FR")).toBe("déc.");
  });
});

describe("quarter ranges (v5.4.0)", () => {
  it("relabels each half, keeping the separator, and passes an expression through", () => {
    expect(relabel("2026-Q3/2026-Q4", 12, 9)).toBe("2026-Q4/2027-Q1");
    expect(relabel("2026-Q3..2026-Q4", 12, 9)).toBe("2026-Q4..2027-Q1");
    expect(relabel("FQ-4/FQ0", 12, 9)).toBe("FQ-4/FQ0");
    expect(relabel("2026-01-01/2026-03-31", 12, 9)).toBe("2026-01-01/2026-03-31");
  });

  it("counts quarter_range as a fiscal type", () => {
    expect(isFiscalType("quarter_range")).toBe(true);
  });
});
