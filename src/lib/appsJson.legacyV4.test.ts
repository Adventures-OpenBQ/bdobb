// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";

import {
  applyImportDecisions,
  type ExistingDashboard,
  keepBothName,
  type App,
  type AppLayoutItem,
  exportApp,
  importApps,
  isAppsJson,
  parseAppsJson,
  pinResolvedBackends,
  planAppsImport,
  UNRESOLVED_BACKEND_ID,
} from "./appsJson";
import { IMPORT_MAX_BYTES, IMPORT_MAX_DASHBOARDS } from "./importLimits";
import { card as baseCard, widget as baseWidget } from "../test/fixtures";
import type { Dashboard, WidgetDef } from "./types";

/**
 * `paramNames` is what the widget DECLARES. It matters because importApps
 * seeds a group's default only onto a member whose widget actually asked for
 * that param, so a test that expects seeding needs the param declared here.
 */
function widget(backendId: string, id: string, paramNames: string[] = ["symbol"]): WidgetDef {
  return baseWidget({
    id,
    backendId,
    name: id,
    params: paramNames.map((paramName) => ({ paramName })),
  });
}

const registry: WidgetDef[] = [widget("b1", "quote"), widget("b1", "prices")];

const dashboard: Dashboard = {
  id: "d1",
  name: "Macro",
  tabs: [
    {
      id: "t1",
      name: "Main",
      cards: [
        {
          id: "c1",
          widgetId: "quote",
          backendId: "b1",
          params: { symbol: "AAPL" },
          layout: { x: 0, y: 0, w: 20, h: 9 },
          bindings: [{ groupId: "g1", paramName: "symbol" }],
        },
        {
          id: "c2",
          widgetId: "prices",
          backendId: "b1",
          params: {},
          layout: { x: 20, y: 0, w: 20, h: 12 },
          view: "chart",
        },
      ],
    },
  ],
  groups: [{ id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "AAPL" }],
};

describe("exportApp", () => {
  it("produces exactly the documented app object", () => {
    expect(exportApp(dashboard)).toEqual({
      name: "Macro",
      description: "",
      img: "",
      img_dark: "",
      img_light: "",
      allowCustomization: true,
      tabs: {
        t1: {
          id: "t1",
          name: "Main",
          layout: [
            {
              i: "quote",
              x: 0,
              y: 0,
              w: 20,
              h: 9,
              groups: ["Ticker"],
              state: {
                params: { symbol: "AAPL" },
                chartView: { enabled: false, chartType: "line" },
              },
            },
            {
              i: "prices",
              x: 20,
              y: 0,
              w: 20,
              h: 12,
              state: { params: {}, chartView: { enabled: true, chartType: "line" } },
            },
          ],
        },
      },
      groups: [
        {
          name: "Ticker",
          type: "param",
          paramName: "symbol",
          defaultValue: "AAPL",
        },
      ],
      prompts: [],
    });
  });

  it("omits state entirely when the card has no params and is not charted", () => {
    const plain: Dashboard = {
      id: "d2",
      name: "Plain",
      tabs: [
        {
          id: "t1",
          name: "Main",
          cards: [
            {
              id: "c1",
              widgetId: "quote",
              backendId: "b1",
              params: {},
              layout: { x: 0, y: 0, w: 4, h: 4 },
            },
          ],
        },
      ],
    };
    expect(exportApp(plain).tabs.t1.layout[0]).toEqual({ i: "quote", x: 0, y: 0, w: 4, h: 4 });
    expect(exportApp(plain).groups).toEqual([]);
  });

  it("does not export a card's title override -- apps.json has no field for it", () => {
    const titled: Dashboard = {
      ...dashboard,
      tabs: [
        {
          ...dashboard.tabs[0],
          cards: [{ ...dashboard.tabs[0].cards[0], title: "AAPL daily" }],
        },
      ],
    };

    const item = exportApp(titled).tabs.t1.layout[0];

    expect(item).not.toHaveProperty("title");
    // Nowhere else either: `state` is the only other place a card's own data
    // reaches the app object, and it carries params and chartView only.
    expect(JSON.stringify(exportApp(titled))).not.toContain("AAPL daily");
  });

  it("keys tabs by tab id and carries every tab", () => {
    const two: Dashboard = {
      ...dashboard,
      tabs: [dashboard.tabs[0], { id: "t2", name: "Second", cards: [] }],
    };
    expect(Object.keys(exportApp(two).tabs)).toEqual(["t1", "t2"]);
  });

  it("writes state.transpose only for a transposed card", () => {
    const transposed: Dashboard = {
      ...dashboard,
      tabs: [
        {
          id: "t1",
          name: "Main",
          cards: [{ ...dashboard.tabs[0].cards[0], view: "transposed" }],
        },
      ],
    };
    const item = exportApp(transposed).tabs.t1.layout[0];
    expect(item.state).toEqual({
      params: { symbol: "AAPL" },
      chartView: { enabled: false, chartType: "line" },
      transpose: true,
    });
    // The documented shape is untouched for every other card.
    expect(exportApp(dashboard).tabs.t1.layout[0].state).not.toHaveProperty("transpose");
  });

  it("emits state for a transposed card even with no params", () => {
    const bare: Dashboard = {
      ...dashboard,
      tabs: [
        {
          id: "t1",
          name: "Main",
          cards: [{ ...dashboard.tabs[0].cards[0], params: {}, bindings: [], view: "transposed" }],
        },
      ],
      groups: [],
    };
    expect(exportApp(bare).tabs.t1.layout[0].state).toEqual({
      params: {},
      chartView: { enabled: false, chartType: "line" },
      transpose: true,
    });
  });
});

