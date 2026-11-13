// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";

import {
  compatibleGroups,
  effectiveParams,
  groupedParamNames,
  groupFor,
  groupsForCard,
  handBackValue,
  nextGroupName,
  paramGroupType,
  splitParamEdit,
} from "./paramGroups";
import type { DashboardCard, ParamGroup, WidgetDef } from "./types";
import { card as makeCard, widget as makeWidget } from "../test/fixtures";

const widget: WidgetDef = makeWidget({
  id: "w1",
  category: "",
  gridData: { w: 1, h: 1 },
  params: [{ paramName: "symbol" }, { paramName: "interval" }],
});

const card: DashboardCard = makeCard({
  id: "c1",
  widgetId: "w1",
  params: { symbol: "AAPL", interval: "1d" },
  layout: { x: 0, y: 0, w: 1, h: 1 },
  bindings: [
    { groupId: "g-symbol", paramName: "symbol" },
    { groupId: "g-ghost", paramName: "interval" },
    { groupId: "g-undeclared", paramName: "country" },
  ],
});

const groups: ParamGroup[] = [
  { id: "g-symbol", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "MSFT" },
  { id: "g-undeclared", name: "Country", paramName: "country", groupType: "country", value: "us" },
];

describe("groupsForCard", () => {
  it("drops group ids that no longer exist on the dashboard", () => {
    expect(groupsForCard(card, groups).map((g) => g.id)).toEqual(["g-symbol", "g-undeclared"]);
  });

  it("returns nothing for a card in no groups", () => {
    expect(groupsForCard({ ...card, bindings: undefined }, groups)).toEqual([]);
  });

  it("returns nothing when the dashboard has no groups at all", () => {
    expect(groupsForCard(card, undefined)).toEqual([]);
  });
});

describe("groupedParamNames", () => {
  it("keeps only group params the widget actually declares", () => {
    expect([...groupedParamNames(card, groups, widget)]).toEqual(["symbol"]);
  });
});

describe("effectiveParams", () => {
  it("lets the group value win over the card's own", () => {
    expect(effectiveParams(card, groups, widget)).toEqual({ symbol: "MSFT", interval: "1d" });
  });

  it("does not append a group param the widget never declared", () => {
    expect(effectiveParams(card, groups, widget)).not.toHaveProperty("country");
  });
});

describe("splitParamEdit", () => {
  it("routes a bound param to the group and the rest onto the card", () => {
    const result = splitParamEdit(
      { symbol: "TSLA", interval: "1h" },
      card,
      groups,
      widget,
    );
    expect(result.groupEdits).toEqual([{ groupId: "g-symbol", value: "TSLA" }]);
    expect(result.cardParams).toEqual({ symbol: "AAPL", interval: "1h" });
  });

  it("reports no group edit when the bound value did not move", () => {
    const result = splitParamEdit(
      { symbol: "MSFT", interval: "1h" },
      card,
      groups,
      widget,
    );
    expect(result.groupEdits).toEqual([]);
  });
});

describe("effectiveParams aliasing", () => {
  it("returns a fresh object, not card.params by reference, when no groups are bound", () => {
    const unboundCard: DashboardCard = { ...card, bindings: undefined };
    const result = effectiveParams(unboundCard, groups, widget);
    expect(result).not.toBe(unboundCard.params);
    expect(result).toEqual(unboundCard.params);
  });
});

describe("duplicate paramName across two bound groups", () => {
  // Card names two groups that both bind "symbol". The first binding in
  // card.bindings is the one that should win, everywhere.
  const dupCard: DashboardCard = {
    id: "c2",
    widgetId: "w1",
    backendId: "b1",
    params: { symbol: "AAPL", interval: "1d" },
    layout: { x: 0, y: 0, w: 1, h: 1 },
    bindings: [
      { groupId: "g-first", paramName: "symbol" },
      { groupId: "g-second", paramName: "symbol" },
    ],
  };

  const dupGroups: ParamGroup[] = [
    { id: "g-first", name: "First", paramName: "symbol", groupType: "symbol", value: "MSFT" },
    { id: "g-second", name: "Second", paramName: "symbol", groupType: "symbol", value: "GOOG" },
  ];

  it("effectiveParams and splitParamEdit agree on which group owns the duplicated paramName", () => {
    const params = effectiveParams(dupCard, dupGroups, widget);
    expect(params.symbol).toBe("MSFT");

    const result = splitParamEdit(
      { symbol: "TSLA", interval: "1d" },
      dupCard,
      dupGroups,
      widget,
    );
    expect(result.groupEdits).toEqual([{ groupId: "g-first", value: "TSLA" }]);
  });
});

