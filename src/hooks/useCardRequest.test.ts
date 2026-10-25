// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";
import { wireParams } from "../lib/params";
import { backend, card, widget } from "../test/fixtures";
import { cardRequestSync } from "./useCardRequest";
import { __primeFiscalYearEndCachesForTests, __resetFiscalYearEndCacheForTests } from "./useFiscalYearEnd";
import { __resetTradingCalendarCacheForTests } from "./useTradingCalendar";

// What Rita's get_widget_data sends for a card (bdobb-lib I2): the request
// useCardRequest builds, not effectiveParams plus a fiscal map alone.
describe("cardRequestSync", () => {
  beforeEach(() => {
    __resetFiscalYearEndCacheForTests();
    __resetTradingCalendarCacheForTests();
  });
  const be = backend({ id: "be", baseUrl: "http://127.0.0.1:1" });

  it("resolves T-1bd on the card's trading calendar: the Tuesday after Labor Day 2026 is Friday the 4th, not the holiday", () => {
    const w = widget({ id: "eod", backendId: "be", params: [{ paramName: "date", type: "date" }] });
    const c = card({ backendId: "be", widgetId: "eod", params: { date: "T-1bd" } });
    const now = new Date("2026-09-08T15:00:00Z");
    const { query, ctx } = cardRequestSync(c, w, be, undefined, undefined, now);
    expect(wireParams(w, query, { ...ctx, now }).date).toBe("2026-09-04");
    // What get_widget_data sent before: no calendar, so the weekday table.
    expect(wireParams(w, query, { now }).date).toBe("2026-09-07");
  });

  // v4: the calendar follows the card's symbol, so Rita's input_args choose it -- here AAPL, on XNYS, over the card's
  // VOD.L. Chosen on the card's own symbol it would be XLON's, and AAPL's T-1bd would land on Labor Day.
  it("chooses the calendars on Rita's overrides, not the card's stored symbol", () => {
    const w = widget({ id: "eod", backendId: "be", params: [{ paramName: "symbol", type: "text" }, { paramName: "date", type: "date" }] });
    const c = card({ backendId: "be", widgetId: "eod", params: { symbol: "VOD.L", date: "T-1bd" } });
    const now = new Date("2026-09-08T15:00:00Z");
    const { query, ctx } = cardRequestSync(c, w, be, undefined, undefined, now, { symbol: "AAPL" });
    expect(query.symbol).toBe("AAPL");
    expect(wireParams(w, query, { ...ctx, now }).date).toBe("2026-09-04");
  });

  // An opted-in card resolves on bundles only: no legacy calendars, so fetchWidgetData loads its bundles.
  it("hands an opted-in card no legacy calendars", () => {
    const w = widget({
      id: "eod",
      backendId: "be",
      calendarBinding: { schemaVersion: 1, kind: "single", calendarId: "exchange:XNYS" },
      params: [{ paramName: "date", type: "date" }],
    });
    const c = card({ backendId: "be", widgetId: "eod", params: { date: "T-1bd" } });
    expect(cardRequestSync(c, w, be, undefined).ctx.calendars).toBeUndefined();
  });

  it("carries the dashboard's exchange into the wire context", () => {
    const w = widget({ id: "eod", backendId: "be", params: [{ paramName: "date", type: "date" }] });
    const c = card({ backendId: "be", widgetId: "eod", params: { date: "T-1bd" } });
    // Ruling RW6: T-1bd consults an XLON year nothing has loaded, so the read refuses -- naming the dashboard's MIC.
    expect(() => cardRequestSync(c, w, be, { exchange: "XLON" })).toThrow("XLON calendar not loaded");
    // A value that consults no year is sent, with the dashboard's exchange in its wire context.
    expect(cardRequestSync({ ...c, params: { date: "T" } }, w, be, { exchange: "XLON" }).ctx.exchange).toBe("XLON");
  });

  it("sends a Run-button card's last-run params and map, not its un-run edit", () => {
    const w = widget({ id: "q", backendId: "be", params: [{ paramName: "symbol" }, { paramName: "quarter", type: "quarter" }] });
    const c = card({ backendId: "be", widgetId: "q", params: { symbol: "EDITED", quarter: "2025-Q1" } });
    const out = cardRequestSync(c, w, be, undefined, { params: { symbol: "RAN", quarter: "2024-Q4" }, fiscalYearEnd: { quarter: 9 } });
    expect(out.query).toEqual({ symbol: "RAN", quarter: "2024-Q4" });
    expect(out.ctx.fiscalYearEnd).toEqual({ quarter: 9 });
  });

  // Moved from chatStore.test's turnFiscalYearEnd, which this replaces.
  it("reads the month a mounted card resolved, through the group's value, and relabels the quarter with it", () => {
    const w = widget({ id: "f", backendId: "be", params: [{ paramName: "symbol", type: "text" }, { paramName: "quarter", type: "quarter" }] });
    const c = card({ backendId: "be", widgetId: "f", params: { symbol: "OLD", quarter: "2025-Q1" }, bindings: [{ paramName: "symbol", groupId: "g1" }] });
    const dash = { groups: [{ id: "g1", name: "G", paramName: "symbol", groupType: "symbol" as const, value: "AAPL" }] };
    expect(cardRequestSync(c, w, be, dash).ctx.fiscalYearEnd).toEqual({ quarter: 12 });
    __primeFiscalYearEndCachesForTests({ lookup: { "be\nhttp://127.0.0.1:1|AAPL": 9 } });
    const out = cardRequestSync(c, w, be, dash);
    expect(out.ctx.fiscalYearEnd).toEqual({ quarter: 9 });
    expect(out.query.symbol).toBe("AAPL");
    expect(cardRequestSync(c, widget({ id: "p", backendId: "be", params: [{ paramName: "symbol", type: "text" }] }), be, dash).ctx.fiscalYearEnd).toEqual({});
  });
});