describe("importApps", () => {
  it("round-trips an exported app back into an equivalent dashboard", () => {
    const { dashboards, cards, unresolved } = importApps([exportApp(dashboard)], registry);

    expect(cards).toBe(2);
    expect(unresolved).toBe(0);
    expect(dashboards).toHaveLength(1);
    const d = dashboards[0];
    expect(d.name).toBe("Macro");
    expect(d.tabs).toHaveLength(1);
    expect(d.tabs[0].name).toBe("Main");
    expect(d.tabs[0].cards.map((c) => c.widgetId)).toEqual(["quote", "prices"]);
    expect(d.tabs[0].cards[0].backendId).toBe("b1");
    expect(d.tabs[0].cards[0].params).toEqual({ symbol: "AAPL" });
    expect(d.tabs[0].cards[0].layout).toEqual({ x: 0, y: 0, w: 20, h: 9 });
    expect(d.tabs[0].cards[1].view).toBe("chart");
    // Fresh ids everywhere — nothing from the file is reused as an id.
    expect(d.id).not.toBe("d1");
    expect(d.tabs[0].id).not.toBe("t1");
    expect(d.tabs[0].cards[0].id).not.toBe("c1");
  });

  // Two backends can serve one widget id; the first in the registry wins, as
  // it does everywhere else a card is resolved.
  it("resolves a card to the first backend serving its id", () => {
    const twice = [widget("b1", "quote"), widget("b2", "quote"), widget("b2", "prices")];
    const d = importApps([exportApp(dashboard)], twice).dashboards[0];
    expect(d.tabs[0].cards.map((c) => c.backendId)).toEqual(["b1", "b2"]);
  });

  // Workspace saves a multi-select as a list; dropping it sent the request
  // without the param (HTTP 422 on the reference backend's advanced dropdown).
  it("comma-joins a list param from the file", () => {
    const app = exportApp(dashboard);
    app.tabs.t1.layout[0].state = {
      params: { symbol: ["AAPL", "MSFT"] } as unknown as Record<string, string>,
      chartView: { enabled: false, chartType: "line" },
    };
    const d = importApps([app], registry).dashboards[0];
    expect(d.tabs[0].cards[0].params).toEqual({ symbol: "AAPL,MSFT" });
  });

  // A card added from the library opens with the widget's declared defaults;
  // an imported one did not, so a param the file left out was never sent.
  it("seeds the widget's declared defaults under the file's own params", () => {
    const served = baseWidget({
      id: "quote",
      backendId: "b1",
      name: "quote",
      params: [
        { paramName: "symbol", value: "TSLA" },
        { paramName: "text_box", value: "var1,var2" },
      ],
    });
    const app = exportApp(dashboard);
    const d = importApps([app], [served, widget("b1", "prices")]).dashboards[0];
    expect(d.tabs[0].cards[0].params).toEqual({ symbol: "AAPL", text_box: "var1,var2" });
  });

  it("lets a group's default win over the widget's own default", () => {
    const served = baseWidget({ id: "quote", backendId: "b1", name: "quote", params: [{ paramName: "symbol", value: "TSLA" }] });
    const app = exportApp(dashboard);
    app.groups[0].defaultValue = "MSFT";
    app.tabs.t1.layout[0].state = { params: {}, chartView: { enabled: false, chartType: "line" } };
    const d = importApps([app], [served, widget("b1", "prices")]).dashboards[0];
    expect(d.tabs[0].cards[0].params).toEqual({ symbol: "MSFT" });
  });

  it("maps a group onto its member cards and applies the default to a card with no value", () => {
    const app = exportApp(dashboard);
    app.groups[0].defaultValue = "MSFT";
    app.tabs.t1.layout[0].state = {
      params: {},
      chartView: { enabled: false, chartType: "line" },
    };

    const d = importApps([app], registry).dashboards[0];

    expect(d.groups).toHaveLength(1);
    const groupId = d.groups![0].id;
    expect(d.groups![0]).toEqual({
      id: groupId,
      name: "Ticker",
      paramName: "symbol",
      groupType: "symbol",
      value: "MSFT",
    });
    expect(d.tabs[0].cards[0].bindings).toEqual([{ groupId, paramName: "symbol" }]);
    expect(d.tabs[0].cards[0].params.symbol).toBe("MSFT");
  });

  it("does not overwrite a member card that arrived with its own value", () => {
    const app = exportApp(dashboard);
    app.groups[0].defaultValue = "MSFT";

    const d = importApps([app], registry).dashboards[0];

    expect(d.tabs[0].cards[0].params.symbol).toBe("AAPL");
  });

  it("treats an endpointParam group exactly like a param group", () => {
    const app = exportApp(dashboard);
    app.groups[0].type = "endpointParam";

    const d = importApps([app], registry).dashboards[0];

    expect(d.groups).toHaveLength(1);
    expect(d.groups![0].paramName).toBe("symbol");
  });

  it("gives an unknown widget id the unresolved sentinel and counts it", () => {
    const app = exportApp(dashboard);
    app.tabs.t1.layout[0].i = "nowhere";

    const { dashboards, cards, unresolved } = importApps([app], registry);

    expect(cards).toBe(2);
    expect(unresolved).toBe(1);
    expect(dashboards[0].tabs[0].cards[0].backendId).toBe(UNRESOLVED_BACKEND_ID);
    expect(dashboards[0].tabs[0].cards[1].backendId).toBe("b1");
  });

  it("resolves against the FIRST connected backend serving the id", () => {
    const d = importApps([exportApp(dashboard)], [widget("bZ", "quote"), widget("bA", "quote")])
      .dashboards[0];
    expect(d.tabs[0].cards[0].backendId).toBe("bZ");
  });

  it("dedupes repeated app names within one file", () => {
    const app = exportApp(dashboard);
    const { dashboards } = importApps([app, app, app], registry);
    expect(dashboards.map((d) => d.name)).toEqual(["Macro", "Macro (2)", "Macro (3)"]);
  });

  it("sizes a card from the served widget when the layout entry omits w and h", () => {
    const app = exportApp(dashboard);
    // A file written by hand, or by a tool that only recorded position.
    delete (app.tabs.t1.layout[0] as Partial<AppLayoutItem>).w;
    delete (app.tabs.t1.layout[0] as Partial<AppLayoutItem>).h;

    const sized = [{ ...widget("b1", "quote"), gridData: { w: 12, h: 6 } }, widget("b1", "prices")];
    const card = importApps([app], sized).dashboards[0].tabs[0].cards[0];

    expect(card.layout).toEqual({ x: 0, y: 0, w: 12, h: 6 });
  });

  it("falls back to 20x9 when nothing serves the id either", () => {
    const app = exportApp(dashboard);
    app.tabs.t1.layout[0].i = "nowhere";
    delete (app.tabs.t1.layout[0] as Partial<AppLayoutItem>).w;
    delete (app.tabs.t1.layout[0] as Partial<AppLayoutItem>).h;

    const card = importApps([app], registry).dashboards[0].tabs[0].cards[0];

    expect(card.layout).toEqual({ x: 0, y: 0, w: 20, h: 9 });
  });

  it("coerces numeric and boolean param values to strings and drops the rest", () => {
    const app = exportApp(dashboard);
    app.tabs.t1.layout[0].state = {
      params: { year: 2026 as unknown as string, live: true as unknown as string, bad: null as unknown as string },
      chartView: { enabled: false, chartType: "line" },
    };

    const card = importApps([app], registry).dashboards[0].tabs[0].cards[0];

    // `symbol` is the dashboard's group default, seeded because this card
    // carries no value of its own for it. The coercion under test is the
    // other three keys — strict equality still proves `bad: null` was dropped.
    expect(card.params).toEqual({ year: "2026", live: "true", symbol: "AAPL" });
  });

  it("falls back to a sane layout when x/y/w/h are missing", () => {
    const app = exportApp(dashboard);
    const item = app.tabs.t1.layout[0] as unknown as Record<string, unknown>;
    delete item.x;
    delete item.y;
    delete item.w;
    delete item.h;

    expect(importApps([app], registry).dashboards[0].tabs[0].cards[0].layout).toEqual({
      x: 0,
      y: 0,
      w: 20,
      h: 9,
    });
  });

  // A zero or negative size made a card the grid cannot draw or grab, and a
  // negative position put it off the grid's top or left edge.
  it("falls back the same way for a negative position and a zero or negative size", () => {
    const app = exportApp(dashboard);
    Object.assign(app.tabs.t1.layout[0], { x: -3, y: -1, w: 0, h: -4 });

    expect(importApps([app], registry).dashboards[0].tabs[0].cards[0].layout).toEqual({
      x: 0,
      y: 0,
      w: 20,
      h: 9,
    });
  });

  it("gives an app with no usable tabs one empty Main tab rather than none", () => {
    const d = importApps(
      [{ name: "Empty", description: "", img: "", img_dark: "", img_light: "", allowCustomization: true, tabs: {}, groups: [], prompts: [] }],
      registry,
    ).dashboards[0];
    expect(d.tabs).toEqual([{ id: d.tabs[0].id, name: "Main", cards: [] }]);
  });

  it.each([
    ["an object", { name: "x" }],
    ["a string", "nope"],
    ["null", null],
    ["an array of non-objects", ["nope"]],
    ["an app with no name", [{ tabs: {} }]],
    ["an app with no tabs object", [{ name: "x" }]],
  ])("throws on %s", (_label, input) => {
    expect(() => importApps(input, registry)).toThrow("not an apps.json file");
  });

  it("accepts an empty array as an empty import rather than an error", () => {
    expect(importApps([], registry)).toEqual({ dashboards: [], cards: 0, unresolved: 0, unresolvedIds: [] });
  });

  it("does not seed a member whose widget never declares the group's param", () => {
    const app = exportApp(dashboard);
    app.groups[0].defaultValue = "MSFT";
    app.tabs.t1.layout[0].state = {
      params: {},
      chartView: { enabled: false, chartType: "line" },
    };

    // The same quote widget, but declaring no params at all.
    const d = importApps([app], [widget("b1", "quote", []), widget("b1", "prices")]).dashboards[0];

    // Still a member — the group binds it, and groupedParamNames is what
    // decides at render time — but nothing was written onto the card.
    expect(d.tabs[0].cards[0].bindings).toEqual([{ groupId: d.groups![0].id, paramName: "symbol" }]);
    expect(d.tabs[0].cards[0].params).toEqual({});
  });

  it("still seeds an unresolved member card, which has no widget to ask yet", () => {
    const app = exportApp(dashboard);
    app.groups[0].defaultValue = "MSFT";
    app.groups[0].widgetIds = ["nowhere"];
    app.tabs.t1.layout[0].i = "nowhere";
    app.tabs.t1.layout[0].state = {
      params: {},
      chartView: { enabled: false, chartType: "line" },
    };

    const d = importApps([app], registry).dashboards[0];

    expect(d.tabs[0].cards[0].backendId).toBe(UNRESOLVED_BACKEND_ID);
    expect(d.tabs[0].cards[0].params.symbol).toBe("MSFT");
  });

  it("maps state.transpose back to a transposed view", () => {
    const app = exportApp(dashboard);
    app.tabs.t1.layout[0].state = {
      params: { symbol: "AAPL" },
      chartView: { enabled: false, chartType: "line" },
      transpose: true,
    };
    const { dashboards } = importApps([app], registry);
    expect(dashboards[0].tabs[0].cards[0].view).toBe("transposed");
  });

  it("lets chartView win when both chart and transpose are set, and ignores a non-true transpose", () => {
    const app = exportApp(dashboard);
    app.tabs.t1.layout[0].state = {
      params: {},
      chartView: { enabled: true, chartType: "line" },
      transpose: true,
    };
    app.tabs.t1.layout[1].state = {
      params: {},
      chartView: { enabled: false, chartType: "line" },
      transpose: "yes" as unknown as true,
    };
    const { dashboards } = importApps([app], registry);
    expect(dashboards[0].tabs[0].cards[0].view).toBe("chart");
    expect(dashboards[0].tabs[0].cards[1].view).toBeUndefined();
  });
});

