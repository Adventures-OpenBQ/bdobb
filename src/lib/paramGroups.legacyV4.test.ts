// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";

import {
  compatibleGroups,
  effectiveParams,
  groupedParamNames,
  groupFor,
  groupsForCard,
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

  it("is the type itself for every period type with no declaration", () => {
    for (const type of ["datetime", "date_range", "quarter", "fiscal_year", "week", "time"]) {
      expect(paramGroupType({ paramName: "p", type })).toBe(type);
    }
    expect(paramGroupType({ paramName: "p", type: "quarter", groupType: "fq" })).toBe("fq");
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

describe("a quarter group stores the December label, and each member reads its own", () => {
  const fiscalWidget: WidgetDef = makeWidget({
    id: "fw",
    category: "",
    gridData: { w: 1, h: 1 },
    params: [
      { paramName: "quarter", type: "quarter" },
      { paramName: "fy", type: "fiscal_year" },
      { paramName: "symbol" },
    ],
  });
  const member: DashboardCard = makeCard({
    id: "c-fiscal",
    widgetId: "fw",
    params: { quarter: "2020-Q1", fy: "2020", symbol: "AAPL" },
    layout: { x: 0, y: 0, w: 1, h: 1 },
    bindings: [
      { groupId: "g-q", paramName: "quarter" },
      { groupId: "g-fy", paramName: "fy" },
    ],
  });
  const fiscalGroups: ParamGroup[] = [
    { id: "g-q", name: "Quarter", paramName: "quarter", groupType: "quarter", value: "2026-Q3" },
    { id: "g-fy", name: "Year", paramName: "fy", groupType: "fiscal_year", value: "2026" },
  ];

  it("reads the group's calendar label relabelled under the member's year end", () => {
    // WMT (January): calendar Jul–Sep 2026 is its Q3 of FY2027; calendar 2026 is mostly its FY2027.
    expect(effectiveParams(member, fiscalGroups, fiscalWidget, false, { quarter: 1, fy: 1 })).toEqual({
      quarter: "2027-Q3",
      fy: "2027",
      symbol: "AAPL",
    });
  });

  it("reads the label verbatim for a December member, and with no map at all", () => {
    expect(effectiveParams(member, fiscalGroups, fiscalWidget, false, { quarter: 12 })).toMatchObject({ quarter: "2026-Q3" });
    expect(effectiveParams(member, fiscalGroups, fiscalWidget)).toMatchObject({ quarter: "2026-Q3", fy: "2026" });
  });

  it("writes an edit back to the group relabelled to December", () => {
    // AAPL (September) picks its FY2027-Q1 = Oct–Dec 2026 = calendar 2026-Q4.
    expect(splitParamEdit({ quarter: "2027-Q1" }, member, fiscalGroups, fiscalWidget, false, { quarter: 9 })).toEqual({
      cardParams: member.params,
      groupEdits: [{ groupId: "g-q", value: "2026-Q4" }],
    });
  });

  it("reports no edit when the relabelled value is what the group already holds", () => {
    // WMT's 2027-Q3 IS calendar 2026-Q3.
    expect(splitParamEdit({ quarter: "2027-Q3" }, member, fiscalGroups, fiscalWidget, false, { quarter: 1 }).groupEdits).toEqual([]);
  });

  it("stores an expression untouched, so every member projects it under its own year end", () => {
    expect(splitParamEdit({ quarter: "T-1q" }, member, fiscalGroups, fiscalWidget, false, { quarter: 9 }).groupEdits).toEqual([
      { groupId: "g-q", value: "T-1q" },
    ]);
    const expressionGroups = [{ ...fiscalGroups[0], value: "T-1q" }, fiscalGroups[1]];
    expect(effectiveParams(member, expressionGroups, fiscalWidget, false, { quarter: 9 })).toMatchObject({ quarter: "T-1q" });
  });
});

it("keys a quarter_range by its type, so it groups only with other quarter ranges (v5.4.0)", () => {
  expect(paramGroupType({ paramName: "span", type: "quarter_range" })).toBe("quarter_range");
});

describe("groupable: false (v5.4.0)", () => {
  it("never binds such a param, even with a saved binding, so the card keeps its own value", () => {
    const w = makeWidget({ id: "w1", params: [{ paramName: "symbol", type: "text", groupable: false }, { paramName: "interval" }] });
    const c = makeCard({ widgetId: "w1", params: { symbol: "AAPL" }, bindings: [{ groupId: "g1", paramName: "symbol" }] });
    const gs: ParamGroup[] = [{ id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "MSFT" }];
    expect([...groupedParamNames(c, gs, w)]).toEqual([]);
    expect(effectiveParams(c, gs, w).symbol).toBe("AAPL");
    expect(splitParamEdit({ symbol: "TSLA" }, c, gs, w)).toEqual({ cardParams: { symbol: "TSLA" }, groupEdits: [] });
  });
});
