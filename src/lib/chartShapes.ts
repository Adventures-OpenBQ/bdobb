// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from "./isRecord";
import type { ColumnSpec } from "./types";

export type PlotlyFigure = { data: unknown[]; layout: Record<string, unknown> };

/**
 * Structural recognition, because no widget on this backend declares itself a
 * chart: an `openbb-charting` response is an object with a `data` array and a
 * `layout` object, and that pair is what we key on.
 */
export function isPlotlyFigure(payload: unknown): payload is PlotlyFigure {
  return isRecord(payload) && Array.isArray(payload.data) && isRecord(payload.layout);
}

/**
 * Is this an array of row objects? Used to decide whether a payload is even
 * eligible for row-shaped handling (chart-from-rows detection here, and the
 * "offer a Chart view" check in WidgetCard) before inspecting its columns.
 *
 * Deliberately loose: an element only has to be a non-null `object`, so an
 * array-typed element (`typeof [] === "object"`) counts as a "row" too. That
 * differs from `tableRows` in `src/lib/tableColumns.ts`, which excludes arrays with
 * `!Array.isArray(r)` — the table needs each row to have named columns to
 * build headers from, so an array element there would produce an empty
 * header row. Nothing here inspects column names before this predicate
 * accepts the data, so the two are not interchangeable; keep them separate.
 */
export function rowsOf(data: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(data)) return null;
  if (data.some((r) => typeof r !== "object" || r === null)) return null;
  return data as Array<Record<string, unknown>>;
}

/**
 * A date-shaped string: a calendar date, optionally followed by a time. Tested
 * with a pattern rather than `Date.parse` alone because `Date.parse` accepts
 * far too much — "2026" and even some bare words parse in some engines, which
 * would turn a year column or a label column into a spurious time axis.
 */
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;