describe("exportApp after importApps", () => {
  /**
   * The documented example shape, written out rather than derived from
   * exportApp — deriving it would let a bug in exportApp define the very
   * thing this test claims to pin.
   */
  const example: App = {
    name: "Example",
    description: "",
    img: "",
    img_dark: "",
    img_light: "",
    allowCustomization: true,
    tabs: {
      "tab-1": {
        id: "tab-1",
        name: "Overview",
        layout: [
          {
            i: "quote",
            x: 0,
            y: 0,
            w: 20,
            h: 9,
            groups: ["Ticker"],
            state: {
              params: { symbol: "AAPL" },
              chartView: { enabled: false, chartType: "line" },
            },
          },
          {
            i: "prices",
            x: 20,
            y: 0,
            w: 20,
            h: 12,
            groups: ["Ticker"],
            state: {
              params: { symbol: "AAPL" },
              chartView: { enabled: true, chartType: "line" },
            },
          },
        ],
      },
    },
    groups: [
      {
        name: "Ticker",
        type: "param",
        paramName: "symbol",
        defaultValue: "AAPL",
      },
    ],
    prompts: [],
  };

  /**
   * Tab ids are regenerated on import by design, so the key and the `id` are
   * the one thing that cannot survive a round trip. Everything else must.
   */
  function stripIds(app: App) {
    return {
      ...app,
      tabs: Object.values(app.tabs).map(({ id: _id, ...tab }) => tab),
    };
  }

  it("round-trips the documented app shape back to itself, modulo generated ids", () => {
    const imported = importApps([example], registry).dashboards[0];

    expect(stripIds(exportApp(imported))).toEqual(stripIds(example));
  });

  it("re-keys each tab by its own fresh id", () => {
    const imported = importApps([example], registry).dashboards[0];
    const app = exportApp(imported);

    expect(Object.keys(app.tabs)).toEqual([imported.tabs[0].id]);
    expect(app.tabs[imported.tabs[0].id].id).toBe(imported.tabs[0].id);
  });
});

