// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A backend statement source on another tab runs headless (BackendSourceRunner).
 * Its linked children must get the rows its card would hand over -- fiscal labels
 * from the reporter's year end -- not the provider's calendar labels, and must
 * not flip when the source's tab is visited.
 */
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));
vi.mock("../lib/plotly", () => ({ renderPlot: () => Promise.resolve(), purgePlot: () => {}, REGISTERED_TRACE_TYPES: new Set(["scatter"]) }));
vi.mock("react-grid-layout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, WidthProvider: (C: unknown) => C }));
vi.mock("../lib/dataClient", async (orig) => ({ ...(await orig<object>()), fetchFiscalYearEnd: async () => ({ fiscalYearEnd: "September" }) }));
import { DashboardGrid } from "./DashboardGrid";
import { TableExecutionRuntime } from "./TableExecutionRuntime";
import { __resetStatementYearEndsForTests } from "../hooks/useStatementYearEnds";
import { tableExecutionStore } from "../stores/tableExecutionStore";
import { useBackendsStore } from "../stores/backendsStore";
import { useDashboardStore } from "../stores/dashboardStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { backend, card as makeCard, widget as makeWidget } from "../test/fixtures";
import { startMockServer } from "../test/mockServer";
import { Boundary } from "../test/tableWorkerBoundary";

afterEach(() => __resetStatementYearEndsForTests());

/** The last rows handed to the table runtime for the source card. */
async function handed(sourceTab: "a" | "b") {
  vi.stubGlobal("Worker", Boundary);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const s = await startMockServer({ "/income": [{ symbol: "AAPL", period_ending: "2025-12-27", fiscal_period: "Q4", fiscal_year: 2025, revenue: 1 }] });
  const spy = vi.spyOn(tableExecutionStore, "setBackendRows");
  const view = render(<></>);
  try {
    useBackendsStore.setState({ backends: [backend({ baseUrl: s.url })], statuses: { b1: "online" } });
    useWidgetRegistryStore.getState().seedBuiltins();
    useWidgetRegistryStore.setState((st) => ({ widgets: [...st.widgets, makeWidget({ id: "income", type: "table", endpoint: "income", params: [
      { paramName: "symbol", label: "Symbol", type: "text", value: "AAPL" },
      { paramName: "period", label: "Period", type: "text", value: "quarter", options: [{ label: "Annual", value: "annual" }, { label: "Quarter", value: "quarter" }] },
    ] as never })] }));
    const source = makeCard({ id: "src", widgetId: "income", params: { symbol: "AAPL", period: "quarter" } });
    const child = makeCard({ id: "child", widgetId: "linked_table", backendId: "builtin", linkedSource: { kind: "widget", sourceWidgetId: "src" } });
    const tabs = sourceTab === "a"
      ? [{ id: "a", name: "A", cards: [child, { ...source, layout: { x: 0, y: 9, w: 20, h: 9 } }] }]
      : [{ id: "a", name: "A", cards: [child] }, { id: "b", name: "B", cards: [source] }];
    useDashboardStore.setState({ dashboards: [{ id: "d1", name: "Main", tabs }], activeId: "d1", activeTabId: "a" });
    view.rerender(<><TableExecutionRuntime /><DashboardGrid onOpenLibrary={() => {}} /></>);
    await waitFor(() => expect(spy.mock.calls.some((c) => c[1] === "src")).toBe(true));
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    const calls = spy.mock.calls.filter((c) => c[1] === "src");
    return { last: calls.at(-1)?.[2] as Array<Record<string, unknown>>, notes: view.queryAllByText("Fiscal labels as reported").length };
  } finally { view.unmount(); spy.mockRestore(); tableExecutionStore.disposeDashboard("d1"); vi.unstubAllGlobals(); await s.close(); }
}

describe("off-tab backend statement source", () => {
  it("hands its linked table the same fiscal rows as when the source is on the same tab", async () => {
    const onTab = await handed("a");
    const offTab = await handed("b");
    expect(onTab.last[0].fiscal_period).toBe("FQ1");
    expect(offTab.last).toEqual(onTab.last);
    expect(offTab.notes).toBe(onTab.notes);
  });
});
