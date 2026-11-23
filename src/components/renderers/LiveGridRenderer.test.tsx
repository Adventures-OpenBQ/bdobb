// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const messageSinks: Array<(m: unknown) => void> = [];
vi.mock("../../hooks/useReconnectingSocket", () => ({
  useReconnectingSocket: (_url: string | null, _sub: unknown, onMessage: (m: unknown) => void) => {
    messageSinks.push(onMessage);
    return "live";
  },
}));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("../../lib/plotly", () => ({
  renderPlot: () => Promise.resolve(),
  purgePlot: () => {},
  resizePlot: () => {},
  REGISTERED_TRACE_TYPES: new Set(["scatter"]),
}));

import { fetch } from "@tauri-apps/plugin-http";
import { WidgetCard } from "../WidgetCard";
import { LiveGridRenderer } from "./LiveGridRenderer";
import { backend as makeBackend, card, widget as makeWidget } from "../../test/fixtures";
import { useBackendsStore } from "../../stores/backendsStore";
import { useDashboardStore } from "../../stores/dashboardStore";
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
import { installVirtualizerDom } from "../../test/virtualizer";

installVirtualizerDom();

const widget = makeWidget({
  type: "live_grid",
  endpoint: "grid_data",
  wsEndpoint: "grid_ws",
  wsRowIdColumn: "symbol",
});
const backend = makeBackend();

const snapshot = (price: number) =>
  new Response(JSON.stringify([{ symbol: "TSLA", price }]), {
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.mocked(fetch).mockReset().mockImplementation(async () => snapshot(10));
});

afterEach(() => {
  messageSinks.length = 0;
});

describe("LiveGridRenderer", () => {
  it("renders the snapshot, updates a row by id, and appends an unknown one", async () => {
    render(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} />);
    await waitFor(() => expect(screen.getByText("10")).toBeInTheDocument());

    act(() => messageSinks[0]({ symbol: "TSLA", price: 11 }));
    await waitFor(() => expect(screen.getByText("11")).toBeInTheDocument());

    act(() => messageSinks[0]({ symbol: "AAPL", price: 5 }));
    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
  });

  // The card does not fetch a live_grid (builtins exclude it), so a failed
  // snapshot is this renderer's to show -- not a silent "No rows.".
  it("shows a failed snapshot as an error with a Retry that refetches", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 500 }));
    render(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 500");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("10")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

it("retries a failed Live Grid snapshot from the header and reloads it on refresh-all", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(new Response("", { status: 500 }))
    .mockResolvedValueOnce(snapshot(10))
    .mockResolvedValueOnce(snapshot(20));
  const liveCard = card({ params: { symbol: "TSLA" } });
  useBackendsStore.setState({ backends: [backend], statuses: {} });
  useWidgetRegistryStore.setState({ widgets: [widget] });
  useDashboardStore.setState({
    dashboards: [{ id: "d", name: "D", tabs: [{ id: "t", name: "T", cards: [liveCard] }] }],
    activeId: "d", activeTabId: "t", viewer: false, refreshEpoch: 0,
  });
  render(<WidgetCard card={liveCard} onRemove={() => {}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 500");

  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByText("10")).toBeInTheDocument();

  act(() => useDashboardStore.getState().refreshAll());
  expect(await screen.findByText("20")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("cancels a superseded snapshot and its replacement on unmount", async () => {
  vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => {}));
  const view = render(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "TSLA" }} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const first = vi.mocked(fetch).mock.calls[0][1]?.signal;

  view.rerender(<LiveGridRenderer widget={widget} backend={backend} params={{ symbol: "AAPL" }} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(first?.aborted).toBe(true);

  view.unmount();
  expect(vi.mocked(fetch).mock.calls[1][1]?.signal?.aborted).toBe(true);
});
