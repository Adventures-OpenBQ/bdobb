// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// v8 locked widgets: the store holds the docks apart from `dashboards`, every
// card write still reaches a docks card, and Settings ▸ Locked Widgets edits
// one edge at a time against a snapshot Cancel restores. Ported from the
// donor's dashboardStore.test.ts "docks" suite (5ee2e8b4: 1706dc4d, bd262fe9,
// 1e75633d, 1fe4ecc0), plus clean's own cases: the epoch-ms revision (R6a),
// Duplicate inside a band, the docks' own groups, and the viewer's sync.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __read, __reset, __seed, __writes } from "../test/memfs";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import { DOCKS_ID, makeDefaultDocks } from "../lib/dashboardsFile";
import type { WidgetDef } from "../lib/types";
import { widget as baseWidget } from "../test/fixtures";
import { useDashboardStore } from "./dashboardStore";

const widget = (over: Partial<WidgetDef> = {}): WidgetDef =>
  baseWidget({ id: "price_history", name: "Price History", params: [{ paramName: "symbol", value: "AAPL" }], ...over });
const store = () => useDashboardStore.getState();
const docksWrites = () => __writes().filter((p) => p.endsWith("docks.json"));
const DOCKS_FILE = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: DOCKS_ID,
    name: "Locked widgets",
    hidden: true,
    tabs: [
      { id: "top", name: "Locked at Top", cards: [] },
      { id: "bottom", name: "Locked at Bottom", cards: [] },
    ],
    dockRows: { top: 6, bottom: 8 },
    ...extra,
  });

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useDashboardStore.setState({
    dashboards: [],
    docks: makeDefaultDocks(),
    dockEdit: null,
    activeId: null,
    previousId: null,
    activeTabId: null,
    maximizedCardId: null,
    viewer: false,
    pendingCardRemoval: null,
  });
});
afterEach(() => vi.useRealTimers());

