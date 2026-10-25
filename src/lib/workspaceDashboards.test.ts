// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { UNRESOLVED_BACKEND_ID, exportCompatibleApp, importApps } from "./appsJson";
import { BUILTIN_WIDGETS, LOCAL_TABLE_ID } from "./builtins";
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
