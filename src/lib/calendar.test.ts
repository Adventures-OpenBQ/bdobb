// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { parseDate, parseZonedDateTime } from "@internationalized/date";
import { beforeEach, describe, expect, it } from "vitest";
import { __read, __reset } from "../test/memfs";
import { __resetLoggerForTests } from "./logger";
import {
  BUNDLED_YEARS,
  DEFAULT_EXCHANGE,
  EXCHANGE_HOURS,
  addBusinessDays,
  bundledCalendar,
  calendarOf,
  calendarName,
  describeCalendar,
  inCalendarRange,
  isKnownCalendar,
  isOpen,
  mergeCalendars,
  newTrace,
  nextOpen,
  normalizeCalendar,
  parseExchange,
  prevOpen,
  sessionClose,
  sessionOpen,
  symbolCalendar,
  weekdayCalendar,
} from "./calendar";
import { CATALOGUE, UNMAPPED_SUFFIXES } from "./calendars/catalogue";

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
});

/** The EODHD v2 shape, minimal: what the backend router and the fixture both send. */
const raw = (holidays: Record<string, unknown>, hours: Record<string, unknown> = {}) => ({
  data: {
    Name: "Test Exchange",
    Code: "US",
    Timezone: "America/New_York",
    TradingHours: { Open: "09:30:00", Close: "16:00:00", WorkingDays: "Mon, Tue, Wed, Thu, Fri", ...hours },
    ExchangeHolidays: holidays,
  },
});

