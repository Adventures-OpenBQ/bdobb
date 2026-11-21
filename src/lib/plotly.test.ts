// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

// The real plotly.js/lib/core cannot run under jsdom (see ChartRenderer.test.tsx
// and scripts/smoke.mjs for why), so only the engine itself is stubbed here —
// this file's own CONFIG object still runs for real, which is the part under test.
// vi.hoisted is required: vi.mock factories are hoisted above normal top-level
// code, so a plain const here would be referenced before initialization.
const { react, register, purge, resize, relayout } = vi.hoisted(() => ({
  react: vi.fn().mockResolvedValue(undefined),
  register: vi.fn(),
  purge: vi.fn(),
  resize: vi.fn(),
  relayout: vi.fn(),
}));

vi.mock("plotly.js/lib/core", () => ({
  default: { register, react, purge, relayout, Plots: { resize } },
}));
vi.mock("plotly.js/lib/candlestick", () => ({ default: { name: "candlestick" } }));
vi.mock("plotly.js/lib/scatter", () => ({ default: { name: "scatter" } }));
vi.mock("plotly.js/lib/bar", () => ({ default: { name: "bar" } }));
vi.mock("plotly.js/lib/heatmap", () => ({ default: { name: "heatmap" } }));
vi.mock("plotly.js/lib/pie", () => ({ default: { name: "pie" } }));
vi.mock("plotly.js/lib/indicator", () => ({ default: { name: "indicator" } }));
vi.mock("plotly.js/lib/waterfall", () => ({ default: { name: "waterfall" } }));
vi.mock("plotly.js/lib/sunburst", () => ({ default: { name: "sunburst" } }));
vi.mock("plotly.js/lib/treemap", () => ({ default: { name: "treemap" } }));
vi.mock("plotly.js/lib/box", () => ({ default: { name: "box" } }));
vi.mock("plotly.js/lib/sankey", () => ({ default: { name: "sankey" } }));
vi.mock("plotly.js/lib/surface", () => ({ default: { name: "surface" } }));

import { followPlotYAxisTicks, followSunburstLevel, REGISTERED_TRACE_TYPES, renderPlot } from "./plotly";

describe("REGISTERED_TRACE_TYPES", () => {
  it.each(["scatter", "candlestick", "bar", "heatmap", "pie", "indicator", "waterfall", "sankey", "box", "sunburst", "treemap", "surface"])("includes the registered %s trace", (type) => {
    expect(REGISTERED_TRACE_TYPES.has(type)).toBe(true);
  });

  it("excludes unsupported trace types", () => {
    expect(REGISTERED_TRACE_TYPES.has("mesh3d")).toBe(false);
    expect(REGISTERED_TRACE_TYPES.has("violin")).toBe(false);
  });

  it("registers pie so the linked chart's Pie type renders", () => {
    expect(REGISTERED_TRACE_TYPES.has("pie")).toBe(true);
  });

  it("registers waterfall so the linked chart's Waterfall type renders", () => {
    expect(REGISTERED_TRACE_TYPES.has("waterfall")).toBe(true);
  });
  it("registers surface so the linked chart's Surface type renders", () => {
    expect(REGISTERED_TRACE_TYPES.has("surface")).toBe(true);
  });
});

describe("renderPlot's config", () => {
  it("raises doubleClickDelay above plotly's 300ms default", async () => {
    // Plotly's own click-counting (components/dragelement/index.js) requires
    // the ENTIRE double-click gesture -- mousedown1, mouseup1, mousedown2,
    // mouseup2 -- to complete within doubleClickDelay, measured from the
    // first mousedown, not just mousedown-to-mousedown. 300ms is a tight
    // window for a real double-click (as opposed to a scripted one), so the
    // default leaves "double-click to reset zoom" prone to silently not
    // firing at all -- not a partial reset, no reaction whatsoever, since
    // numClicks never reaches 2.
    await renderPlot(document.createElement("div"), { data: [], layout: {} });

    expect(react).toHaveBeenCalledTimes(1);
    const config = react.mock.calls[0][3];
    expect(config.doubleClickDelay).toBeGreaterThan(300);
  });

  it("leaves displayModeBar and responsive as they were", async () => {
    await renderPlot(document.createElement("div"), { data: [], layout: {} });
    const config = react.mock.calls[react.mock.calls.length - 1][3];
    expect(config.displayModeBar).toBe(false);
    expect(config.responsive).toBe(true);
  });
});

