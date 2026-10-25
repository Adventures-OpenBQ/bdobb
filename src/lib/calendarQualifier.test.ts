// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import cmes from "./calendars/vendor/conformance/CMES-2026-01.json";
import xkrx from "./calendars/vendor/conformance/XKRX.json";
import xlon from "./calendars/vendor/conformance/XLON.json";
import xnysYearEnd from "./calendars/vendor/conformance/XNYS-2026-12.json";
import xpar from "./calendars/vendor/conformance/XPAR.json";
import type { CalendarBundle } from "./calendars/contracts";
import { bundleCalendar } from "./calendars/resolver";
import { bundledCalendar, normalizeCalendar } from "./calendar";
import { previewExpression, resolveValue } from "./dateExpressions";
import { sendParams, wireParams } from "./params";
import { widget } from "../test/fixtures";

const single = (mic: string) => ({ schemaVersion: 1 as const, kind: "single" as const, calendarId: `exchange:${mic}` });
const calendars = {
  XNYS: bundleCalendar([xnysYearEnd as CalendarBundle], single("XNYS"), "operational-v1"),
  XLON: bundleCalendar([xlon as CalendarBundle], single("XLON"), "operational-v1"),
};
const now = new Date("2026-12-29T12:00:00Z");

describe("calendar-qualified resolution", () => {
  it("steps the same T-1bd on XNYS and on XLON across London's Boxing Day Monday", () => {
    expect(resolveValue("date", "T-1bd(XNYS)", { now, zone: "UTC", calendars })).toBe("2026-12-28");
    expect(resolveValue("date", "T-1bd(XLON)", { now, zone: "UTC", calendars })).toBe("2026-12-24");
  });

  it("gives each range atom its own calendar", () => {
    expect(resolveValue("date_range", "T-3bd(XLON)..T", { now, zone: "UTC", calendars, exchange: "XNYS", calendar: calendars.XNYS })).toBe(
      "2026-12-22/2026-12-29",
    );
  });

  it("closes @close on an NYSE early close", () => {
    const xnys = { XNYS: bundledCalendar("XNYS")! };
    expect(resolveValue("datetime", "T-1bd@close(XNYS)", { now: new Date("2026-11-30T14:30:00Z"), zone: "America/New_York", calendars: xnys })).toBe(
      "2026-11-27T13:00:00-05:00",
    );
  });

  it("takes the next session for @open/@close on a closed date (review focus 3)", () => {
    const hk = normalizeCalendar(
      { data: { Timezone: "Asia/Hong_Kong", TradingHours: { Open: "09:30:00", Close: "16:00:00", WorkingDays: "Mon,Tue,Wed,Thu,Fri" }, ExchangeHolidays: { "2026-10-01": { Holiday: "National Day", Type: "Official" } } } },
      "XHKG",
      [2026],
      "backend",
    )!;
    expect(resolveValue("datetime", "FQ0@open(XHKG)", { now: new Date("2026-10-15T04:00:00Z"), zone: "Asia/Hong_Kong", calendars: { XHKG: hk } })).toBe(
      "2026-10-02T09:30:00+08:00",
    );
    expect(resolveValue("datetime", "T@close", { now: new Date("2026-09-19T15:00:00Z"), zone: "America/New_York", calendar: bundledCalendar("XNYS")!, exchange: "XNYS" })).toBe(
      "2026-09-21T16:00:00-04:00",
    );
  });

  it("puts a wall clock on the calendar's clock, Default (XNYS) included (ruling P13)", () => {
    const at = new Date("2026-09-17T12:00:00Z");
    expect(resolveValue("datetime", "T@14:00", { now: at, zone: "Asia/Tokyo", exchange: "XNYS", from: "default" })).toBe("2026-09-17T14:00:00-04:00");
    expect(resolveValue("datetime", "T@14:00", { now: at, zone: "Asia/Tokyo", exchange: "XNYS", from: "dashboard" })).toBe("2026-09-17T14:00:00-04:00");
    expect(resolveValue("datetime", "T@14:00(XNYS)", { now: at, zone: "Asia/Tokyo", from: "default" })).toBe("2026-09-17T14:00:00-04:00");
  });

  it("makes an unknown (MIC) a visible error, never a literal and never XNYS", () => {
    const errors: string[] = [];
    expect(resolveValue("date", "T(XNYZ)", { now, onError: (m) => errors.push(m) })).toBe("");
    expect(errors).toEqual(["Unknown calendar XNYZ"]);
    expect(previewExpression("date", "T(XNYZ)", { now })?.error).toBe("Unknown calendar XNYZ");
  });

  it("refuses an unloaded calendar on an opted-in card instead of using weekdays (review C1)", () => {
    const errors: string[] = [];
    expect(resolveValue("date", "T-1bd", { now, exchange: "XLON", strict: true, onError: (m) => errors.push(m) })).toBe("");
    expect(errors).toEqual(["No XLON calendar loaded"]);
  });

  it("refuses a qualified atom that resolves to nothing, and keeps an unqualified one a literal (review I2)", () => {
    const errors: string[] = [];
    const ctx = { now, calendars, symbol: "AAPL", onError: (m: string) => errors.push(m) };
    expect(resolveValue("date", "EXP(XLON)", ctx)).toBe("");
    expect(errors).toEqual(["Cannot resolve EXP(XLON)"]);
    expect(resolveValue("date", "EXP", ctx)).toBe("EXP");
    expect(errors).toHaveLength(1);
  });

  it("refuses an @ on a param without a time of day (ruling R7a)", () => {
    const errors: string[] = [];
    expect(resolveValue("date", "T-1bd@close(XNYS)", { now, calendars, onError: (m) => errors.push(m) })).toBe("");
    expect(errors).toEqual(["@ needs a date-and-time parameter"]);
    expect(() => resolveValue("week", "T@14:00", { now })).toThrow("@ needs a date-and-time parameter");
  });
});