describe("with grouping disabled on the dashboard", () => {
  it("effectiveParams returns the card's own params, ignoring the group's value", () => {
    expect(effectiveParams(card, groups, widget, true)).toEqual({
      symbol: "AAPL",
      interval: "1d",
    });
  });

  it("effectiveParams still returns a fresh object, not card.params itself", () => {
    const out = effectiveParams(card, groups, widget, true);
    expect(out).not.toBe(card.params);
  });

  it("groupedParamNames reports nothing bound, so no control is badged as grouped", () => {
    expect([...groupedParamNames(card, groups, widget, true)]).toEqual([]);
  });

  it("splitParamEdit writes a grouped param onto the CARD instead of the group", () => {
    // Without this, an edit made while grouping is off would be routed to the
    // group, masked on the very next render, and silently lost.
    expect(splitParamEdit({ symbol: "MSFT" }, card, groups, widget, true)).toEqual({
      cardParams: { symbol: "MSFT", interval: "1d" },
      groupEdits: [],
    });
  });

  it("leaves the groups array itself untouched — disabling is not deleting", () => {
    effectiveParams(card, groups, widget, true);
    splitParamEdit({ symbol: "MSFT" }, card, groups, widget, true);
    expect(groups).toEqual([
      { id: "g-symbol", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "MSFT" },
      { id: "g-undeclared", name: "Country", paramName: "country", groupType: "country", value: "us" },
    ]);
  });

  it("behaves exactly as before when the flag is absent", () => {
    expect(effectiveParams(card, groups, widget)).toEqual(
      effectiveParams(card, groups, widget, false),
    );
  });
});

describe("paramGroupType", () => {
  it("is the declared groupType when there is one", () => {
    expect(paramGroupType({ paramName: "ticker", groupType: "symbol" })).toBe("symbol");
  });
  it("is `date` for a date control with no declaration", () => {
    expect(paramGroupType({ paramName: "selected_date", type: "date" })).toBe("date");
  });
  it("is the paramName for everything else", () => {
    expect(paramGroupType({ paramName: "symbol", type: "text" })).toBe("symbol");
    expect(paramGroupType({ paramName: "year" })).toBe("year");
  });
});

describe("groupFor", () => {
  it("finds the group a card param is bound to", () => {
    expect(groupFor(card, groups, "symbol")?.id).toBe("g-symbol");
  });
  it("is undefined for an unbound param and for a binding whose group is gone", () => {
    expect(groupFor(card, groups, "interval")).toBeUndefined();
    expect(groupFor(card, groups, "nothing")).toBeUndefined();
  });
});

describe("a cross-name binding", () => {
  const echo: WidgetDef = makeWidget({
    id: "echo",
    category: "",
    gridData: { w: 1, h: 1 },
    params: [{ paramName: "ticker", groupType: "symbol" }],
  });
  const bound: DashboardCard = makeCard({
    id: "c2",
    widgetId: "echo",
    params: { ticker: "NVDA" },
    layout: { x: 0, y: 0, w: 1, h: 1 },
    bindings: [{ groupId: "g-symbol", paramName: "ticker" }],
  });
  it("reads the group value onto the card's own param name", () => {
    expect(effectiveParams(bound, groups, echo)).toEqual({ ticker: "MSFT" });
  });
  it("routes an edit of the card's param to the group", () => {
    expect(splitParamEdit({ ticker: "TSLA" }, bound, groups, echo)).toEqual({
      cardParams: { ticker: "NVDA" },
      groupEdits: [{ groupId: "g-symbol", value: "TSLA" }],
    });
  });
});

describe("compatibleGroups", () => {
  it("lists only the groups of the same type, in dashboard order", () => {
    const all: ParamGroup[] = [
      ...groups,
      { id: "g-sym2", name: "Symbol 2", paramName: "symbol", groupType: "symbol", value: "F" },
    ];
    expect(compatibleGroups(all, "symbol").map((g) => g.id)).toEqual(["g-symbol", "g-sym2"]);
    expect(compatibleGroups(undefined, "symbol")).toEqual([]);
  });
});

describe("nextGroupName", () => {
  it("is Group 1 on an empty dashboard and the first unused number otherwise", () => {
    expect(nextGroupName(undefined)).toBe("Group 1");
    const taken = (names: string[]): ParamGroup[] =>
      names.map((name, i) => ({ id: `g${i}`, name, paramName: "x", groupType: "x", value: "" }));
    expect(nextGroupName(taken(["Group 1", "Group 3"]))).toBe("Group 2");
    expect(nextGroupName(taken(["Ticker", "Group 1"]))).toBe("Group 2");
  });
});
it('reserved pivot names never bind, emit or edit ordinary endpoint params',()=>{
 const reserved='pivot:filter:cat';const declared=makeWidget({params:[{paramName:reserved},{paramName:'symbol'}]});const card=makeCard({params:{symbol:'AAPL',[reserved]:'raw'},bindings:[{paramName:reserved,groupId:'g'}]});const groups=[{id:'g',name:'G',paramName:reserved,groupType:'region',value:'A,B'}];
 expect(groupedParamNames(card,groups,declared)).toEqual(new Set());expect(effectiveParams(card,groups,declared)).toEqual({symbol:'AAPL'});expect(splitParamEdit({[reserved]:'new'},card,groups,declared).cardParams).toEqual(card.params);
});

