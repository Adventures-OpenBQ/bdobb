// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const followPlotYAxisTicks = vi.fn<(
  node: HTMLElement, formatter: unknown, initial: unknown, onError?: (error: unknown) => void,
) => () => void>();
vi.mock("../../lib/plotly", () => ({
  renderPlot: (n: HTMLElement, f: unknown, u?: unknown) => renderPlot(n, f, u),
  purgePlot: (n: HTMLElement) => purgePlot(n),
  resizePlot: (n: HTMLElement) => resizePlot(n),
  followPlotYAxisTicks: (...args: Parameters<typeof followPlotYAxisTicks>) => followPlotYAxisTicks(...args),
  REGISTERED_TRACE_TYPES: new Set(["scatter", "candlestick", "bar", "heatmap", "pie", "indicator", "waterfall", "sankey"]),
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
  followPlotYAxisTicks.mockReset().mockReturnValue(() => {});
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
    const native = { data: [{ type: "surface", z: [[1, 2], [3, 4]] }], layout: {} };
    render(<ChartRenderer data={native} />);
    expect(renderPlot).not.toHaveBeenCalled();
    expect(screen.getByText(/does not include/i)).toBeInTheDocument();
    expect(screen.getByText(/surface/)).toBeInTheDocument();
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
        { type: "surface", z: [[1, 2], [3, 4]] },
      ],
      layout: {},
    };
    render(<ChartRenderer data={native} />);
    expect(renderPlot).not.toHaveBeenCalled();
    expect(screen.getByText(/does not include/i)).toBeInTheDocument();
    expect(screen.getByText(/surface/)).toBeInTheDocument();
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

  it("purges the plot on unmount so plotly does not leak the node", async () => {
    const { unmount } = render(<ChartRenderer data={ohlc} />);
    unmount();
    await waitFor(() => expect(purgePlot).toHaveBeenCalledTimes(1));
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

it('sizes only a scoped scroll plot and reconciles its height without purging it', async () => {
  const data = { data: [{ type: 'scatter' }], layout: { height: 9999 } };
  const { rerender, container, unmount } = render(<ChartRenderer data={data}/>);
  expect(screen.getByTestId('chart-plot').parentElement).toBe(container);
  expect(screen.getByTestId('chart-plot').style.height).toBe('');
  rerender(<ChartRenderer data={data} scrollHeight={940}/>);
  const node = screen.getByTestId('chart-plot');
  expect(node.parentElement).toHaveClass('chart-scroll-viewport');
  expect(node.style.height).toBe('940px');
  const purgeCount = purgePlot.mock.calls.length;
  rerender(<ChartRenderer data={data} scrollHeight={500}/>);
  expect(screen.getByTestId('chart-plot')).toBe(node);
  expect(node.style.height).toBe('500px');
  expect(purgePlot).toHaveBeenCalledTimes(purgeCount);
  unmount();
  await waitFor(() => expect(purgePlot).toHaveBeenCalledWith(node));
});

it('releases vertical drag only for a touch-scroll plot on a coarse pointer', () => {
  let coarse = false;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: coarse)' && coarse, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  const data = { data: [{ type: 'scatter' }], layout: { dragmode: 'zoom' } };
  const { rerender } = render(<ChartRenderer data={data} scrollHeight={800} touchScroll/>);
  expect(figureFromLastCall()).toEqual(data);
  coarse = true;
  rerender(<ChartRenderer data={data} scrollHeight={800} touchScroll/>);
  expect(figureFromLastCall()).toMatchObject({ layout: { dragmode: false } });
  expect(data.layout.dragmode).toBe('zoom');
  rerender(<ChartRenderer data={data} scrollHeight={800}/>);
  expect(figureFromLastCall()).toEqual(data);
});

it('removes a failed draw, bounds the local alert and recovers on a new figure', async () => {
  const { rerender } = render(<ChartRenderer data={ohlc}/>);
  const node = screen.getByTestId('chart-plot');
  renderPlot.mockRejectedValueOnce(new Error('bad coordinate ' + 'x'.repeat(1200)));
  rerender(<ChartRenderer data={[...ohlc]}/>);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/bad coordinate/);
  expect(alert.textContent!.length).toBeLessThan(600);
  expect(purgePlot).toHaveBeenCalledWith(node);
  expect(node).not.toBeVisible();
  rerender(<ChartRenderer data={[...ohlc]}/>);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByTestId('chart-plot')).toBeVisible();
});

