// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom has no canvas, so lwChart is mocked, as plotly is for ChartRenderer.
// What carries logic here is what the renderer asks for and hands over.
const handle = { setBars: vi.fn(), applyTheme: vi.fn(), dispose: vi.fn() };
const mountCandleChart = vi.fn(async (_el: HTMLElement, _opts: unknown) => handle);
vi.mock("../../lib/lwChart", () => ({
  mountCandleChart: (el: HTMLElement, opts: unknown) => mountCandleChart(el, opts),
  TRADINGVIEW_CREDIT_URL: "https://www.tradingview.com/lightweight-charts/",
  TRADINGVIEW_CREDIT_LABEL: "Rendered by TradingView",
}));
vi.mock("../../lib/dataClient", async (orig) => ({
  ...(await orig<typeof import("../../lib/dataClient")>()),
  fetchWidgetData: vi.fn(),
}));
const openUrl = vi.fn((_url: string) => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrl(url) }));
const logOnce = vi.fn((_key: string, _message: string) => Promise.resolve());
vi.mock("../../lib/logger", () => ({
  logOnce: (k: string, m: string) => logOnce(k, m),
  logError: () => Promise.resolve(),
}));

import { TradingViewRenderer } from "./TradingViewRenderer";
import { fetchWidgetData } from "../../lib/dataClient";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import type { BackendConfig, UdfChartSpec, WidgetDef } from "../../lib/types";
import { useSettingsStore } from "../../stores/settingsStore";

const fetchMock = vi.mocked(fetchWidgetData);
const widget = { id: "tv", type: "advanced_charting", endpoint: "/udf" } as unknown as WidgetDef;
const backend = { id: "b1", baseUrl: "http://h" } as BackendConfig;
const spec: UdfChartSpec = {
  defaultSymbol: "AAPL",
  updateFrequency: 60000,
  colors: { upColor: "#0a0" },
  showVolume: true,
};
const ok = { s: "ok", t: [10], o: [1], h: [2], l: [0.5], c: [1.5], v: [100] };
const bar = { time: 10, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 };

function show(over: Partial<UdfChartSpec> = {}, refreshKey = 0) {
  return render(<TradingViewRenderer widget={widget} backend={backend} spec={{ ...spec, ...over }} refreshKey={refreshKey} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark" } });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("TradingViewRenderer", () => {
  it("asks the history route through the data client for a year of daily bars", async () => {
    fetchMock.mockResolvedValue(ok);
    show();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [b, w, params] = fetchMock.mock.calls[0];
    expect(b).toBe(backend);
    expect(w.endpoint).toBe("/udf/history");
    expect(params).toMatchObject({ symbol: "AAPL", resolution: "D" });
    expect(Number(params.to) - Number(params.from)).toBe(365 * 24 * 60 * 60);
  });

  it("draws the bars with the widget's colours and theme", async () => {
    fetchMock.mockResolvedValue(ok);
    show();
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledWith([bar]));
    expect(mountCandleChart.mock.calls[0][1]).toEqual({ theme: "dark", colors: { upColor: "#0a0" }, showVolume: true });
  });

  it("honours showVolume: false", async () => {
    fetchMock.mockResolvedValue(ok);
    show({ showVolume: false });
    await waitFor(() => expect(mountCandleChart).toHaveBeenCalled());
    expect(mountCandleChart.mock.calls[0][1]).toMatchObject({ showVolume: false });
  });

  it("re-themes the mounted chart in place rather than remounting it", async () => {
    fetchMock.mockResolvedValue(ok);
    show();
    await waitFor(() => expect(handle.setBars).toHaveBeenCalled());
    act(() => useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "light" } }));
    expect(handle.applyTheme).toHaveBeenLastCalledWith("light");
    expect(mountCandleChart).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state for no_data", async () => {
    fetchMock.mockResolvedValue({ s: "no_data" });
    show();
    expect(await screen.findByText("No bars for AAPL")).toBeInTheDocument();
    expect(mountCandleChart).not.toHaveBeenCalled();
  });

  it("shows the backend's errmsg with a working Retry", async () => {
    fetchMock.mockResolvedValueOnce({ s: "error", errmsg: "Symbol not found" }).mockResolvedValueOnce(ok);
    show();
    expect(await screen.findByText("Symbol not found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(handle.setBars).toHaveBeenCalledWith([bar]));
  });

  it("shows a malformed payload as an error, never a blank chart", async () => {
    fetchMock.mockResolvedValue("<html>");
    show();
    expect(await screen.findByText("not a UDF history payload")).toBeInTheDocument();
  });

  it("shows the data client's HTTP error wording", async () => {
    fetchMock.mockRejectedValue(new Error("HTTP 404: Not Found"));
    show();
    expect(await screen.findByText("HTTP 404: Not Found")).toBeInTheDocument();
  });

  it("refetches every updateFrequency and keeps the last bars when a refetch fails", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(ok).mockRejectedValueOnce(new Error("HTTP 502"));
    show({ updateFrequency: 5000 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("tv-chart-plot")).toBeInTheDocument();
    expect(logOnce).toHaveBeenCalledTimes(1);
  });

  it("refetches when the header's Refresh bumps refreshKey", async () => {
    fetchMock.mockResolvedValue(ok);
    // The SAME spec object both times: a new one would refetch on its own and
    // hide whether refreshKey does.
    const view = render(<TradingViewRenderer widget={widget} backend={backend} spec={spec} refreshKey={0} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    view.rerender(<TradingViewRenderer widget={widget} backend={backend} spec={spec} refreshKey={1} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("disposes the chart on unmount", async () => {
    fetchMock.mockResolvedValue(ok);
    const view = show();
    await waitFor(() => expect(handle.setBars).toHaveBeenCalled());
    view.unmount();
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes a chart whose library arrives after the card is gone", async () => {
    fetchMock.mockResolvedValue(ok);
    let resolve!: (h: typeof handle) => void;
    mountCandleChart.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const view = show();
    await waitFor(() => expect(mountCandleChart).toHaveBeenCalled());
    view.unmount();
    await act(async () => resolve(handle));
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(handle.setBars).not.toHaveBeenCalled();
  });

  it("says so when the chart library fails to load", async () => {
    fetchMock.mockResolvedValue(ok);
    mountCandleChart.mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module"));
    show();
    expect(await screen.findByText("chart library failed to load")).toBeInTheDocument();
    expect(logOnce).toHaveBeenCalledWith("lightweight-charts-load", expect.stringContaining("Failed to fetch"));
  });

  it("credits TradingView with a link opened through the opener, not the webview", async () => {
    fetchMock.mockResolvedValue(ok);
    show();
    const link = await screen.findByRole("link", { name: "Rendered by TradingView" });
    expect(link).toHaveAttribute("href", "https://www.tradingview.com/lightweight-charts/");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(openUrl).toHaveBeenCalledWith("https://www.tradingview.com/lightweight-charts/");
  });

  it("falls back to window.open when the opener rejects", async () => {
    fetchMock.mockResolvedValue(ok);
    openUrl.mockRejectedValueOnce(new Error("no opener"));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    show();
    fireEvent.click(await screen.findByRole("link", { name: "Rendered by TradingView" }));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith("https://www.tradingview.com/lightweight-charts/", "_blank", "noopener,noreferrer"),
    );
    open.mockRestore();
  });
});