describe("pinResolvedBackends", () => {
  const unresolvedDashboard: Dashboard = {
    id: "d1",
    name: "Macro",
    tabs: [
      {
        id: "t1",
        name: "Main",
        cards: [
          {
            id: "c1",
            widgetId: "quote",
            backendId: UNRESOLVED_BACKEND_ID,
            params: {},
            layout: { x: 0, y: 0, w: 20, h: 9 },
          },
          {
            id: "c2",
            widgetId: "nowhere",
            backendId: UNRESOLVED_BACKEND_ID,
            params: {},
            layout: { x: 20, y: 0, w: 20, h: 9 },
          },
        ],
      },
    ],
  };

  it("pins the backend now serving an unresolved card, leaving the rest alone", () => {
    const pinned = pinResolvedBackends(unresolvedDashboard, registry);

    expect(pinned.tabs[0].cards[0].backendId).toBe("b1");
    // Still unresolved: nothing serves it, so it keeps searching every backend.
    expect(pinned.tabs[0].cards[1].backendId).toBe(UNRESOLVED_BACKEND_ID);
  });

  it("pins the FIRST backend serving the id, which is what fixes it for good", () => {
    const pinned = pinResolvedBackends(unresolvedDashboard, [
      widget("bZ", "quote"),
      widget("bA", "quote"),
    ]);
    expect(pinned.tabs[0].cards[0].backendId).toBe("bZ");
  });

  it("returns the same object when there is nothing to pin", () => {
    // Identity, not just equality: this runs on every layout drag-release,
    // and a fresh object would re-render every card on the tab for nothing.
    expect(pinResolvedBackends(dashboard, registry)).toBe(dashboard);
    expect(pinResolvedBackends(unresolvedDashboard, [])).toBe(unresolvedDashboard);
  });
});

describe("isAppsJson", () => {
  it("accepts an array of apps", () => {
    expect(isAppsJson([{ name: "A", tabs: {} }])).toBe(true);
  });

  it.each([
    ["an array of data rows", [{ a: 1 }, { a: 2 }]],
    ["an empty array", []],
    ["an object", { name: "A", tabs: {} }],
    ["an app with no name", [{ tabs: {} }]],
    ["an app whose tabs is a list", [{ name: "A", tabs: [] }]],
    ["a scalar", 3],
    ["null", null],
  ])("rejects %s, so a drop treats it as data", (_label, value) => {
    expect(isAppsJson(value)).toBe(false);
  });

  it("agrees with importApps on shape: what it rejects, importApps throws on", () => {
    expect(() => importApps([{ a: 1 }], [])).toThrow("not an apps.json file");
    // The empty array is the deliberate exception: not an import to sniff
    // for, but still an empty import when the rail's picker hands it over.
    expect(importApps([], [])).toEqual({ dashboards: [], cards: 0, unresolved: 0, unresolvedIds: [] });
  });
});

/** An apps.json holding one empty app per name, in order. */
const appsFile = (...names: string[]) =>
  JSON.stringify(names.map((name) => ({ name, tabs: { t1: { id: "t1", name: "Main", layout: [] } } })));

const mine = (id: string, name: string, tabCount = 2): ExistingDashboard => ({
  id,
  name,
  tabs: Array.from({ length: tabCount }, (_, i) => ({ id: `${id}-t${i + 1}`, name: `Tab ${i + 1}`, cards: [] })),
});

function ready(text: string, existing: ExistingDashboard[]) {
  const plan = planAppsImport(text, text.length, [], existing);
  if (!plan.ok) throw new Error(plan.refusal);
  return plan;
}

