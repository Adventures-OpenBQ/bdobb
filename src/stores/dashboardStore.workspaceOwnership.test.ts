// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, it } from "vitest";
import type { Dashboard } from "../lib/types";
import { __reset, __read } from "../test/memfs";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { card } from "../test/fixtures";
import { useDashboardStore } from "./dashboardStore";

beforeEach(() => {
  __reset(); __resetJsonStoreForTests();
  const dashboards: Dashboard[] = [
    { id: "alpha", name: "Alpha", tabs: [{ id: "ta", name: "One", cards: [card({ id: "ca" })] }] },
    { id: "beta", name: "Beta", tabs: [{ id: "tb", name: "One", cards: [card({ id: "cb" })] }], groups: [{ id: "gb", name: "Symbol", paramName: "symbol", groupType: "symbol", value: "AAPL" }] },
  ];
  useDashboardStore.setState({ dashboards, activeId: "alpha", activeTabId: "ta", activeTabIds: { alpha: "ta", beta: "tb" }, viewer: false, pendingCardRemoval: null });
});
const store = () => useDashboardStore.getState();
const beta = () => store().dashboards.find(d => d.id === "beta")!;

it("writes an unfocused card parameter to its owning dashboard on disk", async () => {
  await store().applyCardParams("cb", { cardParams: { symbol: "MSFT" }, groupEdits: [] });
  expect(beta().tabs[0].cards[0].params.symbol).toBe("MSFT");
  expect(JSON.parse(__read("dashboards/beta.json")!).tabs[0].cards[0].params.symbol).toBe("MSFT");
  expect(__read("dashboards/alpha.json")).toBeUndefined();
  expect(store().activeId).toBe("alpha");
});
it("renames the tab in its owner without depending on focus", async () => {
  await store().renameTab("tb", "Renamed");
  expect(beta().tabs[0].name).toBe("Renamed");
  expect(store().dashboards[0].tabs[0].name).toBe("One");
});
it("patches an unfocused card's dock and table settings", async () => {
  await store().patchCardField("cb", "paramsOpen", true);
  await store().patchCardField("cb", "table", { columnOrder: ["revenue"] });
  expect(beta().tabs[0].cards[0]).toMatchObject({ paramsOpen: true, table: { columnOrder: ["revenue"] } });
});
it("creates a parameter group on the card's owner", async () => {
  const id = await store().createGroup("cb", "symbol", "symbol", "TSLA");
  expect(beta().groups?.find(g => g.id === id)?.value).toBe("TSLA");
  expect(store().dashboards[0].groups).toBeUndefined();
});
it("hands a surviving group edit to its owner after its card disappears", async () => {
  await store().applyCardParams("gone", { cardParams: {}, groupEdits: [{ groupId: "gb", value: "TSLA" }] });
  expect(beta().groups?.[0].value).toBe("TSLA");
  expect(store().activeId).toBe("alpha");
});
it("keeps viewer card edits transient on their actual owner", async () => {
  useDashboardStore.setState({ viewer: true });
  await store().patchCardField("cb", "title", "Viewer title");
  expect(beta().tabs[0].cards[0].title).toBe("Viewer title");
  expect(__read("dashboards/beta.json")).toBeUndefined();
});
it("updates grid geometry on the owner of the layout's card", async () => {
  await store().updateLayouts([{ i: "cb", x: 1, y: 2, w: 8, h: 9 }]);
  expect(beta().tabs[0].cards[0].layout).toEqual({ x: 1, y: 2, w: 8, h: 9 });
});
it("removes an unfocused card durably and keeps modern Undo on its owner", async () => {
  await store().removeCard("cb");
  expect(beta().tabs[0].cards).toHaveLength(0);
  expect(store().pendingCardRemoval?.dashboardId).toBe("beta");
  await store().undoCardRemoval();
  expect(beta().tabs[0].cards[0].id).toBe("cb");
  expect(store().activeId).toBe("alpha");
});
it("removes a tab from its owner while another dashboard is focused", async () => {
  await store().removeTab("tb");
  expect(beta().tabs).toHaveLength(0);
  expect(store().dashboards[0].tabs).toHaveLength(1);
});
it("keeps each dashboard's selected tab independent of focus", () => {
  useDashboardStore.setState({ dashboards: store().dashboards.map(d => d.id === "beta" ? { ...d, tabs: [...d.tabs, { id: "tb2", name: "Two", cards: [] }] } : d) });
  store().setActiveTab("beta", "tb2");
  expect(store().activeTabIds.beta).toBe("tb2");
  expect(store().activeId).toBe("alpha");
  expect(store().activeTabId).toBe("ta");
});
it("adds a tab to the explicitly named dashboard", async () => {
  await store().addTab("beta", "Second");
  expect(beta().tabs.map(t => t.name)).toEqual(["One", "Second"]);
  expect(store().dashboards[0].tabs).toHaveLength(1);
});
it("writes a saved datetime preset to the explicit owner", async () => {
  await store().savePreset("beta", "Quarter", "THIS QUARTER");
  expect(beta().presets).toEqual([{ name: "Quarter", expr: "THIS QUARTER" }]);
  expect(store().dashboards[0].presets).toBeUndefined();
});
it("keeps the legacy focus tab and owner tab consistent after ordinary navigation", () => {
  useDashboardStore.setState({ dashboards: store().dashboards.map(d => d.id === "beta" ? { ...d, tabs: [...d.tabs, { id: "tb2", name: "Two", cards: [] }] } : d), activeTabIds: { alpha: "ta", beta: "tb2" } });
  store().setActive("beta");
  expect(store().activeTabId).toBe("tb");
  expect(store().activeTabIds.beta).toBe("tb");
});
it("repairs an unfocused owner's selected tab after durable deletion", async () => {
  useDashboardStore.setState({ dashboards: store().dashboards.map(d => d.id === "beta" ? { ...d, tabs: [...d.tabs, { id: "tb2", name: "Two", cards: [] }] } : d), activeTabIds: { alpha: "ta", beta: "tb2" } });
  await store().removeTab("tb2");
  expect(store().activeTabIds.beta).toBe("tb");
  expect(store().activeTabId).toBe("ta");
});
it("repairs an unfocused owner's selected tab after replacing its contents", async () => {
  await store().replaceDashboardContents("beta", { id: "incoming", name: "Incoming", tabs: [{ id: "new-tab", name: "New", cards: [] }] });
  expect(store().activeTabIds.beta).toBe("new-tab");
  expect(store().activeTabId).toBe("ta");
});
it("repairs owner tab selection when synchronized storage removes the selected tab", async () => {
  const { writeTextFile } = await import("@tauri-apps/plugin-fs");
  await writeTextFile("dashboards/beta.json", JSON.stringify({ id: "beta", name: "Beta", tabs: [{ id: "new-tab", name: "New", cards: [] }] }));
  await store().syncDashboard("beta");
  expect(store().activeTabIds.beta).toBe("new-tab");
  expect(store().activeTabId).toBe("ta");
});

it("records the first tab for a new dashboard before workspace assignment", async () => {
  const id = await store().addDashboard("Created");
  const created = store().dashboards.find(d => d.id === id)!;
  expect(store().activeTabIds[id!]).toBe(created.tabs[0].id);
});
it("records first tabs for every imported dashboard before opening the library", async () => {
  const imported: Dashboard[] = [
    { id: "import-one", name: "One", tabs: [{ id: "one-tab", name: "One", cards: [] }] },
    { id: "import-two", name: "Two", tabs: [{ id: "two-tab", name: "Two", cards: [] }] },
  ];
  await store().importDashboards(imported);
  expect(store().activeTabIds["import-one"]).toBe("one-tab");
  expect(store().activeTabIds["import-two"]).toBe("two-tab");
  expect(store().activeTabIds.alpha).toBe("ta");
});
