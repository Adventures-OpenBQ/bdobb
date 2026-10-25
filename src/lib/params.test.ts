// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";

import { __read, __reset } from "../test/memfs";
import { bundledCalendar, weekdayCalendar, type CalendarTrace } from "./calendar";
import { __resetLoggerForTests } from "./logger";
import {
  bindableKeys,
  bodyParams,
  controlKind,
  formFieldKey,
  formInputKind,
  formSubmitBody,
  paramsKey,
  queryParams,
  resolveParamValue,
  resolveSymbolOverride,
  seedParams,
  visibleParams,
  wireParams,
} from "./params";
import { effectiveParams, splitParamEdit } from "./paramGroups";
import type {
  DashboardCard,
  Settings,
  WidgetDef,
  WidgetForm,
  WidgetParam,
} from "./types";
import { card as makeCard, widget as makeWidget } from "../test/fixtures";

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
});

const AUG_23 = new Date(2026, 7, 23);

describe("resolveParamValue", () => {
  it("resolves the bare token to YYYY-MM-DD in local time", () => {
    expect(resolveParamValue("$currentDate", AUG_23)).toBe("2026-08-23");
  });

  it("resolves a suffixed token as an offset — $currentDate is an alias of T", () => {
    expect(resolveParamValue("$currentDate-7d", AUG_23)).toBe("2026-08-16");
    expect(resolveParamValue("$currentDate-1w", AUG_23)).toBe("2026-08-16");
  });

  it("leaves a bare T unchanged — AT&T's ticker is T, and this path does not know the param's type", () => {
    expect(resolveParamValue("T", AUG_23)).toBe("T");
  });

  it("leaves an ordinary value unchanged", () => {
    expect(resolveParamValue("AAPL", AUG_23)).toBe("AAPL");
  });

  it("pads single-digit months and days", () => {
    expect(resolveParamValue("$currentDate", new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("follows the wall clock, not UTC, on both sides of local midnight", () => {
    // Whatever the runner's zone, one of these two instants falls on a
    // different UTC calendar day than the local one; both must still read as
    // the day the person is looking at.
    expect(resolveParamValue("$currentDate", new Date(2026, 7, 23, 23, 30))).toBe("2026-08-23");
    expect(resolveParamValue("$currentDate", new Date(2026, 7, 23, 0, 30))).toBe("2026-08-23");
  });

  it("logs once per unparseable date token", async () => {
    resolveParamValue("$currentDate-7x", AUG_23);
    resolveParamValue("$currentDate-7x", AUG_23);
    resolveParamValue("$currentDate-30x", AUG_23);
    // Allow async logging to settle
    await new Promise((resolve) => setTimeout(resolve, 50));
    const log = __read("logs/bdobb.log") ?? "";
    const lines = log.trimEnd().split("\n").filter((l) => l.length > 0);
    // Exactly 2 lines: -7x once despite two calls, -30x once.
    expect(lines).toHaveLength(2);
    expect(log).toContain("unsupported date token, sent as-is: $currentDate-7x");
    expect(log).toContain("unsupported date token, sent as-is: $currentDate-30x");
  });
});

describe("controlKind", () => {
  const p = (over: Partial<WidgetParam>): WidgetParam => ({ paramName: "x", ...over });

  it("classifies inline options as a select", () => {
    expect(controlKind(p({ options: [{ label: "A", value: "a" }] }))).toBe("select");
  });

  it("classifies form and tabs as unsupported", () => {
    expect(controlKind(p({ type: "form" }))).toBe("unsupported");
    expect(controlKind(p({ type: "tabs" }))).toBe("unsupported");
  });

  it("classifies an optionsEndpoint param as endpoint, whatever its declared type", () => {
    // 21 params in the live manifest declare type "endpoint" AND an
    // optionsEndpoint; classifying by type first would strand them.
    expect(controlKind(p({ type: "endpoint", optionsEndpoint: "/choices" }))).toBe("endpoint");
    expect(controlKind(p({ optionsEndpoint: "/choices" }))).toBe("endpoint");
    expect(controlKind(p({ type: "date", optionsEndpoint: "/choices" }))).toBe("endpoint");
  });

  it("ignores static options on an endpoint param — the endpoint is authoritative", () => {
    expect(
      controlKind(p({ optionsEndpoint: "/choices", options: [{ label: "House", value: "house" }] })),
    ).toBe("endpoint");
  });

  it("classifies a multiSelect param with an endpoint as multi", () => {
    expect(controlKind(p({ multiSelect: true, optionsEndpoint: "/choices" }))).toBe("multi");
  });

  it("classifies a multiSelect param with only static options as multi", () => {
    expect(controlKind(p({ multiSelect: true, options: [{ label: "A", value: "a" }] }))).toBe(
      "multi",
    );
  });

  it("does not classify a multiSelect param with nothing to select from as multi", () => {
    expect(controlKind(p({ multiSelect: true, type: "text" }))).toBe("text");
    expect(controlKind(p({ multiSelect: true, options: [] }))).toBe("text");
  });

  it("classifies form and tabs as unsupported even when they declare an endpoint", () => {
    expect(controlKind(p({ type: "form", optionsEndpoint: "/choices" }))).toBe("unsupported");
  });

  it("classifies date, number and boolean by type", () => {
    expect(controlKind(p({ type: "date" }))).toBe("date");
    expect(controlKind(p({ type: "number" }))).toBe("number");
    expect(controlKind(p({ type: "boolean" }))).toBe("boolean");
  });

  it("falls back to text when no type is declared", () => {
    expect(controlKind(p({}))).toBe("text");
  });

  it("prefers inline options over a declared date type", () => {
    expect(controlKind(p({ type: "date", options: [{ label: "A", value: "a" }] }))).toBe("select");
  });

  it("logs once per unsupported form param type", async () => {
    controlKind(p({ type: "form" }));
    controlKind(p({ type: "form" }));
    // Allow async logging to settle
    await new Promise((resolve) => setTimeout(resolve, 50));
    const log = __read("logs/bdobb.log") ?? "";
    const lines = log.trimEnd().split("\n").filter((l) => l.length > 0);
    // Should have exactly 1 line despite calling twice with same type
    expect(lines).toHaveLength(1);
    expect(log).toContain("unsupported param type: form");
  });

  it("logs once per unsupported tabs param type", async () => {
    controlKind(p({ type: "tabs" }));
    controlKind(p({ type: "tabs" }));
    controlKind(p({ type: "form" }));
    // Allow async logging to settle
    await new Promise((resolve) => setTimeout(resolve, 50));
    const log = __read("logs/bdobb.log") ?? "";
    const lines = log.trimEnd().split("\n").filter((l) => l.length > 0);
    // Should have exactly 2 lines: one for tabs, one for form (once each)
    expect(lines).toHaveLength(2);
    expect(log).toContain("unsupported param type: tabs");
    expect(log).toContain("unsupported param type: form");
  });

  it("logs nothing for an optionsEndpoint param — the options are fetched now", async () => {
    controlKind(p({ type: "endpoint", optionsEndpoint: "/choices" }));
    controlKind(p({ optionsEndpoint: "/other" }));
    controlKind(p({ multiSelect: true, optionsEndpoint: "/third" }));
    // Allow async logging to settle
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(__read("logs/bdobb.log") ?? "").toBe("");
  });

  it("classifies each period type by its own kind, below any option list", () => {
    expect(controlKind(p({ type: "datetime" }))).toBe("datetime");
    expect(controlKind(p({ type: "date_range", rangeEnd: "end" }))).toBe("range");
    expect(controlKind(p({ type: "quarter" }))).toBe("quarter");
    expect(controlKind(p({ type: "fiscal_year" }))).toBe("fiscalYear");
    expect(controlKind(p({ type: "week" }))).toBe("week");
    expect(controlKind(p({ type: "time" }))).toBe("time");
    expect(controlKind(p({ type: "quarter", options: [{ label: "A", value: "a" }] }))).toBe("select");
  });

  it("reports a date_range with no rangeEnd unsupported, once in the log", async () => {
    expect(controlKind(p({ type: "date_range" }))).toBe("unsupported");
    controlKind(p({ type: "date_range" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lines = (__read("logs/bdobb.log") ?? "").trimEnd().split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("date_range param x declares no rangeEnd");
  });

  it("names a quarter_range with no rangeEnd by its own type in the log", async () => {
    expect(controlKind(p({ type: "quarter_range" }))).toBe("unsupported");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lines = (__read("logs/bdobb.log") ?? "").trimEnd().split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("quarter_range param x declares no rangeEnd");
  });
});

describe("visibleParams", () => {
  const widget: WidgetDef = makeWidget({
    id: "w1",
    category: "",
    gridData: { w: 1, h: 1 },
    params: [
      { paramName: "symbol", label: "Symbol", type: "text" },
      { paramName: "start", label: "Start", type: "date" },
      { paramName: "limit", label: "Limit", type: "number" },
      { paramName: "cache", label: "Use cache", type: "boolean" },
      { paramName: "period", label: "Period", options: [{ label: "Daily", value: "d" }] },
      { paramName: "provider", value: "fmp", show: false },
      { paramName: "layout", type: "form" },
    ],
  });

  it("hides show:false and unsupported types", () => {
    expect(visibleParams(widget).map((p) => p.paramName)).toEqual([
      "symbol",
      "start",
      "limit",
      "cache",
      "period",
    ]);
  });

  it("keeps endpoint and multi params visible", () => {
    const w: WidgetDef = {
      ...widget,
      params: [
        { paramName: "chamber", optionsEndpoint: "chambers" },
        { paramName: "ports", multiSelect: true, options: [{ label: "A", value: "a" }] },
        // Out of scope at this version, and show:false in the live manifest.
        { paramName: "file", roles: ["fileSelector"], optionsEndpoint: "files", show: false },
      ],
    };
    expect(visibleParams(w).map((p) => p.paramName)).toEqual(["chamber", "ports"]);
  });
});

describe("paramsKey", () => {
  it("is order-independent: the same entries in a different order produce the same key", () => {
    expect(paramsKey({ a: "1", b: "2" })).toBe(paramsKey({ b: "2", a: "1" }));
  });

  it("distinguishes a key being absent from present-but-empty", () => {
    expect(paramsKey({})).not.toBe(paramsKey({ a: "" }));
  });

  it("distinguishes genuinely different values", () => {
    expect(paramsKey({ a: "1" })).not.toBe(paramsKey({ a: "2" }));
    expect(paramsKey({ a: "1" })).not.toBe(paramsKey({ a: "1", b: "2" }));
  });

  it("does not let a value's own separators forge a collision with a different split across keys", () => {
    // If the key were built by naively joining "k:v" pairs, {a: "1,b:2"}
    // could collide with {a: "1", b: "2"}. JSON-encoding each piece rules
    // that out because the separator inside a JSON string is escaped.
    expect(paramsKey({ a: "1,b:2" })).not.toBe(paramsKey({ a: "1", b: "2" }));
  });

  it("produces the same key for two separately-built objects with identical content", () => {
    const one = { symbol: "AAPL", interval: "1d" };
    const two = { interval: "1d", symbol: "AAPL" };
    expect(paramsKey(one)).toBe(paramsKey(two));
    expect(one).not.toBe(two);
  });
});

describe("resolveSymbolOverride", () => {
  function widget(hasSymbolParam: boolean): WidgetDef {
    return makeWidget({
      id: "w1",
      category: "",
      gridData: { w: 1, h: 1 },
      params: hasSymbolParam ? [{ paramName: "symbol", type: "text" }] : [],
    });
  }

  function card(symbol: string): DashboardCard {
    return makeCard({
      id: crypto.randomUUID(),
      widgetId: "other",
      params: { symbol },
      layout: { x: 0, y: 0, w: 1, h: 1 },
    });
  }

  const settings = (over: Partial<Settings>): Settings => ({
    numberShortcutTarget: "dashboards",
    theme: "dark",
    fontSize: "medium",
    matchDashboardSymbol: false,
    maxDecimalPlaces: 2,
    minimizeButton: false,
    collapseWidgetControls: false,
    cornerDragHandles: false,
    quickAddToolbar: true,
    railWidth: 48,
    widgetGap: 10,
    ...over,
  });

  it("returns no override for a widget with no symbol param", () => {
    expect(
      resolveSymbolOverride(widget(false), [card("AAPL")], settings({ matchDashboardSymbol: true })),
    ).toEqual({});
  });

  it("returns no override when neither matching nor a default ticker is enabled", () => {
    expect(resolveSymbolOverride(widget(true), [card("AAPL")], settings({}))).toEqual({});
  });

  it("matches the most recently added sibling card's symbol when enabled", () => {
    const siblings = [card("AAPL"), card("MSFT")];
    expect(
      resolveSymbolOverride(widget(true), siblings, settings({ matchDashboardSymbol: true })),
    ).toEqual({ symbol: "MSFT" });
  });

  it("skips a sibling with no symbol param and matches the next one back", () => {
    const noSymbol: DashboardCard = { ...card("AAPL"), params: {} };
    const siblings = [card("AAPL"), noSymbol];
    expect(
      resolveSymbolOverride(widget(true), siblings, settings({ matchDashboardSymbol: true })),
    ).toEqual({ symbol: "AAPL" });
  });

  it("falls back to the default ticker when matching is enabled but no sibling carries a symbol", () => {
    expect(
      resolveSymbolOverride(
        widget(true),
        [],
        settings({ matchDashboardSymbol: true, defaultTicker: "TSLA" }),
      ),
    ).toEqual({ symbol: "TSLA" });
  });

  it("uses the default ticker when matching is disabled", () => {
    expect(
      resolveSymbolOverride(widget(true), [card("AAPL")], settings({ defaultTicker: "TSLA" })),
    ).toEqual({ symbol: "TSLA" });
  });

  it("prefers a matched sibling symbol over the default ticker", () => {
    expect(
      resolveSymbolOverride(
        widget(true),
        [card("AAPL")],
        settings({ matchDashboardSymbol: true, defaultTicker: "TSLA" }),
      ),
    ).toEqual({ symbol: "AAPL" });
  });
});

/**
 * Tabs and forms: what the card body renders, what the query string carries,
 * and how a form's fields reach a ParamGroup. The parser's own validation
 * lives in widgetsJson.test.ts -- these tests hand in already-parsed shapes.
 */
describe("tabs and form params", () => {
  const ORDER_FORM: WidgetForm = {
    endpoint: "orders/submit",
    inputs: [
      { paramName: "symbol", type: "text", label: "Symbol", value: "AAPL" },
      { paramName: "qty", type: "number", label: "Quantity", value: "10" },
      {
        paramName: "venues",
        type: "dropdown",
        label: "Venues",
        multiSelect: true,
        options: [
          { label: "NYSE", value: "nyse" },
          { label: "Nasdaq", value: "ndq" },
        ],
      },
      { paramName: "submit", type: "button", label: "Send" },
    ],
  };

  const TABS: WidgetParam = {
    paramName: "period",
    type: "tabs",
    value: "d",
    options: [
      { label: "Daily", value: "d" },
      { label: "Weekly", value: "w" },
    ],
  };

  function widget(params: WidgetParam[]): WidgetDef {
    return makeWidget({ id: "w1", category: "", gridData: { w: 1, h: 1 }, params });
  }

  const formParam = (over: Partial<WidgetParam> = {}): WidgetParam => ({
    paramName: "order",
    type: "form",
    form: ORDER_FORM,
    ...over,
  });

  it("classifies a tabs param with options as tabs, and one without as unsupported", () => {
    expect(controlKind(TABS)).toBe("tabs");
    expect(controlKind({ paramName: "period", type: "tabs" })).toBe("unsupported");
    expect(controlKind({ paramName: "period", type: "tabs", options: [] })).toBe("unsupported");
  });

  it("classifies a param carrying a parsed form as form", () => {
    expect(controlKind(formParam())).toBe("form");
    // The same param without the parsed contract is what it has always been.
    expect(controlKind({ paramName: "order", type: "form" })).toBe("unsupported");
  });

  it("keeps tabs and forms out of the parameter panel and lists them for the body", () => {
    const w = widget([TABS, formParam(), { paramName: "symbol", type: "text" }]);
    expect(visibleParams(w).map((p) => p.paramName)).toEqual(["symbol"]);
    expect(bodyParams(w, "tabs").map((p) => p.paramName)).toEqual(["period"]);
    expect(bodyParams(w, "form").map((p) => p.paramName)).toEqual(["order"]);
  });

  it("leaves a show:false tabs or form param out of the body too", () => {
    const w = widget([
      { ...TABS, show: false },
      formParam({ show: false }),
    ]);
    expect(bodyParams(w, "tabs")).toEqual([]);
    expect(bodyParams(w, "form")).toEqual([]);
  });

  it("seeds a form's field defaults under `${form}.${field}`, and the form itself not at all", () => {
    expect(seedParams(widget([TABS, formParam()]))).toEqual({
      period: "d",
      "order.symbol": "AAPL",
      "order.qty": "10",
    });
  });

  it("maps a form field's storage key to the name a group binds it by", () => {
    expect([...bindableKeys(widget([TABS, formParam()]))]).toEqual([
      ["period", "period"],
      ["order.symbol", "symbol"],
      ["order.qty", "qty"],
      ["order.venues", "venues"],
    ]);
  });

  it("keeps a form's entries off the widget's GET, and a tab's on it", () => {
    const w = widget([TABS, formParam()]);
    expect(
      queryParams(w, { period: "w", order: "x", "order.symbol": "AAPL", symbol: "MSFT" }),
    ).toEqual({ period: "w", symbol: "MSFT" });
  });

  it("returns the very same params object for a widget with no form", () => {
    // Identity, not just equality: WidgetCard's memo feeds this straight to
    // useWidgetData, and a fresh object every render would refetch forever.
    const params = { symbol: "AAPL" };
    expect(queryParams(widget([TABS]), params)).toBe(params);
  });

  it("maps a form field's declared type onto the control that renders it", () => {
    expect(formInputKind({ paramName: "a", type: "text" })).toBe("text");
    expect(formInputKind({ paramName: "a", type: "number" })).toBe("number");
    expect(formInputKind({ paramName: "a", type: "date" })).toBe("date");
    expect(
      formInputKind({ paramName: "a", type: "dropdown", options: [{ label: "A", value: "a" }] }),
    ).toBe("select");
    expect(
      formInputKind({
        paramName: "a",
        type: "dropdown",
        multiSelect: true,
        options: [{ label: "A", value: "a" }],
      }),
    ).toBe("multi");
  });

  it("builds the POST body under bare field names, typed as each field declares", () => {
    const button = ORDER_FORM.inputs[3];
    expect(
      formSubmitBody(
        "order",
        ORDER_FORM,
        { "order.symbol": "MSFT", "order.qty": "25", "order.venues": "nyse,ndq" },
        button,
      ),
    ).toEqual({ symbol: "MSFT", qty: 25, venues: ["nyse", "ndq"], submit: true });
  });

  it("refuses a field that cannot resolve, naming it, rather than POST its (MIC) or @ (R7a)", () => {
    const button = ORDER_FORM.inputs[3];
    const form: WidgetForm = { endpoint: "x", inputs: [{ paramName: "d", type: "date", label: "D" }, button] };
    expect(() => formSubmitBody("f", form, { "f.d": "T@14:00" }, button)).toThrow("d: @ needs a date-and-time parameter");
    expect(() => formSubmitBody("f", form, { "f.d": "T(XNYZ)" }, button)).toThrow("d: Unknown calendar XNYZ");
    expect(() => formSubmitBody("f", form, { "f.d": "EXP(XLON)" }, button)).toThrow("d: Cannot resolve EXP(XLON)");
  });

  it("refuses a qualified date field with no calendar loaded (RF5), and POSTs a literal or calendar-free value as before", () => {
    const button = ORDER_FORM.inputs[3];
    const form: WidgetForm = { endpoint: "x", inputs: [{ paramName: "d", type: "date", label: "D" }, button] };
    const wed = new Date("2026-09-16T12:00:00Z");
    // Ruling RF5: without XLON loaded this would step on plain weekdays, so it is refused rather than POSTed.
    expect(() => formSubmitBody("f", form, { "f.d": "T-1bd(XLON)" }, button, { now: wed })).toThrow("d: XLON calendar not loaded");
    expect(() => formSubmitBody("f", form, { "f.d": "T-1bd(XLON)" }, button, { now: wed, loading: ["XLON"] })).toThrow(
      "d: XLON calendar still loading",
    );
    expect(formSubmitBody("f", form, { "f.d": "2026-01-05" }, button, { now: wed })).toEqual({ d: "2026-01-05", submit: true });
    expect(formSubmitBody("f", form, { "f.d": "T-7d" }, button, { now: wed }).d).toMatch(/^2026-09-0[89]$/);
  });

  it("POSTs T-1bd(XLON) on London's loaded calendar, and an unqualified field on the card's (final review I-A)", () => {
    const button = ORDER_FORM.inputs[3];
    const form: WidgetForm = { endpoint: "x", inputs: [{ paramName: "d", type: "date", label: "D" }, button] };
    const london = { ...weekdayCalendar("XLON"), holidays: { "2026-08-31": { holiday: "Summer Bank Holiday", type: "Official" as const } }, years: [2026], source: "backend" as const };
    const now = new Date("2026-09-01T12:00:00Z");
    const calendars = { XLON: london };
    // Weekdays alone would give Monday 2026-08-31, London's closure.
    expect(formSubmitBody("f", form, { "f.d": "T-1bd(XLON)" }, button, { now, calendars })).toEqual({ d: "2026-08-28", submit: true });
    const card = makeWidget({ exchange: "XLON" });
    expect(formSubmitBody("f", form, { "f.d": "T-1bd" }, button, { now, calendars, widget: card })).toEqual({ d: "2026-08-28", submit: true });
    // RF5: London is loaded for 2026 only, so a step back into 2025 would run on weekdays; refused, naming the year.
    expect(() => formSubmitBody("f", form, { "f.d": "T-200bd(XLON)" }, button, { now, calendars })).toThrow("d: XLON 2025 calendar not loaded");
  });

  it("sends an empty number as null and an empty multiSelect as an empty list", () => {
    expect(formSubmitBody("order", ORDER_FORM, {}, ORDER_FORM.inputs[3])).toEqual({
      symbol: "",
      qty: null,
      venues: [],
      submit: true,
    });
  });

  it("sends a non-numeric number field as null, not NaN", () => {
    expect(
      formSubmitBody("order", ORDER_FORM, { "order.qty": "abc" }, ORDER_FORM.inputs[3]),
    ).toMatchObject({ qty: null });
  });

  it("resolves a field's date token, as the query path already does", () => {
    const form: WidgetForm = {
      endpoint: "e",
      inputs: [
        { paramName: "start", type: "date", value: "$currentDate" },
        { paramName: "go", type: "button", label: "Go" },
      ],
    };
    // The manifest default is the token; what the endpoint gets is a date.
    expect(formSubmitBody("f", form, { "f.start": "$currentDate" }, form.inputs[1], { now: AUG_23 })).toEqual(
      { start: "2026-08-23", go: true },
    );
  });

  it("resolves T on a field declared date, and leaves T alone on a text field", () => {
    const form: WidgetForm = {
      endpoint: "e",
      inputs: [
        { paramName: "start", type: "date", value: "T" },
        { paramName: "symbol", type: "text", value: "T" },
        { paramName: "go", type: "button", label: "Go" },
      ],
    };
    // T is "today" only where the field is a date; on a text field it is AT&T.
    expect(
      formSubmitBody("f", form, { "f.start": "T", "f.symbol": "T" }, form.inputs[2], { now: AUG_23 }),
    ).toEqual({ start: "2026-08-23", symbol: "T", go: true });
  });

  it("sends the pressed button's own value when it declares one", () => {
    const cancel = { paramName: "action", type: "button" as const, label: "Cancel", value: "cancel" };
    expect(formSubmitBody("order", { endpoint: "e", inputs: [cancel] }, {}, cancel)).toEqual({
      action: "cancel",
    });
  });

  it("lets a form field join a group named for the field, not for its storage key", () => {
    const w = widget([formParam()]);
    const card: DashboardCard = makeCard({
      id: "c1",
      widgetId: "w1",
      params: { "order.symbol": "AAPL" },
      layout: { x: 0, y: 0, w: 1, h: 1 },
      bindings: [{ groupId: "g1", paramName: "symbol" }],
    });
    const groups = [
      { id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "NVDA" },
    ];

    expect(effectiveParams(card, groups, w)["order.symbol"]).toBe("NVDA");
    // And an edit to that field moves the GROUP, not the card.
    expect(splitParamEdit({ "order.symbol": "MSFT" }, card, groups, w)).toEqual({
      cardParams: { "order.symbol": "AAPL" },
      groupEdits: [{ groupId: "g1", value: "MSFT" }],
    });
  });

  it("leaves an ungrouped form field on the card", () => {
    const w = widget([formParam()]);
    const card: DashboardCard = makeCard({
      id: "c1",
      widgetId: "w1",
      params: { "order.symbol": "AAPL" },
      layout: { x: 0, y: 0, w: 1, h: 1 },
    });
    expect(splitParamEdit({ "order.qty": "5" }, card, [], w)).toEqual({
      cardParams: { "order.symbol": "AAPL", "order.qty": "5" },
      groupEdits: [],
    });
  });

  it("names the storage key, not the field, for a form field", () => {
    expect(formFieldKey("order", "symbol")).toBe("order.symbol");
  });
});

describe("wireParams", () => {
  const NOW = new Date(2026, 8, 14, 9, 30, 15);
  const w = (params: WidgetParam[]): WidgetDef =>
    makeWidget({ id: "w1", category: "", gridData: { w: 1, h: 1 }, params });

  it("projects an expression per the param's type", () => {
    const widget = w([
      { paramName: "d", type: "date" },
      { paramName: "q", type: "quarter" },
      { paramName: "fy", type: "fiscal_year" },
      { paramName: "wk", type: "week" },
      { paramName: "t", type: "time" },
      { paramName: "at", type: "datetime" },
    ]);
    const out = wireParams(widget, { d: "T-1", q: "T", fy: "T", wk: "T", t: "T-15min", at: "T" }, { now: NOW });
    expect(out).toMatchObject({ d: "2026-09-13", q: "2026-Q3", fy: "2026", wk: "2026-W38", t: "09:15:15" });
    expect(out.at).toMatch(/^2026-09-14T09:30:15[+-]\d{2}:\d{2}$/);
  });

  it("labels a quarter and a fiscal year under the param's own year end", () => {
    const widget = w([{ paramName: "q", type: "quarter" }, { paramName: "fy", type: "fiscal_year" }]);
    expect(wireParams(widget, { q: "T", fy: "T" }, { now: NOW, fiscalYearEnd: { q: 9, fy: 6 } })).toEqual({
      q: "2026-Q4",
      fy: "2027",
    });
  });

  it("expands a date_range into its two keys and drops the composite", () => {
    const widget = w([{ paramName: "start_date", type: "date_range", rangeEnd: "end_date" }]);
    expect(wireParams(widget, { start_date: "2026-01-01/T" }, { now: NOW })).toEqual({
      start_date: "2026-01-01",
      end_date: "2026-09-14",
    });
    // Half a range is still sent as far as it goes.
    expect(wireParams(widget, { start_date: "2026-01-01" }, { now: NOW })).toEqual({
      start_date: "2026-01-01",
      end_date: "",
    });
  });

  // Controller ruling: a declared range's end always wins over a stale card
  // key that happens to share its name, regardless of which key came first
  // in the params object's insertion order.
  it("lets a declared range's expanded end win over a stale key of the same name, whichever came first", () => {
    const widget = w([{ paramName: "start_date", type: "date_range", rangeEnd: "end_date" }]);
    // The stale `end_date` is listed FIRST here -- insertion order must not
    // matter, since wireParams applies the range expansion after the loop.
    expect(
      wireParams(
        widget,
        { end_date: "1999-01-01", start_date: "2026-01-01/2026-02-01" },
        { now: NOW },
      ),
    ).toEqual({ start_date: "2026-01-01", end_date: "2026-02-01" });
  });

  it("treats an entry with no matching param as untyped -- a stale key, a form key -- which is today's behaviour: only $currentDate resolves, T stays a literal", () => {
    const widget = w([{ paramName: "symbol", type: "text" }]);
    expect(wireParams(widget, { symbol: "AAPL", "report.start": "$currentDate", gone: "T-1" }, { now: NOW })).toEqual({
      symbol: "AAPL",
      "report.start": "2026-09-14",
      gone: "T-1",
    });
    expect(wireParams(undefined, { start: "T" }, { now: NOW })).toEqual({ start: "T" });
  });

  // Controller ruling: T is only an anchor on a period-typed param. On a
  // text param -- or any other non-period type -- it is left alone, since it
  // is also a valid ticker (AT&T).
  it("leaves T a ticker on a non-period param", () => {
    const widget = w([{ paramName: "symbol", type: "text" }]);
    expect(wireParams(widget, { symbol: "T" }, { now: NOW }).symbol).toBe("T");
  });

  it("leaves literals alone", () => {
    const widget = w([{ paramName: "q", type: "quarter" }]);
    expect(wireParams(widget, { q: "2025-Q2" }, { now: NOW })).toEqual({ q: "2025-Q2" });
  });

  it("resolves a business-day expression on the param's exchange calendar, and records what it consulted", () => {
    // Friday 27 Nov 2026 at noon: one open day back over Thanksgiving is Wednesday the 25th.
    const friday = new Date(2026, 10, 27, 12, 0, 0);
    const widget = w([{ paramName: "d", type: "date" }, { paramName: "l", type: "date", exchange: "XLON" }]);
    const trace: Record<string, CalendarTrace> = {};
    const out = wireParams(widget, { d: "T-1bd", l: "T-1bd" }, { now: friday, calendars: { XNYS: bundledCalendar("XNYS")! }, trace });
    expect(out).toEqual({ d: "2026-11-25", l: "2026-11-26" });
    expect(trace.d.fallback).toBe(true);
    expect(trace.d.reason).toContain("bundled");
    expect(trace.l.fallback).toBe(true);
    expect(trace.l.reason).toBe("No trading calendar for XLON on this backend; weekdays only");
    expect([...trace.d.years]).toEqual([2026]);
  });

  it("uses the widget's exchange for a param that names none, and XNYS for neither", () => {
    const friday = new Date(2026, 10, 27, 12, 0, 0);
    const widget = w([{ paramName: "d", type: "date" }]);
    const trace: Record<string, CalendarTrace> = {};
    wireParams({ ...widget, exchange: "XETR" }, { d: "T-1bd" }, { now: friday, trace });
    expect(trace.d.reason).toContain("XETR");
    const bare: Record<string, CalendarTrace> = {};
    wireParams(widget, { d: "T-1bd" }, { now: friday, trace: bare });
    expect(bare.d.reason).toContain("XNYS");
  });

  it("records nothing for a literal, and no trace entry at all when none was asked for", () => {
    const widget = w([{ paramName: "d", type: "date" }]);
    const trace: Record<string, CalendarTrace> = {};
    wireParams(widget, { d: "2026-01-01" }, { now: NOW, trace });
    expect(trace.d.fallback).toBe(false);
    expect(trace.d.years.size).toBe(0);
    expect(wireParams(widget, { d: "T-1bd" }, { now: NOW })).toEqual({ d: expect.any(String) });
  });
});

describe("quarter_range on the wire (v5.4.0)", () => {
  it("splits into its own key and its rangeEnd, each a quarter label under the param's year end", () => {
    const w = makeWidget({ params: [{ paramName: "from_q", type: "quarter_range", rangeEnd: "to_q" }] });
    expect(wireParams(w, { from_q: "FQ-4/FQ0" }, { now: new Date(2026, 7, 26, 12), fiscalYearEnd: { from_q: 9 } })).toEqual({
      from_q: "2025-Q4",
      to_q: "2026-Q4",
    });
    expect(wireParams(w, { from_q: "2026-Q1/2026-Q4" })).toEqual({ from_q: "2026-Q1", to_q: "2026-Q4" });
  });

  it("is the quarterRange control with a rangeEnd, and unsupported without one", () => {
    expect(controlKind({ paramName: "q", type: "quarter_range", rangeEnd: "q_end" })).toBe("quarterRange");
    expect(controlKind({ paramName: "q", type: "quarter_range" })).toBe("unsupported");
  });
});

it("resolves on the dashboard's exchange after the param's and the widget's (v5.4.0)", () => {
  const w = makeWidget({ params: [{ paramName: "d", type: "date" }, { paramName: "l", type: "date", exchange: "XTSE" }] });
  const trace: Record<string, CalendarTrace> = {};
  wireParams(w, { d: "T-1bd", l: "T-1bd" }, { now: new Date(2026, 7, 26, 12), exchange: "XLON", trace });
  expect(trace.d.reason).toBe("No trading calendar for XLON on this backend; weekdays only");
  expect(trace.l.reason).toBe("No trading calendar for XTSE on this backend; weekdays only");
});

it("draws a multiple dropdown as a suggesting text field, multiSelect or not, and a bare multiple as text (v5.4.0)", () => {
  const options = [{ label: "A", value: "a" }];
  expect(controlKind({ paramName: "t", multiple: true, options })).toBe("suggest");
  expect(controlKind({ paramName: "t", multiple: true, multiSelect: true, options })).toBe("suggest");
  expect(controlKind({ paramName: "t", multiple: true, optionsEndpoint: "tags" })).toBe("suggest");
  expect(controlKind({ paramName: "t", multiple: true })).toBe("text");
});