describe("the docks in the store", () => {
  it("load keeps the docks out of dashboards and in docks", async () => {
    __seed("dashboards/d1.json", JSON.stringify({ id: "d1", name: "One", cards: [] }));
    __seed("dashboards/docks.json", DOCKS_FILE());
    await store().load();
    expect(store().dashboards.map((d) => d.id)).toEqual(["d1"]);
    expect(store().docks.id).toBe(DOCKS_ID);
  });

  it("load without a docks file gives the in-memory default and writes nothing", async () => {
    await store().load();
    expect(store().docks).toEqual(makeDefaultDocks());
    expect(docksWrites()).toEqual([]);
  });

  it("load excludes a docks file that is missing hidden: true", async () => {
    __seed("dashboards/d1.json", JSON.stringify({ id: "d1", name: "One", cards: [] }));
    __seed("dashboards/docks.json", DOCKS_FILE({ hidden: undefined }));
    await store().load();
    expect(store().dashboards.map((d) => d.id)).toEqual(["d1"]);
    expect(store().docks).toMatchObject({ id: DOCKS_ID, hidden: true });
  });

  it("addCardTo the docks, then patchCardField and removeCard reach that card; no Undo toast", async () => {
    await store().load();
    const id = await store().addCardTo(DOCKS_ID, "bottom", widget());
    expect(id).not.toBeNull();
    await store().patchCardField(id!, "title", "Rail");
    expect(store().docks.tabs[1].cards[0].title).toBe("Rail");
    expect(JSON.parse(__read("dashboards/docks.json")!).tabs[1].cards[0].title).toBe("Rail");
    await store().removeCard(id!);
    expect(store().docks.tabs[1].cards).toEqual([]);
    expect(store().pendingCardRemoval).toBeNull();
    expect(store().dashboards.map((d) => d.id)).not.toContain(DOCKS_ID);
  });

  it("every docks write moves the revision to the edit's time in epoch ms, never backwards (R6a)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_760_000_000_000);
    await store().load();
    await store().setDockRows("top", 4);
    expect(store().docks.revision).toBe(1_760_000_000_000);
    expect(JSON.parse(__read("dashboards/docks.json")!).revision).toBe(1_760_000_000_000);
    // Same millisecond: one on, never equal.
    await store().setDockRows("top", 5);
    expect(store().docks.revision).toBe(1_760_000_000_001);
    // A clock set back: still forward.
    vi.setSystemTime(1_700_000_000_000);
    await store().setDockRows("top", 6);
    expect(store().docks.revision).toBe(1_760_000_000_002);
    vi.setSystemTime(1_770_000_000_000);
    await store().addCardTo(DOCKS_ID, "top", widget());
    expect(store().docks.revision).toBe(1_770_000_000_000);
  });

  it("edit mode: cancel restores the snapshot and writes it; OK keeps the change", async () => {
    await store().load();
    store().beginDockEdit("bottom");
    expect(store().dockEdit?.edge).toBe("bottom");
    await store().addCardTo(DOCKS_ID, "bottom", widget());
    await store().setDockRows("bottom", 10);
    await store().cancelDockEdit();
    expect(store().dockEdit).toBeNull();
    expect(store().docks.tabs[1].cards).toEqual([]);
    expect(store().docks.dockRows?.bottom).toBe(8);
    expect(JSON.parse(__read("dashboards/docks.json")!).tabs[1].cards).toEqual([]);

    store().beginDockEdit("bottom");
    await store().addCardTo(DOCKS_ID, "bottom", widget());
    await store().commitDockEdit();
    expect(store().dockEdit).toBeNull();
    expect(store().docks.tabs[1].cards).toHaveLength(1);
  });

  it("beginDockEdit restores a maximized card", async () => {
    await store().load();
    useDashboardStore.setState({ maximizedCardId: "c" });
    store().beginDockEdit("top");
    expect(store().maximizedCardId).toBeNull();
  });

  it("a second beginDockEdit leaves the first edit's edge and snapshot alone", async () => {
    await store().load();
    store().beginDockEdit("bottom");
    const snapshot = store().dockEdit?.snapshot;
    await store().addCardTo(DOCKS_ID, "bottom", widget());
    store().beginDockEdit("top");
    expect(store().dockEdit?.edge).toBe("bottom");
    expect(store().dockEdit?.snapshot).toBe(snapshot);
    expect(store().dockEdit?.snapshot.tabs[1].cards).toEqual([]);
  });

  it("cancel with nothing changed writes no docks file at all", async () => {
    await store().load();
    const before = docksWrites();
    store().beginDockEdit("bottom");
    await store().cancelDockEdit();
    expect(store().dockEdit).toBeNull();
    expect(docksWrites()).toEqual(before);
  });

  it("a docks file's tab that is not an edge is not carried, and an add to it is refused", async () => {
    __seed(
      "dashboards/docks.json",
      DOCKS_FILE({
        tabs: [
          { id: "middle", name: "Nowhere", cards: [] },
          { id: "bottom", name: "Renamed", cards: [] },
        ],
      }),
    );
    await store().load();
    expect(store().docks.tabs.map((t) => [t.id, t.name])).toEqual([
      ["top", "Locked at Top"],
      ["bottom", "Locked at Bottom"],
    ]);
    expect(await store().addCardTo(DOCKS_ID, "middle", widget())).toBeNull();
    expect(await store().addCardTo(DOCKS_ID, "top", widget())).not.toBeNull();
  });

  it("setDockRows clamps and pinCard refuses a docks card without a write", async () => {
    await store().load();
    await store().setDockRows("top", 1);
    expect(store().docks.dockRows?.top).toBe(2);
    await store().setDockRows("bottom", 99);
    expect(store().docks.dockRows?.bottom).toBe(24);
    const id = await store().addCardTo(DOCKS_ID, "top", widget());
    const beforePin = __read("dashboards/docks.json");
    await store().pinCard(id!, "top");
    expect(store().docks.tabs[0].cards[0].pinned).toBeUndefined();
    expect(__read("dashboards/docks.json")).toBe(beforePin);
  });

  it("viewer window: beginDockEdit no-ops and a docks mutation writes nothing to disk", async () => {
    await store().load();
    useDashboardStore.setState({ viewer: true });
    store().beginDockEdit("bottom");
    expect(store().dockEdit).toBeNull();
    const before = docksWrites();
    await store().setDockRows("top", 1);
    expect(store().docks.dockRows?.top).toBe(2);
    expect(docksWrites()).toEqual(before);
  });

  it("viewer window: syncDashboard of the docks id re-reads the docks, never a rail dashboard", async () => {
    await store().load();
    __seed("dashboards/docks.json", DOCKS_FILE({ dockRows: { top: 3, bottom: 8 } }));
    await store().syncDashboard(DOCKS_ID);
    expect(store().docks.dockRows?.top).toBe(3);
    expect(store().dashboards.map((d) => d.id)).not.toContain(DOCKS_ID);
  });

  it("importDashboards drops a dashboard that claims the docks id or hidden", async () => {
    await store().load();
    await store().importDashboards([
      { id: DOCKS_ID, name: "evil", tabs: [] },
      { id: "h1", name: "hidden", tabs: [], hidden: true },
      { id: "ok", name: "fine", tabs: [] },
    ]);
    const ids = store().dashboards.map((d) => d.id);
    expect(ids).toContain("ok");
    expect(ids).not.toContain(DOCKS_ID);
    expect(ids).not.toContain("h1");
  });

  it("addCardTo the docks clamps a wide card to the reserved rows and puts two 10-wide widgets side by side", async () => {
    await store().load();
    const id1 = await store().addCardTo(DOCKS_ID, "top", widget({ gridData: { w: 40, h: 8 } }));
    expect(store().docks.tabs[0].cards[0].layout).toEqual({ x: 0, y: 0, w: 40, h: 6 });
    await store().removeCard(id1!);
    await store().addCardTo(DOCKS_ID, "top", widget({ gridData: { w: 10, h: 4 } }));
    await store().addCardTo(DOCKS_ID, "top", widget({ gridData: { w: 10, h: 4 } }));
    expect(store().docks.tabs[0].cards.map((c) => c.layout)).toEqual([
      { x: 0, y: 0, w: 10, h: 4 },
      { x: 10, y: 0, w: 10, h: 4 },
    ]);
  });

  it("Duplicate inside a band takes the next free spot there; Copy to a dashboard lands in its grid", async () => {
    await store().load();
    const dashboardId = store().activeId!;
    const tabId = store().activeTabId!;
    const id = await store().addCardTo(DOCKS_ID, "bottom", widget({ gridData: { w: 10, h: 4 } }));
    const copy = await store().duplicateCard(id!);
    expect(store().docks.tabs[1].cards.find((c) => c.id === copy)?.layout).toEqual({ x: 10, y: 0, w: 10, h: 4 });
    const out = await store().copyCardTo(id!, dashboardId, tabId);
    expect(store().dashboards[0].tabs[0].cards.map((c) => c.id)).toEqual([out]);
  });

  it("a docks card's groups are the docks' own", async () => {
    await store().load();
    const a = await store().addCardTo(DOCKS_ID, "top", widget());
    const b = await store().addCardTo(DOCKS_ID, "bottom", widget());
    const group = await store().createGroup(a!, "symbol", "symbol", "MSFT");
    await store().joinGroup(group!, b!, "symbol");
    expect(store().docks.groups?.map((g) => g.id)).toEqual([group]);
    expect(store().docks.tabs[1].cards[0].bindings).toEqual([{ groupId: group, paramName: "symbol" }]);
    await store().applyCardParams(a!, { cardParams: { symbol: "MSFT" }, groupEdits: [{ groupId: group!, value: "TSLA" }] });
    expect(store().docks.groups?.[0].value).toBe("TSLA");
    expect(store().dashboards[0].groups ?? []).toEqual([]);
  });

  it("applySyncedDocks takes the server's copy at the server's revision, never bumped, and is refused mid-edit and in the viewer", async () => {
    await store().load();
    const incoming = { ...makeDefaultDocks(), dockRows: { top: 3, bottom: 9 } };
    await store().applySyncedDocks(incoming, 1_770_000_000_000);
    expect(store().docks).toMatchObject({ id: DOCKS_ID, hidden: true, revision: 1_770_000_000_000, dockRows: { top: 3, bottom: 9 } });
    expect(JSON.parse(__read("dashboards/docks.json")!).revision).toBe(1_770_000_000_000);

    store().beginDockEdit("top");
    await store().applySyncedDocks({ ...incoming, dockRows: { top: 5, bottom: 5 } }, 1_780_000_000_000);
    expect(store().docks.revision).toBe(1_770_000_000_000);
    await store().commitDockEdit();

    useDashboardStore.setState({ viewer: true });
    await store().applySyncedDocks({ ...incoming, dockRows: { top: 5, bottom: 5 } }, 1_780_000_000_000);
    expect(store().docks.revision).toBe(1_770_000_000_000);
  });

  it("importDocks replaces the docks as an edit (new revision, written), re-stamping the id, flag and edges", async () => {
    await store().load();
    const incoming = { ...makeDefaultDocks(), id: "evil", hidden: false, tabs: [{ id: "bottom", name: "x", cards: [{ id: "x", widgetId: "rss", backendId: "b", params: {}, layout: { x: 0, y: 0, w: 6, h: 4 } }] }] };
    await store().importDocks(incoming as never);
    expect(store().docks).toMatchObject({ id: DOCKS_ID, hidden: true });
    expect(store().docks.tabs.map((t) => [t.id, t.cards.length])).toEqual([["top", 0], ["bottom", 1]]);
    expect(store().docks.revision).toBeGreaterThan(1_700_000_000_000);
    expect(JSON.parse(__read("dashboards/docks.json")!).tabs[1].cards[0].id).toBe("x");
    expect(store().dashboards.map((d) => d.id)).not.toContain("evil");

    const before = store().docks;
    store().beginDockEdit("top");
    await store().importDocks(makeDefaultDocks());
    expect(store().docks).toBe(before);
    await store().commitDockEdit();
    useDashboardStore.setState({ viewer: true });
    await store().importDocks(makeDefaultDocks());
    expect(store().docks).toBe(before);
  });
});