describe("planAppsImport", () => {
  it("reports no conflict when every name is new", () => {
    const plan = ready(appsFile("Imported"), [mine("d1", "Main")]);

    expect(plan.dashboards.map((d) => d.name)).toEqual(["Imported"]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.existingNames).toEqual(["Main"]);
  });

  it("reports an exact match with the existing id and both sides' counts", () => {
    const plan = ready(appsFile("Macro"), [mine("d1", "Macro")]);

    expect(plan.conflicts).toEqual([
      {
        imported: plan.dashboards[0],
        existingIds: ["d1"],
        yours: { tabs: 2, cards: 0 },
        incoming: { tabs: 1, cards: 0 },
      },
    ]);
  });

  it("matches case-sensitively", () => {
    expect(ready(appsFile("Macro"), [mine("d1", "macro")]).conflicts).toEqual([]);
  });

  it("names every existing owner when two of yours share the name", () => {
    const plan = ready(appsFile("Macro"), [mine("d1", "Macro", 3), mine("d2", "Macro", 1)]);

    expect(plan.conflicts[0].existingIds).toEqual(["d1", "d2"]);
    expect(plan.conflicts[0].yours).toEqual({ tabs: 3, cards: 0 });
  });

  it("suffixes a name repeated inside the file without asking about it", () => {
    const plan = ready(appsFile("Macro", "Macro"), [mine("d1", "Macro")]);

    expect(plan.dashboards.map((d) => d.name)).toEqual(["Macro", "Macro (2)"]);
    expect(plan.conflicts.map((c) => c.imported.name)).toEqual(["Macro"]);
  });

  it("treats an in-file suffix that matches an existing name as a conflict", () => {
    const plan = ready(appsFile("Macro", "Macro"), [mine("d2", "Macro (2)")]);

    expect(plan.conflicts.map((c) => c.imported.name)).toEqual(["Macro (2)"]);
    expect(plan.conflicts[0].existingIds).toEqual(["d2"]);
  });

  it("refuses an oversize file before it parses anything", () => {
    const plan = planAppsImport("not json at all", IMPORT_MAX_BYTES + 1, [], [mine("d1", "Main")]);

    expect(plan).toEqual({ ok: false, refusal: "File is 10.1 MB; the limit is 10 MB." });
  });

  it("refuses too many dashboards before reporting any conflict", () => {
    const text = appsFile(...Array.from({ length: 501 }, () => "Main"));

    expect(planAppsImport(text, text.length, [], [mine("d1", "Main")])).toEqual({
      ok: false,
      refusal: "File holds 501 dashboards; the limit is 500.",
    });
  });

  it("throws for a file that is not an apps.json, exactly as importApps does", () => {
    expect(() => planAppsImport("[{\"a\":1}]", 10, [], [])).toThrow("not an apps.json file");
  });
});

describe("groupType and cross-name bindings", () => {
  const echo = baseWidget({
    id: "param_echo",
    backendId: "builtin",
    params: [{ paramName: "ticker", type: "text", groupType: "symbol" }],
  });
  const quoteWidget = baseWidget({ id: "quote", backendId: "b1", params: [{ paramName: "symbol" }] });

  it("exports groupType only when it differs from paramName, and groupBindings only for a differing param", () => {
    const dashboard: Dashboard = {
      id: "d1",
      name: "Dash",
      groups: [
        { id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "AAPL" },
        { id: "g2", name: "Dates", paramName: "selected_date", groupType: "date", value: "2026-01-01" },
      ],
      tabs: [
        {
          id: "t1",
          name: "Main",
          cards: [
            baseCard({ id: "c1", widgetId: "quote", params: {}, bindings: [{ groupId: "g1", paramName: "symbol" }] }),
            baseCard({
              id: "c2",
              widgetId: "param_echo",
              params: {},
              bindings: [{ groupId: "g1", paramName: "ticker" }],
            }),
          ],
        },
      ],
    };
    const app = exportApp(dashboard);
    expect(app.groups).toEqual([
      { name: "Ticker", type: "param", paramName: "symbol", defaultValue: "AAPL" },
      { name: "Dates", type: "param", paramName: "selected_date", defaultValue: "2026-01-01", groupType: "date" },
    ]);
    const [c1, c2] = app.tabs.t1.layout;
    expect(c1.groups).toEqual(["Ticker"]);
    expect(c1).not.toHaveProperty("groupBindings");
    expect(c2.groups).toEqual(["Ticker"]);
    expect(c2.groupBindings).toEqual([{ group: "Ticker", paramName: "ticker" }]);
  });

  it("imports groupType from the file, else the first resolvable member's inferred type, else paramName", () => {
    const raw = {
      name: "App",
      groups: [
        { name: "Ticker", type: "param", paramName: "symbol", defaultValue: "AAPL" },
        { name: "Dates", type: "param", paramName: "selected_date", defaultValue: "2026-01-01" },
        { name: "Typed", type: "param", paramName: "x", defaultValue: "1", groupType: "custom" },
      ],
      tabs: {
        t1: {
          id: "t1",
          name: "Main",
          layout: [
            { i: "quote", x: 0, y: 0, w: 1, h: 1, groups: ["Ticker"] },
            { i: "param_echo", x: 0, y: 1, w: 1, h: 1, groups: ["Ticker"], groupBindings: [{ group: "Ticker", paramName: "ticker" }] },
            { i: "datepick", x: 0, y: 2, w: 1, h: 1, groups: ["Dates", "Typed"] },
          ],
        },
      },
    };
    const datepick = baseWidget({
      id: "datepick",
      backendId: "b1",
      params: [{ paramName: "selected_date", type: "date" }, { paramName: "x" }],
    });
    const { dashboards } = importApps([raw], [quoteWidget, echo, datepick]);
    const [d] = dashboards;
    expect(d.groups!.map((g) => [g.name, g.groupType])).toEqual([
      ["Ticker", "symbol"],
      ["Dates", "date"],
      ["Typed", "custom"],
    ]);
    const cards = d.tabs[0].cards;
    const idOf = (name: string) => d.groups!.find((g) => g.name === name)!.id;
    expect(cards[0].bindings).toEqual([{ groupId: idOf("Ticker"), paramName: "symbol" }]);
    expect(cards[1].bindings).toEqual([{ groupId: idOf("Ticker"), paramName: "ticker" }]);
    expect(cards[1].params.ticker).toBe("AAPL");
    expect(cards[2].bindings).toEqual([
      { groupId: idOf("Dates"), paramName: "selected_date" },
      { groupId: idOf("Typed"), paramName: "x" },
    ]);
  });
});

