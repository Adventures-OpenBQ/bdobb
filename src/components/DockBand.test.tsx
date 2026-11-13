// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/plotly", () => ({
  renderPlot: () => Promise.resolve(),
  purgePlot: () => {},
  REGISTERED_TRACE_TYPES: new Set(["scatter", "candlestick"]),
}));

// Same shape of stub as DashboardGrid.test.tsx: the real library measures a
// container jsdom cannot lay out, and the mount-time onLayoutChange call is
// what the band's content-diff guard has to survive.
vi.mock("react-grid-layout", () => ({
  // A named component (clean's lint gate, rules-of-hooks): the donor's arrow is otherwise verbatim.
  default: function MockGrid({
    children,
    onLayoutChange,
    layout,
    className,
    isDraggable,
    isResizable,
    maxRows,
    margin,
    containerPadding,
  }: {
    children: React.ReactNode;
    onLayoutChange: (l: unknown[]) => void;
    layout: unknown[];
    className?: string;
    isDraggable?: boolean;
    isResizable?: boolean;
    maxRows?: number;
    margin?: [number, number];
    containerPadding?: [number, number];
  }) {
    useEffect(() => {
      onLayoutChange(layout);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div
        data-testid="grid"
        className={className}
        data-layout={JSON.stringify(layout)}
        data-draggable={String(isDraggable)}
        data-resizable={String(isResizable)}
        data-max-rows={String(maxRows)}
        data-margin={JSON.stringify(margin ?? null)}
        data-container-padding={JSON.stringify(containerPadding ?? null)}
      >
        <button type="button" onClick={() => onLayoutChange([{ i: "dc1", x: 4, y: 1, w: 10, h: 4 }])}>
          simulate drag stop
        </button>
        {children}
      </div>
    );
  },
  WidthProvider: (Component: unknown) => Component,
}));

import { makeDefaultDocks } from "../lib/dashboardsFile";
import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import type { Dashboard } from "../lib/types";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { card as makeCard, widget as makeWidget } from "../test/fixtures";
import { __read, __reset as __resetFs } from "../test/memfs";
import { DockBand, DockEditor } from "./DockBand";

const REAL_ACTIONS = {
  updateLayouts: useDashboardStore.getState().updateLayouts,
  cancelDockEdit: useDashboardStore.getState().cancelDockEdit,
};

/** The docks dashboard with `cards` on the bottom edge and nothing on top. */
function docksWith(cards: Dashboard["tabs"][number]["cards"]): Dashboard {
  const docks = makeDefaultDocks();
  return { ...docks, tabs: [docks.tabs[0], { ...docks.tabs[1], cards }] };
}

const dockCard = makeCard({ id: "dc1", widgetId: "w1", layout: { x: 0, y: 0, w: 20, h: 6 } });

/** The window's height: a band caps only when the two bands would leave the dashboard under 200px. */
function windowHeight(px: number) {
  Object.defineProperty(window, "innerHeight", { value: px, configurable: true });
  window.dispatchEvent(new Event("resize"));
}

beforeEach(() => {
  // A desktop window, where every band below fits.
  windowHeight(1200);
  __resetLoggerForTests();
  __resetFs();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  useWidgetRegistryStore.setState({
    widgets: [makeWidget({ id: "w1", name: "Price History", endpoint: "equity/price" })],
  });
  useDashboardStore.setState({
    ...REAL_ACTIONS,
    docks: docksWith([dockCard]),
    dockEdit: null,
    maximizedCardId: null,
    viewer: false,
  });
});

describe("DockBand", () => {
  it("renders nothing for an empty edge, and the band with its locked cards otherwise", () => {
    render(<DockBand edge="top" />);
    expect(document.querySelector(".dock-band-top")).toBeNull();

    render(<DockBand edge="bottom" />);
    const band = document.querySelector<HTMLElement>(".dock-band-bottom");
    expect(band).not.toBeNull();
    expect(band).toHaveAccessibleName("Locked at Bottom");
    // The band reserves exactly rows * rowHeight + (rows - 1) * gap + one pad.
    expect(band?.style.height).toBe(`${8 * 20 + 7 * 10 + 10}px`);
    // Outside the editor the grid neither drags nor resizes and the card is locked.
    const grid = screen.getByTestId("grid");
    expect(grid.dataset.draggable).toBe("false");
    expect(grid.dataset.resizable).toBe("false");
    expect(grid.dataset.maxRows).toBe("8");
    expect(screen.queryByRole("button", { name: "Remove card" })).toBeNull();
  });

  it("a 24-row band caps and scrolls only where it would push the dashboard off screen, keeping its rows", () => {
    useDashboardStore.setState({ docks: { ...docksWith([dockCard]), dockRows: { top: 6, bottom: 24 } } });
    const full = `${24 * 20 + 23 * 10 + 10}px`;
    // A desktop window: 720px of band leaves the dashboard 480px, as before.
    render(<DockBand edge="bottom" />);
    const band = document.querySelector<HTMLElement>(".dock-band-bottom")!;
    expect(band.style.height).toBe(full);
    expect(band.style.overflowY).toBe("");

    // An iPad in landscape: 768 - 200px for the dashboard leaves 568px, so 18 rows (18 * 20 + 17 * 10 + 10 = 540).
    act(() => windowHeight(768));
    expect(band.style.height).toBe("540px");
    expect(band.style.overflowY).toBe("auto");
    // The grid keeps all 24 rows: nothing is moved or rewritten.
    expect(screen.getByTestId("grid").dataset.maxRows).toBe("24");
    expect(useDashboardStore.getState().docks.dockRows?.bottom).toBe(24);

    // The editor's Taller stops at the same 18 rows.
    useDashboardStore.setState({ docks: { ...docksWith([dockCard]), dockRows: { top: 6, bottom: 18 } } });
    useDashboardStore.getState().beginDockEdit("bottom");
    render(<DockEditor onOpenLibrary={() => {}} />);
    expect(screen.getByRole("button", { name: "Taller" })).toBeDisabled();
  });

  it("the band's measure follows the widget gap, with the grid's own 10px padding", () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, widgetGap: 25 } });
    render(<DockBand edge="bottom" />);
    expect(document.querySelector<HTMLElement>(".dock-band")?.style.height).toBe(`${8 * 20 + 7 * 25 + 10}px`);
    const grid = screen.getByTestId("grid");
    expect(grid.dataset.margin).toBe("[25,25]");
    // Side padding only: the band pads its outer edge in CSS, and the inner
    // edge's gap is the dashboard's own.
    expect(grid.dataset.containerPadding).toBe("[10,0]");
  });

  it("steps aside while its edge is being edited, and comes back after", async () => {
    render(<DockBand edge="bottom" />);
    expect(document.querySelector(".dock-band-bottom")).not.toBeNull();
    act(() => useDashboardStore.getState().beginDockEdit("bottom"));
    expect(document.querySelector(".dock-band-bottom")).toBeNull();
    await act(() => useDashboardStore.getState().commitDockEdit());
    expect(document.querySelector(".dock-band-bottom")).not.toBeNull();
  });

  it("a maximized dock card lifts the band out of its own stacking context", () => {
    render(<DockBand edge="bottom" />);
    expect(document.querySelector(".dock-band")).not.toHaveClass("dock-band-maximized");
    act(() => useDashboardStore.setState({ maximizedCardId: "dc1" }));
    expect(document.querySelector(".dock-band")).toHaveClass("dock-band-maximized");
  });

  it("persists a moved layout but not the layout the grid reports back on mount", async () => {
    const updateLayouts = vi.fn().mockResolvedValue(undefined);
    useDashboardStore.setState({ updateLayouts });
    render(<DockBand edge="bottom" />);
    expect(updateLayouts).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /simulate drag stop/i }));
    await waitFor(() => expect(updateLayouts).toHaveBeenCalledWith([{ i: "dc1", x: 4, y: 1, w: 10, h: 4 }]));
  });
});

