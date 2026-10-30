// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// plotly.js does not run under jsdom — it needs canvas and layout APIs jsdom
// lacks. The module is mocked so these tests can assert WHICH figure the
// renderer decided to draw, which is the part that carries logic. That plotly
// itself draws correctly is not something a unit test can establish.
const renderPlot = vi.fn((_node: HTMLElement, _figure: unknown, _uirevision?: unknown) =>
  Promise.resolve(),
);
const purgePlot = vi.fn();
const resizePlot = vi.fn();
vi.mock("../../lib/plotly", () => ({
  renderPlot: (n: HTMLElement, f: unknown, u?: unknown) => renderPlot(n, f, u),
  purgePlot: (n: HTMLElement) => purgePlot(n),
  resizePlot: (n: HTMLElement) => resizePlot(n),
  // Mirrors the real module's derivation: only what chartShapes can produce.
  REGISTERED_TRACE_TYPES: new Set(["scatter", "candlestick", "bar"]),
}));

const logError = vi.fn((_message: string) => Promise.resolve());
vi.mock("../../lib/logger", () => ({
  logError: (message: string) => logError(message),
}));

import { ChartRenderer } from "./ChartRenderer";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import { useSettingsStore } from "../../stores/settingsStore";

// jsdom implements no ResizeObserver at all. This stub captures the
// callback each ChartRenderer instance registers, and every instance
// created, so a test can trigger a "resize" by hand and inspect whether an
// instance was torn down — without pulling in a real observer.
class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  callback: ResizeObserverCallback;
  disconnected = false;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverStub.instances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
}

const ohlc = [
  { date: "2026-01-02", open: 1, high: 3, low: 0.5, close: 2 },
  { date: "2026-01-03", open: 2, high: 4, low: 1.5, close: 3 },
];

beforeEach(() => {
  renderPlot.mockClear();
  purgePlot.mockClear();
  resizePlot.mockClear();
  logError.mockClear();
  ResizeObserverStub.instances = [];
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
});

/**
 * A real ResizeObserver always delivers at least one entry carrying a
 * contentRect. The stub used to pass an empty array, which was harmless only
 * while the implementation ignored entries; it now reads them to tell a real
 * size change from plotly redrawing its own SVG inside the node.
 */
function sizeEntry(width: number, height: number): ResizeObserverEntry[] {
  return [{ contentRect: { width, height } }] as unknown as ResizeObserverEntry[];
}

function figureFromLastCall() {
  return renderPlot.mock.calls.at(-1)![1] as { data: Array<{ type: string }> };
}

