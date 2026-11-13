// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn() }));
import { confirm } from "@tauri-apps/plugin-dialog";

import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { useDashboardStore } from "../stores/dashboardStore";
import type { TableExecutionStore, ViewState } from "../stores/tableExecutionStore";
import { card } from "../test/fixtures";
import { __reset } from "../test/memfs";
import { FeedSymbolGroupDialog } from "./FeedSymbolGroupDialog";

// Fixed objects: useSyncExternalStore needs the same snapshot back for an unchanged store.
const ready = { status: "ready", ready: { columns: [
  { id: "name", label: "Name", dtype: "text" },
  { id: "px", label: "Price", dtype: "number" },
  { id: "tkr", label: "Ticker" },
] } } as unknown as ViewState;
const none = { status: "unavailable" } as unknown as ViewState;
const views = { subscribe: () => () => {}, readView: (_d: string, id: string) => (id === "" ? none : ready) } as Pick<TableExecutionStore, "subscribe" | "readView">;
const groups = () => useDashboardStore.getState().dashboards[0].groups!;

beforeEach(() => {
  __reset();
  __resetJsonStoreForTests();
  vi.mocked(confirm).mockReset();
  useDashboardStore.setState({
    viewer: false, activeId: "d", activeTabId: "t",
    dashboards: [{
      id: "d", name: "D",
      groups: [{ id: "g", name: "Watch", paramName: "symbol", groupType: "symbol", value: "AAPL", source: { sourceWidgetId: "old", columnId: "tkr" } }],
      tabs: [{ id: "t", name: "First", cards: [
        card({ id: "s", widgetId: "local_table", backendId: "builtin", title: "Prices" }),
        card({ id: "old", widgetId: "local_table", backendId: "builtin", title: "Old prices" }),
      ] }],
    }],
  });
});

it("offers the table's text columns and preselects the one named ticker", () => {
  render(<FeedSymbolGroupDialog dashboardId="d" sourceWidgetId="s" store={views} onClose={() => {}} />);
  expect((screen.getByLabelText("Ticker column") as HTMLSelectElement).value).toBe("tkr");
  expect(screen.getByRole("option", { name: "Name" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Price" })).toBeNull();
});

it("feeds a new symbol group from the table menu without asking", async () => {
  const onClose = vi.fn();
  render(<FeedSymbolGroupDialog dashboardId="d" sourceWidgetId="s" store={views} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Feed symbol group" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(groups()[1]).toMatchObject({ paramName: "symbol", groupType: "symbol", source: { sourceWidgetId: "s", columnId: "tkr" } });
  expect(confirm).not.toHaveBeenCalled();
});

it("replaces an existing source only after a confirmation naming it", async () => {
  vi.mocked(confirm).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<FeedSymbolGroupDialog dashboardId="d" sourceWidgetId="s" store={views} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("Symbol group"), { target: { value: "g" } });
  fireEvent.click(screen.getByRole("button", { name: "Feed symbol group" }));
  await waitFor(() => expect(confirm).toHaveBeenCalledWith(
    'Replace the source of "Watch"? It is fed by Old prices — First.',
    expect.objectContaining({ kind: "warning" }),
  ));
  expect(groups()[0].source?.sourceWidgetId).toBe("old");
  await waitFor(() => expect(screen.getByRole("button", { name: "Feed symbol group" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Feed symbol group" }));
  await waitFor(() => expect(groups()[0].source).toEqual({ sourceWidgetId: "s", columnId: "tkr" }));
});

it("does not offer a table whose own parameters are bound to the chosen group", () => {
  useDashboardStore.setState((st) => ({
    dashboards: st.dashboards.map((d) => ({ ...d, tabs: d.tabs.map((t) => ({ ...t, cards: [...t.cards,
      card({ id: "b", widgetId: "local_table", backendId: "builtin", title: "Bound", bindings: [{ groupId: "g", paramName: "symbol" }] })] })) })),
  }));
  render(<FeedSymbolGroupDialog dashboardId="d" groupId="g" store={views} onClose={() => {}} />);
  expect(screen.queryByRole("option", { name: "Bound — First" })).toBeNull();
  expect(screen.getByRole("option", { name: "Prices — First" })).toBeTruthy();
  expect(screen.queryByLabelText("Symbol group")).toBeNull();
});
