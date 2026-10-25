// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { UNRESOLVED_BACKEND_ID, exportCompatibleApp, importApps } from "./appsJson";
import { decodeV3CardExtension } from "./appsExtensionsV3";
import { BUILTIN_WIDGETS, LOCAL_TABLE_ID } from "./builtins";
import { isRecord } from "./isRecord";
import type { Dashboard, SyncStore } from "./types";
import { fromWorkspace, toWorkspace } from "./workspaceDashboards";
import { card as makeCard, widget } from "../test/fixtures";

type Rec = Record<string, unknown>;
const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "src/test/workspace-fama-french.json"), "utf8"));
const famaFrench = (): Rec => structuredClone(fixture.owned["aaaaaaaa-0000-4000-8000-000000000002"].content);
const app = (): Rec => structuredClone(fixture.apps.owned["aaaaaaaa-0000-4000-8000-000000000003"].content);
const FACTORS = "famafrench_factors_famafrench_obb";
const body = (content: Rec, store: SyncStore = "dashboard") => (store === "dashboard" ? content.data : content) as Rec;
const widgetsOf = (content: Rec, store: SyncStore = "dashboard") => body(content, store).widgets as Rec[];

/** The widgets array's order carries nothing (grid entries join by id), so round trips compare it sorted. */
function normalize(content: Rec, store: SyncStore = "dashboard"): Rec {
  const b = body(content, store);
  const sorted = { ...b, widgets: [...(b.widgets as Rec[])].sort((x, y) => String(x.id).localeCompare(String(y.id))) };
  return store === "dashboard" ? { ...content, data: sorted } : sorted;
}
const gridOf = (content: Rec) => body(content).gridLayout as Record<string, Rec[]>;

describe("fromWorkspace", () => {
  it("makes one tab per gridLayout key, named and ordered by the tab strip, and one card per widget", () => {
    const d = fromWorkspace(famaFrench(), "dashboard", []);
    expect(d.name).toBe("Fama-French Research Data");
    expect(d.tabs.map((t) => t.name)).toEqual(["Factors", "Portfolios"]);
    expect(d.tabs.map((t) => t.cards.map((c) => c.widgetId))).toEqual([
      [FACTORS, "famafrench_breakpoints_famafrench_obb"],
      ["famafrench_us_portfolio_returns_famafrench_obb"],
    ]);
  });

  it("takes params from storage.params by the importer's rules, layout from the grid entry, and fresh ids", () => {
    const [first] = fromWorkspace(famaFrench(), "dashboard", []).tabs[0].cards;
    expect(first.params).toEqual({ region: "america", factor: "3_factors", frequency: "monthly", provider: "famafrench" });
    expect(first.layout).toEqual({ x: 0, y: 2, w: 40, h: 18 });
    expect(first.backendId).toBe(UNRESOLVED_BACKEND_ID);
    expect(first.id).not.toMatch(/^bbbbbbbb-/);
    expect(first.extensions?.workspace?.widget.id).toBe("bbbbbbbb-0000-4000-8000-000000000001");
  });

  it("resolves the backend as importApps does", () => {
    const [first] = fromWorkspace(famaFrench(), "dashboard", [widget({ id: FACTORS, backendId: "nas" })]).tabs[0].cards;
    expect(first.backendId).toBe("nas");
  });

  it("turns an enabled storage.chartView into the chart view", () => {
    const content = famaFrench();
    ((widgetsOf(content)[0].storage as Rec).chartView as Rec).enabled = true;
    expect(fromWorkspace(content, "dashboard", []).tabs[0].cards[0].view).toBe("chart");
  });

  it("names a tab by its key when there is no tab strip", () => {
    const content = famaFrench();
    (content.data as Rec).widgets = widgetsOf(content).filter((w) => w.widgetId !== "navigation_bar");
    expect(fromWorkspace(content, "dashboard", []).tabs.map((t) => t.name)).toEqual(["factors", "portfolios"]);
  });

  it("reads an app's content the same way", () => {
    const d = fromWorkspace(app(), "app", []);
    expect(d.name).toBe("Fama-French App");
    expect(d.tabs.map((t) => [t.name, t.cards.length])).toEqual([["factors", 2]]);
  });

  it("restores BDOBB's own card state from extensions.bdobb, and refuses an invalid one", () => {
    const content = famaFrench();
    widgetsOf(content)[0].extensions = { bdobb: { schemaVersion: 1, profile: "v3", title: "Mine", minimized: true } };
    expect(fromWorkspace(content, "dashboard", []).tabs[0].cards[0]).toMatchObject({ title: "Mine", minimized: true });
    widgetsOf(content)[0].extensions = { bdobb: { schemaVersion: 1, profile: "v3", view: "pivot" } };
    expect(() => fromWorkspace(content, "dashboard", [])).toThrow();
  });

  it("throws on content it cannot read", () => {
    expect(() => fromWorkspace({ data: { name: "x" } }, "dashboard", [])).toThrow();
    expect(() => fromWorkspace("nope", "app", [])).toThrow();
  });
});

