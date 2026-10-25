// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";

// The real plotly.js/lib/core cannot run under jsdom (see ChartRenderer.test.tsx
// and scripts/smoke.mjs for why), so only the engine itself is stubbed here —
// this file's own CONFIG object still runs for real, which is the part under test.
// vi.hoisted is required: vi.mock factories are hoisted above normal top-level
// code, so a plain const here would be referenced before initialization.
const { react, register, purge, resize } = vi.hoisted(() => ({
  react: vi.fn().mockResolvedValue(undefined),
  register: vi.fn(),
  purge: vi.fn(),
  resize: vi.fn(),
}));

vi.mock("plotly.js/lib/core", () => ({
  default: { register, react, purge, Plots: { resize } },
}));
vi.mock("plotly.js/lib/candlestick", () => ({ default: { name: "candlestick" } }));
vi.mock("plotly.js/lib/scatter", () => ({ default: { name: "scatter" } }));
vi.mock("plotly.js/lib/bar", () => ({ default: { name: "bar" } }));
vi.mock("plotly.js/lib/heatmap", () => ({ default: { name: "heatmap" } }));

import { REGISTERED_TRACE_TYPES, renderPlot } from "./plotly";

describe("REGISTERED_TRACE_TYPES", () => {
  it("includes every trace chartShapes can produce", () => {
    expect(REGISTERED_TRACE_TYPES.has("scatter")).toBe(true);
    expect(REGISTERED_TRACE_TYPES.has("candlestick")).toBe(true);
    expect(REGISTERED_TRACE_TYPES.has("bar")).toBe(true);
  });

  it("registers heatmap so the reference heatmap widgets render", () => {
    expect(REGISTERED_TRACE_TYPES.has("heatmap")).toBe(true);
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