describe("parseAppsJson", () => {
  const app = { name: "Macro", tabs: { t1: { id: "t1", name: "Main", layout: [] } } };

  it("returns the apps of a well-formed payload with no issue", () => {
    const result = parseAppsJson([app], "Local");
    expect(result.apps).toEqual([app]);
    expect(result.issue).toBeUndefined();
  });

  // What a backend serving no apps.json produces: fetchAppsJson resolves
  // null on its 404, and that is "no apps", not a problem to report.
  it("treats a null payload as no apps and no issue", () => {
    expect(parseAppsJson(null, "Local")).toEqual({ apps: [] });
  });

  it("treats an empty array as no apps and no issue", () => {
    expect(parseAppsJson([], "Local")).toEqual({ apps: [] });
  });

  it("reports one issue naming the backend when the payload is not a list of apps", () => {
    const result = parseAppsJson({ oops: "not-an-apps-json" }, "Local");
    expect(result.apps).toEqual([]);
    expect(result.issue?.reason).toContain("Local");
  });

  // The reason line is shown and logged; a backend's payload can hold
  // anything, so none of it is ever quoted back.
  it("never quotes the payload in the issue", () => {
    const result = parseAppsJson({ secret: "s3cret-value" }, "Local");
    expect(JSON.stringify(result.issue)).not.toContain("s3cret-value");
  });

  it("reports an issue for an entry that is not an app", () => {
    const result = parseAppsJson([app, "nope"], "Local");
    expect(result.apps).toEqual([]);
    expect(result.issue).toBeDefined();
  });

  it("refuses a payload holding more apps than the import limit", () => {
    const many = Array.from({ length: IMPORT_MAX_DASHBOARDS + 1 }, (_, i) => ({
      ...app,
      name: `Macro ${i}`,
    }));
    const result = parseAppsJson(many, "Local");
    expect(result.apps).toEqual([]);
    expect(result.issue?.reason).toContain(String(IMPORT_MAX_DASHBOARDS));
  });

  it("refuses a payload larger than the import byte limit", () => {
    const huge = [{ ...app, description: "x".repeat(IMPORT_MAX_BYTES + 1) }];
    const result = parseAppsJson(huge, "Local");
    expect(result.apps).toEqual([]);
    expect(result.issue?.reason).toContain("MB");
  });

  // The response's own Content-Length when it declared one. It may only
  // TIGHTEN the ceiling: a response that announces more than the limit is
  // refused on that alone, without the parsed document being re-serialized.
  it("refuses a payload whose declared size is over the byte limit", () => {
    const result = parseAppsJson([app], "Local", IMPORT_MAX_BYTES + 1);
    expect(result.apps).toEqual([]);
    expect(result.issue?.reason).toContain("MB");
  });

  it("accepts a payload that is within the limit by both measures", () => {
    const result = parseAppsJson([app], "Local", 128);
    expect(result.apps).toEqual([app]);
    expect(result.issue).toBeUndefined();
  });

  // The direction that matters. A Content-Length is the size on the WIRE, so
  // a gzipped (or simply lying) response can declare far less than the
  // document actually is -- and a declared 0 is the extreme of it. The
  // measured size still has to fit, so the header can never wave one
  // through.
  it("still refuses an oversized payload when the declared size is zero", () => {
    const huge = [{ ...app, description: "x".repeat(IMPORT_MAX_BYTES + 1) }];
    const result = parseAppsJson(huge, "Local", 0);
    expect(result.apps).toEqual([]);
    expect(result.issue?.reason).toContain("MB");
  });

  // The count ceiling lives on the same call as the measured size, so a
  // small declared size must not skip it either.
  it("still refuses too many apps when the declared size is small", () => {
    const many = Array.from({ length: IMPORT_MAX_DASHBOARDS + 1 }, (_, i) => ({
      ...app,
      name: `Macro ${i}`,
    }));
    const result = parseAppsJson(many, "Local", 1);
    expect(result.issue?.reason).toContain(String(IMPORT_MAX_DASHBOARDS));
  });
});

