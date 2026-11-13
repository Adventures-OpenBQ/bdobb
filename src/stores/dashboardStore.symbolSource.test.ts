// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, expect, it } from "vitest";
import { exportApp, exportCompatibleApp } from "../lib/appsJson";
import { loadDashboards } from "../lib/dashboardsFile";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import type { Dashboard } from "../lib/types";
import { card, widget } from "../test/fixtures";
import { __read, __reset, __seed } from "../test/memfs";
import { useDashboardStore } from "./dashboardStore";

const store = () => useDashboardStore.getState();
const groups = () => store().activeDashboard()!.groups ?? [];

beforeEach(() => {
  __reset();
  __resetJsonStoreForTests();
  useDashboardStore.setState({ dashboards: [], activeId: null, activeTabId: null, viewer: false, pendingCardRemoval: null });
});

async function setup() {
  await store().load();
  const source = (await store().addCard(widget({ id: "local_table", backendId: "builtin" }), { file: "data.csv" }))!;
  return { source, dashboardId: store().activeDashboard()!.id };
}

it("creates a fed symbol group, saves its source, and Remove source keeps the list", async () => {
  const { source, dashboardId } = await setup();
  const id = (await store().setGroupSource(dashboardId, null, { sourceWidgetId: source, columnId: "symbol" }))!;
  expect(groups()).toEqual([
    { id, name: "Group 1", paramName: "symbol", groupType: "symbol", value: "", source: { sourceWidgetId: source, columnId: "symbol" } },
  ]);
  const loaded = (await loadDashboards()).find((d) => d.id === dashboardId)!;
  expect(loaded.groups![0].source).toEqual({ sourceWidgetId: source, columnId: "symbol" });
  await store().applyCardParams("", { cardParams: {}, groupEdits: [{ groupId: id, value: "AAPL,MSFT" }] });
  expect(await store().setGroupSource(dashboardId, id, null)).toBe(id);
  expect(groups()[0]).toEqual({ id, name: "Group 1", paramName: "symbol", groupType: "symbol", value: "AAPL,MSFT" });
});

it("refuses a group that is not a symbol group, a card that is not a table, and the viewer", async () => {
  const { source, dashboardId } = await setup();
  useDashboardStore.setState((s) => ({
    dashboards: s.dashboards.map((d) => ({ ...d, groups: [{ id: "g", name: "Dates", paramName: "date", groupType: "date", value: "T" }] })),
  }));
  expect(await store().setGroupSource(dashboardId, "g", { sourceWidgetId: source, columnId: "symbol" })).toBeNull();
  expect(await store().setGroupSource(dashboardId, null, { sourceWidgetId: "foreign", columnId: "symbol" })).toBeNull();
  useDashboardStore.setState({ viewer: true });
  expect(await store().setGroupSource(dashboardId, null, { sourceWidgetId: source, columnId: "symbol" })).toBeNull();
  expect(groups()).toHaveLength(1);
});

it("a feeder's group edit lands in memory but never on disk in the viewer (spec §1)", async () => {
  const { source, dashboardId } = await setup();
  const id = (await store().setGroupSource(dashboardId, null, { sourceWidgetId: source, columnId: "symbol" }))!;
  const before = __read(`dashboards/${dashboardId}.json`);
  useDashboardStore.setState({ viewer: true });
  await store().applyCardParams("", { cardParams: {}, groupEdits: [{ groupId: id, value: "AAPL" }] });
  expect(groups()[0].value).toBe("AAPL");
  expect(__read(`dashboards/${dashboardId}.json`)).toBe(before);
});

it("deleting the source table keeps the group, its list and the reference; undo restores the link", async () => {
  const { source, dashboardId } = await setup();
  const id = (await store().setGroupSource(dashboardId, null, { sourceWidgetId: source, columnId: "symbol" }))!;
  await store().applyCardParams("", { cardParams: {}, groupEdits: [{ groupId: id, value: "AAPL,MSFT" }] });
  await store().removeCard(source);
  expect(groups()[0]).toMatchObject({ value: "AAPL,MSFT", source: { sourceWidgetId: source } });
  await store().undoCardRemoval();
  expect(store().activeDashboard()!.tabs[0].cards[0].id).toBe(source);
  expect(groups()[0].source?.sourceWidgetId).toBe(source);
});

it("duplicating a dashboard points the copy's source at the copied table", async () => {
  const { source, dashboardId } = await setup();
  await store().setGroupSource(dashboardId, null, { sourceWidgetId: source, columnId: "symbol" });
  const copyId = (await store().duplicateDashboard(dashboardId))!;
  const copy = store().dashboards.find((d) => d.id === copyId)!;
  const copied = copy.tabs[0].cards[0].id;
  expect(copied).not.toBe(source);
  expect(copy.groups![0].source).toEqual({ sourceWidgetId: copied, columnId: "symbol" });
  expect(store().dashboards.find((d) => d.id === dashboardId)!.groups![0].source!.sourceWidgetId).toBe(source);
});

it("loads an older file unchanged and drops a malformed or misplaced source, never the group", async () => {
  __seed("dashboards/d9.json", JSON.stringify({
    id: "d9", name: "Z", tabs: [],
    groups: [
      { id: "a", name: "Plain", paramName: "symbol", value: "AAPL" },
      { id: "b", name: "Fed", paramName: "symbol", groupType: "symbol", value: "AAPL", source: { sourceWidgetId: "s", columnId: "c", extra: 1 } },
      { id: "c", name: "Dates", paramName: "date", groupType: "date", value: "T", source: { sourceWidgetId: "s", columnId: "c" } },
      { id: "e", name: "Bad", paramName: "symbol", groupType: "symbol", value: "AAPL", source: "s" },
    ],
  }));
  const [d] = await loadDashboards();
  expect(d.groups).toEqual([
    { id: "a", name: "Plain", paramName: "symbol", groupType: "symbol", value: "AAPL" },
    { id: "b", name: "Fed", paramName: "symbol", groupType: "symbol", value: "AAPL", source: { sourceWidgetId: "s", columnId: "c" } },
    { id: "c", name: "Dates", paramName: "date", groupType: "date", value: "T" },
    { id: "e", name: "Bad", paramName: "symbol", groupType: "symbol", value: "AAPL" },
  ]);
});

it("apps.json carries the group's value and never its source, in both export shapes (R6)", () => {
  const d: Dashboard = {
    id: "d", name: "D", tabs: [{ id: "t", name: "T", cards: [card({ id: "c" })] }],
    groups: [{ id: "g", name: "Watch", paramName: "symbol", groupType: "symbol", value: "AAPL,MSFT", source: { sourceWidgetId: "c", columnId: "symbol" } }],
  };
  const plain = exportApp(d);
  expect(plain.groups[0]).toMatchObject({ name: "Watch", paramName: "symbol", defaultValue: "AAPL,MSFT" });
  const compatible = exportCompatibleApp(d);
  expect(compatible.ok).toBe(true);
  expect(JSON.stringify(plain)).not.toMatch(/sourceWidgetId|columnId/);
  expect(JSON.stringify(compatible.ok ? compatible.value : null)).not.toMatch(/sourceWidgetId|columnId/);
});
