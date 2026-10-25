// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { widget as makeWidget } from "../test/fixtures";
import {
  consultsFiscal,
  fiscalChain,
  fiscalControlParam,
  fiscalLabel,
  fiscalReason,
  isTickerParam,
  monthControlParams,
  singleTicker,
  takesFiscalYearEnd,
} from "./fiscalChain";
import { monthLabel } from "./periods";

describe("which params take, and which consult, a fiscal year end", () => {
  it("covers the three fiscal types and the two date types (spec §1.1)", () => {
    for (const type of ["quarter", "fiscal_year", "quarter_range", "date", "date_range"]) expect(takesFiscalYearEnd(type)).toBe(true);
    for (const type of ["datetime", "week", "time", "text", undefined]) expect(takesFiscalYearEnd(type)).toBe(false);
  });

  it("consults for a fiscal type always, and for a date only when its value uses FQ, FY, fq or fy", () => {
    expect(consultsFiscal("quarter", "2026-Q3")).toBe(true);
    expect(consultsFiscal("quarter_range", "")).toBe(true);
    expect(consultsFiscal("date", "FQ0")).toBe(true);
    expect(consultsFiscal("date", "T-1fy")).toBe(true);
    expect(consultsFiscal("date_range", "FY0/T")).toBe(true);
    expect(consultsFiscal("date", "T-1d")).toBe(false);
    expect(consultsFiscal("date", "2026-01-01")).toBe(false);
    expect(consultsFiscal("text", "FY0")).toBe(false);
  });

  it("reads the fiscal token in any case, as the grammar does since v5.3.4", () => {
    // `T-1Fq` resolves as a fiscal quarter, so it has to wait for the year end too.
    expect(consultsFiscal("date", "T-1Fq")).toBe(true);
    expect(consultsFiscal("date", "fY0")).toBe(true);
  });
});

describe("singleTicker (spec §1.2)", () => {
  it("is the one ticker param's single value, trimmed and upper-cased", () => {
    const w = makeWidget({ params: [{ paramName: "symbol", type: "text" }, { paramName: "q", type: "quarter" }] });
    expect(singleTicker(w, { symbol: " aapl " })).toBe("AAPL");
    expect(singleTicker(w, { symbol: "AAPL,MSFT" })).toBeUndefined();
    expect(singleTicker(w, { symbol: "" })).toBeUndefined();
    expect(singleTicker(w, {})).toBeUndefined();
  });

  it("counts type ticker, type symbol and paramName symbol, and wants exactly one that is not multiSelect", () => {
    expect(isTickerParam({ paramName: "t", type: "ticker" })).toBe(true);
    expect(isTickerParam({ paramName: "t", type: "symbol" })).toBe(true);
    expect(isTickerParam({ paramName: "symbol", type: "text" })).toBe(true);
    expect(isTickerParam({ paramName: "ticker", type: "text" })).toBe(false);
    const two = makeWidget({ params: [{ paramName: "symbol" }, { paramName: "peer", type: "ticker" }] });
    expect(singleTicker(two, { symbol: "AAPL", peer: "MSFT" })).toBeUndefined();
    const multi = makeWidget({ params: [{ paramName: "symbol", multiSelect: true, options: [{ label: "A", value: "AAPL" }] }] });
    expect(singleTicker(multi, { symbol: "AAPL" })).toBeUndefined();
    expect(singleTicker(makeWidget({ params: [{ paramName: "q", type: "quarter" }] }), {})).toBeUndefined();
  });
});

