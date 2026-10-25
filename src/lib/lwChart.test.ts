// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";

// lightweight-charts draws to canvas, which jsdom lacks -- the same reason
// ChartRenderer.test.tsx mocks plotly. What carries logic here is which
// options and data this module hands the library, so that is what's asserted.
const series = () => {
  const scale = { applyOptions: vi.fn() };
  return { setData: vi.fn(), update: vi.fn(), priceScale: vi.fn(() => scale) };
};
const fitContent = vi.fn();
const panes = [{ setStretchFactor: vi.fn() }, { setStretchFactor: vi.fn() }];
const chart = {
  addSeries: vi.fn((_def: unknown, _opts?: unknown, _pane?: number) => series()),
  panes: () => panes,
  applyOptions: vi.fn(),
  remove: vi.fn(),
  timeScale: () => ({ fitContent }),
};
const createChart = vi.fn((_el: HTMLElement, _opts: unknown) => chart);
vi.mock("lightweight-charts", () => ({
  ColorType: { Solid: "solid" },
  CandlestickSeries: { type: "Candlestick" },
  HistogramSeries: { type: "Histogram" },
  TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 },
  createChart: (el: HTMLElement, opts: unknown) => createChart(el, opts),
}));

import { CARD_BG, GRID, TEXT } from "./chartShapes";
import { mountCandleChart, TRADINGVIEW_CREDIT_LABEL, TRADINGVIEW_CREDIT_URL } from "./lwChart";

