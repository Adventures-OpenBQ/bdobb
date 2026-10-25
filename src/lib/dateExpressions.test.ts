// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { getLocalTimeZone, parseAbsolute, parseZonedDateTime } from "@internationalized/date";
import { beforeEach, describe, expect, it } from "vitest";
import { __read, __reset } from "../test/memfs";
import { bundledCalendar, newTrace, normalizeCalendar, type ExchangeCalendar } from "./calendar";
import { __resetLoggerForTests } from "./logger";
import {
  isExpression,
  isRange,
  isPeriodType,
  isRangeType,
  parseExpression,
  parseWireDate,
  parseWireDatetime,
  parseWireTime,
  previewExpression,
  projectValue,
  resolveExpression,
  resolveValue,
  serializeExpression,
  stringifyAtom,
  splitRange,
  stringifyExpression,
  wireDatetime,
  wireTime,
} from "./dateExpressions";

const canonical = (value: string) => {
  const expr = parseExpression(value);
  return expr ? serializeExpression(expr) : null;
};

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
});

// Local wall clock: the grammar means "now, to the person looking at the screen".
const NOW = new Date(2026, 8, 14, 9, 30, 15); // Mon 14 Sep 2026 09:30:15
const ZONE = getLocalTimeZone();

const named = (name: string, offsets: Array<{ sign: 1 | -1; amount: number; unit: string }> = []) => ({
  start: { anchor: { kind: "named", name }, offsets },
});
const period = (p: string, n: number, offsets: Array<{ sign: 1 | -1; amount: number; unit: string }> = []) => ({
  start: { anchor: { kind: "period", period: p, n }, offsets },
});

describe("parseExpression", () => {
  it("accepts a bare anchor with no offsets, and reads $currentDate as T", () => {
    expect(parseExpression("T")).toEqual(named("T"));
    expect(parseExpression("$currentDate")).toEqual(named("T"));
    expect(parseExpression("now")).toEqual(named("now"));
    expect(parseExpression("trade_date")).toEqual(named("trade_date"));
    expect(parseExpression("prev_trade_date")).toEqual(named("prev_trade_date"));
    expect(parseExpression("session_open")).toEqual(named("session_open"));
    expect(parseExpression("session_close")).toEqual(named("session_close"));
  });

  it("reads a bare number as days, and every unit by name", () => {
    expect(parseExpression("T-1")).toEqual(named("T", [{ sign: -1, amount: 1, unit: "d" }]));
    expect(parseExpression("T+2w")).toEqual(named("T", [{ sign: 1, amount: 2, unit: "w" }]));
    expect(parseExpression("T-1q")).toEqual(named("T", [{ sign: -1, amount: 1, unit: "q" }]));
    expect(parseExpression("T-3min")).toEqual(named("T", [{ sign: -1, amount: 3, unit: "min" }]));
    expect(parseExpression("T-90s")).toEqual(named("T", [{ sign: -1, amount: 90, unit: "s" }]));
    expect(parseExpression("T-2h")).toEqual(named("T", [{ sign: -1, amount: 2, unit: "h" }]));
    expect(parseExpression("T-5y")).toEqual(named("T", [{ sign: -1, amount: 5, unit: "y" }]));
    expect(parseExpression("T-5bd")).toEqual(named("T", [{ sign: -1, amount: 5, unit: "bd" }]));
    expect(parseExpression("FQ0-1fq")).toEqual(period("FQ", 0, [{ sign: -1, amount: 1, unit: "fq" }]));
    expect(parseExpression("FY0+1fy")).toEqual(period("FY", 0, [{ sign: 1, amount: 1, unit: "fy" }]));
  });

  it("treats m and mo as months, never minutes", () => {
    expect(parseExpression("T-1m")).toEqual(named("T", [{ sign: -1, amount: 1, unit: "m" }]));
    expect(parseExpression("T-1mo")).toEqual(named("T", [{ sign: -1, amount: 1, unit: "m" }]));
  });

  it("chains offsets left to right", () => {
    expect(parseExpression("T-1y+1d")).toEqual(
      named("T", [{ sign: -1, amount: 1, unit: "y" }, { sign: 1, amount: 1, unit: "d" }]),
    );
  });

  it("reads the period anchors and their shorthand: Q-4 is four quarters back, Q0-4 is four days before this quarter", () => {
    expect(parseExpression("W0")).toEqual(period("W", 0));
    expect(parseExpression("M0")).toEqual(period("M", 0));
    expect(parseExpression("Q0")).toEqual(period("Q", 0));
    expect(parseExpression("Y0")).toEqual(period("Y", 0));
    expect(parseExpression("FQ0")).toEqual(period("FQ", 0));
    expect(parseExpression("FY0")).toEqual(period("FY", 0));
    expect(parseExpression("Q-4")).toEqual(period("Q", -4));
    expect(parseExpression("Q0-4")).toEqual(period("Q", 0, [{ sign: -1, amount: 4, unit: "d" }]));
    expect(parseExpression("FQ+1")).toEqual(period("FQ", 1));
    expect(parseExpression("W-26+1d")).toEqual(period("W", -26, [{ sign: 1, amount: 1, unit: "d" }]));
  });

  it("reads a range with / or .., each half an atom", () => {
    expect(parseExpression("T-7d/T")).toEqual({
      start: { anchor: { kind: "named", name: "T" }, offsets: [{ sign: -1, amount: 7, unit: "d" }] },
      end: { anchor: { kind: "named", name: "T" }, offsets: [] },
    });
    expect(parseExpression("M0..T")).toEqual({
      start: { anchor: { kind: "period", period: "M", n: 0 }, offsets: [] },
      end: { anchor: { kind: "named", name: "T" }, offsets: [] },
    });
    expect(parseExpression("T/T/T")).toBeNull();
    expect(parseExpression("2026-01-01/T")).toBeNull();
  });

  it("allows whitespace between tokens", () => {
    expect(parseExpression("T - 1")).toEqual(named("T", [{ sign: -1, amount: 1, unit: "d" }]));
    expect(parseExpression(" T-7d / T ")).toEqual(parseExpression("T-7d/T"));
  });

  // v5.3.4: case stopped being part of the grammar (see the block at the end of
  // this file), so `t-1` and `Today` left this list. Everything else here still fails.
  it("rejects anything it cannot read whole", () => {
    expect(parseExpression("T-1x")).toBeNull();
    expect(parseExpression("T1")).toBeNull();
    expect(parseExpression("TSLA")).toBeNull();
    expect(parseExpression("nowhere")).toBeNull();
    expect(parseExpression("W")).toBeNull();
    expect(parseExpression("Q-")).toBeNull();
    expect(parseExpression("2026-09-14")).toBeNull();
    expect(parseExpression("$currentDate-7x")).toBeNull();
    expect(parseExpression("")).toBeNull();
  });

  it("caps an offset amount at six digits: a longer one does not parse, so the value is a literal", () => {
    expect(parseExpression("T-999999d")).toEqual(named("T", [{ sign: -1, amount: 999999, unit: "d" }]));
    expect(parseExpression("T-1000000d")).toBeNull();
    expect(parseExpression("T-999999999999999999999d")).toBeNull();
  });

  it("caps a business-day amount at four digits: a longer one does not parse, so the value is a literal", () => {
    expect(parseExpression("T-9999bd")).toEqual(named("T", [{ sign: -1, amount: 9999, unit: "bd" }]));
    expect(parseExpression("T-10000bd")).toBeNull();
    expect(parseExpression("T-999999bd")).toBeNull();
    expect(resolveValue("date", "T-10000bd", { now: NOW })).toBe("T-10000bd");
    // The cap is bd's alone: a six-digit day amount still parses.
    expect(parseExpression("T-999999d")).toEqual(named("T", [{ sign: -1, amount: 999999, unit: "d" }]));
  });

  it("caps a period shorthand's integer at three digits: a longer one, such as a year, is a literal", () => {
    expect(parseExpression("W-999")).toEqual(period("W", -999));
    expect(parseExpression("Q+999")).toEqual(period("Q", 999));
    expect(parseExpression("W-1000")).toBeNull();
    expect(parseExpression("Y2024")).toBeNull();
    expect(parseExpression("Q-9999999999")).toBeNull();
  });
});

