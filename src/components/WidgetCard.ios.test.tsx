// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

// A file of its own because saveTextFile decides iOS once, at module load
// (TAURI_ENV_PLATFORM), so the env has to be iOS before anything imports it.
vi.hoisted(() => vi.stubEnv("TAURI_ENV_PLATFORM", "ios"));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn(), confirm: vi.fn() }));
const useWidgetData = vi.fn();
vi.mock("../hooks/useWidgetData", () => ({
  useWidgetData: (c: unknown, p: unknown, o: unknown) => useWidgetData(c, p, o),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

import { save } from "@tauri-apps/plugin-dialog";
import { __read } from "../test/memfs";
import { card as makeCard, widget as makeWidget } from "../test/fixtures";
import { useDashboardStore } from "../stores/dashboardStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { WidgetCard } from "./WidgetCard";

it("on iOS, an export writes the content to Documents/<name> BEFORE the picker opens", async () => {
  // iOS's save() only hands an existing file to a "move to..." picker; a card
  // that called save() first and wrote to the returned path exported an
  // empty file. The CSV has to be on disk by the time save() is called.
  // A chart, not a table: a backend table exports through the table worker,
  // which this render does not start. Both paths save through saveTextFile.
  const card = makeCard({ id: "c1", widgetId: "w1" });
  useWidgetRegistryStore.setState({ widgets: [makeWidget({ id: "w1", name: "Price History", type: "chart" })] });
  useWidgetData.mockReturnValue({ status: "ready", data: [{ a: 1 }], retry: vi.fn(), attempt: 0 });
  useDashboardStore.setState({
    dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
    activeId: "d1",
    activeTabIds: { d1: "t1" },
  });
  let onDiskAtPicker: string | undefined;
  vi.mocked(save).mockImplementation(async (opts) => {
    onDiskAtPicker = __read(String(opts?.defaultPath));
    return "/picked/out.csv";
  });

  render(<WidgetCard card={card} dashboardId="d1" onRemove={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Card menu" }));
  await userEvent.click(screen.getByRole("menuitem", { name: /^Export/ }));
  await userEvent.click(screen.getByRole("menuitem", { name: "CSV" }));

  await waitFor(() => expect(save).toHaveBeenCalled());
  // This line's toCsv writes RFC 4180 CRLF rows.
  expect(onDiskAtPicker).toBe("a\r\n1");
  // Nothing is written to the path the picker returned -- it already holds the file.
  expect(__read("/picked/out.csv")).toBeUndefined();
});

it("wraps native iPad title parameters independently of pointer type", async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15');
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
  const card = makeCard({ id: 'ipad-wrap', widgetId: 'ipad-widget' });
  useWidgetRegistryStore.setState({ widgets: [makeWidget({ id: 'ipad-widget', name: 'iPad title', type: 'chart' })] });
  useWidgetData.mockReturnValue({ status: 'ready', data: [{a: 1}], retry: vi.fn(), attempt: 0 });
  const {container} = render(<WidgetCard card={card} dashboardId="d1" onRemove={vi.fn()} />);
  expect(container.querySelector('.widget-card')).toHaveAttribute('data-parameter-layout', 'wrap');
});

it("keeps iPhone title parameters scrolling", async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X)');
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
  const card = makeCard({ id: 'iphone-scroll', widgetId: 'phone-widget' });
  useWidgetRegistryStore.setState({ widgets: [makeWidget({ id: 'phone-widget', name: 'Phone title', type: 'chart' })] });
  useWidgetData.mockReturnValue({ status: 'ready', data: [{a: 1}], retry: vi.fn(), attempt: 0 });
  const {container} = render(<WidgetCard card={card} dashboardId="d1" onRemove={vi.fn()} />);
  expect(container.querySelector('.widget-card')).toHaveAttribute('data-parameter-layout', 'scroll');
});
