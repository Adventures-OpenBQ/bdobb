// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { buildFigure, detectChartAxis, detectTimeColumn, isPlotlyFigure, rowsOf } from "./chartShapes";

const ohlc = [
  { date: "2026-01-02", open: 1, high: 3, low: 0.5, close: 2, volume: 100 },
  { date: "2026-01-03", open: 2, high: 4, low: 1.5, close: 3, volume: 120 },
];

const ohlcNoVolume = [
  { date: "2026-01-02", open: 1, high: 3, low: 0.5, close: 2 },
  { date: "2026-01-03", open: 2, high: 4, low: 1.5, close: 3 },
];

const series = [
  { period_ending: "2026-01-02", value: 10, other: 5 },
  { period_ending: "2026-01-03", value: 11, other: 6 },
];

describe("isPlotlyFigure", () => {
  it("recognises an object carrying both data and layout", () => {
    expect(isPlotlyFigure({ data: [{ x: [1] }], layout: { title: "t" } })).toBe(true);
  });

  it("rejects a lookalike missing layout", () => {
    expect(isPlotlyFigure({ data: [{ x: [1] }] })).toBe(false);
  });

  it("rejects a lookalike whose data is not an array", () => {
    expect(isPlotlyFigure({ data: { x: [1] }, layout: {} })).toBe(false);
  });

  it("rejects rows, null and primitives", () => {
    expect(isPlotlyFigure(ohlc)).toBe(false);
    expect(isPlotlyFigure(null)).toBe(false);
    expect(isPlotlyFigure("data")).toBe(false);
  });
});

describe("rowsOf", () => {
  it("accepts an array of plain objects", () => {
    expect(rowsOf(ohlc)).toEqual(ohlc);
  });

  it("rejects a non-array payload", () => {
    expect(rowsOf({ data: [], layout: {} })).toBeNull();
    expect(rowsOf("a string")).toBeNull();
    expect(rowsOf(null)).toBeNull();
  });

  it("rejects an array containing a null or non-object element", () => {
    expect(rowsOf([{ a: 1 }, null])).toBeNull();
    expect(rowsOf([{ a: 1 }, "b"])).toBeNull();
  });

  it("accepts an empty array", () => {
    expect(rowsOf([])).toEqual([]);
  });

  // Deliberately loose, unlike TableRenderer's own row predicate: an
  // array-typed element still counts as a "row" here, since nothing in this
  // module inspects column names before this check runs. See the doc
  // comment on rowsOf for why the two predicates are not interchangeable.
  it("does not reject an array-typed element", () => {
    expect(rowsOf([[1, 2, 3]])).toEqual([[1, 2, 3]]);
  });
});

describe("detectTimeColumn", () => {
  it("finds a date column by its values, whatever it is called", () => {
    expect(detectTimeColumn(series)).toBe("period_ending");
  });

  it("does not mistake a number for a date", () => {
    expect(detectTimeColumn([{ year: 2026, value: 1 }])).toBeNull();
  });

  it("does not mistake a plain string for a date", () => {
    expect(detectTimeColumn([{ symbol: "AAPL", value: 1 }])).toBeNull();
  });

  it("accepts a full ISO timestamp", () => {
    expect(detectTimeColumn([{ t: "2026-01-02T10:30:00Z", v: 1 }])).toBe("t");
  });

  it("requires every sampled value to parse, so a mixed column is not a time column", () => {
    expect(detectTimeColumn([{ d: "2026-01-02" }, { d: "not a date" }])).toBeNull();
  });

  it("rejects a column of year strings that Date.parse accepts but are not dates", () => {
    expect(detectTimeColumn([{ year: "2026", value: 1 }])).toBeNull();
  });

  it("rejects a column of month-year strings that Date.parse accepts but are not dates", () => {
    expect(detectTimeColumn([{ period: "Dec 2026", value: 1 }])).toBeNull();
  });

  it("returns null for no rows", () => {
    expect(detectTimeColumn([])).toBeNull();
  });
});

// The reference backend's "Table to Chart Widget": quarters, not dates.
const quarters = [
  { category: "Q1", value: 125000, target: 120000 },
  { category: "Q2", value: 148000, target: 140000 },
];