describe("canonical form", () => {
  it("is compact, writes every unit, keeps a shorthand, and normalises .. to /", () => {
    expect(canonical("T")).toBe("$currentDate");
    expect(canonical("T - 1")).toBe("$currentDate-1d");
    expect(canonical("T-1mo")).toBe("$currentDate-1M");
    expect(canonical("$currentDate-7")).toBe("$currentDate-7d");
    expect(canonical("Q-4")).toBe("Q-4");
    expect(canonical("Q+1")).toBe("Q+1");
    expect(canonical("Q0-4")).toBe("Q0-4d");
    expect(canonical("T-7d .. T")).toBe("$currentDate-7d/$currentDate");
    expect(canonical("trade_date-5bd/trade_date")).toBe("trade_date-5bd/trade_date");
    expect(canonical("AAPL")).toBeNull();
  });

  it("round-trips every built-in shape through parse and stringify", () => {
    for (const expr of ["T", "T-1d", "T-7d/T", "M0/T", "Q0/T", "Y0/T", "T-12m/T", "trade_date", "prev_trade_date", "trade_date-5bd/trade_date", "now", "now-1h", "now-5min", "session_open", "session_close-1bd", "W0", "W-1", "Q0", "Q-1", "Q-4", "FQ0", "FQ-1", "FQ-4", "FY0", "FY-1"]) {
      expect(stringifyExpression(parseExpression(expr)!)).toBe(expr);
    }
  });

  it("splitRange accepts / and ..", () => {
    expect(splitRange("2026-01-01/T")).toEqual(["2026-01-01", "T"]);
    expect(splitRange("T-7d..T")).toEqual(["T-7d", "T"]);
    expect(splitRange("T")).toEqual(["T", ""]);
  });
});

describe("resolveExpression", () => {
  const at = (expr: string) => resolveExpression(expr, NOW, ZONE)!;

  it("is now for the bare anchor", () => {
    const now = at("T");
    expect([now.year, now.month, now.day, now.hour, now.minute, now.second]).toEqual([2026, 9, 14, 9, 30, 15]);
    expect(now.timeZone).toBe(ZONE);
  });

  it("applies every unit", () => {
    expect(at("T-1").day).toBe(13);
    expect(at("T+1").day).toBe(15);
    expect(at("T-2w").day).toBe(31);
    expect([at("T-1m").month, at("T-1m").day]).toEqual([8, 14]);
    expect([at("T-1q").month, at("T-1q").day]).toEqual([6, 14]);
    expect(at("T-5y").year).toBe(2021);
    expect(at("T-2h").hour).toBe(7);
    expect(at("T-3min").minute).toBe(27);
    expect(at("T-90s").minute).toBe(28);
  });

  it("clamps a month's day to the target month's last day", () => {
    const jan31 = new Date(2026, 0, 31, 12, 0, 0);
    const feb = resolveExpression("T+1m", jan31, ZONE)!;
    expect([feb.month, feb.day]).toEqual([2, 28]);
    const leap = resolveExpression("T+1m", new Date(2028, 0, 31, 12, 0, 0), ZONE)!;
    expect([leap.month, leap.day]).toEqual([2, 29]);
  });

  it("chains", () => {
    const r = at("T-1y+1d");
    expect([r.year, r.month, r.day]).toEqual([2025, 9, 15]);
  });

  it("is null for a literal", () => {
    expect(resolveExpression("2026-09-14", NOW, ZONE)).toBeNull();
  });
});

describe("projectValue", () => {
  const now = resolveExpression("T", NOW, ZONE)!;

  it("projects the same instant into every type", () => {
    expect(projectValue("date", now)).toBe("2026-09-14");
    expect(projectValue("date_range", now)).toBe("2026-09-14");
    expect(projectValue("week", now)).toBe("2026-W38");
    expect(projectValue("quarter", now)).toBe("2026-Q3");
    expect(projectValue("quarter", now, 9)).toBe("2026-Q4");
    expect(projectValue("fiscal_year", now)).toBe("2026");
    expect(projectValue("fiscal_year", now, 6)).toBe("2027");
    expect(projectValue("time", now)).toBe("09:30:15");
    expect(projectValue("datetime", now)).toMatch(/^2026-09-14T09:30:15[+-]\d{2}:\d{2}$/);
  });

  it("applies an hour offset before projecting a date, so T-1h at 00:30 is yesterday", () => {
    const early = resolveExpression("T-1h", new Date(2026, 8, 14, 0, 30, 0), ZONE)!;
    expect(projectValue("date", early)).toBe("2026-09-13");
  });
});

describe("resolveValue", () => {
  it("projects an expression per type and leaves a literal alone", () => {
    expect(resolveValue("date", "T-1", { now: NOW })).toBe("2026-09-13");
    expect(resolveValue("quarter", "T-1q", { now: NOW })).toBe("2026-Q2");
    expect(resolveValue("quarter", "T", { now: NOW, fiscalYearEnd: 9 })).toBe("2026-Q4");
    expect(resolveValue("week", "2026-W37", { now: NOW })).toBe("2026-W37");
    expect(resolveValue(undefined, "$currentDate", { now: NOW })).toBe("2026-09-14");
    expect(resolveValue("text", "AAPL", { now: NOW })).toBe("AAPL");
  });

  it("resolves T only on period types — AT&T's ticker is T, so a non-period value keeps it literal", () => {
    // A period-typed param: T resolves like any other anchor.
    expect(resolveValue("date", "T", { now: NOW })).toBe("2026-09-14");
    // A text param, or no declared type at all (undefined — a form-field key
    // or an untyped param): T is a ticker, not an anchor, with or without an
    // offset suffix.
    expect(resolveValue("text", "T", { now: NOW })).toBe("T");
    expect(resolveValue(undefined, "T", { now: NOW })).toBe("T");
    expect(resolveValue(undefined, "T-1", { now: NOW })).toBe("T-1");
    // $currentDate still resolves on a non-period type — it has never been a
    // ticker, and OpenBB's own manifests spell "today" that way regardless of
    // the param's declared type.
    expect(resolveValue("text", "$currentDate-1", { now: NOW })).toBe("2026-09-13");
  });

  it("resolves each half of a range independently, as a date", () => {
    expect(resolveValue("date_range", "2026-01-01/T", { now: NOW })).toBe("2026-01-01/2026-09-14");
    expect(resolveValue("date_range", "T-1y/T", { now: NOW })).toBe("2025-09-14/2026-09-14");
    expect(resolveValue("date_range", "T", { now: NOW })).toBe("2026-09-14");
  });

  it("logs an unparseable token once and sends it as-is, and never logs an ordinary value", async () => {
    expect(resolveValue("date", "T-1x", { now: NOW })).toBe("T-1x");
    resolveValue("date", "T-1x", { now: NOW });
    expect(resolveValue("date", "$currentDate-7x", { now: NOW })).toBe("$currentDate-7x");
    expect(resolveValue("text", "TSLA", { now: NOW })).toBe("TSLA");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lines = (__read("logs/bdobb.log") ?? "").trimEnd().split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("unsupported date token, sent as-is: T-1x");
    expect(lines[1]).toContain("unsupported date token, sent as-is: $currentDate-7x");
  });
});