describe("the bundled NYSE fixture", () => {
  it("normalises with the corrected Independence Day entry and its three years", () => {
    const cal = bundledCalendar(DEFAULT_EXCHANGE)!;
    expect(cal.code).toBe("XNYS");
    expect(cal.timezone).toBe("America/New_York");
    expect(cal.source).toBe("bundled");
    expect(cal.years).toEqual([...BUNDLED_YEARS]);
    expect(cal.session).toMatchObject({ open: "09:30:00", close: "16:00:00", workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri"] });
    expect(cal.session.preMarket).toEqual({ open: "04:00:00", close: "09:30:00" });
    expect(cal.session.afterHours).toEqual({ open: "16:00:00", close: "20:00:00" });
    expect(cal.holidays["2026-07-03"]).toEqual({ holiday: "Independence Day observed", type: "Official" });
    expect(cal.holidays["2026-11-27"]).toEqual({ holiday: "Day after Thanksgiving", type: "EarlyClose", earlyClose: "13:00:00" });
    const entries = Object.values(cal.holidays);
    expect(entries).toHaveLength(34);
    expect(entries.filter((h) => h.type === "Official")).toHaveLength(29);
    expect(entries.filter((h) => h.type === "EarlyClose")).toHaveLength(5);
  });

  it("is only bundled for XNYS", () => {
    expect(bundledCalendar("XLON")).toBeNull();
  });
});

describe("normalizeCalendar", () => {
  it("reads the v2 envelope, sorts holiday keys, and keeps Bank entries distinct from Official", () => {
    const cal = normalizeCalendar(
      raw({
        "2026-12-25": { Holiday: "Christmas Day", Type: "Official" },
        "2026-01-01": { Holiday: "New Year's Day", Type: "Official" },
        "2026-05-04": { Holiday: "Early May bank holiday", Type: "Bank" },
      }),
      "XLON",
      [2026],
      "backend",
    )!;
    expect(cal.code).toBe("XLON");
    expect(cal.name).toBe("Test Exchange");
    expect(Object.keys(cal.holidays)).toEqual(["2026-01-01", "2026-05-04", "2026-12-25"]);
    expect(cal.holidays["2026-05-04"].type).toBe("Bank");
    expect(cal.years).toEqual([2026]);
    expect(cal.source).toBe("backend");
  });

  it("parses WorkingDays with or without spaces, and defaults Mon–Fri when it is unreadable", () => {
    expect(normalizeCalendar(raw({}, { WorkingDays: "Mon,Tue,Wed,Thu,Fri,Sat" }), "X", [2026], "backend")!.session.workingDays)
      .toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(normalizeCalendar(raw({}, { WorkingDays: 7 }), "X", [2026], "backend")!.session.workingDays)
      .toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  });

  it("keeps the optional sessions only when both ends are present", () => {
    const cal = normalizeCalendar(raw({}, { LunchBreakStart: "11:30:00", LunchBreakEnd: "12:30:00", PreMarketOpen: "08:00:00" }), "XTKS", [2026], "backend")!;
    expect(cal.session.lunchBreak).toEqual({ start: "11:30:00", end: "12:30:00" });
    expect(cal.session.preMarket).toBeUndefined();
  });

  it("drops an EarlyClose entry with no time, and says so once in the log", async () => {
    const cal = normalizeCalendar(raw({ "2026-11-27": { Holiday: "Day after Thanksgiving", Type: "EarlyClose" } }), "XNYS", [2026], "backend")!;
    expect(cal.holidays["2026-11-27"]).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(__read("logs/bdobb.log") ?? "").toContain("2026-11-27 is EarlyClose with no time");
  });

  it("drops malformed entries and refuses an envelope with no zone or hours", () => {
    const cal = normalizeCalendar(raw({ "not-a-date": { Holiday: "X", Type: "Official" }, "2026-01-01": { Type: "Official" }, "2026-01-02": { Holiday: "Y", Type: "Closed" } }), "X", [2026], "backend")!;
    expect(cal.holidays).toEqual({});
    expect(normalizeCalendar({ data: { TradingHours: { Open: "09:30:00", Close: "16:00:00" } } }, "X", [2026], "backend")).toBeNull();
    expect(normalizeCalendar({ data: { Timezone: "UTC" } }, "X", [2026], "backend")).toBeNull();
    expect(normalizeCalendar(null, "X", [2026], "backend")).toBeNull();
    expect(normalizeCalendar([], "X", [2026], "backend")).toBeNull();
  });

  it("refuses a zone or a session time the date library cannot use, rather than throwing later", () => {
    // Both pass a shape check; both made toZoned/parseTime throw a RangeError
    // inside resolveValue, which took every card on the MIC to its
    // ErrorBoundary instead of falling back to the next calendar source.
    expect(normalizeCalendar({ data: { ...raw({}).data, Timezone: "Mars/Olympus_Mons" } }, "X", [2026], "backend")).toBeNull();
    expect(normalizeCalendar(raw({}, { Open: "25:00:00" }), "X", [2026], "backend")).toBeNull();
    expect(normalizeCalendar(raw({}, { Close: "16:60:00" }), "X", [2026], "backend")).toBeNull();
  });
});

describe("the weekday table", () => {
  it("names hours, a zone and a trading week for every catalogue calendar", () => {
    expect(Object.keys(EXCHANGE_HOURS)).toEqual(CATALOGUE.map((e) => e.mic));
    expect(weekdayCalendar("XASX")).toMatchObject({ timezone: "Australia/Sydney", session: { open: "10:00:00", close: "16:00:00" } });
    expect(weekdayCalendar("XTAE")).toMatchObject({ timezone: "Asia/Tel_Aviv", session: { open: "09:59:00", close: "17:15:00" } });
    expect(weekdayCalendar("XTAI")).toMatchObject({ timezone: "Asia/Taipei", session: { open: "09:00:00", close: "13:30:00" } });
    expect(weekdayCalendar("XPAR")).toMatchObject({ timezone: "Europe/Paris", session: { open: "09:00:00", close: "17:30:00" } });
    expect(weekdayCalendar("XSAU").session.workingDays).toEqual(["Mon", "Tue", "Wed", "Thu", "Sun"]);
    const london = weekdayCalendar("XLON");
    expect(london).toMatchObject({ code: "XLON", timezone: "Europe/London", source: "weekdays", years: [], holidays: {} });
    expect(london.session).toEqual({ open: "08:00:00", close: "16:30:00", workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri"] });
  });

  it("refuses an unknown MIC rather than run it on New York's hours (spec)", () => {
    expect(() => weekdayCalendar("XXXX")).toThrow("Unknown calendar XXXX");
  });
});

describe("mergeCalendars, inCalendarRange", () => {
  it("unions holidays and years", () => {
    const a = normalizeCalendar(raw({ "2026-01-01": { Holiday: "A", Type: "Official" } }), "X", [2026], "backend")!;
    const b = normalizeCalendar(raw({ "2027-01-01": { Holiday: "B", Type: "Official" } }), "X", [2027], "backend")!;
    const merged = mergeCalendars(b, a);
    expect(merged.years).toEqual([2026, 2027]);
    expect(Object.keys(merged.holidays).sort()).toEqual(["2026-01-01", "2027-01-01"]);
  });

  it("bounds the years a backend is ever asked for", () => {
    expect(inCalendarRange(1990)).toBe(true);
    expect(inCalendarRange(2040)).toBe(true);
    expect(inCalendarRange(1989)).toBe(false);
    expect(inCalendarRange(2041)).toBe(false);
  });
});

describe("open days and sessions on the bundled NYSE calendar", () => {
  const cal = bundledCalendar("XNYS")!;
  const d = (s: string) => parseDate(s);

  it("closes weekends and Official days, opens EarlyClose days, and closes the corrected 2026-07-03", () => {
    expect(isOpen(cal, d("2026-11-26"))).toBe(false);
    expect(isOpen(cal, d("2026-11-27"))).toBe(true);
    expect(isOpen(cal, d("2026-11-28"))).toBe(false);
    expect(isOpen(cal, d("2026-11-29"))).toBe(false);
    expect(isOpen(cal, d("2026-07-03"))).toBe(false);
    expect(isOpen(cal, d("2026-09-14"))).toBe(true);
  });

  it("treats a Bank day as open", () => {
    const withBank = normalizeCalendar(raw({ "2026-05-04": { Holiday: "Bank", Type: "Bank" } }), "XLON", [2026], "backend")!;
    expect(isOpen(withBank, d("2026-05-04"))).toBe(true);
  });

  it("puts the session instants in the exchange zone, honouring an early close", () => {
    expect(sessionOpen(cal, d("2026-11-27")).toString()).toBe("2026-11-27T09:30:00-05:00[America/New_York]");
    expect(sessionClose(cal, d("2026-11-27")).toString()).toBe("2026-11-27T13:00:00-05:00[America/New_York]");
    expect(sessionClose(cal, d("2026-09-14")).toString()).toBe("2026-09-14T16:00:00-04:00[America/New_York]");
  });

  it("finds the next and previous open days", () => {
    expect(nextOpen(cal, d("2026-11-26")).toString()).toBe("2026-11-27");
    expect(nextOpen(cal, d("2026-11-27")).toString()).toBe("2026-11-27");
    expect(prevOpen(cal, d("2026-11-29")).toString()).toBe("2026-11-27");
    expect(prevOpen(cal, d("2026-07-03")).toString()).toBe("2026-07-02");
  });

  it("steps business days over weekends and closures, keeping the time of day (the addendum's T-5bd example)", () => {
    const monday = parseZonedDateTime("2026-11-30T09:30:00[America/New_York]");
    expect(addBusinessDays(cal, monday, -5).toString()).toBe("2026-11-20T09:30:00-05:00[America/New_York]");
    const wednesday = parseZonedDateTime("2026-11-25T15:45:10[America/New_York]");
    expect(addBusinessDays(cal, wednesday, 1).toString()).toBe("2026-11-27T15:45:10-05:00[America/New_York]");
    expect(addBusinessDays(cal, wednesday, 0)).toEqual(wednesday);
  });

  // A `bd` step counts SESSIONS, so its answer has to be one. Starting from a
  // closed day it was not: the estimate can land on a weekend whose window
  // already holds exactly |n| open days, both correction loops are then
  // skipped, and the closed estimate was returned as the answer.
  it("always lands on an open day, even when the walk starts on a closed one", () => {
    // Saturday. Five sessions back is Mon 09-14 (Fri 18, Thu 17, Wed 16,
    // Tue 15, Mon 14); the estimate lands on Sat 09-12 and used to stop there.
    const saturday = parseZonedDateTime("2026-09-19T12:00:00[America/New_York]");
    expect(addBusinessDays(cal, saturday, -5).toString()).toBe("2026-09-14T12:00:00-04:00[America/New_York]");
    // Forward has the same shape: five sessions on from Sat 09-19 is Fri 09-25.
    expect(addBusinessDays(cal, saturday, 5).toString()).toBe("2026-09-25T12:00:00-04:00[America/New_York]");
    // And a holiday start, not just a weekend one: Labor Day 2026-09-07.
    const laborDay = parseZonedDateTime("2026-09-07T12:00:00[America/New_York]");
    for (const n of [-5, -1, 1, 5]) {
      const landed = addBusinessDays(cal, laborDay, n);
      expect(isOpen(cal, d(landed.toString().slice(0, 10))), `${n}bd from Labor Day`).toBe(true);
    }
  });

  it("every bd step from every day of one week lands on an open day", () => {
    // The property the example above is one case of. A closed start is the
    // interesting half, so the week deliberately spans a weekend.
    for (const day of ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"]) {
      const at = parseZonedDateTime(`${day}T12:00:00[America/New_York]`);
      for (const n of [-20, -5, -3, -1, 1, 3, 5, 20]) {
        const landed = addBusinessDays(cal, at, n);
        expect(isOpen(cal, d(landed.toString().slice(0, 10))), `${day} ${n}bd`).toBe(true);
      }
    }
  });

  it("estimate-and-adjust matches a day-by-day reference walk, in both directions, even over long ranges", () => {
    // The reference is the pre-refactor implementation: one isOpen per day.
    // Local calendar date — toDate().toISOString() would shift a late-evening
    // New York anchor into the next UTC day and poison the comparison.
    const pad = (v: number) => String(v).padStart(2, "0");
    const naive = (anchor: string, n: number): string => {
      const at = parseZonedDateTime(anchor);
      let date = parseDate(`${at.year}-${pad(at.month)}-${pad(at.day)}`);
      const step = n < 0 ? -1 : 1;
      for (let left = Math.abs(n); left > 0; left -= 1) {
        do {
          date = date.add({ days: step });
        } while (!isOpen(cal, date));
      }
      return date.toString();
    };
    for (const anchor of [
      "2026-11-30T09:30:00[America/New_York]", // the Thanksgiving / early-close fortnight
      "2026-01-15T16:00:00[America/New_York]", // MLK weekend in the window
      "2026-07-10T12:00:00[America/New_York]", // observed Independence Day
      "2026-12-31T23:59:59[America/New_York]", // a year crossing both ways
    ]) {
      for (const n of [1, 3, 5, 10, 50, 252, -1, -3, -5, -10, -50, -252]) {
        const got = addBusinessDays(cal, parseZonedDateTime(anchor), n);
        // Compare local date parts: toISOString() would shift a late-evening
        // New York result into the next UTC day, as it did the anchor above.
        expect(`${got.year}-${pad(got.month)}-${pad(got.day)}`).toBe(naive(anchor, n));
      }
    }
  });

  it("counts open days arithmetically: a four-digit bd count stays off the per-day walk", () => {
    // T-9999bd was the case the 4-digit cap protects at parse time; the
    // estimate puts the target ~38 years out and the count costs one pass
    // over the holiday entries (hundreds), not ~14,000 day tests.
    // From late 2040 so the ~40 years stay inside XNYS's catalogue bounds (ruling RF6 refuses a step past them).
    const instant = parseZonedDateTime("2040-12-14T09:30:00[America/New_York]");
    const started = performance.now();
    const got = addBusinessDays(cal, instant, -9999);
    expect(performance.now() - started).toBeLessThan(250);
    // Sanity: the answer crosses 2002. (No trace here; "names every year a
    // long bd step crosses" below checks the years a long step records.)
    expect(got.year).toBeLessThan(2003);
  });
});

describe("the trace", () => {
  const d = (s: string) => parseDate(s);

  it("records every year consulted and flags nothing on a backend calendar that holds the year", () => {
    const cal = normalizeCalendar(raw({}), "XNYS", [2026], "backend")!;
    const trace = newTrace();
    isOpen(cal, d("2026-09-14"), trace);
    expect([...trace.years]).toEqual([2026]);
    expect(trace.fallback).toBe(false);
    expect(trace.reason).toBeUndefined();
  });

  it("flags a year the backend calendar does not hold, and refuses one past the catalogue's bounds (RF6)", () => {
    const cal = normalizeCalendar(raw({}), "XNYS", [2026], "backend")!;
    const missing = newTrace();
    isOpen(cal, d("2029-01-02"), missing);
    expect(missing.fallback).toBe(true);
    expect(missing.reason).toBe("No XNYS calendar for 2029; weekdays assumed");
    expect(() => isOpen(cal, d("2041-01-02"), newTrace())).toThrow("XNYS COVERAGE_UNAVAILABLE (coverage 1990-01-01 to 2040-12-31)");
    expect(() => isOpen(cal, d("1989-12-29"))).toThrow(/COVERAGE_UNAVAILABLE/);
  });

  it("flags the bundled file and the weekday table, naming which", () => {
    const bundled = newTrace();
    isOpen(bundledCalendar("XNYS")!, d("2026-09-14"), bundled);
    expect(bundled.fallback).toBe(true);
    expect(bundled.reason).toBe("No trading calendar for XNYS on this backend; using the bundled NYSE calendar");
    const weekdays = newTrace();
    addBusinessDays(weekdayCalendar("XLON"), parseZonedDateTime("2026-09-14T12:00:00[Europe/London]"), -1, weekdays);
    expect(weekdays.fallback).toBe(true);
    expect(weekdays.reason).toBe("No trading calendar for XLON on this backend; weekdays only");
    expect([...weekdays.years]).toEqual([2026]);
  });

  it("names every year a long bd step crosses, not just its two ends", () => {
    // T-500bd from October 2026 lands in 2024; 2025's closures are inside the
    // window, so 2025 must be in the trace or it is never fetched.
    const cal = normalizeCalendar(raw({}), "XNYS", [2026], "backend")!;
    const trace = newTrace();
    const got = addBusinessDays(cal, parseZonedDateTime("2026-10-14T09:30:00[America/New_York]"), -500, trace);
    expect(got.year).toBe(2024);
    expect([...trace.years].sort()).toEqual([2024, 2025, 2026]);
  });
});

describe("the dashboard's exchange (2026-10-24)", () => {
  it("reads any catalogue calendar in its own spelling, and keeps any other name for repair", () => {
    for (const mic of ["XNYS", "XLON", "XTSE", "XETR", "XTKS", "XHKG", "XPAR", "CMES", "24/7", "us_futures"]) {
      expect(parseExchange(mic)).toBe(mic);
    }
    expect(parseExchange(" xlon ")).toBe("XLON");
    expect(parseExchange("US_FUTURES")).toBe("us_futures");
    expect(parseExchange("XNAS")).toBe("XNAS");
    expect(parseExchange("US")).toBe("US");
    // An unknown name is upper-cased like an expression's (us) and a widget's exchange (fix round 1, item 6).
    expect(parseExchange(" us ")).toBe("US");
    for (const v of [7, null, "", "  ", "X".repeat(33)]) expect(parseExchange(v), String(v)).toBeUndefined();
  });
});

describe("symbol calendars (spec table)", () => {
  it("maps every suffix, case-insensitive, on the last dot", () => {
    const cases: Record<string, string> = {
      "AAPL.US": "XNYS", "VOD.LSE": "XLON", "VOD.L": "XLON", "RY.TO": "XTSE", "SAP.XETRA": "XETR", "SAP.DE": "XETR",
      "7203.TSE": "XTKS", "7203.T": "XTKS", "0700.HK": "XHKG", "BHP.AU": "XASX", "BHP.AX": "XASX", "TEVA.TA": "XTAE",
      "2330.TW": "XTAI", "vod.l": "XLON", "7203.t": "XTKS",
    };
    for (const [symbol, mic] of Object.entries(cases)) expect(symbolCalendar(symbol), symbol).toBe(mic);
  });

  it("maps every catalogue suffix to its calendar", () => {
    for (const e of CATALOGUE) {
      for (const s of [...e.suffixes.eodhd, ...e.suffixes.yahoo]) expect(symbolCalendar(`X.${s.toLowerCase()}`), s).toBe(e.mic);
    }
    const cases: Record<string, string> = {
      "MC.PA": "XPAR", "ASML.AS": "XAMS", "NESN.SW": "XSWX", "005930.KS": "XKRX", "005930.KO": "XKRX", "035720.KQ": "XKRX",
      "600519.SS": "XSHG", "600519.SHG": "XSHG", "500325.BO": "XBOM", "D05.SI": "XSES", "PETR4.SA": "BVMF",
      "WALMEX.MX": "XMEX", "NPN.JO": "XJSE", "ES.CME": "CMES", "BMW.SG": "XSTU",
    };
    for (const [symbol, mic] of Object.entries(cases)) expect(symbolCalendar(symbol), symbol).toBe(mic);
  });

  it("infers nothing for a dropped or ambiguous suffix", () => {
    for (const s of Object.keys(UNMAPPED_SUFFIXES)) expect(symbolCalendar(`X.${s}`), s).toBeUndefined();
    for (const s of ["AIR.NX", "000001.SZ", "RELIANCE.NS", "6488.TWO"]) expect(symbolCalendar(s), s).toBeUndefined();
  });

  it("tells .T from .TO", () => {
    expect(symbolCalendar("7203.T")).toBe("XTKS");
    expect(symbolCalendar("RY.TO")).toBe("XTSE");
  });

  it("infers nothing for unsuffixed, crypto, FX, unknown, share-class and list symbols (review focus 1)", () => {
    for (const s of ["AAPL", "T", "BTC-USD", "BTC-USD.CC", "EURUSD=X", "EUR.FOREX", "BRK.B", "AAPL,VOD.L", "", " "]) {
      expect(symbolCalendar(s), s).toBeUndefined();
    }
  });
});

describe("calendarOf: spec precedence steps 2-6", () => {
  const w = (over: object = {}) => ({ params: [{ paramName: "symbol" }, { paramName: "d" }], ...over });
  const xtks = { schemaVersion: 1 as const, kind: "single" as const, calendarId: "exchange:XTKS" };

  it("lets each step beat the next", () => {
    expect(calendarOf(w({ exchange: "XHKG" }), { exchange: "XTSE" }, "XETR", { symbol: "VOD.L" })).toEqual({ mic: "XLON", from: "symbol", symbol: "VOD.L" });
    expect(calendarOf(w({ exchange: "XHKG" }), { exchange: "XTSE" }, "XETR", { symbol: "AAPL" })).toEqual({ mic: "XTSE", from: "param" });
    expect(calendarOf(w({ calendarBinding: xtks, exchange: "XHKG" }), {}, "XETR")).toEqual({ mic: "XTKS", from: "widget" });
    expect(calendarOf(w({ exchange: "XHKG" }), {}, "XETR")).toEqual({ mic: "XHKG", from: "widget" });
    expect(calendarOf(w(), {}, "XETR")).toEqual({ mic: "XETR", from: "dashboard" });
    expect(calendarOf(w(), {}, undefined)).toEqual({ mic: "XNYS", from: "default" });
  });

  it("reads a symbol only when the card has a symbol parameter", () => {
    expect(calendarOf({ params: [{ paramName: "d" }] }, {}, undefined, { symbol: "VOD.L" }).from).toBe("default");
  });

  it("keys a non-exchange or joint binding by its JSON, and names it by its members", () => {
    const joint = { schemaVersion: 1 as const, kind: "joint" as const, members: ["payment:BOJ", "payment:T2"], mode: "all_open" as const, referenceTimezone: "UTC" };
    const { mic } = calendarOf(w({ calendarBinding: joint }), {}, undefined);
    expect(mic).toBe(`binding:${JSON.stringify(joint)}`);
    expect(calendarName(mic)).toBe("payment:BOJ+payment:T2");
  });

  it("describes where the calendar came from, as the Date expression footer shows it", () => {
    expect(describeCalendar({ mic: "XLON", from: "expression" })).toBe("XLON (from the expression)");
    expect(describeCalendar({ mic: "XTKS", from: "symbol", symbol: "7203.T" })).toBe("XTKS (from symbol 7203.T)");
    expect(describeCalendar({ mic: "XTSE", from: "param" })).toBe("XTSE (from the parameter)");
    expect(describeCalendar({ mic: "XHKG", from: "widget" })).toBe("XHKG (from the widget)");
    expect(describeCalendar({ mic: "XETR", from: "dashboard" })).toBe("XETR (from the dashboard)");
    expect(describeCalendar({ mic: "XNYS", from: "default" })).toBe("Default (XNYS)");
  });

  it("knows exactly the catalogue's calendars; an alias stays unknown (ruling RF3)", () => {
    expect(isKnownCalendar("XASX")).toBe(true);
    expect(isKnownCalendar("us_futures")).toBe(true);
    expect(isKnownCalendar("US_FUTURES")).toBe(false);
    expect(isKnownCalendar("XNAS")).toBe(false);
    expect(isKnownCalendar("constructor")).toBe(false);
  });
});