describe("group membership on the layout entry", () => {
  it("joins a card to the groups its own layout entry names", () => {
    const app = {
      name: "Ref",
      tabs: {
        t1: {
          id: "t1",
          name: "Grouping",
          layout: [
            { i: "quote", x: 0, y: 0, w: 20, h: 9, groups: ["Group 1"] },
            { i: "prices", x: 20, y: 0, w: 20, h: 9, groups: ["Group 1"] },
          ],
        },
      },
      groups: [
        { name: "Group 1", type: "endpointParam", paramName: "symbol", defaultValue: "AAPL" },
      ],
    };
    const result = importApps([app], registry);
    const dashboard = result.dashboards[0];
    expect(dashboard.groups).toHaveLength(1);
    const groupId = dashboard.groups![0].id;
    const cards = dashboard.tabs[0].cards;
    expect(cards[0].bindings?.some((b) => b.groupId === groupId)).toBe(true);
    expect(cards[1].bindings?.some((b) => b.groupId === groupId)).toBe(true);
    expect(dashboard.groups![0].paramName).toBe("symbol");
    expect(dashboard.groups![0].value).toBe("AAPL");
  });

  it("still honours widgetIds, so a file written the other way still imports", () => {
    // Three assertions in this file already exercise widgetIds, and a file in
    // the wild may use it. Membership is the union of both sources.
    const app = {
      name: "Ref",
      tabs: { t1: { id: "t1", name: "T", layout: [{ i: "quote", x: 0, y: 0, w: 20, h: 9 }] } },
      groups: [
        { name: "G", type: "param", paramName: "symbol", defaultValue: "AAPL", widgetIds: ["quote"] },
      ],
    };
    const result = importApps([app], registry);
    expect(result.dashboards[0].groups).toHaveLength(1);
  });

  it("writes membership onto the layout entry on export, not onto the group", () => {
    // A round trip through Workspace has to carry the grouping, and Workspace
    // reads it from the entry.
    const app = {
      name: "Ref",
      tabs: {
        t1: {
          id: "t1",
          name: "T",
          layout: [{ i: "quote", x: 0, y: 0, w: 20, h: 9, groups: ["G"] }],
        },
      },
      groups: [{ name: "G", type: "param", paramName: "symbol", defaultValue: "AAPL" }],
    };
    const imported = importApps([app], registry).dashboards[0];
    const exported = exportApp(imported);
    const entry = Object.values(exported.tabs)[0].layout[0];
    expect(entry.groups).toEqual(["G"]);
    expect(exported.groups[0].widgetIds).toBeUndefined();
    expect(exported.groups[0].paramName).toBe("symbol");
  });

  it("round-trips grouping through export and back", () => {
    const app = {
      name: "Ref",
      tabs: {
        t1: {
          id: "t1",
          name: "T",
          layout: [
            { i: "quote", x: 0, y: 0, w: 20, h: 9, groups: ["G"] },
            { i: "prices", x: 20, y: 0, w: 20, h: 9, groups: ["G"] },
          ],
        },
      },
      groups: [{ name: "G", type: "param", paramName: "symbol", defaultValue: "AAPL" }],
    };
    const once = importApps([app], registry).dashboards[0];
    const twice = importApps([exportApp(once)], registry).dashboards[0];
    expect(twice.groups).toHaveLength(1);
    expect(twice.tabs[0].cards.every((c) => c.bindings?.length === 1)).toBe(true);
  });

  it("de-duplicates group names within an app on export", () => {
    // Membership is by name now, so two groups called the same thing would be
    // ambiguous on the way back in.
    const twoGroups: Dashboard = {
      id: "d1",
      name: "D",
      tabs: [{ id: "t1", name: "T", cards: [] }],
      groups: [
        { id: "g1", name: "G", paramName: "a", groupType: "a", value: "1" },
        { id: "g2", name: "G", paramName: "b", groupType: "b", value: "2" },
      ],
    };
    const exported = exportApp(twoGroups);
    expect(exported.groups.map((g) => g.name)).toEqual(["G", "G (2)"]);
  });
});

describe("applyImportDecisions", () => {
  it("adds every dashboard as-is when nothing conflicts", () => {
    const plan = ready(appsFile("A", "B"), [mine("d1", "Main")]);

    expect(applyImportDecisions(plan, [])).toEqual({
      added: plan.dashboards,
      replaced: [],
      skipped: 0,
    });
  });

  it("treats a conflict with no decision as a skip", () => {
    const plan = ready(appsFile("Macro"), [mine("d1", "Macro")]);

    expect(applyImportDecisions(plan, [])).toEqual({ added: [], replaced: [], skipped: 1 });
  });

  it("Replace pairs the existing id with the file's dashboard", () => {
    const plan = ready(appsFile("Macro"), [mine("d1", "Macro")]);

    expect(applyImportDecisions(plan, ["replace"])).toEqual({
      added: [],
      replaced: [{ id: "d1", dashboard: plan.dashboards[0] }],
      skipped: 0,
    });
  });

  it("Keep both adds it under the first unused name", () => {
    const plan = ready(appsFile("Macro"), [mine("d1", "Macro"), mine("d2", "Macro (2)")]);

    const { added } = applyImportDecisions(plan, ["keep"]);

    expect(added.map((d) => d.name)).toEqual(["Macro (3)"]);
    expect(added[0].id).toBe(plan.dashboards[0].id);
  });

  it("Skip imports nothing and counts it", () => {
    const plan = ready(appsFile("Macro"), [mine("d1", "Macro")]);

    expect(applyImportDecisions(plan, ["skip"])).toEqual({ added: [], replaced: [], skipped: 1 });
  });

  it("handles a mixed file in file order", () => {
    const plan = ready(appsFile("Macro", "New", "Rates", "Fx"), [
      mine("d1", "Macro"),
      mine("d2", "Rates"),
      mine("d3", "Fx"),
    ]);

    const result = applyImportDecisions(plan, ["keep", "skip", "replace"]);

    expect(result.added.map((d) => d.name)).toEqual(["Macro (2)", "New"]);
    expect(result.replaced).toEqual([{ id: "d3", dashboard: plan.dashboards[3] }]);
    expect(result.skipped).toBe(1);
  });

  it("skips past a name this same import already assigned", () => {
    // "Macro (2)" is the file's own second Macro, added as-is, so Keep both
    // on the first one must not take it.
    const plan = ready(appsFile("Macro", "Macro"), [mine("d1", "Macro")]);

    const { added } = applyImportDecisions(plan, ["keep"]);

    expect(added.map((d) => d.name)).toEqual(["Macro (3)", "Macro (2)"]);
  });

  it("refuses a Replace the dialog would have disabled", () => {
    const plan = ready(appsFile("Macro"), [mine("d1", "Macro"), mine("d2", "Macro")]);

    expect(() => applyImportDecisions(plan, ["replace"])).toThrow();
  });
});

describe("keepBothName", () => {
  it("is the name applyImportDecisions gives, given the answers before it", () => {
    const plan = ready(appsFile("Macro", "Macro (3)"), [
      mine("d1", "Macro"),
      mine("d2", "Macro (2)"),
      mine("d3", "Macro (3)"),
    ]);

    expect(keepBothName(plan, [], 0)).toBe("Macro (4)");
    expect(keepBothName(plan, ["keep"], 1)).toBe("Macro (3) (2)");
    const { added } = applyImportDecisions(plan, ["keep", "keep"]);
    expect(added.map((d) => d.name)).toEqual(["Macro (4)", "Macro (3) (2)"]);
  });
});