describe("detectChartAxis", () => {
  it("prefers a date column", () => {
    expect(detectChartAxis([{ label: "a", date: "2026-01-02", v: 1 }])).toBe("date");
  });

  it("falls back to the category column when a numeric column can go up it", () => {
    expect(detectChartAxis(quarters)).toBe("category");
  });

  it("takes the single non-numeric column wherever it sits", () => {
    expect(detectChartAxis([{ value: 1, category: "Q1", target: 2 }])).toBe("category");
  });

  it("takes the first column when several are non-numeric", () => {
    expect(detectChartAxis([{ symbol: "AAPL", name: "Apple", price: 1 }])).toBe("symbol");
  });

  it("takes the first column when every column is numeric", () => {
    expect(detectChartAxis([{ x: 1, y: 2 }])).toBe("x");
  });

  it("finds no axis in text with nothing numeric to plot", () => {
    expect(detectChartAxis([{ symbol: "AAPL", name: "Apple" }])).toBeNull();
  });
});

describe("buildFigure", () => {
  it("draws one bar series per numeric column over a text axis", () => {
    const figure = buildFigure(quarters, "category")!;
    const traces = figure.data as Array<{ type: string; name: string; x: unknown[]; y: unknown[] }>;
    expect(traces.map((t) => [t.type, t.name])).toEqual([
      ["bar", "value"],
      ["bar", "target"],
    ]);
    expect(traces[0].x).toEqual(["Q1", "Q2"]);
    expect(traces[1].y).toEqual([120000, 140000]);
    expect((figure.layout.xaxis as { type: string }).type).toBe("category");
  });

  it("builds a candlestick when open, high, low and close are all present", () => {
    const figure = buildFigure(ohlcNoVolume, "date")!;
    expect(figure.data).toHaveLength(1);
    expect((figure.data[0] as { type: string }).type).toBe("candlestick");
  });

  it("adds a volume bar on its own y-axis when a volume column is present", () => {
    const figure = buildFigure(ohlc, "date")!;
    expect(figure.data).toHaveLength(2);
    const [candle, volume] = figure.data as Array<{
      type: string;
      y?: unknown[];
      yaxis?: string;
      name?: string;
    }>;
    expect(candle.type).toBe("candlestick");
    expect(volume.type).toBe("bar");
    expect(volume.y).toEqual([100, 120]);
    expect(volume.yaxis).toBe("y2");

    const layout = figure.layout as {
      yaxis?: { domain?: number[] };
      yaxis2?: { domain?: number[] };
    };
    // Volume gets its own domain slice at the bottom, distinct from the
    // price axis's slice, rather than sharing one y-axis with a wildly
    // different value scale (shares up to millions vs. a price in the tens
    // or hundreds).
    expect(layout.yaxis2?.domain).toBeDefined();
    expect(layout.yaxis?.domain).toBeDefined();
    expect(layout.yaxis2?.domain).not.toEqual(layout.yaxis?.domain);
  });

  it("adds no volume trace or second y-axis when there is no volume column", () => {
    const figure = buildFigure(ohlcNoVolume, "date")!;
    expect(figure.data).toHaveLength(1);
    const layout = figure.layout as { yaxis2?: unknown };
    expect(layout.yaxis2).toBeUndefined();
  });

  it("does not mistake a non-numeric volume column for real volume data", () => {
    const badVolume = ohlcNoVolume.map((r) => ({ ...r, volume: "n/a" }));
    const figure = buildFigure(badVolume, "date")!;
    expect(figure.data).toHaveLength(1);
  });

  it("turns the rangeslider off, which is what keeps the y-axis zoomable", () => {
    // plotly defaults rangeslider.visible to TRUE for candlestick, and its
    // own attribute docs say "if visible, perpendicular axes will be set to
    // `fixedrange`" -- so leaving the default on silently makes the y-axis
    // unzoomable and unresettable, and costs 15% of a card's height for a
    // strip the spec never asks for.
    const figure = buildFigure(ohlc, "date")!;
    const xaxis = figure.layout.xaxis as { rangeslider?: { visible?: boolean } };
    expect(xaxis.rangeslider?.visible).toBe(false);
  });

  it("matches the app's own card background and text colour, not plotly's white default", () => {
    const figure = buildFigure(ohlcNoVolume, "date")!;
    const layout = figure.layout as {
      paper_bgcolor?: string;
      plot_bgcolor?: string;
      font?: { color?: string };
    };
    // Plotly defaults both to white and font.color to black; left alone, a
    // chart on this app's dark cards would be a white rectangle with
    // unreadably-dark axis text. Values must stay in sync with
    // --bg-card/--text in styles.css by hand -- this module has no access
    // to CSS custom properties.
    expect(layout.paper_bgcolor).toBe("#1e242e");
    expect(layout.plot_bgcolor).toBe("#1e242e");
    expect(layout.font?.color).toBe("#dfe4ec");
  });

  it("matches the app's card background on the line branch too, not just candlestick", () => {
    const figure = buildFigure(series, "period_ending")!;
    const layout = figure.layout as { paper_bgcolor?: string; plot_bgcolor?: string };
    expect(layout.paper_bgcolor).toBe("#1e242e");
    expect(layout.plot_bgcolor).toBe("#1e242e");
  });

  it("leaves the line branch's axes alone", () => {
    // The rangeslider default only applies to candlestick/ohlc traces, so a
    // line figure needs no such override -- asserting it stays absent keeps
    // the fix scoped to where the problem actually is.
    const figure = buildFigure(series, "period_ending")!;
    const xaxis = figure.layout.xaxis as { rangeslider?: unknown };
    expect(xaxis.rangeslider).toBeUndefined();
  });

  it("builds one line per numeric column when OHLC is incomplete", () => {
    const figure = buildFigure(series, "period_ending")!;
    expect(figure.data).toHaveLength(2);
    const names = figure.data.map((t) => (t as { name: string }).name).sort();
    expect(names).toEqual(["other", "value"]);
    expect((figure.data[0] as { type: string }).type).toBe("scatter");
  });

  it("excludes the time column from the plotted lines", () => {
    const figure = buildFigure(series, "period_ending")!;
    const names = figure.data.map((t) => (t as { name: string }).name);
    expect(names).not.toContain("period_ending");
  });

  it("returns null when there is no numeric column to plot", () => {
    expect(buildFigure([{ date: "2026-01-02", label: "x" }], "date")).toBeNull();
  });

  it("returns null for no rows", () => {
    expect(buildFigure([], "date")).toBeNull();
  });

  it("does not plot a column that is mostly strings with one stray number", () => {
    const mixed = [
      { date: "2026-01-02", value: 10, code: "USD" },
      { date: "2026-01-03", value: 11, code: "EUR" },
      { date: "2026-01-04", value: 12, code: "GBP" },
      { date: "2026-01-05", value: 13, code: 999 },
      { date: "2026-01-06", value: 14, code: "JPY" },
    ];
    const figure = buildFigure(mixed, "date")!;
    const names = figure.data.map((t) => (t as { name: string }).name);
    expect(names).toEqual(["value"]);
  });

  it("still plots a numeric column that has a null gap", () => {
    const withGap = [
      { date: "2026-01-02", value: 10 },
      { date: "2026-01-03", value: null },
      { date: "2026-01-04", value: 12 },
    ];
    const figure = buildFigure(withGap, "date")!;
    expect(figure.data).toHaveLength(1);
    const trace = figure.data[0] as { name: string; y: unknown[] };
    expect(trace.name).toBe("value");
    expect(trace.y).toEqual([10, null, 12]);
  });

  it("does not build a candlestick when OHLC columns hold strings, and falls through to no chart", () => {
    const stringOhlc = [
      { date: "2026-01-02", open: "1", high: "3", low: "0.5", close: "2" },
      { date: "2026-01-03", open: "2", high: "4", low: "1.5", close: "3" },
    ];
    expect(buildFigure(stringOhlc, "date")).toBeNull();
  });

  it("uses the light palette when theme is light", () => {
    const figure = buildFigure(ohlcNoVolume, "date", "light")!;
    const layout = figure.layout as {
      paper_bgcolor?: string;
      plot_bgcolor?: string;
      font?: { color?: string };
    };
    expect(layout.paper_bgcolor).toBe("#ffffff");
    expect(layout.plot_bgcolor).toBe("#ffffff");
    expect(layout.font?.color).toBe("#1a1f28");
  });

  it("defaults to the dark palette when no theme is given", () => {
    const figure = buildFigure(series, "period_ending")!;
    const layout = figure.layout as { paper_bgcolor?: string };
    expect(layout.paper_bgcolor).toBe("#1e242e");
  });
});