describe("toWorkspace round trip", () => {
  it("returns a downloaded dashboard unchanged", () => {
    const content = famaFrench();
    expect(normalize(toWorkspace(fromWorkspace(content, "dashboard", []), "dashboard"))).toEqual(normalize(famaFrench()));
  });

  it("returns it unchanged when the registry seeds params the server never stored", () => {
    const registry = [widget({ id: FACTORS, params: [{ paramName: "region", value: "america" }, { paramName: "extra", value: "x" }] })];
    const d = fromWorkspace(famaFrench(), "dashboard", registry);
    expect(d.tabs[0].cards[0].params.extra).toBe("x");
    expect(normalize(toWorkspace(d, "dashboard"))).toEqual(normalize(famaFrench()));
  });

  it("returns a downloaded app unchanged", () => {
    expect(normalize(toWorkspace(fromWorkspace(app(), "app", []), "app"), "app")).toEqual(normalize(app(), "app"));
  });

  it("writes back an edited param and keeps the server's untouched values", () => {
    const d = fromWorkspace(famaFrench(), "dashboard", []);
    const c = d.tabs[0].cards[0];
    c.params = { ...c.params, region: "europe" };
    const params = (widgetsOf(toWorkspace(d, "dashboard"))[0].storage as Rec).params as Rec;
    expect(params).toMatchObject({ region: "europe", start_date: null, end_date: null });
  });

  it("writes back a moved card's position and keeps its grid extras", () => {
    const d = fromWorkspace(famaFrench(), "dashboard", []);
    d.tabs[0].cards[0].layout = { x: 4, y: 6, w: 20, h: 10 };
    const entry = gridOf(toWorkspace(d, "dashboard")).factors[1];
    expect(entry).toEqual({ i: "bbbbbbbb-0000-4000-8000-000000000001", x: 4, y: 6, w: 20, h: 10, minW: 8, minH: 4, moved: false, static: false });
  });

  it("writes the chart view into storage.chartView, keeping its other fields", () => {
    const d = fromWorkspace(famaFrench(), "dashboard", []);
    d.tabs[0].cards[0].view = "chart";
    expect((widgetsOf(toWorkspace(d, "dashboard"))[0].storage as Rec).chartView).toEqual({ enabled: true, chartType: "line", chartSettingsOpen: false });
  });

  it("regenerates the tab strip from renamed and added tabs, and drops a removed card", () => {
    const d = fromWorkspace(famaFrench(), "dashboard", []);
    d.tabs[0].name = "Factor data";
    d.tabs[1].cards = [];
    d.tabs.push({ id: "t-new", name: "New", cards: [] });
    const out = toWorkspace(d, "dashboard");
    const nav = widgetsOf(out).find((w) => w.widgetId === "navigation_bar") as Rec;
    expect((nav.storage as Rec).tabs).toEqual([{ id: "factors", name: "Factor data" }, { id: "portfolios", name: "Portfolios" }, { id: "t-new", name: "New" }]);
    expect(gridOf(out)["t-new"]).toEqual([expect.objectContaining({ i: nav.id, w: 40, h: 2 })]);
    expect(widgetsOf(out).some((w) => w.widgetId === "famafrench_us_portfolio_returns_famafrench_obb")).toBe(false);
  });

  it("builds a new dashboard item for a BDOBB-made dashboard, with no tab strip for one tab", () => {
    const d: Dashboard = { id: "d1", name: "Mine", tabs: [{ id: "t1", name: "Main", cards: [makeCard({ id: "c1", widgetId: "note", backendId: "builtin", params: { text: "hi" } })] }] };
    const out = toWorkspace(d, "dashboard", { index: "ffffffff-0000-4000-8000-000000000001", parentId: "root-index" });
    expect(out).toMatchObject({ index: "ffffffff-0000-4000-8000-000000000001", isFolder: false, parentId: "root-index", data: { name: "Mine", groups: [], currentTab: "t1" } });
    const [w] = widgetsOf(out);
    expect(w).toMatchObject({ widgetId: "note", innerTab: "t1", storage: { params: { text: "hi" } } });
    expect(gridOf(out).t1).toEqual([{ i: w.id, x: 0, y: 0, w: 20, h: 9 }]);
  });

  it("places a dashboard that still carries a server shell by the NEW item, not the old one", () => {
    const d = fromWorkspace(famaFrench(), "dashboard", []);
    const out = toWorkspace(d, "dashboard", { index: "ffffffff-0000-4000-8000-000000000009", parentId: "new-root" });
    expect(out).toMatchObject({ index: "ffffffff-0000-4000-8000-000000000009", parentId: "new-root", data: { name: "Fama-French Research Data" } });
    // Without a new item the shell's own place stands (a linked upload).
    expect(toWorkspace(d, "dashboard")).toMatchObject({ index: "aaaaaaaa-0000-4000-8000-000000000002", parentId: "aaaaaaaa-0000-4000-8000-000000000001" });
  });

  it("never uploads a local table's file", () => {
    const d: Dashboard = { id: "d1", name: "Mine", tabs: [{ id: "t1", name: "Main", cards: [makeCard({ widgetId: LOCAL_TABLE_ID, backendId: "builtin", params: { file: "mine.csv", sheet: "1" } })] }] };
    expect((widgetsOf(toWorkspace(d, "dashboard"))[0].storage as Rec).params).toEqual({ sheet: "1" });
  });

  it("uses a BDOBB-made card's own id as its widget id, so the next download can match it", () => {
    const d: Dashboard = { id: "d1", name: "Mine", tabs: [{ id: "t1", name: "Main", cards: [makeCard({ id: "card-1", widgetId: "note", backendId: "builtin" }), makeCard({ id: "card-1", widgetId: "note", backendId: "builtin" })] }] };
    const ids = widgetsOf(toWorkspace(d, "dashboard")).map((w) => w.id);
    expect(ids[0]).toBe("card-1");
    expect(ids[1]).not.toBe("card-1"); // a second use in one dashboard still gets a fresh id
  });

  it("gives a second card sharing one server id a fresh id", () => {
    const d = fromWorkspace(famaFrench(), "dashboard", []);
    d.tabs[0].cards.push({ ...d.tabs[0].cards[0], id: "copy" });
    const ids = gridOf(toWorkspace(d, "dashboard")).factors.map((e) => e.i);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps BDOBB built-ins, groups and card state through BDOBB -> Workspace -> BDOBB", () => {
    const file = JSON.parse(readFileSync(resolve(process.cwd(), "docs/examples/v3.1.0-builtins.apps.json"), "utf8"));
    const [source] = importApps(file, BUILTIN_WIDGETS).dashboards;
    const c = source.tabs[0].cards[0];
    Object.assign(c, { title: "Pinned", minimized: true, view: "transposed", table: { sorting: [{ id: "a", desc: true }] } });
    const back = fromWorkspace(toWorkspace(source, "dashboard", { index: "ffffffff-0000-4000-8000-000000000002", parentId: null }), "dashboard", BUILTIN_WIDGETS);
    const shape = (d: Dashboard) => ({
      name: d.name, groups: d.groups, groupsDisabled: d.groupsDisabled,
      tabs: d.tabs.map((t) => ({ name: t.name, cards: t.cards.map((x) => ({ ...x, id: undefined, extensions: undefined })) })),
    });
    expect(shape(back)).toEqual(shape(source));
  });

  it("leaves a synced card exportable as a BDOBB-compatible app", () => {
    expect(exportCompatibleApp(fromWorkspace(famaFrench(), "dashboard", [])).ok).toBe(true);
  });
});