describe("wire forms", () => {
  it("writes a datetime to the second with its UTC offset and no zone name", () => {
    const at = parseZonedDateTime("2026-09-14T09:30:15.250[America/New_York]");
    expect(wireDatetime(at)).toBe("2026-09-14T09:30:15-04:00");
    const winter = parseZonedDateTime("2026-01-14T09:30:15[Asia/Kolkata]");
    expect(wireDatetime(winter)).toBe("2026-01-14T09:30:15+05:30");
  });

  it("keeps the instant's own offset when dropping milliseconds inside the DST fall-back repeated hour", () => {
    // America/New_York repeats local 01:30:15 on 2026-11-01: the FIRST pass (05:30:15.250Z) is
    // still -04:00, the SECOND pass (06:30:15.250Z) is -05:00. Zeroing the millisecond via `set`
    // re-resolves the wall time with 'compatible' disambiguation and always lands on the earlier
    // (-04:00) offset; `subtract` must preserve whichever offset the instant actually had.
    const firstPass = parseAbsolute("2026-11-01T05:30:15.250Z", "America/New_York");
    expect(wireDatetime(firstPass)).toBe("2026-11-01T01:30:15-04:00");
    const secondPass = parseAbsolute("2026-11-01T06:30:15.250Z", "America/New_York");
    expect(wireDatetime(secondPass)).toBe("2026-11-01T01:30:15-05:00");
  });

  it("reads a wire datetime back into the given zone", () => {
    const at = parseWireDatetime("2026-09-14T09:30:15-04:00", "America/New_York")!;
    expect([at.year, at.month, at.day, at.hour, at.minute, at.second]).toEqual([2026, 9, 14, 9, 30, 15]);
    const shifted = parseWireDatetime("2026-09-14T09:30:15-04:00", "Europe/London")!;
    expect(shifted.hour).toBe(14);
    expect(parseWireDatetime("not a date", "America/New_York")).toBeNull();
  });

  it("reads and writes a time and a date", () => {
    expect(wireTime(parseWireTime("09:30:00")!)).toBe("09:30:00");
    // @internationalized/date's parseTime requires a two-digit hour; the wire
    // form is always HH:MM:SS, so a single-digit hour is a malformed input,
    // not a lenient parse.
    expect(parseWireTime("09:30")).not.toBeNull();
    expect(parseWireTime("9:30")).toBeNull();
    expect(parseWireTime("noon")).toBeNull();
    expect(parseWireDate("2026-09-14")!.toString()).toBe("2026-09-14");
    expect(parseWireDate("2026-13-01")).toBeNull();
    expect(parseWireDate("")).toBeNull();
  });

  it("knows the seven period types", () => {
    for (const t of ["date", "datetime", "date_range", "quarter", "fiscal_year", "week", "time"]) {
      expect(isPeriodType(t)).toBe(true);
    }
    expect(isPeriodType("text")).toBe(false);
    expect(isPeriodType(undefined)).toBe(false);
  });
});

describe("anchors and units on a calendar", () => {
  const NY = "America/New_York";
  const cal = bundledCalendar("XNYS")!;
  // An instant in New York, written as the wall clock there.
  const ny = (s: string) => parseZonedDateTime(`${s}[America/New_York]`).toDate();
  const on = (type: "date" | "datetime" | "week" | "quarter" | "fiscal_year" | "date_range", expr: string, now: Date, extra: { fiscalYearEnd?: number; calendar?: ExchangeCalendar | null; exchange?: string } = {}) =>
    resolveValue(type, expr, { now, zone: NY, calendar: extra.calendar === null ? undefined : (extra.calendar ?? cal), exchange: extra.exchange, fiscalYearEnd: extra.fiscalYearEnd });

  it("T-5bd on Mon 2026-11-30 is 2026-11-20: Thanksgiving is skipped", () => {
    expect(on("date", "T-5bd", ny("2026-11-30T09:30:00"))).toBe("2026-11-20");
  });

  it("session_close on the day after Thanksgiving is 13:00 New York", () => {
    expect(on("datetime", "session_close", ny("2026-11-27T10:00:00"))).toBe("2026-11-27T13:00:00-05:00");
    expect(on("datetime", "session_open", ny("2026-11-27T10:00:00"))).toBe("2026-11-27T09:30:00-05:00");
  });

  it("session_open on a closed day is the next open day's open", () => {
    expect(on("datetime", "session_open", ny("2026-09-12T10:00:00"))).toBe("2026-09-14T09:30:00-04:00");
    expect(on("date", "session_close", ny("2026-09-12T10:00:00"))).toBe("2026-09-14");
  });

  it("trade_date at 09:00 Mon 2026-09-14 is Friday 2026-09-11; after the close it is the day itself", () => {
    expect(on("date", "trade_date", ny("2026-09-14T09:00:00"))).toBe("2026-09-11");
    expect(on("date", "trade_date", ny("2026-09-14T16:30:00"))).toBe("2026-09-14");
    expect(on("date", "prev_trade_date", ny("2026-09-14T09:00:00"))).toBe("2026-09-10");
    expect(on("datetime", "trade_date", ny("2026-09-14T09:00:00"))).toBe("2026-09-11T16:00:00-04:00");
  });

  it("projects a trading anchor to the exchange-local date, not the user's", () => {
    // 08:00 Tuesday in Tokyo is 19:00 Monday in New York: the last completed
    // session is Monday's, whatever the local date says.
    const tokyoMorning = parseZonedDateTime("2026-09-15T08:00:00[Asia/Tokyo]").toDate();
    expect(resolveValue("date", "trade_date", { now: tokyoMorning, zone: "Asia/Tokyo", calendar: cal })).toBe("2026-09-14");
    expect(resolveValue("date", "T", { now: tokyoMorning, zone: "Asia/Tokyo", calendar: cal })).toBe("2026-09-15");
  });

  it("FQ-4 under a June year end on 2026-09-14 is FY2026-Q1, the same quarter a year earlier", () => {
    const now = ny("2026-09-14T09:30:00");
    expect(on("quarter", "FQ0", now, { fiscalYearEnd: 6 })).toBe("2027-Q1");
    expect(on("quarter", "FQ-4", now, { fiscalYearEnd: 6 })).toBe("2026-Q1");
    expect(on("quarter", "FQ0-1fq", now, { fiscalYearEnd: 6 })).toBe("2026-Q4");
    expect(on("fiscal_year", "FY-1", now, { fiscalYearEnd: 6 })).toBe("2026");
    expect(on("fiscal_year", "FY0", now, { fiscalYearEnd: 6 })).toBe("2027");
  });

  it("resolves the calendar period anchors and their shorthand", () => {
    const wed = ny("2026-09-16T09:30:00");
    expect(on("date", "W0", wed)).toBe("2026-09-14");
    expect(on("date", "M0", wed)).toBe("2026-09-01");
    expect(on("date", "Q0", wed)).toBe("2026-07-01");
    expect(on("date", "Y0", wed)).toBe("2026-01-01");
    expect(on("date", "Q-4", wed)).toBe("2025-07-01");
    expect(on("date", "Q0-4", wed)).toBe("2026-06-27");
    expect(on("date", "M-3", wed)).toBe("2026-06-01");
    expect(on("week", "W-1", wed)).toBe("2026-W37");
    expect(on("quarter", "Q-1", wed)).toBe("2026-Q2");
    expect(on("date", "T-1fq", wed)).toBe("2026-06-16");
    expect(on("date", "T-1fy", wed)).toBe("2025-09-16");
    expect(on("datetime", "now-1h", wed)).toBe("2026-09-16T08:30:00-04:00");
    expect(on("datetime", "now-5min", wed)).toBe("2026-09-16T09:25:00-04:00");
  });

  it("resolves each half of a range, with / or ..", () => {
    const mon = ny("2026-09-14T09:30:00");
    expect(on("date_range", "T-7d/T", mon)).toBe("2026-09-07/2026-09-14");
    expect(on("date_range", "T-7d..T", mon)).toBe("2026-09-07/2026-09-14");
    expect(on("date_range", "trade_date-5bd/trade_date", ny("2026-09-14T17:00:00"))).toBe("2026-09-04/2026-09-14");
    // A range on a single-value type is not an expression there: sent as-is.
    expect(on("date", "T-7d/T", mon)).toBe("T-7d/T");
  });

  it("falls back to weekdays for an exchange with no calendar, and says so in the trace", () => {
    const trace = newTrace();
    expect(resolveValue("date", "T-1bd", { now: ny("2026-09-14T09:30:00"), zone: NY, exchange: "XLON", trace })).toBe("2026-09-11");
    expect(trace.fallback).toBe(true);
    expect(trace.reason).toBe("No trading calendar for XLON on this backend; weekdays only");
    expect([...trace.years]).toEqual([2026]);
    const bundled = newTrace();
    resolveValue("date", "T-1bd", { now: ny("2026-09-14T09:30:00"), zone: NY, calendar: cal, trace: bundled });
    expect(bundled.reason).toContain("bundled");
    const literal = newTrace();
    resolveValue("date", "T-1", { now: ny("2026-09-14T09:30:00"), zone: NY, calendar: cal, trace: literal });
    expect(literal.fallback).toBe(false);
  });
});

