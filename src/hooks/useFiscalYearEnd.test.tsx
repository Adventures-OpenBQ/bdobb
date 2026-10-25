// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// plugin-http's fetch is a drop-in for the platform fetch; the real one here
// exercises the mock server over genuine HTTP, as useParamOptions.test.tsx does.
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));

import { __read, __reset } from "../test/memfs";
import { __resetLoggerForTests } from "../lib/logger";
import { startMockServer, type MockServer } from "../test/mockServer";
import type { BackendConfig, WidgetDef } from "../lib/types";
import { backend, widget as makeWidget } from "../test/fixtures";
import { __primeFiscalYearEndCachesForTests, __resetFiscalYearEndCacheForTests, fiscalYearEndSync, useFiscalYearEnd } from "./useFiscalYearEnd";

/** One path answering per symbol, in each of the three documented shapes. */
function fiscalYearEndFor(url: URL): unknown {
  switch (url.searchParams.get("symbol")) {
    case "AAPL":
      return "September";
    case "MSFT":
      return { fiscalYearEnd: 6 };
    case "WMT":
      return 1;
    case "JUNK":
      return { month: "Smarch" };
    default:
      return { __status: 404 };
  }
}

const widget: WidgetDef = makeWidget({
  id: "fiscal",
  params: [
    { paramName: "symbol", type: "text" },
    { paramName: "fy_end", options: [{ label: "December", value: "December" }, { label: "June", value: "June" }] },
    {
      paramName: "quarter",
      type: "quarter",
      fiscalYearEndEndpoint: "fiscal_year_end",
      optionsParams: { symbol: "$symbol" },
      fiscalYearEndParam: "fy_end",
      fiscalYearEnd: 3,
    },
    { paramName: "fy", type: "fiscal_year", fiscalYearEndParam: "fy_end", fiscalYearEnd: 3 },
    { paramName: "static_only", type: "fiscal_year", fiscalYearEnd: 3 },
    { paramName: "bare", type: "quarter" },
    { paramName: "date", type: "date", fiscalYearEnd: 5 },
  ],
});

const servers: MockServer[] = [];