describe("v8 card state through the Workspace server (R2)", () => {
  const pinnedNote = (over: Partial<Dashboard["tabs"][0]["cards"][0]> = {}): Dashboard => ({ id: "d1", name: "Mine", tabs: [{ id: "t1", name: "Main", cards: [
    makeCard({ id: "card-1", widgetId: "note", backendId: "builtin", pinned: "bottom", title: "Wire", bindings: [{ groupId: "g1", paramName: "symbol" }] }),
    makeCard({ id: "card-2", widgetId: "note", backendId: "builtin", ...over }),
  ] }], groups: [{ id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "AAPL" }] });
  const upload = (d: Dashboard) => toWorkspace(d, "dashboard", { index: "ffffffff-0000-4000-8000-000000000003", parentId: null });

  it("writes the pinned edge in extensions.bdobbV8 beside the plain v3 state, and reads it back", () => {
    const out = upload(pinnedNote());
    const [pinned, plain] = widgetsOf(out);
    expect(pinned.extensions).toEqual({
      bdobb: { schemaVersion: 1, profile: "v3", title: "Wire", bindings: [{ groupId: "g1", paramName: "symbol" }] },
      bdobbV8: { schemaVersion: 1, profile: "v8", pinned: "bottom" },
    });
    expect(plain).not.toHaveProperty("extensions");
    const back = fromWorkspace(out, "dashboard", BUILTIN_WIDGETS).tabs[0].cards;
    expect(back[0]).toMatchObject({ pinned: "bottom", title: "Wire", layout: { x: 0, y: 0, w: 20, h: 9 } });
    expect(back[1]).not.toHaveProperty("pinned");
  });

  it("carries a News card's feeds in bdobbV8 and reads them back", () => {
    const news = { feeds: [{ url: "https://a.example/feed", name: "Wire", tab: "Wires" }], highlights: ["fed"], tabOrder: ["Wires"] };
    const out = upload(pinnedNote({ widgetId: "news", news }));
    expect(widgetsOf(out)[1].extensions).toEqual({ bdobbV8: { schemaVersion: 1, profile: "v8", news } });
    const back = fromWorkspace(out, "dashboard", BUILTIN_WIDGETS).tabs[0].cards;
    expect(back[1].news).toEqual(news);
    expect(back[0]).not.toHaveProperty("news");
  });

  it("v7's strict reader takes the v8-written record's v3 state and never inspects bdobbV8", () => {
    // v7.0.0's applyNative, unchanged on this line: extensions.bdobb only,
    // bindings split off, the rest through the strict v3 decoder.
    for (const w of widgetsOf(upload(pinnedNote()))) {
      if (!isRecord(w.extensions) || !isRecord(w.extensions.bdobb)) continue;
      const { bindings: _bindings, ...rest } = w.extensions.bdobb;
      expect(decodeV3CardExtension(rest, "$").ok).toBe(true);
    }
  });

  it("an unpin removes bdobbV8 from a downloaded server card, and a pin adds it, keeping other extensions", () => {
    const d = fromWorkspace(upload(pinnedNote()), "dashboard", BUILTIN_WIDGETS);
    d.tabs[0].cards[0].extensions!.workspace!.widget.extensions = { ...(d.tabs[0].cards[0].extensions!.workspace!.widget.extensions as Rec), other: { keep: true } };
    delete d.tabs[0].cards[0].pinned;
    d.tabs[0].cards[1].pinned = "top";
    const [first, second] = widgetsOf(toWorkspace(d, "dashboard"));
    expect(first.extensions).not.toHaveProperty("bdobbV8");
    expect(first.extensions).toMatchObject({ other: { keep: true }, bdobb: { title: "Wire" } });
    expect(second.extensions).toEqual({ bdobbV8: { schemaVersion: 1, profile: "v8", pinned: "top" } });
  });

  it("skips an invalid or newer v8 record for that widget, keeping its plain v3 card and the rest of the sync (Q3)", () => {
    for (const bad of [{ schemaVersion: 1, profile: "v8", pinned: "left" }, { schemaVersion: 1, profile: "v8", news: {} }, { schemaVersion: 1, profile: "v8", news: { feeds: [{ url: "ftp://x", name: "", tab: "" }] } }, { schemaVersion: 2, profile: "v8", pinned: "top", future: { x: 1 } }, "top"]) {
      const out = upload(pinnedNote({ pinned: "top" }));
      (widgetsOf(out)[0].extensions as Rec).bdobbV8 = bad;
      const cards = fromWorkspace(out, "dashboard", BUILTIN_WIDGETS).tabs[0].cards;
      expect(cards[0]).not.toHaveProperty("pinned");
      expect(cards[0]).toMatchObject({ title: "Wire", bindings: [{ groupId: "g1", paramName: "symbol" }] });
      // The other widget's readable v8 record still applies.
      expect(cards[1].pinned).toBe("top");
    }
  });

  it("carries an unreadable v8 record back unchanged on upload, even after a local pin, and never drops it (Q3)", () => {
    const future = { schemaVersion: 2, profile: "v8", pinned: "top", future: { x: 1 } };
    for (const bad of [future, { schemaVersion: 1, profile: "v8", pinned: "left" }, "top"]) {
      const out = upload(pinnedNote());
      (widgetsOf(out)[0].extensions as Rec).bdobbV8 = structuredClone(bad);
      const d = fromWorkspace(out, "dashboard", BUILTIN_WIDGETS);
      expect(widgetsOf(toWorkspace(d, "dashboard"))[0].extensions).toMatchObject({ bdobbV8: bad, bdobb: { title: "Wire" } });
      d.tabs[0].cards[0].pinned = "bottom";
      d.tabs[0].cards[0].title = "Edited";
      const [first, second] = widgetsOf(toWorkspace(d, "dashboard"));
      expect((first.extensions as Rec).bdobbV8).toEqual(bad);
      expect(first.extensions).toMatchObject({ bdobb: { title: "Edited" } });
      expect(second).not.toHaveProperty("extensions");
    }
  });

});
it('syncs managed source references and selected linked chains with remapped parent identities',()=>{
 const source=makeCard({id:'source',widgetId:'managed',managedSource:{sourceId:'durable-source',kind:'upload',version:1},tableDefinition:{table:{},search:'saved'},tableSelection:{kind:'allMatching',excludedIds:['r204']}});
 const child=makeCard({id:'child',widgetId:'linked_table',linkedSource:{kind:'widget',sourceWidgetId:'source'},tableDefinition:{table:{},search:'child'}});
 const grandchild=makeCard({...child,id:'grandchild',linkedSource:{kind:'widget',sourceWidgetId:'child'}});
 const d:Dashboard={id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[source,child,grandchild]}]};
 const wire=toWorkspace(d,'dashboard');const reopened=fromWorkspace(wire,'dashboard',[]);const [a,b,c]=reopened.tabs[0].cards;
 expect(a.managedSource).toEqual(source.managedSource);expect(a.tableDefinition).toEqual(source.tableDefinition);expect(a.tableSelection).toEqual(source.tableSelection);
 expect(b.linkedSource?.sourceWidgetId).toBe(a.id);expect(c.linkedSource?.sourceWidgetId).toBe(b.id);expect(b.tableDefinition).toEqual(child.tableDefinition);
 expect(normalize(toWorkspace(reopened,'dashboard'))).toEqual(normalize(wire));
});
it('syncs a calendar view card and a pivoted table card through Workspace',()=>{
 const pivot={enabled:true,grouping:['sector'],split:[]};
 const cal=makeCard({id:'cal',view:'calendar',calendar:{mode:'static',cursor:'2026-10-01'}});
 const piv=makeCard({id:'piv',table:{pivot,sorting:[{id:'a',desc:true}]}});
 const d:Dashboard={id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[cal,piv]}]};
 const [a,b]=fromWorkspace(toWorkspace(d,'dashboard'),'dashboard',[]).tabs[0].cards;
 expect(a.view).toBe('calendar');expect(a.calendar).toEqual(cal.calendar);expect(b.table).toEqual(piv.table);
});