const bars = [
  { time: 10, open: 1, high: 3, low: 0.5, close: 2, volume: 100 },
  { time: 20, open: 3, high: 4, low: 1.5, close: 2, volume: 200 },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mountCandleChart", () => {
  it("creates an auto-sized chart in the app's card colours with the on-canvas logo off and the wheel left to the card", async () => {
    await mountCandleChart(document.createElement("div"), { theme: "dark", colors: {}, showVolume: true });
    expect(createChart.mock.calls[0][1]).toEqual({
      autoSize: true,
      // User ruling 2026-10-04: the wheel scrolls the card, as on the Plotly
      // cards; drag still pans.
      handleScroll: { mouseWheel: false },
      handleScale: { mouseWheel: false },
      layout: {
        attributionLogo: false,
        background: { type: "solid", color: CARD_BG.dark },
        textColor: TEXT.dark,
      },
      grid: { vertLines: { color: GRID.dark }, horzLines: { color: GRID.dark } },
      rightPriceScale: { borderColor: GRID.dark },
      timeScale: { borderColor: GRID.dark },
    });
  });

  it("shows local hours and minutes on an intraday axis, and leaves a daily one on dates", async () => {
    type Axis = {
      timeVisible: boolean;
      secondsVisible: boolean;
      tickMarkFormatter: (t: number, type: number) => string | null;
    };
    const axis = (n: number) => (createChart.mock.calls[n][1] as { timeScale: Axis }).timeScale;
    // Built from local parts, so 09:30 holds in whatever zone the suite runs in.
    const open = new Date(2026, 9, 16, 9, 30, 15).getTime() / 1000;

    await mountCandleChart(document.createElement("div"), { theme: "dark", colors: {}, showVolume: true, barSeconds: 60 });
    expect(axis(0)).toMatchObject({ borderColor: GRID.dark, timeVisible: true, secondsVisible: false });
    expect(axis(0).tickMarkFormatter(open, 3)).toBe("09:30");
    // A day mark keeps the library's own label.
    expect(axis(0).tickMarkFormatter(open, 2)).toBeNull();

    await mountCandleChart(document.createElement("div"), { theme: "dark", colors: {}, showVolume: true, barSeconds: 1 });
    expect(axis(1)).toMatchObject({ timeVisible: true, secondsVisible: true });
    expect(axis(1).tickMarkFormatter(open, 4)).toBe("09:30:15");

    await mountCandleChart(document.createElement("div"), { theme: "dark", colors: {}, showVolume: true, barSeconds: 86400 });
    expect(createChart.mock.calls[2][1]).toMatchObject({ timeScale: { borderColor: GRID.dark } });
    expect(createChart.mock.calls[2][1]).not.toHaveProperty("timeScale.timeVisible");
    expect(createChart.mock.calls[2][1]).not.toHaveProperty("localization");
  });

  it("hands the candle colours to the candlestick series and keeps the volume ones back", async () => {
    await mountCandleChart(document.createElement("div"), {
      theme: "dark",
      colors: { upColor: "#0a0", downColor: "#a00", volumeUpColor: "#0f0" },
      showVolume: true,
    });
    expect(chart.addSeries.mock.calls[0]).toEqual([{ type: "Candlestick" }, { upColor: "#0a0", downColor: "#a00" }]);
    expect(chart.addSeries.mock.calls[1][0]).toEqual({ type: "Histogram" });
  });

  it("adds no volume series when showVolume is off", async () => {
    await mountCandleChart(document.createElement("div"), { theme: "dark", colors: {}, showVolume: false });
    expect(chart.addSeries).toHaveBeenCalledTimes(1);
    expect(panes[0].setStretchFactor).not.toHaveBeenCalled();
    expect(panes[1].setStretchFactor).not.toHaveBeenCalled();
  });

  it("sets candles and up/down-coloured volume, fitting the view only on the first load", async () => {
    const handle = await mountCandleChart(document.createElement("div"), {
      theme: "dark",
      colors: { volumeUpColor: "#0f0", volumeDownColor: "#f00" },
      showVolume: true,
    });
    const candles = chart.addSeries.mock.results[0].value;
    const volume = chart.addSeries.mock.results[1].value;
    expect(chart.addSeries.mock.calls[1]).toEqual([
      { type: "Histogram" },
      { priceFormat: { type: "volume" }, priceScaleId: "right", title: "Volume" },
      1,
    ]);
    expect(volume.priceScale().applyOptions).toHaveBeenCalledWith({ visible: true, scaleMargins: { top: 0.1, bottom: 0 } });
    expect(candles.priceScale().applyOptions).toHaveBeenCalledWith({ scaleMargins: { top: 0.1, bottom: 0.05 } });
    expect(panes[0].setStretchFactor).toHaveBeenCalledWith(4);
    expect(panes[1].setStretchFactor).toHaveBeenCalledWith(1);
    handle.setBars(bars);
    expect(candles.setData).toHaveBeenCalledWith([
      { time: 10, open: 1, high: 3, low: 0.5, close: 2 },
      { time: 20, open: 3, high: 4, low: 1.5, close: 2 },
    ]);
    expect(volume.setData).toHaveBeenCalledWith([
      { time: 10, value: 100, color: "#0f0" },
      { time: 20, value: 200, color: "#f00" },
    ]);
    handle.setBars(bars);
    // A refetch must not throw away the reader's zoom and pan.
    expect(fitContent).toHaveBeenCalledTimes(1);
    handle.updateBar({ ...bars[1], close: 3, volume: 250 });
    expect(candles.update).toHaveBeenCalledWith({ time: 20, open: 3, high: 4, low: 1.5, close: 3 });
    expect(volume.update).toHaveBeenCalledWith({ time: 20, value: 250, color: "#0f0" });
    expect(fitContent).toHaveBeenCalledTimes(1);
  });

  it("re-themes in place and removes the chart on dispose", async () => {
    const handle = await mountCandleChart(document.createElement("div"), { theme: "dark", colors: {}, showVolume: true });
    handle.applyTheme("light");
    expect(chart.applyOptions).toHaveBeenCalledWith({
      layout: { background: { type: "solid", color: CARD_BG.light }, textColor: TEXT.light },
      grid: { vertLines: { color: GRID.light }, horzLines: { color: GRID.light } },
      rightPriceScale: { borderColor: GRID.light },
      timeScale: { borderColor: GRID.light },
    });
    handle.dispose();
    expect(chart.remove).toHaveBeenCalledTimes(1);
  });
});

it("exports the credit the card shows", () => {
  expect(TRADINGVIEW_CREDIT_URL).toBe("https://www.tradingview.com/lightweight-charts/");
  expect(TRADINGVIEW_CREDIT_LABEL).toBe("Rendered by TradingView");
});
