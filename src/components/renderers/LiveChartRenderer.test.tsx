// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom has no canvas, so lwChart is mocked, as in TradingViewRenderer.test.
const handle = { setBars: vi.fn(), updateBar: vi.fn(), applyTheme: vi.fn(), dispose: vi.fn() };
const mountCandleChart = vi.fn(async (_el: HTMLElement, _opts: unknown) => handle);
vi.mock("../../lib/lwChart", () => ({
  mountCandleChart: (el: HTMLElement, opts: unknown) => mountCandleChart(el, opts),
  TRADINGVIEW_CREDIT_URL: "https://www.tradingview.com/lightweight-charts/",
  TRADINGVIEW_CREDIT_LABEL: "Rendered by TradingView",
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("../../lib/dataClient", async (orig) => ({
  ...(await orig<typeof import("../../lib/dataClient")>()),
  fetchWidgetData: vi.fn(),
  ticketedWsUrl: vi.fn(async (_backend: unknown, url: string) => `${url}?ticket=t${++tickets}`),
}));
let tickets = 0;
vi.mock("../../lib/logger", async (orig) => ({
  ...(await orig<typeof import("../../lib/logger")>()),
  logOnce: vi.fn(async () => {}),
}));

import { LiveChartRenderer } from "./LiveChartRenderer";
import { fetchWidgetData, ticketedWsUrl } from "../../lib/dataClient";
import { logOnce } from "../../lib/logger";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import { useSettingsStore } from "../../stores/settingsStore";
import type { BackendConfig, WidgetDef } from "../../lib/types";
import { FakeSocket } from "../../test/fakeSocket";

// The real useReconnectingSocket runs on the spec-accurate fake, as in
// LiveGridRenderer.test: what is pinned is the wire the backend sees.
const widget = { id: "lc", type: "live_chart", endpoint: "series", wsEndpoint: "live_grid_ws" } as unknown as WidgetDef;
const backend = { id: "b", name: "live-grid", baseUrl: "http://h" } as BackendConfig;
const T0 = Date.UTC(2026, 9, 9, 13, 30) / 1000;
const envelope = {
  symbol: "AAPL",
  interval: "1m",
  bars: [{ date: "2026-10-09T13:30:00+00:00", open: 10, high: 11, low: 9, close: 10.5, volume: 100 }],
  cache: {},
};
const seeded = { time: T0, open: 10, high: 11, low: 9, close: 10.5, volume: 100 };

function socket(): FakeSocket {
  if (!FakeSocket.last) throw new Error("no socket was opened");
  return FakeSocket.last;
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeSocket.last = null;
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.mocked(fetchWidgetData).mockResolvedValue(envelope);
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark" } });
  // 13:30:20 UTC: inside the seeded bar's minute.
  vi.spyOn(Date, "now").mockReturnValue((T0 + 20) * 1000);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LiveChartRenderer", () => {
  it("seeds from /series for the first symbol, subscribes, folds ticks, and closes the socket on unmount", async () => {
    const { unmount } = render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL, MSFT", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledWith([seeded]));
    expect(vi.mocked(fetchWidgetData).mock.calls[0][2]).toEqual({ symbol: "AAPL", interval: "1m" });
    // One symbol is drawn, and the card says so.
    expect(screen.getByText(/Charting AAPL only/)).toBeInTheDocument();
    expect(screen.getByText("Rendered by TradingView")).toBeInTheDocument();

    expect(socket().url).toBe("ws://h/live_grid_ws");
    act(() => socket().open());
    expect(socket().sent).toEqual([JSON.stringify({ params: { symbol: "AAPL" } })]);

    // Same minute: the seeded bar moves. Another symbol: nothing.
    act(() => socket().emit({ symbol: "AAPL", price: 12, last_size: 5, updated_at: "13:30:15" }));
    expect(handle.updateBar).toHaveBeenLastCalledWith({ ...seeded, high: 12, close: 12, volume: 105 });
    act(() => socket().emit({ symbol: "MSFT", price: 400, updated_at: "13:30:16" }));
    expect(handle.updateBar).toHaveBeenCalledTimes(1);
    // The next minute, in the array shape: a new bar, built on the folded one.
    act(() => socket().emit([{ symbol: "AAPL", price: 13, last_size: 1, updated_at: "13:31:02" }]));
    expect(handle.updateBar).toHaveBeenLastCalledWith({ time: T0 + 60, open: 13, high: 13, low: 13, close: 13, volume: 1 });
    // Older than the newest bar: ignored.
    act(() => socket().emit({ symbol: "AAPL", price: 1, updated_at: "13:29:59" }));
    expect(handle.updateBar).toHaveBeenCalledTimes(2);

    unmount();
    expect(socket().closed).toBe(true);
    expect(handle.dispose).toHaveBeenCalled();
  });

  it("adds the change in stream_volume: baseline first, then deltas; volume and last_size ignored", async () => {
    render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalled());
    act(() => socket().open());
    const tick = (price: number, stream: number, volume: number) =>
      act(() => socket().emit({ symbol: "AAPL", price, last_size: 99, stream_volume: stream, volume, updated_ts: "2026-10-09T13:30:10+00:00" }));
    tick(11, 300, 50_000);
    expect(handle.updateBar).toHaveBeenLastCalledWith({ ...seeded, high: 11, close: 11, volume: 100 });
    // A re-seed on the server moved `volume` by 9,000; only the stream's 40 count.
    tick(11.5, 340, 59_000);
    expect(handle.updateBar).toHaveBeenLastCalledWith({ ...seeded, high: 11.5, close: 11.5, volume: 140 });
  });

  it("falls back to the day volume's deltas without stream_volume (an older live-grid)", async () => {
    render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalled());
    act(() => socket().open());
    act(() => socket().emit({ symbol: "AAPL", price: 11, last_size: 99, volume: 50_000, updated_ts: "2026-10-09T13:30:10+00:00" }));
    act(() => socket().emit({ symbol: "AAPL", price: 11, last_size: 99, volume: 50_025, updated_ts: "2026-10-09T13:30:11+00:00" }));
    expect(handle.updateBar).toHaveBeenLastCalledWith({ ...seeded, high: 11, close: 11, volume: 125 });
  });

  // Review F1: the first row after a gap must not credit the outage's volume to one bar.
  it("re-seeds on a reopen and starts the volume baseline over", async () => {
    render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledTimes(1));
    act(() => socket().open());
    const tick = (stream: number) =>
      act(() => socket().emit({ symbol: "AAPL", price: 11, stream_volume: stream, updated_ts: "2026-10-09T13:30:10+00:00" }));
    tick(1000);
    const first = socket();
    act(() => first.close());
    await waitFor(() => expect(FakeSocket.all).toHaveLength(2), { timeout: 3000 });
    // The first open does not re-seed; the reopen does.
    expect(fetchWidgetData).toHaveBeenCalledTimes(1);
    act(() => socket().open());
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledTimes(2));
    expect(fetchWidgetData).toHaveBeenCalledTimes(2);
    tick(5000);
    expect(handle.updateBar).toHaveBeenLastCalledWith({ ...seeded, high: 11, close: 11, volume: 100 });
    tick(5010);
    expect(handle.updateBar).toHaveBeenLastCalledWith({ ...seeded, high: 11, close: 11, volume: 110 });
  });

  it("asks a fresh socket ticket for every connect when the credential is a header", async () => {
    const keyed = { ...backend, authLocation: "header", headerName: "Authorization", headerValue: "Bearer x" } as BackendConfig;
    render(<LiveChartRenderer widget={widget} backend={keyed} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(FakeSocket.all).toHaveLength(1));
    expect(socket().url).toMatch(/^ws:\/\/h\/live_grid_ws\?ticket=t\d+$/);
    expect(socket().url).not.toContain("Bearer");
    act(() => socket().close());
    await waitFor(() => expect(FakeSocket.all).toHaveLength(2), { timeout: 3000 });
    expect(FakeSocket.all[1].url).not.toBe(FakeSocket.all[0].url);
    expect(ticketedWsUrl).toHaveBeenCalledTimes(2);
  });

  it("re-themes the live chart on a theme flip instead of remounting it", async () => {
    render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalled());
    expect(mountCandleChart.mock.calls[0][1]).toEqual({ theme: "dark", colors: {}, showVolume: true, barSeconds: 60 });
    act(() => useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "light" } }));
    expect(handle.applyTheme).toHaveBeenLastCalledWith("light");
    expect(mountCandleChart).toHaveBeenCalledTimes(1);
  });

  it("under StrictMode leaves one live chart and one open socket", async () => {
    render(
      <StrictMode>
        <LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />
      </StrictMode>,
    );
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledWith([seeded]));
    expect(handle.dispose).toHaveBeenCalledTimes(mountCandleChart.mock.calls.length - 1);
    expect(FakeSocket.all.filter((s) => !s.closed)).toHaveLength(1);
  });

  it("disposes the chart and mounts a new one for a new symbol, clearing the old one's error", async () => {
    vi.mocked(fetchWidgetData).mockRejectedValueOnce(new Error("HTTP 502: Bad Gateway"));
    const { rerender } = render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(screen.getByText("HTTP 502: Bad Gateway")).toBeInTheDocument());
    let answer: (v: unknown) => void = () => {};
    vi.mocked(fetchWidgetData).mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    rerender(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "MSFT", interval: "1m" }} />);
    // Review F7: AAPL's error is not MSFT's.
    expect(screen.queryByText("HTTP 502: Bad Gateway")).toBeNull();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    await act(async () => answer(envelope));
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledTimes(1));

    rerender(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "TSLA", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledTimes(2));
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(mountCandleChart).toHaveBeenCalledTimes(2);
  });

  it("keeps the drawn chart when a Refresh fails, and logs it once", async () => {
    const { rerender } = render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalled());
    vi.mocked(fetchWidgetData).mockRejectedValueOnce(new Error("HTTP 502: Bad Gateway"));
    rerender(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} refreshKey={1} />);
    await waitFor(() => expect(logOnce).toHaveBeenCalledWith("live-chart-refetch:lc", expect.stringContaining("keeping the last bars")));
    expect(screen.queryByText("HTTP 502: Bad Gateway")).toBeNull();
    expect(screen.getByTestId("live-chart-plot")).toBeInTheDocument();
  });

  // Review F5: an empty seed that ticks then fills.
  it("drops the empty-seed note once a tick draws, and keeps those bars through a failed Refresh", async () => {
    vi.mocked(fetchWidgetData).mockResolvedValueOnce({ ...envelope, bars: [] });
    const { rerender } = render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(screen.getByText("No bars for AAPL yet.")).toBeInTheDocument());
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledWith([]));
    act(() => socket().open());
    act(() => socket().emit({ symbol: "AAPL", price: 12, updated_ts: "2026-10-09T13:30:15+00:00" }));
    expect(handle.updateBar).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("No bars for AAPL yet.")).toBeNull();
    vi.mocked(fetchWidgetData).mockRejectedValueOnce(new Error("HTTP 502: Bad Gateway"));
    rerender(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} refreshKey={1} />);
    await waitFor(() => expect(logOnce).toHaveBeenCalledWith("live-chart-refetch:lc", expect.any(String)));
    expect(screen.queryByText("HTTP 502: Bad Gateway")).toBeNull();
    expect(screen.getByTestId("live-chart-plot")).toBeInTheDocument();
  });

  it("shows a chart library that fails to load as an error, and Retry mounts it again", async () => {
    mountCandleChart.mockRejectedValueOnce(new Error("chunk failed"));
    render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(screen.getByText("chart library failed to load")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledWith([seeded]));
    expect(mountCandleChart).toHaveBeenCalledTimes(2);
  });

  // Review F6.
  it("with an interval it cannot bucket, shows the seed and a note and opens no socket", async () => {
    const { rerender } = render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "2w" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledWith([seeded]));
    expect(screen.getByText('Live updates are off: "2w" is not an interval this chart reads.')).toBeInTheDocument();
    rerender(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL" }} />);
    await waitFor(() => expect(screen.getByText("Live updates are off: no interval is set.")).toBeInTheDocument());
    expect(FakeSocket.all).toHaveLength(0);
  });

  // The deleted WidgetCard raw-JSON test also pinned this (review F12): keys a release
  // adds to /series' cache (the lake read-back's, or none yet named) are no error.
  it("draws an envelope whose cache carries keys the client has never heard of, with no error", async () => {
    vi.mocked(fetchWidgetData).mockResolvedValueOnce({
      ...envelope,
      cache: { cache: "hit", rows_from_ticks: 3, rows_from_lake: 390, lake_days: ["2026-10-09"], a_key_no_release_has_yet: { nested: [1] } },
    });
    render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledWith([seeded]));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Retry")).toBeNull();
  });

  it("re-seeds on an interval change without re-sending the unchanged subscribe frame", async () => {
    const { rerender } = render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalled());
    act(() => socket().open());
    rerender(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "5m" }} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(2));
    expect(socket().sent).toEqual([JSON.stringify({ params: { symbol: "AAPL" } })]);
  });

  it("re-seeds and re-subscribes on a symbol change, and re-fetches the seed on Refresh", async () => {
    const { rerender } = render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalled());
    act(() => socket().open());

    rerender(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "MSFT", interval: "1m" }} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetchWidgetData).mock.calls[1][2]).toEqual({ symbol: "MSFT", interval: "1m" });
    expect(socket().sent.at(-1)).toBe(JSON.stringify({ params: { symbol: "MSFT" } }));
    expect(FakeSocket.all).toHaveLength(1);

    rerender(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "MSFT", interval: "5m" }} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(3));
    rerender(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "MSFT", interval: "5m" }} refreshKey={1} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(4));
  });

  it("without a wsEndpoint (a v3 reference backend) shows the seeded chart and opens no socket", async () => {
    const plain = { ...widget, wsEndpoint: undefined } as WidgetDef;
    render(<LiveChartRenderer widget={plain} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledWith([seeded]));
    expect(FakeSocket.all).toHaveLength(0);
  });

  it("shows a failed seed as an error with Retry", async () => {
    vi.mocked(fetchWidgetData).mockRejectedValue(new Error("HTTP 502: Bad Gateway"));
    render(<LiveChartRenderer widget={widget} backend={backend} params={{ symbol: "AAPL", interval: "1m" }} />);
    await waitFor(() => expect(screen.getByText("HTTP 502: Bad Gateway")).toBeInTheDocument());
  });
});
