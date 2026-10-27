// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@adventures-openbq/arts-charts", () => ({ configureArtsCharts: vi.fn() }));
const { __reset } = await import("../test/memfs");
const { __resetJsonStoreForTests } = await import("./jsonStore");
const { useBackendsStore } = await import("../stores/backendsStore");
const { useDashboardStore } = await import("../stores/dashboardStore");
const { useArtsChartsStore } = await import("../stores/artsChartsStore");
const { artsChartWidget } = await import("./artsCharts/widget");
const { addChartToDashboard, openChartCard, buildHost } = await import("./artsChartsHost");

const ID = "0b5d6f3e-1c2a-4b7e-9a0d-3e2f1a0b9c8d";
const charts = { id: "c1", name: "Charts", baseUrl: "https://door.example.com", authLocation: "header" as const, validateWidgets: true, kind: "arts-charts" as const, door: "gateway" as const };

function resetDashboards(): void {
  __reset();
  __resetJsonStoreForTests();
  useDashboardStore.setState({
    dashboards: [], activeId: null, previousId: null, activeTabId: null, activeTabIds: {},
    maximizedCardId: null, viewer: false, pendingCardRemoval: null,
  });
  useArtsChartsStore.setState({ reveal: null });
}
const allCards = () => useDashboardStore.getState().dashboards.flatMap((d) => d.tabs.flatMap((t) => t.cards));

describe("B8", () => {
  beforeEach(() => { resetDashboards(); useBackendsStore.setState({ backends: [charts] }); });
  it("adds {chart_id} to the dashboard in view, on the Art's Charts connection", async () => {
    const dash = await useDashboardStore.getState().addDashboard("Mine");
    useDashboardStore.getState().setActive(dash!);
    await addChartToDashboard(ID);
    const card = allCards().at(-1)!;
    expect(card).toMatchObject({ widgetId: "arts_chart", backendId: "c1", params: { chart_id: ID } });
  });
  it("live adds {chart_id, live: 'true'}", async () => {
    await addChartToDashboard(ID, { live: true });
    expect(allCards().at(-1)!.params).toMatchObject({ chart_id: ID, live: "true" });
  });
  it("with no dashboard open, creates one called Art's Charts", async () => {
    useDashboardStore.setState({ activeId: null });
    await addChartToDashboard(ID);
    expect(useDashboardStore.getState().dashboards.some((d) => d.name === "Art's Charts")).toBe(true);
  });
  it("openChart focuses an existing card for that chart_id and reveals it", async () => {
    await addChartToDashboard(ID);
    const count = allCards().length;
    await openChartCard(ID);
    expect(allCards().length).toBe(count);
    expect(useArtsChartsStore.getState().reveal?.cardId).toBe(allCards().find((c) => c.params.chart_id === ID)!.id);
  });
  it("openChart adds a card when none shows that chart", async () => {
    await openChartCard(ID);
    expect(allCards().filter((c) => c.params.chart_id === ID)).toHaveLength(1);
  });
  it("the main window's host with a connection offers both", () => {
    expect(typeof buildHost({ viewer: false }).addToDashboard).toBe("function");
    expect(typeof buildHost({ viewer: false }).openChart).toBe("function");
  });
  const twoDashboards = async () => {
    const store = useDashboardStore.getState();
    const a = (await store.addDashboard("A"))!;
    const b = (await store.addDashboard("B"))!;
    const tb2 = (await store.addTab(b, "Second"))!;
    store.setActive(b);
    store.setActiveTab(b, tb2);
    await useDashboardStore.getState().addCard(artsChartWidget(charts), { chart_id: ID });
    const card = useDashboardStore.getState().dashboards.flatMap((d) => d.tabs.flatMap((t) => t.cards)).find((c) => c.params.chart_id === ID)!;
    const tb1 = useDashboardStore.getState().dashboards.find((d) => d.id === b)!.tabs[0].id;
    useDashboardStore.getState().setActiveTab(b, tb1);
    useDashboardStore.getState().setActive(a);
    return { a, b, tb1, tb2, card };
  };
  it("openChart on a card in another dashboard and tab switches to both, then reveals", async () => {
    const { b, tb2, card } = await twoDashboards();
    await openChartCard(ID);
    const s = useDashboardStore.getState();
    expect(s.activeId).toBe(b);
    expect(s.activeTabId).toBe(tb2);
    expect(useArtsChartsStore.getState().reveal?.cardId).toBe(card.id);
  });
  it("openChart with another card maximized on the dashboard being left clears it by switching away", async () => {
    const { a, b, card } = await twoDashboards();
    await useDashboardStore.getState().addCard(artsChartWidget(charts), { chart_id: "other" });
    const other = useDashboardStore.getState().dashboards.flatMap((d) => d.tabs.flatMap((t) => t.cards)).find((c) => c.params.chart_id === "other")!;
    useDashboardStore.getState().setMaximized(other.id);
    expect(useDashboardStore.getState().activeId).toBe(a);
    await openChartCard(ID);
    expect(useDashboardStore.getState().activeId).toBe(b);
    expect(useDashboardStore.getState().maximizedCardId).toBeNull();
    expect(useArtsChartsStore.getState().reveal?.cardId).toBe(card.id);
  });
  it("openChart on the dashboard and tab already in view does not un-maximize another card (current behavior)", async () => {
    const { b, card } = await twoDashboards();
    useDashboardStore.getState().setActive(b);
    useDashboardStore.getState().setActiveTab(b, useDashboardStore.getState().dashboards.find((d) => d.id === b)!.tabs.find((t) => t.cards.some((c) => c.id === card.id))!.id);
    await useDashboardStore.getState().addCard(artsChartWidget(charts), { chart_id: "other" });
    const other = useDashboardStore.getState().dashboards.flatMap((d) => d.tabs.flatMap((t) => t.cards)).find((c) => c.params.chart_id === "other")!;
    useDashboardStore.getState().setMaximized(other.id);
    await openChartCard(ID);
    expect(useDashboardStore.getState().maximizedCardId).toBe(other.id);
    expect(useArtsChartsStore.getState().reveal?.cardId).toBe(card.id);
  });
  it("the viewer window's host offers neither", () => {
    expect(buildHost({ viewer: true }).addToDashboard).toBeUndefined();
    expect(buildHost({ viewer: true }).openChart).toBeUndefined();
  });
});