describe("wireParams and sendParams", () => {
  const w = (over = {}) => widget({ params: [{ paramName: "symbol", type: "text" }, { paramName: "d", type: "date" }], ...over });

  it("follows the card's symbol, and lets the expression's (MIC) beat it (precedence step 1 over 2)", () => {
    expect(wireParams(w(), { symbol: "VOD.L", d: "T-1bd" }, { now, calendars })).toEqual({ symbol: "VOD.L", d: "2026-12-24" });
    expect(wireParams(w(), { symbol: "VOD.L", d: "T-1bd(XNYS)" }, { now, calendars })).toEqual({ symbol: "VOD.L", d: "2026-12-28" });
  });

  it("refuses an exchange outside the nine only where a calendar is needed (review focus 2)", () => {
    const xnas = w({ exchange: "XNAS" });
    const errors: Record<string, string> = {};
    expect(wireParams(xnas, { d: "T-1bd" }, { now, errors })).toEqual({ d: "" });
    expect(errors).toEqual({ d: "Unknown calendar XNAS" });
    expect(() => sendParams(xnas, { d: "T-1bd" }, { now })).toThrow("d: Unknown calendar XNAS");
    expect(sendParams(xnas, { d: "T-7d" }, { now: new Date("2026-12-29T12:00:00Z") }).d).toMatch(/^2026-12-2[12]$/);
    expect(sendParams(xnas, { d: "2026-12-01" }, { now })).toEqual({ d: "2026-12-01" });
  });

  it("never sends an @ on a date param (ruling R7a)", () => {
    const errors: Record<string, string> = {};
    expect(wireParams(w(), { d: "T-1bd@close(XNYS)" }, { now, calendars, errors })).toEqual({ d: "" });
    expect(errors).toEqual({ d: "@ needs a date-and-time parameter" });
    expect(() => sendParams(w(), { d: "T-1bd@close(XNYS)" }, { now, calendars })).toThrow("d: @ needs a date-and-time parameter");
  });
});