describe("fiscalChain (spec §1.2)", () => {
  const values = { fy_end: "June" };

  it("takes the card override first, over everything", () => {
    expect(fiscalChain({ fiscalYearEnd: 3 }, { fiscalYearEnd: 1 }, values, { override: 9, param: 6 })).toEqual({ month: 9, source: "card" });
    expect(fiscalChain({ fiscalYearEndEndpoint: "fye" }, {}, values, { override: 9, param: "pending" })).toEqual({ month: 9, source: "card" });
  });

  it("then the param's own fields, in the v5.2.0 order: endpoint, sibling, static", () => {
    const own = { fiscalYearEndEndpoint: "fye", fiscalYearEndParam: "fy_end", fiscalYearEnd: 3 };
    expect(fiscalChain(own, {}, values, { param: 9 })).toEqual({ month: 9, source: "parameter" });
    expect(fiscalChain(own, {}, values, {})).toEqual({ month: 6, source: "parameter" });
    expect(fiscalChain(own, {}, { fy_end: "Smarch" }, {})).toEqual({ month: 3, source: "parameter" });
  });

  it("then the widget's, in the same order", () => {
    expect(fiscalChain({}, { fiscalYearEndParam: "fy_end", fiscalYearEnd: 3 }, values, { widget: 1 })).toEqual({ month: 1, source: "widget" });
    expect(fiscalChain({}, { fiscalYearEndParam: "fy_end", fiscalYearEnd: 3 }, values, {})).toEqual({ month: 6, source: "widget" });
    expect(fiscalChain({}, { fiscalYearEnd: 3 }, {}, {})).toEqual({ month: 3, source: "widget" });
  });

  it("then the lookup, also when a declared endpoint failed (spec §1.2 over plan ruling 7)", () => {
    expect(fiscalChain({}, {}, {}, {})).toEqual({ lookup: true });
    // A settled endpoint with no usable answer is `undefined`: the chain falls through.
    expect(fiscalChain({ fiscalYearEndEndpoint: "fye" }, {}, {}, {})).toEqual({ lookup: true });
    expect(fiscalChain({}, { fiscalYearEndEndpoint: "fye" }, {}, {})).toEqual({ lookup: true });
  });

  it("stops at an endpoint still in flight: pending, and nothing after it — the lookup included — decides", () => {
    expect(fiscalChain({ fiscalYearEndEndpoint: "fye" }, { fiscalYearEnd: 3 }, {}, { param: "pending" })).toEqual({ pending: true });
    expect(fiscalChain({}, { fiscalYearEndEndpoint: "fye" }, {}, { widget: "pending" })).toEqual({ pending: true });
    // Only what comes AFTER the endpoint waits: the param's own static month precedes the widget's endpoint.
    expect(fiscalChain({ fiscalYearEnd: 3 }, { fiscalYearEndEndpoint: "fye" }, {}, { widget: "pending" })).toEqual({ month: 3, source: "parameter" });
  });
});

describe("monthControlParams", () => {
  it("names every param some fiscalYearEndParam points at, on a param or on the widget", () => {
    const w = makeWidget({
      fiscalYearEndParam: "fy_widget",
      params: [{ paramName: "fy_widget" }, { paramName: "q", type: "quarter", fiscalYearEndParam: "fy_param" }, { paramName: "d", type: "date" }],
    });
    expect([...monthControlParams(w)].sort()).toEqual(["fy_param", "fy_widget"]);
    expect(monthControlParams(makeWidget({ params: [{ paramName: "q", type: "quarter" }] })).size).toBe(0);
  });
});

describe("fiscalControlParam (spec §1.5)", () => {
  it("is the first param that consults, and none when the widget already has its own month control", () => {
    const w = makeWidget({ params: [{ paramName: "symbol" }, { paramName: "d", type: "date" }, { paramName: "q", type: "quarter" }] });
    expect(fiscalControlParam(w, { d: "T-1d" })?.paramName).toBe("q");
    expect(fiscalControlParam(w, { d: "FQ0" })?.paramName).toBe("d");
    const own = makeWidget({ params: [{ paramName: "fy_end" }, { paramName: "q", type: "quarter", fiscalYearEndParam: "fy_end" }] });
    expect(fiscalControlParam(own, {})).toBeUndefined();
    const widgetOwn = makeWidget({ fiscalYearEndParam: "fy_end", params: [{ paramName: "fy_end" }, { paramName: "q", type: "quarter" }] });
    expect(fiscalControlParam(widgetOwn, {})).toBeUndefined();
    expect(fiscalControlParam(makeWidget({ params: [{ paramName: "d", type: "date" }] }), { d: "T" })).toBeUndefined();
  });
});

describe("the control's text and the ⚠ reason", () => {
  it("names the month by the system locale and its source, the ticker for a lookup", () => {
    expect(fiscalLabel(9, "lookup", "AAPL")).toBe(`${monthLabel(9)} · AAPL`);
    expect(fiscalLabel(6, "widget")).toBe(`${monthLabel(6)} · widget`);
    expect(fiscalLabel(3, "parameter")).toBe(`${monthLabel(3)} · parameter`);
    expect(fiscalLabel(12, "default")).toBe(`${monthLabel(12)} · default`);
    expect(fiscalReason("ZZZZ")).toBe("Fiscal year end: no fiscal data for ZZZZ on this backend; using December");
  });
});
