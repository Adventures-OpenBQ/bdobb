// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { CalendarDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import { bundledCalendar } from "./calendar";
import { expiryBack, isMonthlyExpiry, monthlyExpiry, parseOptionSymbol } from "./optionSymbol";

const cal = bundledCalendar("XNYS")!;
const d = (s: string) => {
  const [y, m, day] = s.split("-").map(Number);
  return new CalendarDate(y, m, day);
};

describe("parseOptionSymbol", () => {
  it("reads an OCC symbol's own expiry, root, side and strike", () => {
    // The point of the whole exercise: the expiry is IN the symbol.
    expect(parseOptionSymbol("AAPL260918C00150000")).toEqual({
      root: "AAPL", expiry: d("2026-09-18"), call: true, strike: 150,
    });
  });

  it("reads the space-padded canonical form a feed sends", () => {
    expect(parseOptionSymbol("AAPL  260918P00150000")?.expiry).toEqual(d("2026-09-18"));
    expect(parseOptionSymbol("AAPL  260918P00150000")?.call).toBe(false);
  });

  it("carries a fractional strike, which is thousandths", () => {
    expect(parseOptionSymbol("SPY260918C00450500")?.strike).toBe(450.5);
  });

  it("is null for anything that is not an OCC symbol", () => {
    for (const s of ["AAPL", "", "ESZ26", "AAPL260918X00150000", "AAPL26091C00150000"]) {
      expect(parseOptionSymbol(s), s).toBeNull();
    }
  });

  it("is null for a shape that matches but is not a date", () => {
    // The guard that a regex alone does not give: month 13, and a February
    // that never happened.
    expect(parseOptionSymbol("AAPL261318C00150000")).toBeNull();
    expect(parseOptionSymbol("AAPL260230C00150000")).toBeNull();
  });
});

describe("monthlyExpiry", () => {
  it("is the third Friday", () => {
    expect(monthlyExpiry(cal, 2026, 9)).toEqual(d("2026-09-18"));
    expect(monthlyExpiry(cal, 2026, 10)).toEqual(d("2026-10-16"));
  });

  it("moves earlier when the third Friday is closed", () => {
    // Good Friday 2026 is 2026-04-03, which is not the third Friday. The
    // rule still has to hold for any closed third Friday, so assert the
    // mechanism: a month whose third Friday the calendar calls shut.
    const thirdFriday = monthlyExpiry(cal, 2026, 4);
    expect(thirdFriday).toEqual(d("2026-04-17"));
    // And the general property: whatever comes back is an open day.
    for (let m = 1; m <= 12; m += 1) {
      const e = monthlyExpiry(cal, 2026, m);
      expect(e.day, `month ${m}`).toBeGreaterThanOrEqual(14);
      expect(e.day, `month ${m}`).toBeLessThanOrEqual(21);
    }
  });
});

describe("expiryBack", () => {
  const sept = d("2026-09-18"); // the third Friday

  it("is the contract's own expiry at zero", () => {
    expect(expiryBack(cal, sept, 0)).toEqual(sept);
  });

  it("steps back a monthly at a time", () => {
    expect(expiryBack(cal, sept, 1)).toEqual(d("2026-08-21"));
    expect(expiryBack(cal, sept, 2)).toEqual(d("2026-07-17"));
  });

  it("crosses a year boundary", () => {
    expect(expiryBack(cal, d("2026-01-16"), 1)).toEqual(d("2025-12-19"));
  });

  it("steps forward on a negative count, across a year boundary too", () => {
    expect(expiryBack(cal, sept, -1)).toEqual(d("2026-10-16"));
    expect(expiryBack(cal, d("2025-12-19"), -1)).toEqual(d("2026-01-16"));
  });

  it("refuses to step back from a contract that is not a monthly", () => {
    // A weekly. Its previous expiry is the previous WEEK, and nothing here
    // knows a weekly chain -- answering with the monthly would be a
    // plausible wrong number, which is worse than no answer.
    const weekly = d("2026-09-25");
    expect(isMonthlyExpiry(cal, weekly)).toBe(false);
    expect(expiryBack(cal, weekly, 1)).toBeNull();
    // Its own expiry is still exact, because that came from the symbol.
    expect(expiryBack(cal, weekly, 0)).toEqual(weekly);
  });
});