async function serve(): Promise<BackendConfig> {
  const s = await startMockServer({ "/fiscal_year_end": (url: URL) => fiscalYearEndFor(url) });
  servers.push(s);
  return backend({ baseUrl: s.url });
}

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetFiscalYearEndCacheForTests();
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe("useFiscalYearEnd", () => {
  it("has one entry per quarter, fiscal_year and date param, and none for any other type", async () => {
    const b = await serve();
    const { result } = renderHook(() => useFiscalYearEnd(widget, { symbol: "AAPL", fy_end: "June" }, b));
    await waitFor(() => expect(result.current.months.quarter).toBe(9));
    expect(Object.keys(result.current.months).sort()).toEqual(["bare", "date", "fy", "quarter", "static_only"]);
  });

  it("resolves endpoint over sibling over static over December", async () => {
    const b = await serve();
    const { result } = renderHook(() => useFiscalYearEnd(widget, { symbol: "AAPL", fy_end: "June" }, b));
    // The sibling and the static answer at once; the endpoint lands later.
    expect(result.current.months).toEqual({ quarter: 6, fy: 6, static_only: 3, bare: 12, date: 5 });
    await waitFor(() => expect(result.current.months.quarter).toBe(9));
    expect(result.current.months).toEqual({ quarter: 9, fy: 6, static_only: 3, bare: 12, date: 5 });
  });

  it("reads every documented endpoint shape", async () => {
    const b = await serve();
    for (const [symbol, month] of [["MSFT", 6], ["WMT", 1]] as const) {
      const { result } = renderHook(() => useFiscalYearEnd(widget, { symbol, fy_end: "December" }, b));
      await waitFor(() => expect(result.current.months.quarter).toBe(month));
    }
  });

  it("falls through to the sibling on an unreadable answer, on an error, and with no backend — and logs once", async () => {
    const b = await serve();
    const junk = renderHook(() => useFiscalYearEnd(widget, { symbol: "JUNK", fy_end: "June" }, b));
    const missing = renderHook(() => useFiscalYearEnd(widget, { symbol: "NONE", fy_end: "June" }, b));
    const offline = renderHook(() => useFiscalYearEnd(widget, { symbol: "AAPL", fy_end: "June" }, undefined));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(junk.result.current.months.quarter).toBe(6);
    expect(missing.result.current.months.quarter).toBe(6);
    expect(offline.result.current.months.quarter).toBe(6);
    const lines = (__read("logs/bdobb.log") ?? "").trimEnd().split("\n").filter((l) => l.length > 0);
    // One line each: the unreadable answer, the 404, and the skipped lookup.
    expect(lines).toHaveLength(3);
    expect(lines.some((l) => l.includes("unusable fiscal year end"))).toBe(true);
    expect(lines.some((l) => l.includes("fiscal year end lookup failed"))).toBe(true);
    expect(lines.some((l) => l.includes("backend not configured"))).toBe(true);
  });

  it("falls through past a sibling whose value does not parse", () => {
    const { result } = renderHook(() => useFiscalYearEnd(widget, { fy_end: "Smarch" }, undefined));
    expect(result.current.months.fy).toBe(3);
    const { result: blank } = renderHook(() => useFiscalYearEnd(widget, {}, undefined));
    expect(blank.current.months.fy).toBe(3);
  });

  it("caches per endpoint and request params, so a second card asks nothing", async () => {
    const b = await serve();
    const first = renderHook(() => useFiscalYearEnd(widget, { symbol: "AAPL", fy_end: "December" }, b));
    await waitFor(() => expect(first.result.current.months.quarter).toBe(9));
    const second = renderHook(() => useFiscalYearEnd(widget, { symbol: "AAPL", fy_end: "December" }, b));
    expect(second.result.current.months.quarter).toBe(9);
    expect(servers[0].requests.filter((r) => r.path === "/fiscal_year_end")).toHaveLength(1);
  });

  it("refetches when the templated symbol moves, and keeps its identity while nothing changes", async () => {
    const b = await serve();
    const { result, rerender } = renderHook(
      ({ symbol }: { symbol: string }) => useFiscalYearEnd(widget, { symbol, fy_end: "December" }, b),
      { initialProps: { symbol: "AAPL" } },
    );
    await waitFor(() => expect(result.current.months.quarter).toBe(9));
    // v5.4.0: `bare` asks the built-in lookup, whose 404 lands on its own
    // schedule and adds a reason — capture only once nothing is in flight.
    await waitFor(() => expect(result.current.pending).toBe(false));
    const before = result.current;
    rerender({ symbol: "AAPL" });
    expect(result.current).toBe(before);
    rerender({ symbol: "MSFT" });
    await waitFor(() => expect(result.current.months.quarter).toBe(6));
  });

  it("is empty for no widget", () => {
    const { result } = renderHook(() => useFiscalYearEnd(undefined, {}, undefined));
    expect(result.current).toEqual({ months: {}, reasons: {}, pending: false });
  });
});