describe("previewExpression and isExpression", () => {
  const NOW_NY = parseZonedDateTime("2026-09-14T09:30:00[America/New_York]").toDate();

  it("previews an @ on a date parameter as an error, not as a literal", () => {
    expect(previewExpression("date", "T@close", { now: NOW_NY, zone: "America/New_York" })).toMatchObject({
      error: "@ needs a date-and-time parameter",
    });
    expect(previewExpression("date", "2026-01-05")).toBeNull();
  });

  it("previews an expression in the param's vocabulary, with the fallback flag, and is null for a literal", () => {
    expect(previewExpression("date", "T-1", { now: NOW_NY, zone: "America/New_York" })).toEqual({ text: "2026-09-13", fallback: false, reason: undefined });
    const p = previewExpression("date_range", "T-7d/T", { now: NOW_NY, zone: "America/New_York", exchange: "XLON" })!;
    expect(p.text).toBe("2026-09-07 – 2026-09-14");
    expect(p.fallback).toBe(false);
    const bd = previewExpression("date", "T-1bd", { now: NOW_NY, zone: "America/New_York", exchange: "XLON" })!;
    expect(bd).toEqual({ text: "2026-09-11", fallback: true, reason: "No trading calendar for XLON on this backend; weekdays only" });
    expect(previewExpression("date", "2026-09-14", { now: NOW_NY })).toBeNull();
    expect(previewExpression("quarter", "2026-Q3", { now: NOW_NY })).toBeNull();
  });

  it("knows an expression from a literal per type", () => {
    expect(isExpression("date", "T")).toBe(true);
    expect(isExpression("date", "trade_date-5bd")).toBe(true);
    expect(isExpression("date", "2026-09-14")).toBe(false);
    expect(isExpression("date", "T-7d/T")).toBe(false);
    expect(isExpression("date_range", "T-7d/T")).toBe(true);
    expect(isExpression("date_range", "2026-01-01/T")).toBe(true);
    expect(isExpression("date_range", "2026-01-01/2026-03-31")).toBe(false);
    expect(isExpression("quarter", "FQ-4")).toBe(true);
    expect(isExpression("text", "T")).toBe(false);
    expect(isExpression(undefined, "$currentDate")).toBe(false);
  });
});

describe("OpenBB's dialect (v5.4.0)", () => {
  const NOW = new Date("2026-08-26T13:30:00Z");
  const NY = "America/New_York";

  it("reads today and $currentDate as T, and a capital M in unit position as a month", () => {
    expect(parseExpression("today")).toEqual(parseExpression("T"));
    expect(parseExpression("today-1w")).toEqual(parseExpression("T-1w"));
    expect(parseExpression("$currentDate-3M")).toEqual(parseExpression("T-3m"));
    expect(parseExpression("T-3M")).toEqual(parseExpression("T-3mo"));
    // v5.3.4: in any case, like the rest of the grammar now.
    expect(parseExpression("Today")).toEqual(parseExpression("T"));
    expect(parseExpression("TODAY")).toEqual(parseExpression("T"));
    expect(parseExpression("$CURRENTDATE-3M")).toEqual(parseExpression("T-3m"));
  });

  it("resolves $currentDate-3M three months back and $currentDate-4h as T-4h", () => {
    expect(resolveValue("date", "$currentDate-3M", { now: NOW, zone: NY })).toBe("2026-05-26");
    expect(resolveValue("date", "today-3M", { now: NOW, zone: NY })).toBe("2026-05-26");
    expect(resolveValue("datetime", "$currentDate-4h", { now: NOW, zone: NY })).toBe(
      resolveValue("datetime", "now-4h", { now: NOW, zone: NY }),
    );
  });
});

describe("serializeExpression (v5.4.0)", () => {
  const s = (value: string) => canonical(value);

  it("writes a T atom with at most one h, d, w, month or y offset in OpenBB's form", () => {
    expect(s("T")).toBe("$currentDate");
    expect(s("today")).toBe("$currentDate");
    expect(s("T-2y")).toBe("$currentDate-2y");
    expect(s("T+1")).toBe("$currentDate+1d");
    expect(s("T-3mo")).toBe("$currentDate-3M");
    expect(s("T-1w")).toBe("$currentDate-1w");
    expect(s("T-4h")).toBe("$currentDate-4h");
    expect(serializeExpression(parseExpression("$currentDate-3M")!)).toBe("$currentDate-3M");
  });

  it("writes a range in OpenBB's form only when both sides qualify", () => {
    expect(s("T-7d/T")).toBe("$currentDate-7d/$currentDate");
    expect(s("T-7d .. T")).toBe("$currentDate-7d/$currentDate");
    expect(s("T-7d/trade_date")).toBe("T-7d/trade_date");
  });

  it("keeps the extended form for everything else", () => {
    for (const value of ["T-5bd", "FQ-4", "trade_date", "T-1q", "T-1y+1d", "now-1h", "T-30min", "T-90s", "M0/T", "Q-4", "Q0-4d"]) {
      expect(s(value)).toBe(value);
    }
  });
});

describe("FY-prefixed labels are labels (v5.4.0)", () => {
  it("never parses FY + four unsigned digits as the FY shorthand", () => {
    expect(parseExpression("FY2026")).toBeNull();
    expect(parseExpression("FY2026-Q3")).toBeNull();
    expect(parseExpression("FY-1")).not.toBeNull();
    expect(parseExpression("FY+2")).not.toBeNull();
    expect(isExpression("fiscal_year", "FY2026")).toBe(false);
  });

  it("sends a seeded prefixed label unprefixed", () => {
    expect(resolveValue("quarter", "FY2026-Q3")).toBe("2026-Q3");
    expect(resolveValue("fiscal_year", "FY2026")).toBe("2026");
    expect(resolveValue("text", "FY2026")).toBe("FY2026");
  });
});

describe("offsets past the representable years", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  it.each(["T-999999y", "T-2027y", "T-999999w", "T+999999y", "T+999999m", "T+7974y"])("%s is a literal, not a wrapped or clamped year", value => {
    expect(resolveValue("date", value, { now, zone: "UTC" })).toBe(value);
  });
  it("keeps the edge years that exist", () => {
    expect(resolveValue("date", "T-2025y", { now, zone: "UTC" })).toBe("0001-10-15");
    expect(resolveValue("date", "T+7973y", { now, zone: "UTC" })).toBe("9999-10-15");
  });
});

describe("common period label spellings stay labels", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  it.each([
    ["fiscal_year", "FY24"],
    ["quarter", "Q1 2024"],
    ["quarter", "Q3-2025"],
    ["week", "W12 2026"],
  ])("%s %j is a literal, not a far-off period", (type, value) => {
    expect(isExpression(type, value)).toBe(false);
    expect(resolveValue(type, value, { now })).toBe(value);
  });
  it("unprefixes an FY label typed with a space, and keeps the shorthand", () => {
    expect(resolveValue("fiscal_year", "FY 2024", { now })).toBe("2024");
    expect(resolveValue("quarter", "FY 2025-Q3", { now })).toBe("2025-Q3");
    expect(resolveValue("quarter", "2025-Q3", { now })).toBe("2025-Q3");
    expect(parseExpression("FY-1")).toEqual(period("FY", -1));
    expect(parseExpression("Q12")).toEqual(period("Q", 12));
  });
});

describe("quarter_range (v5.4.0)", () => {
  const NOW = new Date("2026-08-26T13:30:00Z");
  const NY = "America/New_York";

  it("resolves each half as a quarter under the fiscal year end", () => {
    expect(resolveValue("quarter_range", "FQ-4/FQ0", { now: NOW, zone: NY, fiscalYearEnd: 9 })).toBe("2025-Q4/2026-Q4");
    expect(resolveValue("quarter_range", "FY0..FQ0", { now: NOW, zone: NY, fiscalYearEnd: 9 })).toBe("2026-Q1/2026-Q4");
    expect(resolveValue("quarter_range", "Q-4/Q-1", { now: NOW, zone: NY })).toBe("2025-Q3/2026-Q2");
    expect(resolveValue("quarter_range", "2026-Q1/FY2026-Q4", { now: NOW, zone: NY })).toBe("2026-Q1/2026-Q4");
  });

  it("is a range type, and an expression when either half is one", () => {
    expect(isRangeType("quarter_range")).toBe(true);
    expect(isRangeType("date_range")).toBe(true);
    expect(isRangeType("quarter")).toBe(false);
    expect(isPeriodType("quarter_range")).toBe(true);
    expect(isExpression("quarter_range", "FQ-4/FQ0")).toBe(true);
    expect(isExpression("quarter_range", "2026-Q1/2026-Q4")).toBe(false);
  });
});

