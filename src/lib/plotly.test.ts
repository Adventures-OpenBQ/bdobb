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
vi.mock("plotly.js/lib/box", () => ({ default: { name: "box" } }));
vi.mock("plotly.js/lib/sankey", () => ({ default: { name: "sankey" } }));

import { followPlotYAxisTicks, REGISTERED_TRACE_TYPES, renderPlot } from "./plotly";

describe("REGISTERED_TRACE_TYPES", () => {
  it.each(["scatter", "candlestick", "bar", "heatmap", "pie", "indicator", "waterfall", "sankey", "box"])("includes the registered %s trace", (type) => {
    expect(REGISTERED_TRACE_TYPES.has(type)).toBe(true);
  });

  it("excludes unsupported trace types", () => {
    expect(REGISTERED_TRACE_TYPES.has("surface")).toBe(false);
    expect(REGISTERED_TRACE_TYPES.has("violin")).toBe(false);
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