it.each(["dashboard", "app"] as const)("preserves a named single tab through %s sync", (store) => {
  const original: Dashboard = { id: "local-dashboard", name: "Pinned example", tabs: [{ id: "local-tab-uuid", name: "Pinned", cards: [makeCard({ widgetId: "clock", backendId: "builtin", params: { face: "dots" }, pinned: "bottom" })] }] };
  const wire = toWorkspace(original, store);
  expect(widgetsOf(wire, store).some((widget) => widget.widgetId === "navigation_bar")).toBe(false);
  const reopened = fromWorkspace(wire, store, BUILTIN_WIDGETS);
  expect(reopened.tabs.map((tab) => tab.name)).toEqual(["Pinned"]);
  expect(reopened.tabs[0].cards[0]).toMatchObject({ widgetId: "clock", pinned: "bottom", params: { face: "dots" } });
});

it("preserves a renamed single server tab without rewriting an untouched unnamed tab", () => {
  const wire = app();
  const untouched = fromWorkspace(wire, "app", []);
  expect(normalize(toWorkspace(untouched, "app"), "app")).toEqual(normalize(wire, "app"));
  untouched.tabs[0].name = "Renamed research";
  expect(fromWorkspace(toWorkspace(untouched, "app"), "app", []).tabs[0].name).toBe("Renamed research");
});

it("uses a valid saved tab label when navigation metadata is malformed, and prefers valid navigation labels", () => {
  const wire = famaFrench();
  const data = body(wire);
  data.extensions = { bdobb: { tabNames: { factors: "Saved factors", portfolios: 42 } } };
  const navigation = widgetsOf(wire).find((widget) => widget.widgetId === "navigation_bar")!;
  const tabs = (navigation.storage as Rec).tabs as Rec[];
  tabs[0].name = 42;
  expect(fromWorkspace(wire, "dashboard", []).tabs[0].name).toBe("Saved factors");
  tabs[0].name = "Navigation wins";
  expect(fromWorkspace(wire, "dashboard", []).tabs[0].name).toBe("Navigation wins");
  tabs[1].name = null;
  expect(fromWorkspace(wire, "dashboard", []).tabs[1].name).toBe("portfolios");
});