it('ignores a superseded draw rejection after the next revision renders', async () => {
  let reject!: (error: Error) => void;
  renderPlot.mockReturnValueOnce(new Promise<void>((_, fail) => { reject = fail; }));
  const { rerender } = render(<ChartRenderer data={ohlc} uirevision="old"/>);
  rerender(<ChartRenderer data={ohlc} uirevision="new"/>);
  await act(async () => reject(new Error('superseded')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(purgePlot).not.toHaveBeenCalled();
  expect(logError).not.toHaveBeenCalledWith('chart render failed: superseded');
});

it('releases coarse watchlist drags only while its viewport overflows and restores zoom on resize', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const data = { data: [{ type: 'scatter' }], layout: { dragmode: 'zoom' } };
  render(<ChartRenderer data={data} scrollHeight={280} touchScroll="overflow"/>);
  const viewport = screen.getByTestId('chart-plot').parentElement!;
  let available = 568;
  Object.defineProperties(viewport, {
    clientHeight: { get: () => available }, scrollHeight: { get: () => Math.max(available, 280) },
  });
  const resize = () => act(() => {
    for (const observer of ResizeObserverStub.instances.filter(o => !o.disconnected))
      observer.callback(sizeEntry(450, available), observer as unknown as ResizeObserver);
  });
  resize();
  expect(figureFromLastCall()).toEqual(data);
  available = 220;
  resize();
  expect(figureFromLastCall()).toMatchObject({ layout: { dragmode: false } });
  available = 280;
  resize();
  expect(figureFromLastCall()).toEqual(data);
});

it('inspects Sankey nodes and links on tap and lets touch drags or unrelated taps pass through', () => {
  const data = { data: [{ type: 'sankey' }], layout: { width: 390, height: 680 } };
  render(<ChartRenderer data={data} scrollHeight={680} touchScroll="overflow" inspectSankeyOnTouch/>);
  const plot = screen.getByTestId('chart-plot');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.innerHTML = '<g class="sankey-node"><rect/></g><path class="sankey-link"/><rect/>';
  plot.append(svg);
  const handlers = vi.fn();
  svg.addEventListener('mouseover', handlers);
  svg.addEventListener('mousemove', handlers);
  const touch = { identifier: 1, clientX: 40, clientY: 50 };
  for (const target of [svg.querySelector('g rect')!, svg.querySelector('path')!]) {
    fireEvent.touchStart(target, { touches: [touch] });
    expect(fireEvent.touchEnd(target, { changedTouches: [touch], touches: [] })).toBe(false);
    expect(handlers.mock.calls.slice(-2).map(([event]) => [event.type, event.clientX, event.clientY]))
      .toEqual([['mouseover', 40, 50], ['mousemove', 40, 50]]);
  }
  const link = svg.querySelector('path')!;
  fireEvent.touchStart(link, { touches: [touch] });
  fireEvent.touchMove(link, { touches: [{ ...touch, clientY: 75 }] });
  expect(fireEvent.touchEnd(link, { changedTouches: [touch], touches: [] })).toBe(true);
  const background = svg.lastElementChild!;
  fireEvent.touchStart(background, { touches: [touch] });
  expect(fireEvent.touchEnd(background, { changedTouches: [touch], touches: [] })).toBe(true);
  fireEvent.touchStart(link, { touches: [touch] });
  fireEvent.touchStart(link, { touches: [touch, { ...touch, identifier: 2 }] });
  expect(fireEvent.touchEnd(link, { changedTouches: [touch], touches: [] })).toBe(true);
  expect(handlers).toHaveBeenCalledTimes(4);
});

it('keeps a plot intact when Strict Mode reattaches the same newly drawable node', async () => {
  const onViewportWidthChange = vi.fn();
  const { rerender } = render(<StrictMode><ChartRenderer data={undefined} scrollHeight={260} onViewportWidthChange={onViewportWidthChange}/></StrictMode>);
  const viewport = document.querySelector('.chart-scroll-viewport');
  expect(viewport).not.toBeNull();
  renderPlot.mockImplementationOnce(async node => {
    await Promise.resolve();
    if (purgePlot.mock.calls.some(([removed]) => removed === node)) throw new Error('Plotly lost its layout during drawing');
  });
  rerender(<StrictMode><ChartRenderer data={ohlc} scrollHeight={260} onViewportWidthChange={onViewportWidthChange}/></StrictMode>);
  await act(async () => {});
  expect(purgePlot).not.toHaveBeenCalled();
  expect(screen.getByTestId('chart-plot').parentElement).toBe(viewport);
});


it('reports the current mounted tick failure as a chart-local draw error', async () => {
  const axis = { range: [0, 2], tickvals: [1], ticktext: ['10%'] };
  const figure = { data: [{ type: 'scatter' }], layout: { yaxis: axis } };
  const format = () => ({ tickvals: [.5], ticktext: ['5%'] });
  const { rerender, unmount } = render(<ChartRenderer data={figure} formatYAxisTicks={format}/>);
  const node = screen.getByTestId('chart-plot');
  await waitFor(() => expect(followPlotYAxisTicks).toHaveBeenCalledTimes(1));
  const firstError = followPlotYAxisTicks.mock.calls[0][3];

  rerender(<ChartRenderer data={{ ...figure }} formatYAxisTicks={format}/>);
  await waitFor(() => expect(followPlotYAxisTicks).toHaveBeenCalledTimes(2));
  await act(async () => firstError?.(new Error('obsolete zoom failed')));
  expect(screen.getByTestId('chart-plot')).toBe(node);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(logError).not.toHaveBeenCalled();

  const currentError = followPlotYAxisTicks.mock.calls[1][3];
  await act(async () => currentError?.(new Error('current zoom failed')));
  expect(screen.getByRole('alert')).toHaveTextContent('Chart could not be drawn. current zoom failed');
  expect(node).not.toBeInTheDocument();
  unmount();
  await act(async () => currentError?.(new Error('detached zoom failed')));
  expect(logError.mock.calls).toEqual([['chart render failed: current zoom failed']]);
});
