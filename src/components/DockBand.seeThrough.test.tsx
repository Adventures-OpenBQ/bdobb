// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// See-through locked bands (docs/superpowers/specs/2026-11-12-see-through-locked-bands-design.md).
// jsdom lays nothing out and styles.css is not in the test build (`css:
// false`), so the layout is asserted as classes, published properties and
// the CSS file's text; e2e/see-through.spec.ts measures it in a real engine.
import { readFileSync } from "node:fs";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/plotly", () => ({
  renderPlot: () => Promise.resolve(),
  purgePlot: () => {},
  REGISTERED_TRACE_TYPES: new Set(["scatter", "candlestick"]),
}));
// The real grid measures a container jsdom cannot lay out.
vi.mock("react-grid-layout", () => ({
  default: function MockGrid({ children }: { children: React.ReactNode }) {
    return <div data-testid="grid">{children}</div>;
  },
  WidthProvider: (Component: unknown) => Component,
}));

import { makeDefaultDocks } from "../lib/dashboardsFile";
import type { DockSeeThrough } from "../lib/dockSeeThrough";
import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import type { Dashboard, PinEdge } from "../lib/types";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { useWorkspacesStore } from "../stores/workspacesStore";
import { card as makeCard, widget as makeWidget } from "../test/fixtures";
import { __reset as __resetFs } from "../test/memfs";
import { DockBand, DockEditor } from "./DockBand";

const css = readFileSync("src/styles.css", "utf8");

/** A card on each edge: 6 rows on top (180px band), 8 at the bottom (240px). */
function docksBoth(): Dashboard {
  const docks = makeDefaultDocks();
  return {
    ...docks,
    tabs: [
      { ...docks.tabs[0], cards: [makeCard({ id: "top1", widgetId: "w1", layout: { x: 0, y: 0, w: 20, h: 6 } })] },
      { ...docks.tabs[1], cards: [makeCard({ id: "bot1", widgetId: "w1", layout: { x: 20, y: 0, w: 20, h: 8 } })] },
    ],
  };
}

function seeThrough(edges: DockSeeThrough) {
  useDashboardStore.setState((s) => ({ docks: { ...s.docks, dockSeeThrough: edges } }));
}

function windowHeight(px: number) {
  Object.defineProperty(window, "innerHeight", { value: px, configurable: true });
  window.dispatchEvent(new Event("resize"));
}

beforeEach(() => {
  windowHeight(1200);
  __resetLoggerForTests();
  __resetFs();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  useWidgetRegistryStore.setState({ widgets: [makeWidget({ id: "w1", name: "Price History", endpoint: "equity/price" })] });
  useWorkspacesStore.setState({ activeWorkspaceId: null });
  useDashboardStore.setState({
    docks: docksBoth(),
    dockEdit: null,
    maximizedCardId: null,
    viewer: false,
    activeId: "d1",
    activeTabId: "t1",
    activeTabIds: { d1: "t1" },
  });
});

describe("DockEditor's See-through where empty switch", () => {
  it("is off by default, turns its edge on and off, and Cancel restores it", async () => {
    useDashboardStore.getState().beginDockEdit("bottom");
    render(<DockEditor onOpenLibrary={() => {}} />);
    const toggle = screen.getByRole("switch", { name: "See-through where empty" });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(useDashboardStore.getState().docks.dockSeeThrough).toEqual({ bottom: true }));
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(useDashboardStore.getState().docks).not.toHaveProperty("dockSeeThrough"));
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(useDashboardStore.getState().dockEdit).toBeNull());
    expect(useDashboardStore.getState().docks).not.toHaveProperty("dockSeeThrough");
  });

  it("shows the edited edge's own switch", () => {
    seeThrough({ top: true });
    useDashboardStore.getState().beginDockEdit("bottom");
    render(<DockEditor onOpenLibrary={() => {}} />);
    expect(screen.getByRole("switch", { name: "See-through where empty" })).not.toBeChecked();
  });
});

/** The band in the area's column with a scroll region after it, as App and DashboardGrid lay them out. */
function inArea(edge: PinEdge, viewer = false) {
  const tree = () => (
    <main className="dashboard-area">
      <DockBand edge={edge} viewer={viewer} />
      <div className="dashboard-scroll" data-testid="scroll" />
    </main>
  );
  const view = render(tree());
  return {
    area: screen.getByRole("main"),
    band: () => document.querySelector<HTMLElement>(`.dock-band-${edge}`),
    rerender: () => view.rerender(tree()),
  };
}