describe("symbol lists (spec 2026-11-13 §3)", () => {
  const list: ParamGroup = { id: "g", name: "Watch", paramName: "symbol", groupType: "symbol", value: "AAPL,MSFT,NVDA" };
  const member = (params: WidgetDef["params"]) => makeWidget({ id: "m", params });
  const bound = makeCard({ id: "m1", widgetId: "m", params: { symbol: "TSLA" }, bindings: [{ groupId: "g", paramName: "symbol" }] });
  const single = member([{ paramName: "symbol" }]);
  const multi = member([{ paramName: "symbol", multiSelect: true }]);

  it("gives a multiSelect member the whole list and any other member the first entry", () => {
    expect(effectiveParams(bound, [list], multi).symbol).toBe("AAPL,MSFT,NVDA");
    expect(effectiveParams(bound, [list], single).symbol).toBe("AAPL");
  });

  it("reads the first non-blank entry, trimmed", () => {
    expect(effectiveParams(bound, [{ ...list, value: " , msft ,AAPL" }], single).symbol).toBe("msft");
  });

  it("passes a one-entry value through byte for byte", () => {
    expect(effectiveParams(bound, [{ ...list, value: " AAPL " }], single).symbol).toBe(" AAPL ");
  });

  it("leaves a comma value in a group of any other type whole", () => {
    const region: ParamGroup = { id: "g", name: "Region", paramName: "region", groupType: "region", value: "A,B" };
    const card = makeCard({ id: "m2", widgetId: "m", params: {}, bindings: [{ groupId: "g", paramName: "region" }] });
    expect(effectiveParams(card, [region], member([{ paramName: "region" }])).region).toBe("A,B");
  });

  it("judges a form field by its own multiSelect, under its <form>.<field> key", () => {
    const form = (fieldMulti: boolean) => member([{
      paramName: "report", type: "form",
      form: { endpoint: "e", inputs: [
        { paramName: "symbol", type: "dropdown", multiSelect: fieldMulti, options: [] },
        { paramName: "go", type: "button" },
      ] },
    }]);
    const card = makeCard({ id: "m3", widgetId: "m", params: { "report.symbol": "X" }, bindings: [{ groupId: "g", paramName: "symbol" }] });
    expect(effectiveParams(card, [list], form(true))["report.symbol"]).toBe("AAPL,MSFT,NVDA");
    expect(effectiveParams(card, [list], form(false))["report.symbol"]).toBe("AAPL");
  });

  it("does not write a single member's displayed first entry back over the list", () => {
    expect(splitParamEdit({ symbol: "AAPL" }, bound, [list], single).groupEdits).toEqual([]);
    expect(splitParamEdit({ symbol: "NVDA" }, bound, [list], single).groupEdits).toEqual([{ groupId: "g", value: "NVDA" }]);
  });

  it("writes a multiSelect member's edited list whole", () => {
    expect(splitParamEdit({ symbol: "AAPL,MSFT,NVDA" }, bound, [list], multi).groupEdits).toEqual([]);
    expect(splitParamEdit({ symbol: "AAPL,TSLA" }, bound, [list], multi).groupEdits).toEqual([{ groupId: "g", value: "AAPL,TSLA" }]);
  });
});

describe("handBackValue (user ruling U4, 2026-11-13)", () => {
  const list: ParamGroup = { id: "g", name: "Watch", paramName: "symbol", groupType: "symbol", value: "AAPL,MSFT" };

  it("hands a single-symbol member the first entry and a multiSelect member the whole list", () => {
    expect(handBackValue(list, makeWidget({ params: [{ paramName: "symbol" }] }), "symbol")).toBe("AAPL");
    expect(handBackValue(list, makeWidget({ params: [{ paramName: "symbol", multiSelect: true }] }), "symbol")).toBe("AAPL,MSFT");
  });

  it("judges a form field bound by its name through its own multiSelect", () => {
    const form = makeWidget({ params: [{ paramName: "report", type: "form", form: { endpoint: "e", inputs: [{ paramName: "symbol", type: "text", multiSelect: true }] } }] });
    expect(handBackValue(list, form, "symbol")).toBe("AAPL,MSFT");
  });

  it("hands back a one-entry value byte for byte, and the whole value when the widget is unknown", () => {
    expect(handBackValue({ ...list, value: " AAPL " }, makeWidget({ params: [{ paramName: "symbol" }] }), "symbol")).toBe(" AAPL ");
    expect(handBackValue(list, undefined, "symbol")).toBe("AAPL,MSFT");
  });
});