describe("renderPlot's uirevision", () => {
  // Plotly.react keeps the user's zoom/pan only while layout.uirevision is
  // unchanged; a fresh layout without one drops it on every refetch.
  it("sets layout.uirevision to the caller's revision without mutating the figure", async () => {
    const figure = { data: [], layout: { title: "t" } };
    await renderPlot(document.createElement("div"), figure, "card-1");
    const layout = react.mock.calls[react.mock.calls.length - 1][2];
    expect(layout).toEqual({ title: "t", uirevision: "card-1" });
    expect(figure.layout).toEqual({ title: "t" });
  });

  it("respects a uirevision the backend's figure already carries", async () => {
    await renderPlot(document.createElement("div"), { data: [], layout: { uirevision: "backend" } }, "card-1");
    const layout = react.mock.calls[react.mock.calls.length - 1][2];
    expect(layout.uirevision).toBe("backend");
  });
});

describe("renderPlot and indicator traces", () => {
  it("purges before drawing indicators, whose in-place update stacks new bands over the bar", async () => {
    purge.mockClear();
    const node = document.createElement("div");
    await renderPlot(node, { data: [{ type: "indicator" }], layout: {} });
    expect(purge).toHaveBeenCalledWith(node);
    expect(purge.mock.invocationCallOrder[0]).toBeLessThan(react.mock.invocationCallOrder.at(-1)!);
  });

  it("keeps the in-place update (and the user's zoom) for every other trace", async () => {
    purge.mockClear();
    await renderPlot(document.createElement("div"), { data: [{ type: "bar" }], layout: {} });
    expect(purge).not.toHaveBeenCalled();
  });
});


describe("live y-axis tick failures", () => {
  const initial = { range: [0, 2], tickvals: [1], ticktext: ["10%"] };
  const labels = () => ({ tickvals: [.5], ticktext: ["5%"] });
  function tickGraph() {
    const events = new EventEmitter();
    const axis = { ...initial };
    const graph = Object.assign(document.createElement("div"), {
      _fullLayout: { yaxis: axis }, on: events.on.bind(events), removeListener: events.removeListener.bind(events),
    });
    return { graph, zoom: () => {
      axis.range = [.2, .8];
      events.emit("plotly_relayout");
    } };
  }

  it.each(["formatter", "relayout"] as const)("reports a synchronous %s failure during a later zoom", (operation) => {
    const { graph, zoom } = tickGraph();
    const error = new Error(operation + " failed");
    const fail = () => { throw error; };
    const onError = vi.fn();
    if (operation === "relayout") relayout.mockImplementationOnce(fail);
    const stop = followPlotYAxisTicks(graph, operation === "formatter" ? fail : labels, initial, onError);
    try {
      expect(zoom).not.toThrow();
      expect(onError.mock.calls).toEqual([[error]]);
    } finally { stop(); }
  });

  it.each(["current", "retired"] as const)("handles deferred Plotly rejection for a %s tick listener", async (lifetime) => {
    const { graph, zoom } = tickGraph();
    const error = new Error("Plotly ticks could not be laid out");
    let reject!: (reason: Error) => void;
    const request = new Promise((_, fail) => { reject = fail; });
    relayout.mockReturnValueOnce(request);
    const onError = vi.fn();
    const stop = followPlotYAxisTicks(graph, labels, initial, onError);
    zoom();
    if (lifetime === "retired") stop();
    reject(error);
    await request.catch(() => {});
    if (lifetime === "current") {
      expect(onError.mock.calls).toEqual([[error]]);
      stop();
    } else expect(onError).not.toHaveBeenCalled();
  });
});