function isDateLike(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== "string") return false;
  if (!DATE_LIKE.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

/** Sampled rather than exhaustive: enough to be confident, cheap on long series. */
const SAMPLE = 5;

/**
 * Scans values, not names. A backend is free to call its time axis anything —
 * the live manifest uses `date`, `period_ending` and others — so keying on the
 * column name would miss most of them and invent time axes for the rest.
 */
export function detectTimeColumn(rows: Array<Record<string, unknown>>): string | null {
  if (rows.length === 0) return null;
  const sample = rows.slice(0, SAMPLE);
  for (const key of Object.keys(rows[0])) {
    const values = sample.map((r) => r[key]).filter((v) => v !== null && v !== undefined);
    if (values.length > 0 && values.every(isDateLike)) return key;
  }
  return null;
}

const OHLC = ["open", "high", "low", "close"] as const;

/**
 * Genuinely numeric, not merely numeric-touched: every non-null sampled value
 * must be a number. Mirrors `detectTimeColumn`'s discipline (and its `SAMPLE`
 * constant) so a column that is mostly strings with one stray number does not
 * qualify, while an ordinary numeric column with occasional `null`/`undefined`
 * gaps — routine in financial time series — still does.
 */
function isNumericColumn(rows: Array<Record<string, unknown>>, key: string): boolean {
  const sample = rows.slice(0, SAMPLE);
  const values = sample.map((r) => r[key]).filter((v) => v !== null && v !== undefined);
  return values.length > 0 && values.every((v) => typeof v === "number");
}

function numericKeys(rows: Array<Record<string, unknown>>, exclude: string): string[] {
  return Object.keys(rows[0]).filter((k) => k !== exclude && isNumericColumn(rows, k));
}

/**
 * The x-axis a row payload charts on, in order: a date column; else the one
 * non-numeric column when there is exactly one (the category -- quarters,
 * sectors, tickers -- whatever its position); else the first column. A
 * non-date axis also needs at least one numeric column to plot against it,
 * or every all-text table would be offered a chart with nothing in it.
 */
export function detectChartAxis(rows: Array<Record<string, unknown>>): string | null {
  const timeKey = detectTimeColumn(rows);
  if (timeKey !== null || rows.length === 0) return timeKey;
  const keys = Object.keys(rows[0]);
  const nonNumeric = keys.filter((k) => !isNumericColumn(rows, k));
  const axis = nonNumeric.length === 1 ? nonNumeric[0] : keys[0];
  return axis !== undefined && numericKeys(rows, axis).length > 0 ? axis : null;
}

// Plotly defaults paper/plot background to white and font colour to black --
// invisible against this app's dark cards without an override. Values must
// stay in sync with --bg-card/--text (both light and dark) in styles.css by
// hand: this module has no access to CSS custom properties.
// Exported for src/lib/lwChart.ts, so a lightweight-charts card and a Plotly
// card share one background and one text colour per theme.
export const CARD_BG = { dark: "#1e242e", light: "#ffffff" };
export const TEXT = { dark: "#dfe4ec", light: "#1a1f28" };
// --border, for grid lines and axis borders (lightweight-charts' defaults are
// near-white on the dark card).
export const GRID = { dark: "#2b323d", light: "#d7dce3" };

/**
 * The paper/plot background and font colour every figure needs to be legible
 * on this app's cards. Shared by buildFigure and by the vega-lite/highcharts
 * translators so a foreign chart follows the app theme -- light and dark --
 * exactly like a native Plotly widget, rather than the colours its own spec
 * hard-coded.
 */
export function themedLayout(theme: "dark" | "light" = "dark"): Record<string, unknown> {
  return {
    paper_bgcolor: CARD_BG[theme],
    plot_bgcolor: CARD_BG[theme],
    font: { color: TEXT[theme] },
  };
}

const VOLUME_KEY = "volume";

/**
 * On a date axis: candlestick when all four OHLC columns are present and
 * genuinely numeric, otherwise one line per genuinely numeric column. On a
 * text axis (see detectChartAxis): one bar series per numeric column. Returns null rather than
 * an empty figure when there is nothing to plot, so the caller can fall back
 * to the table instead of rendering a chart with bare axes.
 */
const MARGIN = { l: 48, r: 12, t: 12, b: 32 };

export function buildFigure(
  rows: Array<Record<string, unknown>>,
  axisKey: string,
  theme: "dark" | "light" = "dark",
): PlotlyFigure | null {
  if (rows.length === 0) return null;
  const x = rows.map((r) => r[axisKey]);
  const layout: Record<string, unknown> = {
    margin: MARGIN,
    xaxis: { type: "date" },
    showlegend: true,
    ...themedLayout(theme),
  };

  if (detectTimeColumn(rows) !== axisKey) {
    // A text axis: one bar group per numeric column, the column chart
    // OpenBB Workspace draws for the same table.
    const keys = numericKeys(rows, axisKey);
    if (keys.length === 0) return null;
    return {
      data: keys.map((k) => ({ type: "bar", name: k, x, y: rows.map((r) => r[k]) })),
      layout: { ...layout, xaxis: { type: "category" } },
    };
  }

  const present = Object.keys(rows[0]);
  if (OHLC.every((k) => present.includes(k) && isNumericColumn(rows, k))) {
    const hasVolume = present.includes(VOLUME_KEY) && isNumericColumn(rows, VOLUME_KEY);

    return {
      data: [
        {
          type: "candlestick",
          x,
          open: rows.map((r) => r.open),
          high: rows.map((r) => r.high),
          low: rows.map((r) => r.low),
          close: rows.map((r) => r.close),
        },
        // A widget can return volume alongside OHLC; plotted on the price
        // axis it would be unreadable (volume runs into the millions,
        // price rarely past the hundreds), so it gets its own y-axis
        // (yaxis2) on a slice of vertical space below the price panel,
        // the standard candlestick-plus-volume layout.
        ...(hasVolume
          ? [
              {
                type: "bar",
                x,
                y: rows.map((r) => r.volume),
                yaxis: "y2",
                name: "Volume",
              },
            ]
          : []),
      ],
      layout: {
        ...layout,
        // plotly defaults rangeslider.visible to TRUE for candlestick and
        // ohlc traces, and its own attribute documentation states that "if
        // visible, perpendicular axes will be set to `fixedrange`". So the
        // default silently makes the y-axis unzoomable -- and therefore
        // unresettable by double-click, since there is no y-range to restore.
        // It also spends 15% of the plot area (the slider's default
        // thickness) on a strip this app never asked for; on a dashboard
        // card that is expensive. The spec describes "a candlestick when
        // OHLC columns are present" and nothing more.
        //
        // Only the candlestick branch needs this: the default applies to
        // candlestick/ohlc traces, not to the scatter lines below.
        xaxis: { ...(layout.xaxis as object), rangeslider: { visible: false } },
        // No volume: the price panel keeps the full plot area, same as
        // before this feature existed.
        yaxis: { domain: hasVolume ? [0.25, 1] : [0, 1] },
        ...(hasVolume ? { yaxis2: { domain: [0, 0.2] } } : {}),
      },
    };
  }

  const keys = numericKeys(rows, axisKey);
  if (keys.length === 0) return null;
  return {
    data: keys.map((k) => ({
      type: "scatter",
      mode: "lines",
      name: k,
      x,
      y: rows.map((r) => r[k]),
    })),
    layout,
  };
}

/** What a chart built from rows plots: its x column, its y columns, and whether x is time. */
export type RowChartAxes = { x: string; series: string[]; time: boolean };

/**
 * columnsDefs' `chartDataType`, when any column declares one: x is the first
 * `time` column, else the first `category` one; y is every `series` column;
 * `excluded` and undeclared columns are never plotted. With no declaration
 * at all, this is detectChartAxis exactly -- non-null whenever it is -- so a
 * widget that declares nothing is offered a chart exactly as before.
 */
export function rowChartAxes(
  rows: Array<Record<string, unknown>>,
  columns: ColumnSpec[] = [],
): RowChartAxes | null {
  const typed = columns.filter((c) => c.chartDataType !== undefined);
  if (typed.length === 0) {
    const x = detectChartAxis(rows);
    return x === null ? null : { x, series: numericKeys(rows, x), time: detectTimeColumn(rows) === x };
  }
  const axis =
    typed.find((c) => c.chartDataType === "time") ?? typed.find((c) => c.chartDataType === "category");
  const series = typed.filter((c) => c.chartDataType === "series").map((c) => c.field);
  if (axis === undefined || series.length === 0 || rows.length === 0) return null;
  return { x: axis.field, series, time: axis.chartDataType === "time" };
}

/** chartView's `chartType` as a Plotly trace. Anything not listed draws as `line`. */
function seriesTrace(chartType: string, name: string, x: unknown[], y: unknown[]): Record<string, unknown> {
  switch (chartType) {
    case "area":
      return { type: "scatter", mode: "lines", fill: "tozeroy", name, x, y };
    case "column":
      return { type: "bar", name, x, y };
    case "bar":
      // Horizontal bars: the axis column runs up the y-axis.
      return { type: "bar", orientation: "h", name, x: y, y: x };
    case "scatter":
      return { type: "scatter", mode: "markers", name, x, y };
    default:
      return { type: "scatter", mode: "lines", name, x, y };
  }
}

/**
 * The figure for a row payload. A widget that declares neither chartDataType
 * nor chartView.chartType gets buildFigure, unchanged (candlestick included).
 * Otherwise x and y come from rowChartAxes and the trace from `chartType`,
 * defaulting to a line on a time axis and columns on a category one.
 */
export function rowFigure(
  rows: Array<Record<string, unknown>>,
  columns: ColumnSpec[] | undefined,
  chartType: string | undefined,
  theme: "dark" | "light" = "dark",
): PlotlyFigure | null {
  const declared = columns?.some((c) => c.chartDataType !== undefined) ?? false;
  if (!declared && chartType === undefined) {
    const axisKey = detectChartAxis(rows);
    return axisKey === null ? null : buildFigure(rows, axisKey, theme);
  }
  const axes = rowChartAxes(rows, columns);
  if (axes === null || axes.series.length === 0) return null;
  const type = chartType ?? (axes.time ? "line" : "column");
  const x = rows.map((r) => r[axes.x]);
  const axis = { type: axes.time ? "date" : "category" };
  return {
    data: axes.series.map((k) => seriesTrace(type, k, x, rows.map((r) => r[k]))),
    layout: {
      margin: MARGIN,
      showlegend: true,
      ...themedLayout(theme),
      ...(type === "bar" ? { yaxis: axis } : { xaxis: axis }),
    },
  };
}