/**
 * `$today` — the start of today, as against `T` / `now` / `$currentDate`,
 * which are all this INSTANT.
 *
 * It is a new token rather than a redefinition of an existing one because
 * `$currentDate` is what `serializeExpression` WRITES for every `T`-anchored
 * expression the user applies or saves. Changing that token's meaning would
 * silently rewrite every stored dashboard the app itself had written.
 * `$today` is never emitted, so its meaning is free.
 */
describe("$today", () => {
  const AT = new Date("2026-09-14T13:00:00Z"); // 09:00 in New York
  const NY = "America/New_York";

  it("is midnight, where T is the current time", () => {
    expect(resolveValue("datetime", "$today", { now: AT, zone: NY })).toBe("2026-09-14T00:00:00-04:00");
    expect(resolveValue("datetime", "T", { now: AT, zone: NY })).toBe("2026-09-14T09:00:00-04:00");
  });

  it("is the same day as T on a date param, where the time is projected away", () => {
    expect(resolveValue("date", "$today", { now: AT, zone: NY })).toBe("2026-09-14");
    expect(resolveValue("date", "T", { now: AT, zone: NY })).toBe("2026-09-14");
  });

  it("takes offsets like any other anchor, and keeps midnight", () => {
    expect(resolveValue("datetime", "$today-3d", { now: AT, zone: NY })).toBe("2026-09-11T00:00:00-04:00");
    expect(resolveValue("date", "$today-1w", { now: AT, zone: NY })).toBe("2026-09-07");
  });

  it("round-trips through the parser as itself", () => {
    expect(stringifyAtom(parseExpression("$today-2d")!.start)).toBe("$today-2d");
    // And is NOT collapsed into T, which is what makes it a distinct anchor.
    expect(parseExpression("$today")).not.toEqual(parseExpression("T"));
  });

  it("is never what the serializer writes: that stays $currentDate", () => {
    // The whole reason $today is a new token. If serializeExpression ever
    // emitted it, every saved `T` would come back as midnight.
    expect(serializeExpression(parseExpression("T")!)).toBe("$currentDate");
    expect(serializeExpression(parseExpression("T-3d")!)).toBe("$currentDate-3d");
  });

  it("leaves bare `today` and `$currentDate` exactly as they were", () => {
    // Purely additive: every existing spelling of the instant keeps working,
    // so no stored dashboard or widget manifest changes meaning. `today` and
    // `$today` therefore differ only by a `$` while meaning different things
    // -- kept knowingly, for backward compatibility.
    expect(parseExpression("today")).toEqual(parseExpression("T"));
    expect(resolveValue("datetime", "today", { now: AT, zone: NY })).toBe("2026-09-14T09:00:00-04:00");
    expect(resolveValue("datetime", "$currentDate", { now: AT, zone: NY })).toBe("2026-09-14T09:00:00-04:00");
  });
});

/**
 * Weekday offsets: `T-SAT` is the Saturday on or before today, `T+FRI` the
 * Friday on or after it, and a count steps a week further out.
 *
 * ON OR BEFORE / ON OR AFTER (user ruling 2026-09-29, back-ported from main's
 * 8b50cc09 on 2026-10-01). This line was strict -- on a Monday `T-MON` was
 * last Monday -- and these tests asserted that; the ruling replaced it, so on
 * the day itself the step does not move.
 *
 * Pure calendar arithmetic, so no exchange is needed -- a Saturday is a
 * Saturday whatever is trading. `trade_date` and `bd` are the trading
 * answers and already exist.
 */
describe("weekday offsets", () => {
  // Monday 2026-09-14, 09:00 in New York.
  const MON = new Date("2026-09-14T13:00:00Z");
  const NY = "America/New_York";
  const on = (expr: string) => resolveValue("date", expr, { now: MON, zone: NY });

  it("steps back to the nearest weekday on or before, and forward on or after", () => {
    expect(on("T-SAT")).toBe("2026-09-12");
    expect(on("T+FRI")).toBe("2026-09-18");
  });

  it("counts a week further out for each step past the first", () => {
    // Today IS Monday: the first on-or-before is today, the second the 7th.
    expect(on("T-2MON")).toBe("2026-09-07");
    // Sundays on or after Monday the 14th: the 20th, then the 27th.
    expect(on("T+2SUN")).toBe("2026-09-27");
  });

  it("stays on today when today is that weekday", () => {
    expect(on("T-MON")).toBe("2026-09-14");
    expect(on("T+MON")).toBe("2026-09-14");
  });

  it("refuses a count of zero, in either direction", () => {
    // Zero Mondays has no meaning; the arithmetic read it as minus one week
    // and pointed the wrong way (T-0MON on a Tuesday was the NEXT Monday).
    expect(parseExpression("T-0MON")).toBeNull();
    expect(parseExpression("T+0FRI")).toBeNull();
    expect(on("T-0MON")).toBe("T-0MON");
    expect(on("T+0FRI")).toBe("T+0FRI");
  });

  it("does not steal the month unit: T-2M is still two months", () => {
    // The trap: `M` is a month and `MON` starts with one. Weekdays have to be
    // read before units, or `2MON` is two months with a stray `ON` and the
    // whole value silently becomes a literal.
    expect(on("T-2M")).toBe("2026-07-14");
    expect(on("T-2mo")).toBe("2026-07-14");
    expect(on("T-2m")).toBe("2026-07-14");
  });

  it("knows all seven, in any case, and rejects anything that is not one", () => {
    for (const [day, date] of [["MON", "2026-09-14"], ["TUE", "2026-09-08"], ["WED", "2026-09-09"],
      ["THU", "2026-09-10"], ["FRI", "2026-09-11"], ["SAT", "2026-09-12"], ["SUN", "2026-09-13"]] as const) {
      expect(on(`T-${day}`), day).toBe(date);
    }
    // 2026-09-29 demo: `T-Mon` was typed, and the upper-case-only regex made
    // it a literal. Weekdays fold case now (the rest of this line does not).
    expect(on("T-Mon")).toBe("2026-09-14");
    expect(on("T+fri")).toBe("2026-09-18");
    // v5.3.4 (user ruling 2026-10-01): the whole grammar folds case now, as
    // main does, so a lower-case `t` is the T anchor and `t+fri` is the
    // Friday on or after today, like `T+FRI`.
    expect(on("t+fri")).toBe("2026-09-18");
    // Not a weekday, not a unit: a literal, sent as written.
    expect(on("T-XYZ")).toBe("T-XYZ");
  });

  it("composes with the other offsets, left to right", () => {
    // A week back first (Monday the 7th), then the Friday on or before it.
    expect(on("T-1w-FRI")).toBe("2026-09-04");
  });

  it("round-trips through the parser, to the canonical upper-case spelling", () => {
    expect(stringifyAtom(parseExpression("T-2MON")!.start)).toBe("T-2MON");
    expect(stringifyAtom(parseExpression("T+FRI")!.start)).toBe("T+1FRI");
    expect(stringifyAtom(parseExpression("T-mon")!.start)).toBe("T-1MON");
  });

  it("needs no exchange: it is calendar arithmetic, not trading", () => {
    expect(resolveValue("date", "T-SAT", { now: MON, zone: NY })).toBe("2026-09-12");
  });
});

/**
 * `EXP` — an option contract's own expiry, and `EXP-n` the n-th monthly
 * before it. `EXP-1` to `EXP` is the window a current contract has traded.
 *
 * Options only, on this line. The expiry is IN an OCC symbol, so nothing has
 * to be looked up; a futures contract's is a per-root exchange rule and needs
 * the security master, so those refuse here rather than guess. See
 * optionSymbol.ts.
 */