describe("the built-in lookup (v5.4.0)", () => {
  const LOOKUP = "/api/v1/fundamentals/fiscal_year_end";

  function lookupFor(url: URL): unknown {
    switch (url.searchParams.get("symbol")) {
      case "AAPL":
        return { fiscalYearEnd: "September" };
      case "SLOW":
        return { fiscalYearEnd: "June", __delayMs: 300 };
      case "BOOM":
        return { __status: 500 };
      case "ODD":
        return { fiscalYearEnd: "Smarch" };
      default:
        return { __status: 404 };
    }
  }

  async function serveLookup(): Promise<{ b: BackendConfig; s: MockServer }> {
    const s = await startMockServer({
      [LOOKUP]: (url: URL) => lookupFor(url),
      "/fiscal_year_end": () => "March",
      // A declared endpoint held open, for the rulings on one in flight.
      "/slow_fiscal_year_end": () => ({ fiscalYearEnd: "March", __delayMs: 300 }),
    });
    servers.push(s);
    return { b: backend({ baseUrl: s.url }), s };
  }

  const lookups = (s: MockServer) => s.requests.filter((r) => r.path === LOOKUP).map((r) => r.search);

  const single: WidgetDef = makeWidget({
    id: "single",
    params: [
      { paramName: "symbol", type: "text" },
      { paramName: "q", type: "quarter" },
      { paramName: "asof", type: "date" },
      { paramName: "fixed", type: "quarter", fiscalYearEnd: 3 },
    ],
  });

  it("resolves every param that reaches it, asks upper-cased, and is pending while in flight", async () => {
    const { b, s } = await serveLookup();
    const { result } = renderHook(() => useFiscalYearEnd(single, { symbol: "aapl", q: "T", asof: "FQ0" }, b));
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.months).toEqual({ q: 9, asof: 9, fixed: 3 }));
    expect(result.current.pending).toBe(false);
    expect(result.current.reasons).toEqual({});
    expect(result.current.control).toEqual({ month: 9, source: "lookup", ticker: "AAPL" });
    expect(lookups(s)).toEqual(["?symbol=AAPL"]);
  });

  it("remembers a 404 for the session: December, a reason on each consulting param only, and no second request", async () => {
    const { b, s } = await serveLookup();
    const values = { symbol: "ZZZZ", q: "T", asof: "T-1d" };
    const first = renderHook(() => useFiscalYearEnd(single, values, b));
    await waitFor(() => expect(first.result.current.pending).toBe(false));
    expect(first.result.current.months).toEqual({ q: 12, asof: 12, fixed: 3 });
    expect(first.result.current.reasons).toEqual({ q: "Fiscal year end: no fiscal data for ZZZZ on this backend; using December" });
    expect(first.result.current.control).toEqual({ month: 12, source: "default" });
    const second = renderHook(() => useFiscalYearEnd(single, values, b));
    expect(second.result.current.pending).toBe(false);
    expect(second.result.current.reasons.q).toMatch(/ZZZZ/);
    expect(lookups(s)).toEqual(["?symbol=ZZZZ"]);
    expect(__read("logs/bdobb.log") ?? "").not.toContain("ZZZZ");
  });

  it("remembers an HTTP error and an unreadable answer the same way, logging each once", async () => {
    const { b } = await serveLookup();
    const boom = renderHook(() => useFiscalYearEnd(single, { symbol: "BOOM", q: "T" }, b));
    const odd = renderHook(() => useFiscalYearEnd(single, { symbol: "ODD", q: "T" }, b));
    await waitFor(() => {
      expect(boom.result.current.pending).toBe(false);
      expect(odd.result.current.pending).toBe(false);
    });
    expect(boom.result.current.reasons.q).toMatch(/BOOM/);
    expect(odd.result.current.reasons.q).toMatch(/ODD/);
    const log = __read("logs/bdobb.log") ?? "";
    expect(log).toContain("fiscal year end lookup failed for BOOM");
    expect(log).toContain("unusable fiscal year end");
  });

  it("asks nothing, and never waits, for two tickers, a comma list, no backend, or no consulting param", async () => {
    const { b, s } = await serveLookup();
    const two = makeWidget({ id: "two", params: [{ paramName: "symbol" }, { paramName: "peer", type: "ticker" }, { paramName: "q", type: "quarter" }] });
    const dates = makeWidget({ id: "dates", params: [{ paramName: "symbol" }, { paramName: "asof", type: "date" }] });
    const hooks = [
      renderHook(() => useFiscalYearEnd(two, { symbol: "AAPL", peer: "MSFT", q: "T" }, b)),
      renderHook(() => useFiscalYearEnd(single, { symbol: "AAPL,MSFT", q: "T" }, b)),
      renderHook(() => useFiscalYearEnd(single, { symbol: "AAPL", q: "T" }, undefined)),
      renderHook(() => useFiscalYearEnd(dates, { symbol: "AAPL", asof: "T-1d" }, b)),
    ];
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const h of hooks) {
      expect(h.result.current.pending).toBe(false);
      expect(h.result.current.reasons).toEqual({});
    }
    expect(hooks[0].result.current.months.q).toBe(12);
    expect(lookups(s)).toEqual([]);
  });

  it("lets the card override win over the whole chain, and consults nothing then", async () => {
    const { b, s } = await serveLookup();
    const { result } = renderHook(() => useFiscalYearEnd(single, { symbol: "AAPL", q: "T", asof: "FQ0" }, b, 6));
    expect(result.current.months).toEqual({ q: 6, asof: 6, fixed: 6 });
    expect(result.current.pending).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(lookups(s)).toEqual([]);
  });

  it("answers from the widget's own fields first; a widget endpoint in flight keeps the lookup out, and one that answered wins", async () => {
    const { b, s } = await serveLookup();
    const fixed = makeWidget({ id: "wf", fiscalYearEnd: 6, params: [{ paramName: "symbol" }, { paramName: "q", type: "quarter" }] });
    const asked = makeWidget({ id: "wa", fiscalYearEndEndpoint: "fiscal_year_end", params: [{ paramName: "symbol" }, { paramName: "q", type: "quarter" }] });
    const a = renderHook(() => useFiscalYearEnd(fixed, { symbol: "AAPL", q: "T" }, b));
    expect(a.result.current.months.q).toBe(6);
    expect(a.result.current.control).toEqual({ month: 6, source: "widget" });
    const e = renderHook(() => useFiscalYearEnd(asked, { symbol: "AAPL", q: "T" }, b));
    // In flight: December provisionally, no hold and no reason (controller ruling 2).
    expect(e.result.current.months.q).toBe(12);
    expect(e.result.current.pending).toBe(false);
    expect(e.result.current.reasons).toEqual({});
    await waitFor(() => expect(e.result.current.months.q).toBe(3));
    expect(e.result.current.control).toEqual({ month: 3, source: "widget" });
    expect(s.requests.filter((r) => r.path === "/fiscal_year_end").map((r) => r.search)).toEqual(["?symbol=AAPL"]);
    expect(lookups(s)).toEqual([]);
  });

  it("falls through a declared endpoint that failed, param or widget, to the lookup for a single ticker (spec §1.2)", async () => {
    const { b, s } = await serveLookup();
    const ownBroken = makeWidget({
      id: "ob",
      params: [
        { paramName: "symbol" },
        { paramName: "q", type: "quarter", fiscalYearEndEndpoint: "no_such_route", optionsParams: { symbol: "$symbol" } },
      ],
    });
    const widgetBroken = makeWidget({
      id: "wb",
      fiscalYearEndEndpoint: "no_such_route",
      params: [{ paramName: "symbol" }, { paramName: "q", type: "quarter" }],
    });
    const own = renderHook(() => useFiscalYearEnd(ownBroken, { symbol: "AAPL", q: "T" }, b));
    const wide = renderHook(() => useFiscalYearEnd(widgetBroken, { symbol: "AAPL", q: "T" }, b));
    await waitFor(() => {
      expect(own.result.current.months.q).toBe(9);
      expect(wide.result.current.months.q).toBe(9);
    });
    expect(own.result.current.control).toEqual({ month: 9, source: "lookup", ticker: "AAPL" });
    expect(wide.result.current.pending).toBe(false);
    // Both template the same endpoint with symbol=AAPL, so they share one request.
    expect(s.requests.filter((r) => r.path === "/no_such_route")).toHaveLength(1);
    expect(lookups(s)).toEqual(["?symbol=AAPL"]);
  });

  it("while a declared endpoint is in flight, shows the synchronous rungs past it — never the lookup, a hold or a reason", async () => {
    const { b, s } = await serveLookup();
    const slow = makeWidget({
      id: "slow",
      params: [
        { paramName: "symbol" },
        // The static month sits after the endpoint in the same field set.
        { paramName: "withStatic", type: "quarter", fiscalYearEndEndpoint: "slow_fiscal_year_end", optionsParams: { symbol: "$symbol" }, fiscalYearEnd: 4 },
        // Nothing synchronous after it: December, although AAPL's lookup would say September.
        { paramName: "bareEndpoint", type: "quarter", fiscalYearEndEndpoint: "slow_fiscal_year_end", optionsParams: { symbol: "$symbol" } },
      ],
    });
    const { result } = renderHook(() => useFiscalYearEnd(slow, { symbol: "AAPL", withStatic: "T", bareEndpoint: "T" }, b));
    const provisional = { months: { withStatic: 4, bareEndpoint: 12 }, reasons: {}, pending: false, control: { month: 4, source: "parameter" } };
    expect(result.current).toEqual(provisional);
    // The endpoint has been asked and is being held open: still provisional.
    await waitFor(() => expect(s.requests.some((r) => r.path === "/slow_fiscal_year_end")).toBe(true));
    expect(result.current).toEqual(provisional);
    await waitFor(() => expect(result.current.months).toEqual({ withStatic: 3, bareEndpoint: 3 }));
    expect(lookups(s)).toEqual([]);
  });

  it("shares one lookup between two cards", async () => {
    const { b, s } = await serveLookup();
    const one = renderHook(() => useFiscalYearEnd(single, { symbol: "SLOW", q: "T" }, b));
    const two = renderHook(() => useFiscalYearEnd(single, { symbol: "SLOW", q: "T" }, b));
    expect(one.result.current.pending).toBe(true);
    expect(two.result.current.pending).toBe(true);
    await waitFor(() => expect(two.result.current.months.q).toBe(6));
    expect(one.result.current.months.q).toBe(6);
    expect(lookups(s)).toEqual(["?symbol=SLOW"]);
  });
});