describe("sunburst level listener lifetime", () => {
  const event = "plotly_sunburstclick";
  function sunburstGraph() {
    const events = new EventEmitter();
    const remove = vi.fn(events.removeListener.bind(events));
    const graph = Object.assign(document.createElement("div"), { on: events.on.bind(events), removeListener: remove });
    const onLevel = vi.fn();
    const dispose = followSunburstLevel(graph, onLevel);
    const select = events.listeners(event)[0];
    return { graph, events, remove, onLevel, dispose, select };
  }

  it("can dispose an already-purged graph and retires the captured callback", () => {
    const { graph, remove, onLevel, dispose, select } = sunburstGraph();
    // Installed Plotly deletes its event methods during purge.
    Reflect.deleteProperty(graph, "removeListener");
    expect(dispose).not.toThrow();
    expect(dispose).not.toThrow();
    expect(remove).not.toHaveBeenCalled();
    expect(select({ nextLevel: "root" })).toBeUndefined();
    expect(onLevel).not.toHaveBeenCalled();
  });

  it("removes its own listener once and ignores obsolete callbacks", () => {
    const { events, remove, onLevel, dispose, select } = sunburstGraph();
    const other = vi.fn();
    events.on(event, other);
    expect(select({})).toBeUndefined();
    expect(select({ nextLevel: "Technology" })).toBe(false);
    expect(onLevel.mock.calls).toEqual([["Technology"]]);
    dispose();
    dispose();
    expect(remove.mock.calls).toEqual([[event, select]]);
    expect(events.listeners(event)).toEqual([other]);
    expect(select({ nextLevel: "root" })).toBeUndefined();
    expect(onLevel.mock.calls).toEqual([["Technology"]]);
  });
});

it('relayouts both y ranges in one original-unit update and safely retires after purge', () => {
  const events = new EventEmitter();
  const initial = { range: [0, 2], tickvals: [1], ticktext: ['1'], margin: 62 };
  const oldYield = { range: [0, 1e-12], tickvals: [5e-13], ticktext: ['5e-11%'], margin: 72 };
  const left = { ...initial };
  const right = { ...oldYield };
  const graph = Object.assign(document.createElement('div'), {
    _fullLayout: { yaxis: left, yaxis2: right, margin: { l: 62, r: 72 } },
    on: events.on.bind(events), removeListener: events.removeListener.bind(events),
  });
  const onError = vi.fn();
  const stop = followPlotYAxisTicks(graph,
    () => ({ tickvals: [.5], ticktext: ['0.5'], margin: 62 }), initial, onError,
    { initial: oldYield, format: () => ({ tickvals: [5e-14], ticktext: ['5e-12%'], margin: 86 }) });
  const listener = events.listeners('plotly_relayout')[0];
  relayout.mockClear();
  left.range = [.2, .8];
  right.range = [3e-14, 7e-14];
  events.emit('plotly_relayout');
  expect(relayout.mock.calls).toEqual([[graph, {
    'yaxis.tickvals': [.5], 'yaxis.ticktext': ['0.5'],
    'yaxis2.tickvals': [5e-14], 'yaxis2.ticktext': ['5e-12%'], 'margin.r': 86,
  }]]);
  Reflect.deleteProperty(graph, 'removeListener');
  stop();
  stop();
  listener();
  expect(relayout).toHaveBeenCalledTimes(1);
  expect(onError).not.toHaveBeenCalled();
});

it('forwards both native treemap Home representations and retires a purged listener', async () => {
  const events = new EventEmitter();
  const graph = Object.assign(document.createElement('div'), {
    on: events.on.bind(events), removeListener: events.removeListener.bind(events),
  });
  const { followTreemapLevel } = await import('./plotly');
  const navigate = vi.fn();
  const retire = followTreemapLevel(graph, navigate);
  const select = events.listeners('plotly_treemapclick')[0];
  const root = '["market-root","delivered-sample"]';
  expect(select({ nextLevel: '' })).toBe(false);
  expect(select({ nextLevel: root })).toBe(false);
  expect(navigate.mock.calls).toEqual([[''], [root]]);
  Reflect.deleteProperty(graph, 'removeListener');
  expect(retire).not.toThrow();
  expect(select({ nextLevel: '["market-sector","Technology"]' })).toBeUndefined();
  expect(navigate).toHaveBeenCalledTimes(2);
});