describe("ChartRenderer", () => {
  it("draws a native figure payload as-is", async () => {
    // Was `type: "bar"`. The fixture was switched to a registered type
    // ("scatter") so this test exercises the draw-as-is path; refusal of an
    // unregistered trace type is covered separately by "refuses a native
    // figure with an unregistered trace type" using `pie`.
    const native = { data: [{ type: "scatter", x: [1], y: [2] }], layout: { title: "t" } };
    render(<ChartRenderer data={native} />);
    expect(renderPlot).toHaveBeenCalledTimes(1);
    expect(figureFromLastCall()).toEqual(native);
  });

  it("draws a native figure whose traces are all registered types", () => {
    const native = {
      data: [
        { type: "scatter", x: [1], y: [2] },
        { type: "candlestick", x: [1], open: [1], high: [2], low: [0], close: [1] },
      ],
      layout: {},
    };
    render(<ChartRenderer data={native} />);
    expect(renderPlot).toHaveBeenCalledTimes(1);
    expect(figureFromLastCall()).toEqual(native);
  });

  it("refuses a native figure with an unregistered trace type", () => {
    const native = { data: [{ type: "pie", x: [1], y: [2] }], layout: {} };
    render(<ChartRenderer data={native} />);
    expect(renderPlot).not.toHaveBeenCalled();
    expect(screen.getByText(/does not include/i)).toBeInTheDocument();
    expect(screen.getByText(/pie/)).toBeInTheDocument();
  });

  it("draws a native figure trace that omits `type`, since plotly defaults it to scatter", () => {
    const native = { data: [{ x: [1], y: [2] }], layout: {} };
    render(<ChartRenderer data={native} />);
    expect(renderPlot).toHaveBeenCalledTimes(1);
    expect(figureFromLastCall()).toEqual(native);
  });

  it("refuses a mixed figure with one registered and one unregistered trace", () => {
    const native = {
      data: [
        { type: "scatter", x: [1], y: [2] },
        { type: "pie", x: [1], y: [2] },
      ],
      layout: {},
    };
    render(<ChartRenderer data={native} />);
    expect(renderPlot).not.toHaveBeenCalled();
    expect(screen.getByText(/does not include/i)).toBeInTheDocument();
    expect(screen.getByText(/pie/)).toBeInTheDocument();
  });

  it("converts rows carrying a time column into a figure", () => {
    render(<ChartRenderer data={ohlc} />);
    expect(figureFromLastCall().data[0].type).toBe("candlestick");
  });

  it("draws a candlestick with a volume subplot instead of refusing the trace", () => {
    const ohlcWithVolume = [
      { date: "2026-01-02", open: 1, high: 3, low: 0.5, close: 2, volume: 100 },
      { date: "2026-01-03", open: 2, high: 4, low: 1.5, close: 3, volume: 120 },
    ];
    render(<ChartRenderer data={ohlcWithVolume} />);
    expect(renderPlot).toHaveBeenCalled();
    expect(screen.queryByText(/needs a trace type/i)).not.toBeInTheDocument();
  });

  it("says so rather than drawing when the rows have no axis with numbers to plot", () => {
    render(<ChartRenderer data={[{ symbol: "AAPL", name: "Apple" }]} />);
    expect(renderPlot).not.toHaveBeenCalled();
    expect(screen.getByText(/nothing chartable/i)).toBeInTheDocument();
  });

  it("says so rather than throwing when the payload is not rows at all", () => {
    render(<ChartRenderer data={"a string"} />);
    expect(renderPlot).not.toHaveBeenCalled();
    expect(screen.getByText(/nothing chartable/i)).toBeInTheDocument();
  });

  it("reconciles a refresh via Plotly.react instead of purging and redrawing", () => {
    // A refresh is a new `data` identity on an already-mounted ChartRenderer
    // (WidgetCard keeps the component mounted across a Refresh click). If
    // the draw effect purged before every redraw, zoom/pan would be lost on
    // every refresh — the DOM node would also be torn down and recreated,
    // which this test would catch via the getByTestId identity check below.
    const { rerender } = render(<ChartRenderer data={ohlc} />);
    const firstNode = screen.getByTestId("chart-plot");
    expect(renderPlot).toHaveBeenCalledTimes(1);
    expect(purgePlot).not.toHaveBeenCalled();

    const refreshed = [
      { date: "2026-01-04", open: 3, high: 5, low: 2.5, close: 4 },
      { date: "2026-01-05", open: 4, high: 6, low: 3.5, close: 5 },
    ];
    rerender(<ChartRenderer data={refreshed} />);

    expect(purgePlot).not.toHaveBeenCalled();
    expect(renderPlot).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("chart-plot")).toBe(firstNode);
    expect(figureFromLastCall().data[0].type).toBe("candlestick");
  });

  it("purges the plot on unmount so plotly does not leak the node", () => {
    const { unmount } = render(<ChartRenderer data={ohlc} />);
    unmount();
    expect(purgePlot).toHaveBeenCalledTimes(1);
  });

  it("logs rather than throwing when renderPlot rejects", async () => {
    renderPlot.mockReturnValueOnce(Promise.reject(new Error("boom")));
    render(<ChartRenderer data={ohlc} />);
    await waitFor(() => {
      expect(logError).toHaveBeenCalledWith("chart render failed: boom");
    });
  });

  it("resizes the plot when a ResizeObserver reports the card's size changed", () => {
    // plotly's own `responsive: true` only attaches a `window` resize
    // listener; react-grid-layout resizes cards without ever resizing the
    // window, so a chart would otherwise keep its old pixel size until the
    // OS window itself changed.
    render(<ChartRenderer data={ohlc} />);
    const plotNode = screen.getByTestId("chart-plot");
    const observer = ResizeObserverStub.instances.at(-1)!;

    observer.callback(sizeEntry(400, 300), observer as unknown as ResizeObserver);

    expect(resizePlot).toHaveBeenCalledWith(plotNode);
  });

  it("does NOT resize when the reported size is unchanged", () => {
    // ResizeObserver also fires when plotly redraws its own SVG inside the
    // node -- including on a click -- and Plotly.Plots.resize relayouts,
    // which rebuilds the drag layer. Plotly detects a double-click by
    // counting two clicks within a delay on the SAME drag layer, so resizing
    // unconditionally between the two clicks discards the count and
    // "double-click to reset zoom" silently stops working.
    render(<ChartRenderer data={ohlc} />);
    const observer = ResizeObserverStub.instances.at(-1)!;

    observer.callback(sizeEntry(400, 300), observer as unknown as ResizeObserver);
    expect(resizePlot).toHaveBeenCalledTimes(1);

    observer.callback(sizeEntry(400, 300), observer as unknown as ResizeObserver);
    observer.callback(sizeEntry(400.4, 299.6), observer as unknown as ResizeObserver);

    // Still one: neither an identical box nor sub-pixel jitter is a resize.
    expect(resizePlot).toHaveBeenCalledTimes(1);

    observer.callback(sizeEntry(500, 300), observer as unknown as ResizeObserver);
    expect(resizePlot).toHaveBeenCalledTimes(2);
  });

  it("disconnects the resize observer on unmount", () => {
    const { unmount } = render(<ChartRenderer data={ohlc} />);
    const observer = ResizeObserverStub.instances.at(-1)!;

    unmount();

    expect(observer.disconnected).toBe(true);
  });

  it("draws with the light palette when the theme setting is light", () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, theme: "light" },
    });
    render(<ChartRenderer data={ohlc} />);
    const layout = renderPlot.mock.calls.at(-1)![1] as {
      layout: { paper_bgcolor?: string };
    };
    expect(layout.layout.paper_bgcolor).toBe("#ffffff");
  });

  it("redraws with the new palette when the theme setting changes after mount", async () => {
    render(<ChartRenderer data={ohlc} />);
    const initial = renderPlot.mock.calls.at(-1)![1] as { layout: { paper_bgcolor?: string } };
    expect(initial.layout.paper_bgcolor).toBe("#1e242e");

    act(() => {
      useSettingsStore.setState({
        settings: { ...useSettingsStore.getState().settings, theme: "light" },
      });
    });

    await waitFor(() => {
      const latest = renderPlot.mock.calls.at(-1)![1] as { layout: { paper_bgcolor?: string } };
      expect(latest.layout.paper_bgcolor).toBe("#ffffff");
    });
  });

  // Plotly.react keeps zoom/pan only while layout.uirevision holds still. A
  // refetch or a theme flip is the same question asked again, so the user's
  // view must survive it; new params are a different question, so it resets.
  it("keeps one uirevision across a refetch and a theme flip, and a new one after a params change", async () => {
    const refreshed = [
      { date: "2026-01-04", open: 3, high: 5, low: 2.5, close: 4 },
      { date: "2026-01-05", open: 4, high: 6, low: 3.5, close: 5 },
    ];
    const revisionOfLastCall = () => renderPlot.mock.calls.at(-1)![2];
    const { rerender } = render(<ChartRenderer data={ohlc} uirevision="AAPL" />);
    const first = revisionOfLastCall();
    expect(first).toBeDefined();

    rerender(<ChartRenderer data={refreshed} uirevision="AAPL" />);
    expect(renderPlot).toHaveBeenCalledTimes(2);
    expect(revisionOfLastCall()).toBe(first);

    act(() => {
      useSettingsStore.setState({
        settings: { ...useSettingsStore.getState().settings, theme: "light" },
      });
    });
    await waitFor(() => expect(renderPlot).toHaveBeenCalledTimes(3));
    expect(revisionOfLastCall()).toBe(first);

    rerender(<ChartRenderer data={refreshed} uirevision="MSFT" />);
    expect(renderPlot).toHaveBeenCalledTimes(4);
    expect(revisionOfLastCall()).not.toBe(first);
  });

  it("keeps a stable uirevision across a refetch when the caller supplies none", () => {
    const { rerender } = render(<ChartRenderer data={ohlc} />);
    const first = renderPlot.mock.calls.at(-1)![2];
    expect(first).toBeDefined();
    rerender(<ChartRenderer data={[...ohlc]} />);
    expect(renderPlot.mock.calls.at(-1)![2]).toBe(first);
  });

  it("charts rows by the widget's chartDataType columns and chartType", () => {
    render(
      <ChartRenderer
        data={[{ name: "ETH", tvl: 1, change: 2 }]}
        columns={[
          { field: "name", chartDataType: "category" },
          { field: "tvl", chartDataType: "series" },
        ]}
        chartType="column"
      />,
    );
    expect(figureFromLastCall().data).toEqual([{ type: "bar", name: "tvl", x: ["ETH"], y: [1] }]);
  });
});