describe("EXP", () => {
  const NOW = new Date("2026-09-14T13:00:00Z");
  const NY = "America/New_York";
  const cal = bundledCalendar("XNYS")!;
  const on = (expr: string, symbol?: string) =>
    resolveValue("date", expr, { now: NOW, zone: NY, calendar: cal, symbol });

  it("is the contract's own expiry, read from the symbol", () => {
    expect(on("EXP", "AAPL260918C00150000")).toBe("2026-09-18");
    // A different contract, a different answer: nothing is looked up.
    expect(on("EXP", "SPY261218P00450000")).toBe("2026-12-18");
  });

  it("steps back a monthly at a time, which is the contract's traded window", () => {
    expect(on("EXP-1", "AAPL260918C00150000")).toBe("2026-08-21");
    expect(on("EXP-2", "AAPL260918C00150000")).toBe("2026-07-17");
  });

  it("steps forward a monthly at a time, the mirror of EXP-n", () => {
    // It once lost its sign and answered 2026-08-21, the same as EXP-1.
    expect(on("EXP+1", "AAPL260918C00150000")).toBe("2026-10-16");
    expect(on("EXP+2", "AAPL260918C00150000")).toBe("2026-11-20");
    // Across a year end: January 2027's third Friday, then February's.
    expect(on("EXP+1", "SPY261218P00450000")).toBe("2027-01-15");
    expect(on("EXP+2", "SPY261218P00450000")).toBe("2027-02-19");
  });

  it("is the contract's own expiry at a zero count, either sign", () => {
    expect(on("EXP+0", "AAPL260918C00150000")).toBe("2026-09-18");
    expect(on("EXP-0", "AAPL260918C00150000")).toBe("2026-09-18");
  });

  it("refuses without a symbol, rather than answering about nothing", () => {
    expect(on("EXP")).toBe("EXP");
    expect(on("EXP-1")).toBe("EXP-1");
  });

  it("refuses on a symbol that is not an option", () => {
    // An equity has no expiry, and a futures contract's needs the security
    // master -- v11's job. Both stay literals here.
    expect(on("EXP", "AAPL")).toBe("EXP");
    expect(on("EXP", "ESZ26")).toBe("EXP");
  });

  it("gives a weekly its own expiry but refuses to step back from one", () => {
    // Exact, because the symbol said so.
    expect(on("EXP", "AAPL260925C00150000")).toBe("2026-09-25");
    // And no guess at a weekly chain it cannot know.
    expect(on("EXP-1", "AAPL260925C00150000")).toBe("EXP-1");
  });

  it("follows the period shorthand rule, and backtracks when it cannot", () => {
    // `EXP-1` is one EXPIRY back -- the count binds tighter than an offset,
    // exactly as `Q-4` does.
    expect(on("EXP-1", "AAPL260918C00150000")).toBe("2026-08-21");
    // But `EXP-1w` has no reading as a count (`w` is left over), so it falls
    // back to the only other one: the anchor at zero, offset a week. It used
    // to be a literal that silently did nothing.
    expect(on("EXP-1w", "AAPL260918C00150000")).toBe("2026-09-11");
    expect(on("EXP0-1w", "AAPL260918C00150000")).toBe("2026-09-11");
    // Two offsets: one expiry back, then a week.
    expect(on("EXP-1-1w", "AAPL260918C00150000")).toBe("2026-08-14");
  });

  it("round-trips through the parser", () => {
    expect(stringifyAtom(parseExpression("EXP-2")!.start)).toBe("EXP-2");
    expect(stringifyAtom(parseExpression("EXP")!.start)).toBe("EXP0");
  });
});

/**
 * The shorthand backtrack.
 *
 * A counted anchor's digits bind tighter than an offset -- `Q-4` is four
 * quarters back, `Q0-4` is four days before this quarter's start. That rule
 * is kept. What changes is what happens when the greedy reading FAILS:
 * `Q-4w` used to take `-4` as the count, find a stray `w` no offset could
 * consume, and drop the whole value to a literal that silently did nothing.
 *
 * There is exactly one other reading, so it is taken: anchor at zero, and
 * the whole tail as offsets. No currently-valid expression changes meaning,
 * because the greedy parse is still tried first and wins whenever it
 * consumes everything.
 */
describe("the shorthand backtrack", () => {
  const NOW = new Date("2026-09-14T13:00:00Z"); // Monday
  const NY = "America/New_York";
  const cal = bundledCalendar("XNYS")!;
  const on = (expr: string, symbol?: string) =>
    resolveValue("date", expr, { now: NOW, zone: NY, calendar: cal, symbol });

  it("reads a failed shorthand as the zero anchor plus offsets", () => {
    // This quarter starts 2026-07-01; four weeks earlier is 2026-06-03.
    expect(on("Q-4w")).toBe(on("Q0-4w"));
    expect(on("Q-4w")).toBe("2026-06-03");
    // This month starts 2026-09-01; a week earlier is 2026-08-25.
    expect(on("M-1w")).toBe("2026-08-25");
    // This ISO week starts Monday 2026-09-14; two days earlier is the 12th.
    expect(on("W-2d")).toBe("2026-09-12");
  });

  it("does the same for EXP", () => {
    const opt = "AAPL260918C00150000";
    expect(on("EXP-1w", opt)).toBe(on("EXP0-1w", opt));
    expect(on("EXP-1w", opt)).toBe("2026-09-11");
  });

  it("leaves the greedy reading alone where it works", () => {
    // The rule that made the backtrack necessary is untouched.
    expect(on("Q-4")).toBe("2025-07-01");   // four quarters back from Q3 2026
    expect(on("Q0-4")).toBe("2026-06-27");  // four DAYS before this quarter
    expect(on("EXP-1", "AAPL260918C00150000")).toBe("2026-08-21");
  });

  it("still refuses a bare period letter, which is a ticker", () => {
    // M is Macy's, Q was a ticker, and EXP is Eagle Materials. The backtrack
    // only applies when a sign follows the anchor, so a bare letter cannot
    // start resolving as "start of this month" behind a user's back.
    for (const v of ["Q", "M", "W", "Y", "FQ", "FY"]) {
      expect(parseExpression(v), v).toBeNull();
    }
  });

  it("still refuses a tail that is no offset at all", () => {
    expect(parseExpression("Q-4x")).toBeNull();
    expect(parseExpression("M-1zz")).toBeNull();
  });
});

/**
 * A dead contract refuses.
 *
 * `EXP` is a live contract's expiry, so once the contract is gone there is
 * nothing for it to name. Live THROUGH its expiry date -- an option trades
 * to the close that day, and truncating its last session would be wrong --
 * and dead from the next day.
 */
describe("EXP on an expired contract", () => {
  const NY = "America/New_York";
  const cal = bundledCalendar("XNYS")!;
  const SYM = "AAPL260918C00150000"; // expires Friday 2026-09-18
  const at = (iso: string, zone = NY) =>
    resolveValue("date", "EXP", { now: new Date(iso), zone, calendar: cal, symbol: SYM });

  it("resolves while the contract is live", () => {
    expect(at("2026-09-14T13:00:00Z")).toBe("2026-09-18");
    expect(at("2026-06-01T13:00:00Z")).toBe("2026-09-18");
  });

  it("still resolves ON the expiry date, which the contract trades through", () => {
    expect(at("2026-09-18T13:00:00Z")).toBe("2026-09-18");
    // Right up to the close, and after it: the date is what the rule reads.
    expect(at("2026-09-18T20:30:00Z")).toBe("2026-09-18");
  });

  it("refuses from the next day", () => {
    expect(at("2026-09-19T13:00:00Z")).toBe("EXP");
    expect(at("2026-09-21T13:00:00Z")).toBe("EXP");
    expect(at("2027-01-27T13:00:00Z")).toBe("EXP");
  });

  it("reads the EXCHANGE's date, not the viewer's", () => {
    // Saturday 09:00 in Tokyo is Friday 20:00 in New York -- still expiry
    // day where the contract trades, so it is still live.
    expect(at("2026-09-19T00:00:00Z", "Asia/Tokyo")).toBe("2026-09-18");
  });

  it("refuses EXP-n on a dead contract too", () => {
    expect(resolveValue("date", "EXP-1", { now: new Date("2026-09-21T13:00:00Z"), zone: NY, calendar: cal, symbol: SYM }))
      .toBe("EXP-1");
  });
});