describe("the full calendar set (2026-10-24)", () => {
  const set = {
    XPAR: bundleCalendar([xpar as CalendarBundle], single("XPAR"), "operational-v1"),
    XKRX: bundleCalendar([xkrx as CalendarBundle], single("XKRX"), "operational-v1"),
    CMES: bundleCalendar([cmes as CalendarBundle], single("CMES"), "operational-v1"),
  };
  const monday = new Date("2026-01-05T15:00:00Z");

  it("resolves (XPAR) and (XKRX) on their own holidays and hours", () => {
    expect(resolveValue("date", "T-1bd(XPAR)", { now, zone: "UTC", calendars: set })).toBe("2026-12-28");
    expect(resolveValue("datetime", "T-2bd@close(XPAR)", { now, zone: "UTC", calendars: set })).toBe("2026-12-24T14:05:00+01:00");
    expect(resolveValue("date", "T+2bd(XKRX)", { now, zone: "UTC", calendars: set })).toBe("2027-01-04");
    expect(resolveValue("datetime", "T+2bd@open(xkrx)", { now, zone: "UTC", calendars: set })).toBe("2027-01-04T10:00:00+09:00");
  });

  it("opens CME's Monday session on Sunday evening, as exchange_calendars labels it", () => {
    expect(resolveValue("datetime", "T@open(CMES)", { now: monday, zone: "UTC", calendars: set })).toBe("2026-01-04T17:00:00-06:00");
    expect(resolveValue("datetime", "T@close(CMES)", { now: monday, zone: "UTC", calendars: set })).toBe("2026-01-05T17:00:00-06:00");
    expect(resolveValue("date", "trade_date(CMES)", { now: monday, zone: "UTC", calendars: set })).toBe("2026-01-02");
    expect(resolveValue("date", "T-1bd(CMES)", { now: monday, zone: "UTC", calendars: set })).toBe("2026-01-02");
    // Sunday 17:30 in Chicago: today is no session, so @open takes Monday's, which opened half an hour ago.
    const sunday = new Date("2026-01-04T23:30:00Z");
    expect(resolveValue("datetime", "T@open(CMES)", { now: sunday, zone: "UTC", calendars: set })).toBe("2026-01-04T17:00:00-06:00");
  });

  it("counts CME's sessions for bd, not weekdays", () => {
    // The vendored CMES fixture (2026-01-02..09) has no weekday closure and no weekend session, so plain weekdays
    // give the same counts on it. The nearest case: the same bundle with Tuesday 6 January closed, as a CME holiday
    // would be.
    const shut = {
      ...cmes,
      days: cmes.days.map((d) =>
        d.date === "2026-01-06" ? { ...d, state: "closed", open: null, close: null, segments: [] } : d,
      ),
    };
    const wednesday = new Date("2026-01-07T15:00:00Z");
    const shutSet = { CMES: bundleCalendar([shut as CalendarBundle], single("CMES"), "operational-v1") };
    expect(resolveValue("date", "T-1bd(CMES)", { now: wednesday, zone: "UTC", calendars: set })).toBe("2026-01-06");
    expect(resolveValue("date", "T-1bd(CMES)", { now: wednesday, zone: "UTC", calendars: shutSet })).toBe("2026-01-05");
  });

  it("never works an overnight calendar out on weekdays, on a legacy card either (review focus 3)", () => {
    const legacy = widget({ exchange: "CMES", params: [{ paramName: "d", type: "date" }] });
    const errors: Record<string, string> = {};
    expect(wireParams(legacy, { d: "T-1bd" }, { now: monday, errors })).toEqual({ d: "" });
    expect(errors).toEqual({ d: "No CMES calendar loaded" });
    expect(() => sendParams(legacy, { d: "T-1bd(us_futures)" }, { now: monday })).toThrow("d: No us_futures calendar loaded");
    // Calendar-free: only the zone is read, so it still sends.
    expect(sendParams(legacy, { d: "T-7d" }, { now: monday }).d).toBe("2025-12-29");
  });
});