describe("a see-through band", () => {
  it("is today's band while its switch is off: no float class, nothing published on the area", () => {
    const { area, band } = inArea("bottom");
    expect(band()).not.toHaveClass("dock-band-float");
    expect(band()?.style.height).toBe("240px");
    expect(area.getAttribute("style")).toBeNull();
  });

  it("floats with its switch on, and publishes its height on the area", () => {
    seeThrough({ bottom: true });
    const { area, band } = inArea("bottom");
    expect(band()).toHaveClass("dock-band-float");
    expect(band()?.style.height).toBe("240px");
    expect(area.style.getPropertyValue("--dock-room-bottom")).toBe("240px");
    expect(area.style.getPropertyValue("--dock-room-top")).toBe("");
  });

  it("is an ordinary band while the window caps it, and floats again once it fits", () => {
    useDashboardStore.setState({ docks: { ...docksBoth(), dockRows: { top: 6, bottom: 24 }, dockSeeThrough: { bottom: true } } });
    const { area, band } = inArea("bottom");
    expect(band()).toHaveClass("dock-band-float");
    act(() => windowHeight(768));
    expect(band()).not.toHaveClass("dock-band-float");
    expect(band()?.style.overflowY).toBe("auto");
    expect(area.style.getPropertyValue("--dock-room-bottom")).toBe("");
    act(() => windowHeight(1200));
    expect(band()).toHaveClass("dock-band-float");
  });

  it("is an ordinary band while a workspace is shown, and floats again on leaving it", () => {
    seeThrough({ bottom: true });
    useWorkspacesStore.setState({ activeWorkspaceId: "w1" });
    const { band } = inArea("bottom");
    expect(band()).not.toHaveClass("dock-band-float");
    act(() => useWorkspacesStore.setState({ activeWorkspaceId: null }));
    expect(band()).toHaveClass("dock-band-float");
  });

  it("floats in a viewer window whatever the workspace store holds", () => {
    seeThrough({ bottom: true });
    useWorkspacesStore.setState({ activeWorkspaceId: "w1" });
    const { band } = inArea("bottom", true);
    expect(band()).toHaveClass("dock-band-float");
  });

  it("leaves nothing on the area while its edge is being edited", () => {
    seeThrough({ bottom: true });
    const { area } = inArea("bottom");
    act(() => useDashboardStore.getState().beginDockEdit("bottom"));
    expect(area.style.getPropertyValue("--dock-room-bottom")).toBe("");
  });
});

describe("styles.css for see-through bands", () => {
  it("lays a .dock-band-float band over the scroll region's end, below the tab bar and inside a tab's pinned card", () => {
    for (const rule of [
      ".dashboard-area:has(> .dashboard-scroll):has(> .dock-band-float) > .dashboard-scroll { order: 1; }",
      ".dashboard-area:has(> .dashboard-scroll):has(> .dock-band-float) > .card-dock-bottom { order: 1; }",
      ".dashboard-area:has(> .dashboard-scroll):has(> .dock-band-float) > .dock-band-bottom { order: 1; }",
      ".dashboard-area:has(> .dashboard-scroll) > .dock-band-top.dock-band-float { order: 1; margin-bottom: calc(-1 * var(--dock-room-top, 0px)); }",
      ".dashboard-area:has(> .dashboard-scroll):has(> .dock-band-bottom.dock-band-float) > .card-dock-bottom { order: 2; }",
      ".dashboard-area:has(> .dashboard-scroll) > .dock-band-bottom.dock-band-float { margin-top: calc(-1 * var(--dock-room-bottom, 0px)); }",
      ".dashboard-area:has(> .dashboard-scroll) > .dock-band.dock-band-float { background: none; border: 0; }",
    ]) {
      expect(css).toContain(rule);
    }
  });

  it("changes nothing for a band that is not see-through: every rule that floats or reads the room names .dock-band-float", () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/[^{}]+\{[^{}]*\}/g) ?? [];
    const floating = rules.filter((r) => r.includes("dock-band-float") || r.includes("--dock-room"));
    expect(floating.length).toBeGreaterThan(0);
    for (const rule of floating) expect(rule.slice(0, rule.indexOf("{"))).toContain("dock-band-float");
  });
});