// v5.3.0 §2 Anchors: `earliest` / `latest` -- "Data-driven bounds from the provider",
// requiring `data_bounds {min, max}` in the resolution context; §5: "if the widget
// hasn't yet reported bounds, the resolver defers". Specified in v5.3 and never
// shipped (found 2026-09-21: "the range popover should be taking everything we
// defined for v5" -- "fix earliest/latest").
describe("earliest / latest (v5.3.0 data bounds)", () => {
  const NY = "America/New_York";
  const now = new Date("2026-09-18T15:00:00Z");
  const bounds = { min: new Date("2019-01-02T14:30:00Z"), max: new Date("2026-09-17T20:00:00Z") };

  it("parses them as anchors, with offsets and in ranges", () => {
    expect(stringifyExpression(parseExpression("earliest")!)).toBe("earliest");
    expect(stringifyExpression(parseExpression("earliest + 1y")!)).toBe("earliest+1y");
    expect(stringifyExpression(parseExpression("latest-30d")!)).toBe("latest-30d");
    expect(stringifyExpression(parseExpression("earliest .. today")!)).toBe("earliest/T");
    expect(stringifyExpression(parseExpression("earliest..latest")!)).toBe("earliest/latest");
    // A word that merely starts like one is a literal.
    expect(parseExpression("earliestish")).toBeNull();
    expect(parseExpression("late")).toBeNull();
  });

  it("resolves from the bounds the context reports", () => {
    expect(resolveValue("date", "earliest", { now, zone: NY, bounds })).toBe("2019-01-02");
    expect(resolveValue("date", "latest", { now, zone: NY, bounds })).toBe("2026-09-17");
    expect(resolveValue("date", "earliest+1y", { now, zone: NY, bounds })).toBe("2020-01-02");
    expect(resolveValue("date", "latest-30d", { now, zone: NY, bounds })).toBe("2026-08-18");
    expect(resolveValue("date_range", "earliest..today", { now, zone: NY, bounds })).toBe("2019-01-02/2026-09-18");
    expect(resolveValue("datetime", "latest", { now, zone: NY, bounds })).toBe("2026-09-17T16:00:00-04:00");
  });

  it("defers when no bounds have been reported: the value is left out, never sent as the word", () => {
    // Left out of the query, the provider answers from ITS earliest / to ITS latest --
    // which is what the word asked for. Sending the letters would be a 422.
    expect(resolveValue("date", "earliest", { now, zone: NY })).toBe("");
    expect(resolveValue("date", "latest-30d", { now, zone: NY })).toBe("");
    expect(resolveValue("date", "earliest", { now, zone: NY, bounds: { max: bounds.max } })).toBe("");
    expect(resolveValue("date", "latest", { now, zone: NY, bounds: { max: bounds.max } })).toBe("2026-09-17");
  });

  it("is not read in a field that is not a date", () => {
    expect(resolveValue("text", "latest", { now, zone: NY, bounds })).toBe("latest");
    expect(resolveValue(undefined, "earliest", { now, zone: NY, bounds })).toBe("earliest");
  });
});

describe("case is not part of the grammar (v5.3.4, back-port of main's 69789ec0)", () => {
  // `t+fri`, `T-1W` and `today-1M` were "not a date" while `T+FRI`, `T-1w` and
  // `today-1m` were: the grammar was case-sensitive in every slot. The slots --
  // anchor, unit, weekday -- are distinct positions, so folding case cannot make
  // one read as another; and this parser only ever sees date-like parameter
  // types (resolveValue's isPeriodType gate), so a symbol field's `t` or `T` is
  // still a ticker. What is STORED stays the one canonical spelling.
  const canonical = (v: string) => {
    const expr = parseExpression(v);
    return expr === null ? null : stringifyExpression(expr);
  };

  it("reads every slot in either case, and writes the canonical one", () => {
    for (const typed of ["t-1w", "T-1W", "today-1W", "TODAY-1w", "$CurrentDate-1w"]) {
      expect(canonical(typed), typed).toBe("T-1w");
    }
    expect(canonical("t+fri")).toBe("T+1FRI"); // the weekday step's own canonical form, as T+FRI
    expect(canonical("NOW-1H")).toBe("now-1h");
    expect(canonical("Trade_Date-5BD")).toBe("trade_date-5bd");
    expect(canonical("SESSION_OPEN")).toBe("session_open");
    expect(canonical("$TODAY-2D")).toBe("$today-2d");
    expect(canonical("EARLIEST")).toBe("earliest");
    expect(canonical("q-4")).toBe("Q-4");
    expect(canonical("fq0")).toBe("FQ0");
    expect(canonical("fy-1")).toBe("FY-1");
    expect(canonical("w-26")).toBe("W-26");
    expect(canonical("exp-1")).toBe(canonical("EXP-1"));
    expect(canonical("today-7d..TODAY")).toBe("T-7d/T");
  });

  it("keeps the one distinction that is about meaning, not case: months and minutes", () => {
    // `m`, `mo` and OpenBB's `M` are months; minutes are `min` -- in any case.
    for (const months of ["T-3m", "T-3M", "T-3mo", "T-3MO", "t-3Mo"]) expect(canonical(months), months).toBe("T-3m");
    for (const minutes of ["now-5min", "NOW-5MIN", "now-5Min"]) expect(canonical(minutes), minutes).toBe("now-5min");
  });

  it("still refuses what was never an expression", () => {
    for (const literal of ["TSLA", "tsla", "T-1x", "t-1wk", "2026-09-18T13:30:00Z", "Q", "q", "now-"]) {
      expect(parseExpression(literal), literal).toBeNull();
    }
  });
});