describe("groupType and cross-name bindings", () => {
  const echo = baseWidget({
    id: "param_echo",
    backendId: "builtin",
    params: [{ paramName: "ticker", type: "text", groupType: "symbol" }],
  });
  const quoteWidget = baseWidget({ id: "quote", backendId: "b1", params: [{ paramName: "symbol" }] });

  it("exports groupType only when it differs from paramName, and groupBindings only for a differing param", () => {
    const dashboard: Dashboard = {
      id: "d1",
      name: "Dash",
      groups: [
        { id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "AAPL" },
        { id: "g2", name: "Dates", paramName: "selected_date", groupType: "date", value: "2026-01-01" },
      ],
      tabs: [
        {
          id: "t1",
          name: "Main",
          cards: [
            baseCard({ id: "c1", widgetId: "quote", params: {}, bindings: [{ groupId: "g1", paramName: "symbol" }] }),
            baseCard({
              id: "c2",
              widgetId: "param_echo",
              params: {},
              bindings: [{ groupId: "g1", paramName: "ticker" }],
            }),
          ],
        },
      ],
    };
    const app = exportApp(dashboard);
    expect(app.groups).toEqual([
      { name: "Ticker", type: "param", paramName: "symbol", defaultValue: "AAPL" },
      { name: "Dates", type: "param", paramName: "selected_date", defaultValue: "2026-01-01", groupType: "date" },
    ]);
    const [c1, c2] = app.tabs.t1.layout;
    expect(c1.groups).toEqual(["Ticker"]);
    expect(c1).not.toHaveProperty("groupBindings");
    expect(c2.groups).toEqual(["Ticker"]);
    expect(c2.groupBindings).toEqual([{ group: "Ticker", paramName: "ticker" }]);
  });

  it("imports groupType from the file, else the first resolvable member's inferred type, else paramName", () => {
    const raw = {
      name: "App",
      groups: [
        { name: "Ticker", type: "param", paramName: "symbol", defaultValue: "AAPL" },
        { name: "Dates", type: "param", paramName: "selected_date", defaultValue: "2026-01-01" },
        { name: "Typed", type: "param", paramName: "x", defaultValue: "1", groupType: "custom" },
      ],
      tabs: {
        t1: {
          id: "t1",
          name: "Main",
          layout: [
            { i: "quote", x: 0, y: 0, w: 1, h: 1, groups: ["Ticker"] },
            { i: "param_echo", x: 0, y: 1, w: 1, h: 1, groups: ["Ticker"], groupBindings: [{ group: "Ticker", paramName: "ticker" }] },
            { i: "datepick", x: 0, y: 2, w: 1, h: 1, groups: ["Dates", "Typed"] },
          ],
        },
      },
    };
    const datepick = baseWidget({
      id: "datepick",
      backendId: "b1",
      params: [{ paramName: "selected_date", type: "date" }, { paramName: "x" }],
    });
    const { dashboards } = importApps([raw], [quoteWidget, echo, datepick]);
    const [d] = dashboards;
    expect(d.groups!.map((g) => [g.name, g.groupType])).toEqual([
      ["Ticker", "symbol"],
      ["Dates", "date"],
      ["Typed", "custom"],
    ]);
    const cards = d.tabs[0].cards;
    const idOf = (name: string) => d.groups!.find((g) => g.name === name)!.id;
    expect(cards[0].bindings).toEqual([{ groupId: idOf("Ticker"), paramName: "symbol" }]);
    expect(cards[1].bindings).toEqual([{ groupId: idOf("Ticker"), paramName: "ticker" }]);
    expect(cards[1].params.ticker).toBe("AAPL");
    expect(cards[2].bindings).toEqual([
      { groupId: idOf("Dates"), paramName: "selected_date" },
      { groupId: idOf("Typed"), paramName: "x" },
    ]);
  });
});

describe("presets in apps.json", () => {
  it("exports a dashboard's presets as an extra field, omitted when there are none, and imports them back", () => {
    const withPresets: Dashboard = { ...dashboard, presets: [{ name: "Two weeks", expr: "T-2w" }] };
    const app = exportApp(withPresets);
    expect(app.presets).toEqual([{ name: "Two weeks", expr: "T-2w" }]);
    expect(exportApp(dashboard)).not.toHaveProperty("presets");
    const back = importApps([app], []).dashboards[0];
    expect(back.presets).toEqual([{ name: "Two weeks", expr: "T-2w" }]);
    const lenient = importApps([{ ...app, presets: [{ name: "ok", expr: "T" }, { name: "" }] }], []).dashboards[0];
    expect(lenient.presets).toEqual([{ name: "ok", expr: "T" }]);
    expect(importApps([{ ...app, presets: [] }], []).dashboards[0]).not.toHaveProperty("presets");
  });
});

describe("the exchange and the FY ends override in apps.json (v5.4.0)", () => {
  it("exports both as extra fields, omitted when unset, and imports them back leniently", () => {
    const withBoth: Dashboard = {
      ...dashboard,
      exchange: "XLON",
      tabs: dashboard.tabs.map((t, i) => (i === 0 ? { ...t, cards: t.cards.map((c, j) => (j === 0 ? { ...c, fiscalYearEnd: 6 } : c)) } : t)),
    };
    const app = exportApp(withBoth);
    expect(app.exchange).toBe("XLON");
    expect(Object.values(app.tabs)[0].layout[0].fiscalYearEnd).toBe(6);
    const plain = exportApp(dashboard);
    expect(plain).not.toHaveProperty("exchange");
    expect(Object.values(plain.tabs)[0].layout[0]).not.toHaveProperty("fiscalYearEnd");

    const back = importApps([app], []).dashboards[0];
    expect(back.exchange).toBe("XLON");
    expect(back.tabs[0].cards[0].fiscalYearEnd).toBe(6);

    const odd = structuredClone(app);
    odd.exchange = "US";
    Object.values(odd.tabs)[0].layout[0].fiscalYearEnd = 13;
    const lenient = importApps([odd], []).dashboards[0];
    // 2026-10-24: a name outside the catalogue is kept for repair (review focus 4), not dropped.
    expect(lenient.exchange).toBe("US");
    expect(lenient.tabs[0].cards[0]).not.toHaveProperty("fiscalYearEnd");
  });
});
