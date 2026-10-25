// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ChartOptions, DeepPartial, UTCTimestamp } from "lightweight-charts";
import { CARD_BG, GRID, TEXT } from "./chartShapes";
import type { CandleColors } from "./types";
import type { UdfBar } from "./udf";

/**
 * The one module that touches lightweight-charts (TradingView's open-source
 * charting library, Apache-2.0, pinned at exactly 5.0.8 -- the version later
 * lines already ship, so carrying this forward never yields two copies).
 *
 * It is loaded with a dynamic import() inside mountCandleChart, so the main
 * bundle does not grow: the library arrives as its own chunk the first time a
 * TradingView card renders. Everything above is `import type`, which the
 * compiler erases.
 *
 * Attribution: the library asks for a link to tradingview.com on a page users
 * see, and names its on-canvas `attributionLogo` as one way to satisfy that,
 * not the only one. As in Art's Charts, the logo is off and the card shows a
 * text credit instead -- these two constants are that credit, in one place so
 * every chart built on this module shows the identical line.
 */
export const TRADINGVIEW_CREDIT_URL = "https://www.tradingview.com/lightweight-charts/";
export const TRADINGVIEW_CREDIT_LABEL = "Rendered by TradingView";

/** lightweight-charts' own candle defaults, reused for volume when a widget names none. */
const UP = "#26a69a";
const DOWN = "#ef5350";

export type CandleChartHandle = {
  /** Replaces the series. The view is fitted to the data on the first non-empty call only, so a refetch keeps zoom and pan. */
  setBars(bars: UdfBar[]): void;
  /**
   * The series' incremental `update`: replaces the newest bar when `bar.time`
   * equals it, appends when later. Never earlier -- the library throws on a bar
   * behind the last one, so the caller (the Live Chart's fold) drops those.
   */
  updateBar(bar: UdfBar): void;
  applyTheme(theme: "dark" | "light"): void;
  dispose(): void;
};

/**
 * A candlestick chart in `el`, with volume in a lower pane and its own
 * visible right-hand scale. Both panes share the time axis. Sizing is the library's `autoSize` (its own ResizeObserver),
 * so a card resized by the grid redraws without anything here watching it.
 * Background, text, grid and scale borders come from the same CARD_BG/TEXT/GRID
 * tokens themedLayout uses, so the two chart libraries look alike in both themes.
 */
export async function mountCandleChart(
  el: HTMLElement,
  {
    theme,
    colors,
    showVolume,
    barSeconds,
  }: {
    theme: "dark" | "light";
    colors: CandleColors;
    showVolume: boolean;
    /** The bar width. Under a day, the axis shows times; left out (or a day or more), dates only. */
    barSeconds?: number | null;
  },
): Promise<CandleChartHandle> {
  const lw = await import("lightweight-charts");
  // Intraday bars are labelled in the reader's own clock, as the live grid
  // resolves a typed time: the bars are UTC (live-grid runs on UTC), and the
  // library's default would print a 09:30 New York open as 13:30. Seconds show
  // only for bars that are not whole minutes. Year, month and day marks keep
  // the library's own labels.
  const intraday = barSeconds != null && barSeconds < 86400;
  const seconds = intraday && barSeconds % 60 !== 0;
  const clock = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
    hourCycle: "h23",
  });
  const stamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
  const ms = (t: unknown) => (t as number) * 1000;
  const themed = (t: "dark" | "light"): DeepPartial<ChartOptions> => ({
    layout: { background: { type: lw.ColorType.Solid, color: CARD_BG[t] }, textColor: TEXT[t] },
    grid: { vertLines: { color: GRID[t] }, horzLines: { color: GRID[t] } },
    rightPriceScale: { borderColor: GRID[t] },
    timeScale: { borderColor: GRID[t] },
  });
  const base = themed(theme);

  // The wheel belongs to the card (user ruling 2026-10-04): a wheel over the
  // chart scrolls the dashboard like the Plotly cards, instead of the library's
  // default wheel-zoom. Dragging still pans the time scale.
  const chart = lw.createChart(el, {
    autoSize: true,
    handleScroll: { mouseWheel: false },
    handleScale: { mouseWheel: false },
    ...base,
    layout: { attributionLogo: false, ...base.layout },
    ...(intraday
      ? {
          timeScale: {
            ...base.timeScale,
            timeVisible: true,
            secondsVisible: seconds,
            tickMarkFormatter: (time: unknown, type: number) =>
              type === lw.TickMarkType.Time || type === lw.TickMarkType.TimeWithSeconds ? clock.format(ms(time)) : null,
          },
          localization: { timeFormatter: (time: unknown) => `${stamp.format(ms(time))} ${clock.format(ms(time))}` },
        }
      : {}),
  });
  // The volume colours are not candlestick options; everything else in
  // CandleColors is, under the same names the widget's chartConfig uses.
  const { volumeUpColor = UP, volumeDownColor = DOWN, ...candleColors } = colors;
  const candles = chart.addSeries(lw.CandlestickSeries, candleColors);
  const volume = showVolume
    ? chart.addSeries(lw.HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "right", title: "Volume" }, 1)
    : null;
  if (volume) {
    volume.priceScale().applyOptions({ visible: true, scaleMargins: { top: 0.1, bottom: 0 } });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.05 } });
    chart.panes()[0].setStretchFactor(4);
    chart.panes()[1].setStretchFactor(1);
  }

  let fitted = false;
  return {
    setBars(bars) {
      candles.setData(
        bars.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })),
      );
      volume?.setData(
        bars.map((b) => ({
          time: b.time as UTCTimestamp,
          value: b.volume,
          color: b.close >= b.open ? volumeUpColor : volumeDownColor,
        })),
      );
      if (!fitted && bars.length > 0) {
        chart.timeScale().fitContent();
        fitted = true;
      }
    },
    updateBar(b) {
      candles.update({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close });
      volume?.update({
        time: b.time as UTCTimestamp,
        value: b.volume,
        color: b.close >= b.open ? volumeUpColor : volumeDownColor,
      });
    },
    applyTheme(t) {
      chart.applyOptions(themed(t));
    },
    dispose() {
      chart.remove();
    },
  };
}