describe("DockEditor", () => {
  it("renders nothing until an edge is being edited", () => {
    render(<DockEditor onOpenLibrary={() => {}} />);
    expect(document.querySelector(".dock-editor")).toBeNull();
  });

  it("is a panel with the edge's title, the green + to add a widget, the rows stepper, Cancel and OK, over a band-sized canvas", async () => {
    const onOpen = vi.fn();
    useDashboardStore.getState().beginDockEdit("bottom");
    render(<DockEditor onOpenLibrary={onOpen} />);

    expect(screen.getByRole("dialog", { name: "Editing Locked at Bottom" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Locked at Bottom" })).toBeInTheDocument();
    const canvas = document.querySelector<HTMLElement>(".dock-canvas-bottom");
    expect(canvas?.style.height).toBe(`${8 * 20 + 7 * 10 + 10}px`);
    // On the canvas the cards get their full chrome back.
    expect(screen.getByTestId("grid").dataset.draggable).toBe("true");
    expect(screen.getByTestId("grid").dataset.resizable).toBe("true");
    expect(screen.getByRole("button", { name: "Remove card" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add widget" }));
    expect(onOpen).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Taller" }));
    await waitFor(() => expect(useDashboardStore.getState().docks.dockRows?.bottom).toBe(9));
    expect(canvas?.style.height).toBe(`${9 * 20 + 8 * 10 + 10}px`);
    await userEvent.click(screen.getByRole("button", { name: "Shorter" }));
    await waitFor(() => expect(useDashboardStore.getState().docks.dockRows?.bottom).toBe(8));

    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(useDashboardStore.getState().dockEdit).toBeNull());
    expect(document.querySelector(".dock-editor")).toBeNull();
  });

  it("names the top edge too", () => {
    useDashboardStore.getState().beginDockEdit("top");
    render(<DockEditor onOpenLibrary={() => {}} />);
    expect(screen.getByRole("heading", { name: "Locked at Top" })).toBeInTheDocument();
    expect(document.querySelector(".dock-canvas-top")).not.toBeNull();
  });

  it("an empty canvas says Add a widget with ⌘K.", () => {
    useDashboardStore.setState({ docks: docksWith([]) });
    useDashboardStore.getState().beginDockEdit("bottom");
    render(<DockEditor onOpenLibrary={() => {}} />);
    expect(document.querySelector(".dock-empty")).toHaveTextContent("Add a widget with ⌘K.");
    expect(screen.queryByTestId("grid")).toBeNull();
  });

  it("Escape cancels the edit unless a card is maximized", async () => {
    useDashboardStore.getState().beginDockEdit("bottom");
    await useDashboardStore.getState().setDockRows("bottom", 10);
    render(<DockEditor onOpenLibrary={() => {}} />);

    useDashboardStore.setState({ maximizedCardId: "dc1" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useDashboardStore.getState().dockEdit).not.toBeNull();

    useDashboardStore.setState({ maximizedCardId: null });
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    await waitFor(() => expect(useDashboardStore.getState().dockEdit).toBeNull());
    // Cancel is a restore, so the row change is undone on disk too.
    await waitFor(() => expect(useDashboardStore.getState().docks.dockRows?.bottom).toBe(8));
    expect(JSON.parse(__read("dashboards/docks.json") ?? "{}").dockRows.bottom).toBe(8);
  });

  it("Cancel tells App it was cancelled once the restore has landed, so Settings can reopen", async () => {
    const onCancelled = vi.fn();
    useDashboardStore.getState().beginDockEdit("bottom");
    render(<DockEditor onOpenLibrary={() => {}} onCancelled={onCancelled} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onCancelled).toHaveBeenCalledTimes(1));
    expect(useDashboardStore.getState().dockEdit).toBeNull();
    // OK does not: it stays on the dashboard.
    act(() => useDashboardStore.getState().beginDockEdit("bottom"));
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(useDashboardStore.getState().dockEdit).toBeNull());
    expect(onCancelled).toHaveBeenCalledTimes(1);
  });

  it("logs a failed Cancel write rather than leaving it unhandled", async () => {
    useDashboardStore.getState().beginDockEdit("bottom");
    useDashboardStore.setState({ cancelDockEdit: vi.fn().mockRejectedValue(new Error("disk full")) });
    render(<DockEditor onOpenLibrary={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("ERROR");
      expect(log).toContain("disk full");
    });
  });
});