describe("the @ production (port of bdobb-v2 f8fcfdc16) and the (MIC) suffix", () => {
  const NY = "America/New_York";
  const cal = bundledCalendar("XNYS")!;
  const ny = (s: string) => parseZonedDateTime(`${s}[America/New_York]`).toDate();
  const on = (type: "date" | "datetime", expr: string, now: Date) =>
    resolveValue(type, expr, { now, zone: NY, calendar: cal });
  const T = { kind: "named", name: "T" } as const;
  const back1bd = [{ sign: -1, amount: 1, unit: "bd" }];

  it("keeps a catalogue calendar's own spelling, in any case, and upper-cases anything else (review focus 2)", () => {
    expect(parseExpression("T-1bd(us_futures)")?.start.calendar).toBe("us_futures");
    expect(parseExpression("T-1bd(US_FUTURES)")?.start.calendar).toBe("us_futures");
    expect(parseExpression("T(24/7)")?.start.calendar).toBe("24/7");
    expect(parseExpression("t-1bd ( xpar )")?.start.calendar).toBe("XPAR");
    expect(parseExpression("T(nyse)")?.start.calendar).toBe("NYSE");
    expect(stringifyExpression(parseExpression("T@open(cmes)")!)).toBe("T@open(CMES)");
  });

  it("reads the / in (24/7) as part of the name, not a range separator", () => {
    expect(splitRange("T-5bd(24/7)/T(24/7)")).toEqual(["T-5bd(24/7)", "T(24/7)"]);
    expect(splitRange("T(24/7)")).toEqual(["T(24/7)", ""]);
    const range = parseExpression("T-5bd(24/7)/T(24/7)");
    expect([range?.start.calendar, range?.end?.calendar]).toEqual(["24/7", "24/7"]);
    expect(stringifyExpression(range!)).toBe("T-5bd(24/7)/T(24/7)");
  });

  it("sends a single (24/7) atom on a range type as one date, not as a range (fix round 1, item 1)", () => {
    expect(isRange("T(24/7)")).toBe(false);
    expect(isRange("T(24/7)/T")).toBe(true);
    expect(isRange("T..T(24/7)")).toBe(true);
    const now = new Date("2026-10-21T15:00:00Z");
    const single = resolveValue("date_range", "T(24/7)", { now, onError: () => {} });
    expect(single).not.toContain("/");
    expect(single).toBe(resolveValue("date", "T(24/7)", { now, onError: () => {} }));
  });

  it("finds the range separator in linear time (fix round 1, item 3)", () => {
    const inputs = ["/".repeat(100_000) + ")", "a/".repeat(50_000) + ")", "(/".repeat(50_000), "T(" + "/".repeat(100_000) + ")"];
    const t0 = performance.now();
    for (const v of inputs) {
      splitRange(v);
      isRange(v);
      parseExpression(v);
    }
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it("parses every example in the spec", () => {
    expect(parseExpression("T-1bd(XLON)")).toEqual({ start: { anchor: T, offsets: back1bd, calendar: "XLON" } });
    expect(parseExpression("T-1bd@close(XNYS)")).toEqual({
      start: { anchor: T, offsets: back1bd, at: { kind: "close" }, calendar: "XNYS" },
    });
    expect(parseExpression("T@09:30(XTKS)")).toEqual({
      start: { anchor: T, offsets: [], at: { kind: "clock", hour: 9, minute: 30 }, calendar: "XTKS" },
    });
    expect(parseExpression("FQ0@open(XHKG)")?.start).toEqual({
      anchor: { kind: "period", period: "FQ", n: 0 },
      offsets: [],
      at: { kind: "open" },
      calendar: "XHKG",
    });
    expect(parseExpression("T-5bd(XLON)..T(XLON)")).toMatchObject({
      start: { calendar: "XLON" },
      end: { calendar: "XLON" },
    });
    // Mixed calendars in one range are allowed; an atom without a suffix is the object it always was.
    expect(parseExpression("T-5bd(XLON)..T")?.end).toEqual({ anchor: T, offsets: [] });
  });

  it("keeps @ strict: two digits each side, a real time, an anchor in front", () => {
    for (const v of ["T@9:5", "T@25:00", "T@14:60", "@14:00", "T@noon"]) expect(parseExpression(v), v).toBeNull();
    expect(on("datetime", "T@9:5", ny("2026-09-14T09:30:00"))).toBe("T@9:5");
  });

  it("reads (MIC) with and without @, and on range atoms", () => {
    expect(parseExpression("T(XNYS)")?.start).toEqual({ anchor: T, offsets: [], calendar: "XNYS" });
    expect(parseExpression("T@close(XNYS)")?.start.at).toEqual({ kind: "close" });
    expect(parseExpression("T-1bd/T(XTKS)")?.end?.calendar).toBe("XTKS");
  });

  it("keeps an unknown MIC for the resolver to refuse, and rejects an unclosed or empty one", () => {
    expect(parseExpression("T(XNYZ)")?.start.calendar).toBe("XNYZ");
    expect(parseExpression("T(XNYS")).toBeNull();
    expect(parseExpression("T()")).toBeNull();
  });

  it("folds case and whitespace in both suffixes (review focus 5)", () => {
    expect(stringifyExpression(parseExpression("t-1bd @ CLOSE ( xlon )")!)).toBe("T-1bd@close(XLON)");
  });

  it("round-trips the suffixes and never writes OpenBB's spelling for an atom that has one", () => {
    for (const v of ["T@14:00", "T@00:05", "FQ0@open", "T-1bd@close(XNYS)", "T-5bd(XLON)/T", "T@09:30/T@16:00"]) {
      expect(serializeExpression(parseExpression(v)!)).toBe(v);
    }
    expect(serializeExpression(parseExpression("T-3mo")!)).toBe("$currentDate-3M");
    expect(serializeExpression(parseExpression("T(XNYS)")!)).toBe("T(XNYS)");
  });

  it("T@14:00 is that date at 14:00 on the exchange's clock, whatever the viewer's zone", () => {
    expect(on("datetime", "T@14:00", ny("2026-09-14T09:30:00"))).toBe("2026-09-14T14:00:00-04:00");
    const tokyoMorning = parseZonedDateTime("2026-09-15T08:00:00[Asia/Tokyo]").toDate();
    expect(resolveValue("datetime", "T@14:00", { now: tokyoMorning, zone: "Asia/Tokyo", calendar: cal })).toBe(
      "2026-09-14T14:00:00-04:00",
    );
    expect(on("datetime", "T-1w@09:30", ny("2026-09-14T16:05:00"))).toBe("2026-09-07T09:30:00-04:00");
  });

  it("FQ0@open is the quarter's first session open, and the weekday table answers with a fallback", () => {
    expect(on("datetime", "FQ0@open", ny("2026-09-14T09:30:00"))).toBe("2026-07-01T09:30:00-04:00");
    const trace = newTrace();
    const now = ny("2026-09-14T09:30:00");
    const london = resolveValue("datetime", "T@open", { now, zone: NY, exchange: "XLON", trace });
    expect(london).toBe("2026-09-14T08:00:00+01:00");
    expect(trace.reason).toBe("No trading calendar for XLON on this backend; weekdays only");
  });

  it("T-1bd@close from a Monday is Friday's close, early closes honoured", () => {
    expect(on("datetime", "T-1bd@close", ny("2026-09-14T09:30:00"))).toBe("2026-09-11T16:00:00-04:00");
    expect(on("datetime", "T-1bd@close", ny("2026-11-30T09:30:00"))).toBe("2026-11-27T13:00:00-05:00");
  });

  it("@ off a datetime param is refused, never sent (R7a); (MIC) is an expression on any period type", () => {
    const now = ny("2026-09-14T09:30:00");
    expect(() => on("date", "T@14:00", now)).toThrow("@ needs a date-and-time parameter");
    expect(isExpression("date", "T@14:00")).toBe(false);
    expect(isExpression("date_range", "T@09:30/T@16:00")).toBe(false);
    expect(isExpression("datetime", "T@14:00")).toBe(true);
    expect(isExpression("date", "T-1bd(XLON)")).toBe(true);
    expect(isExpression("date_range", "T-5bd(XLON)..T")).toBe(true);
    expect(previewExpression("date", "T@14:00", { now, zone: NY, calendar: cal })).toMatchObject({ error: "@ needs a date-and-time parameter" });
  });

  it("leaves T, TSLA and T(XLON) literals in a symbol field", () => {
    for (const v of ["T", "TSLA", "T(XLON)"]) expect(resolveValue("text", v, {})).toBe(v);
  });
});

describe("a legacy card past its calendar's catalogue bounds (ruling RF6)", () => {
  // XSES as a legacy card holds it: the backend's per-year route answered 2026 only. The catalogue ends XSES at
  // 2026-12-31, so 2027 is not a year the backend refused but one no calendar covers.
  const raw = { data: { Timezone: "Asia/Singapore", TradingHours: { Open: "09:00:00", Close: "17:00:00" } } };
  const xses = normalizeCalendar(raw, "XSES", [2026], "backend")!;
  const now = parseZonedDateTime("2026-11-20T10:00:00[Asia/Singapore]").toDate();
  const ctx = { now, zone: "Asia/Singapore", exchange: "XSES", calendars: { XSES: xses } };

  it("refuses T+3mo+1bd in late 2026 with COVERAGE_UNAVAILABLE, and sends nothing", () => {
    const errors: string[] = [];
    const trace = newTrace();
    expect(resolveValue("date", "T+3mo+1bd", { ...ctx, trace, onError: (m) => errors.push(m) })).toBe("");
    expect(errors).toEqual(["XSES COVERAGE_UNAVAILABLE (coverage 1990-01-01 to 2026-12-31)"]);
    expect(() => resolveValue("date", "T+3mo+1bd", ctx)).toThrow(/COVERAGE_UNAVAILABLE/);
  });

  it("still sends a calendar-free T+3mo(XSES)", () => {
    expect(resolveValue("date", "T+3mo(XSES)", ctx)).toBe("2027-02-20");
  });

  it("keeps a backend-refused year inside the bounds on weekdays with the warning (RW6)", () => {
    const trace = newTrace();
    const xses2025 = normalizeCalendar(raw, "XSES", [2025], "backend")!;
    expect(resolveValue("date", "T+1bd", { ...ctx, calendars: { XSES: xses2025 }, trace })).toBe("2026-11-23");
    expect(trace.fallback).toBe(true);
    expect(trace.reason).toBe("No XSES calendar for 2026; weekdays assumed");
  });
});