describe("fiscalYearEndSync", () => {
  beforeEach(() => __resetFiscalYearEndCacheForTests());
  const w = makeWidget({ id: "s", params: [{ paramName: "symbol", type: "text" }, { paramName: "quarter", type: "quarter" }, { paramName: "date", type: "date" }] });
  const be = backend({ id: "be", baseUrl: "http://127.0.0.1:1" });

  it("reads a primed lookup, falls back to December when nothing is cached, and lets the override win", () => {
    expect(fiscalYearEndSync(w, { symbol: "AAPL" }, be)).toEqual({ quarter: 12, date: 12 });
    __primeFiscalYearEndCachesForTests({ lookup: { "be\nhttp://127.0.0.1:1|AAPL": 9 } });
    expect(fiscalYearEndSync(w, { symbol: "AAPL" }, be)).toEqual({ quarter: 9, date: 9 });
    expect(fiscalYearEndSync(w, { symbol: "AAPL" }, be, 6)).toEqual({ quarter: 6, date: 6 });
  });

  it("reads a primed declared endpoint by its request key", () => {
    const e = makeWidget({ id: "e", params: [{ paramName: "symbol", type: "text" }, { paramName: "quarter", type: "quarter", fiscalYearEndEndpoint: "fye", optionsParams: { symbol: "$symbol" } }] });
    __primeFiscalYearEndCachesForTests({ endpoint: { "be\nhttp://127.0.0.1:1|fye?{\"symbol\":\"MSFT\"}": 6 } });
    expect(fiscalYearEndSync(e, { symbol: "MSFT" }, be)).toEqual({ quarter: 6 });
  });
});
