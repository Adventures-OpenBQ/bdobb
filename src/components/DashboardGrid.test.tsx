// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/plotly", () => ({
  renderPlot: () => Promise.resolve(),
  purgePlot: () => {},
  REGISTERED_TRACE_TYPES: new Set(["scatter", "candlestick"]),
}));

vi.mock("react-grid-layout", () => ({
  default: ({
    children,
    onLayoutChange,
    layout,
    resizeHandles,
    className,
    isDraggable,
    isResizable,
  }: {
    children: React.ReactNode;
    onLayoutChange: (l: unknown[]) => void;
    layout: unknown[];
    resizeHandles?: string[];
    className?: string;
    isDraggable?: boolean;
    isResizable?: boolean;
  }) => {
    // The real react-grid-layout calls onLayoutChange unconditionally from
    // componentDidMount, with a layout that (after its own normalization)
    // is content-equal to what was passed in as the `layout` prop. This
    // stub reproduces that so DashboardGrid's own unchanged-layout guard is
    // exercised the same way it would be against the real library, without
    // pulling in the real library's drag machinery.
    useEffect(() => {
      onLayoutChange(layout);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div
        data-testid="grid"
        className={className}
        data-layout={JSON.stringify(layout)}
        data-resize-handles={JSON.stringify(resizeHandles ?? null)}
        data-draggable={String(isDraggable)}
        data-resizable={String(isResizable)}
      >
        <button
          type="button"
          onClick={() =>
            onLayoutChange([
              { i: "c1", x: 5, y: 1, w: 10, h: 4 },
              { i: "c2", x: 0, y: 6, w: 8, h: 3 },
            ])
          }
        >
          simulate drag stop
        </button>
        {children}
      </div>
    );
  },
  // DashboardGrid wraps the default export in WidthProvider, which measures
  // its container's width in the real DOM. jsdom has no layout engine, so
  // there is nothing meaningful to measure here and the stub above doesn't
  // consume a `width` prop anyway — an identity pass-through keeps this a
  // test of our wiring, not of container measurement.
  WidthProvider: (Component: unknown) => Component,
}));

import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { __read, __reset as __resetFs } from "../test/memfs";
import { card as makeCard, widget as makeWidget } from "../test/fixtures";
import { DashboardGrid } from "./DashboardGrid";

const card = (id: string, y: number) =>
  makeCard({ id, widgetId: "w1", layout: { x: 0, y, w: 20, h: 9 } });

// Several tests below replace store actions with a vi.fn() via setState.
// vi.restoreAllMocks() does not undo that (it only reverts vi.spyOn spies),
// so the real actions are captured once at module load and reinstated here
// before every test.
const REAL_ACTIONS = {
  updateLayouts: useDashboardStore.getState().updateLayouts,
  removeCard: useDashboardStore.getState().removeCard,
};

beforeEach(() => {
  __resetLoggerForTests();
  __resetFs();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  useWidgetRegistryStore.setState({
    widgets: [makeWidget({ id: "w1", name: "Price History", endpoint: "equity/price" })],
  });
  useDashboardStore.setState({
    ...REAL_ACTIONS,
    dashboards: [
      { id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [card("c1", 0), card("c2", 9)] }] },
    ],
    activeId: "d1",
    activeTabId: "t1",
    maximizedCardId: null,
  });
});

describe("DashboardGrid", () => {
  it("renders one card per dashboard card", () => {
    render(<DashboardGrid onOpenLibrary={() => {}} />);
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("derives the layout array from the cards", () => {
    render(<DashboardGrid onOpenLibrary={() => {}} />);
    const layout = JSON.parse(screen.getByTestId("grid").dataset.layout ?? "[]");
    expect(layout).toEqual([
      { i: "c1", x: 0, y: 0, w: 20, h: 9 },
      { i: "c2", x: 0, y: 9, w: 20, h: 9 },
    ]);
  });

  it("does not persist a write when the grid reports the same layout back unchanged (e.g. on mount)", async () => {
    const updateLayouts = vi.fn().mockResolvedValue(undefined);
    useDashboardStore.setState({ updateLayouts });

    render(<DashboardGrid onOpenLibrary={() => {}} />);

    expect(updateLayouts).not.toHaveBeenCalled();
  });

  it("issues one batched updateLayouts per layout change", async () => {
    const updateLayouts = vi.fn().mockResolvedValue(undefined);
    useDashboardStore.setState({ updateLayouts });

    render(<DashboardGrid onOpenLibrary={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /simulate drag stop/i }));

    await waitFor(() => expect(updateLayouts).toHaveBeenCalledTimes(1));
    expect(updateLayouts).toHaveBeenCalledWith([
      { i: "c1", x: 5, y: 1, w: 10, h: 4 },
      { i: "c2", x: 0, y: 6, w: 8, h: 3 },
    ]);
  });

  it("removes a card when its close button is clicked", async () => {
    const removeCard = vi.fn().mockResolvedValue(undefined);
    useDashboardStore.setState({ removeCard });

    render(<DashboardGrid onOpenLibrary={() => {}} />);
    const closeButtons = screen.getAllByRole("button", { name: /remove card/i });
    await userEvent.click(closeButtons[0]);

    await waitFor(() => expect(removeCard).toHaveBeenCalledWith("c1"));
  });

  it("shows an empty state when no dashboard is active", () => {
    useDashboardStore.setState({ dashboards: [], activeId: null });
    render(<DashboardGrid onOpenLibrary={() => {}} />);
    expect(screen.getByText(/no dashboard selected/i)).toBeInTheDocument();
  });

  it("logs a rejected updateLayouts write via the catch block, proving it actually ran", async () => {
    // updateLayouts persists optimistically but still returns a promise that
    // can reject on a failed disk write; the grid must catch it (and log it)
    // rather than let it surface as an unhandled rejection.
    //
    // Asserting only `toHaveBeenCalledTimes(1)` here would duplicate the
    // batching test above without proving the try/catch exists: in Vitest
    // 2.1.9, a bare `void updateLayouts(...)` with no try/catch produces an
    // identical call count and does NOT trip the unhandled-rejection
    // detector for this call shape (verified empirically while building
    // this test — see task-15-report.md). So instead this asserts on the
    // real, observable side effect of the catch block running: an ERROR
    // line landing in the (fake) log file. If the try/catch were removed,
    // this line would never be written and the test would fail — that is
    // the containment net a call-count assertion alone cannot provide.
    const updateLayouts = vi.fn().mockRejectedValue(new Error("disk full"));
    useDashboardStore.setState({ updateLayouts });

    render(<DashboardGrid onOpenLibrary={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /simulate drag stop/i }));

    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("ERROR");
      expect(log).toContain("failed to persist layout change");
    });
  });

  it("shows a tab bar for the active dashboard's tabs", () => {
    render(<DashboardGrid onOpenLibrary={() => {}} />);
    expect(screen.getByRole("tab", { name: "Main" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows an empty state, but still offers the tab bar's Add button, when the active dashboard has zero tabs", () => {
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "Main", tabs: [] }],
      activeId: "d1",
      activeTabId: null,
    });
    render(<DashboardGrid onOpenLibrary={() => {}} />);
    expect(screen.getByText(/no tab selected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add tab" })).toBeInTheDocument();
  });

  it("renders cards only from the active tab, not another tab on the same dashboard", () => {
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "Main",
          tabs: [
            { id: "t1", name: "First", cards: [card("c1", 0)] },
            { id: "t2", name: "Second", cards: [card("c2", 0), card("c3", 9)] },
          ],
        },
      ],
      activeId: "d1",
      activeTabId: "t2",
    });
    render(<DashboardGrid onOpenLibrary={() => {}} />);
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("passes no resizeHandles prop by default, leaving react-grid-layout's own single-handle default", () => {
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
    render(<DashboardGrid onOpenLibrary={() => {}} />);
    expect(screen.getByTestId("grid")).toHaveAttribute("data-resize-handles", "null");
  });

  it("passes all four corner handles when cornerDragHandles is on", () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, cornerDragHandles: true },
    });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
    render(<DashboardGrid onOpenLibrary={() => {}} />);
    expect(screen.getByTestId("grid")).toHaveAttribute(
      "data-resize-handles",
      JSON.stringify(["nw", "ne", "sw", "se"]),
    );
  });

  it("adds the corner-handles class when cornerDragHandles is on, and omits it when off", () => {
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });

    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, cornerDragHandles: true },
    });
    const { rerender } = render(<DashboardGrid onOpenLibrary={() => {}} />);
    expect(screen.getByTestId("grid").className).toBe("dashboard-grid dashboard-grid-corner-handles");

    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, cornerDragHandles: false },
    });
    rerender(<DashboardGrid onOpenLibrary={() => {}} />);
    expect(screen.getByTestId("grid").className).toBe("dashboard-grid");
  });

  it("puts card-maximized on the maximized card's GRID ITEM, and on no other item", () => {
    useDashboardStore.setState({ maximizedCardId: "c2" });
    render(<DashboardGrid onOpenLibrary={() => {}} />);

    const maximized = document.querySelectorAll(".card-maximized");
    expect(maximized).toHaveLength(1);
    // The wrapper react-grid-layout clones into the .react-grid-item, NOT the
    // card inside it: the item is the transformed element, and a fixed
    // descendant of it would be laid out against it rather than the viewport.
    expect(maximized[0]).not.toHaveClass("widget-card");
    expect(maximized[0].querySelector(".widget-card")).not.toBeNull();
  });

  it("disables drag and resize on the maximized card's layout item only", () => {
    useDashboardStore.setState({ maximizedCardId: "c2" });
    render(<DashboardGrid onOpenLibrary={() => {}} />);

    const layout = JSON.parse(screen.getByTestId("grid").dataset.layout ?? "[]");
    // Per item, off the layout object -- react-grid-layout reads
    // l.isDraggable/l.isResizable there, not off the child. A maximized card
    // is not where its grid slot is, so a drag would move a slot nobody sees.
    expect(layout).toEqual([
      { i: "c1", x: 0, y: 0, w: 20, h: 9 },
      { i: "c2", x: 0, y: 9, w: 20, h: 9, isDraggable: false, isResizable: false },
    ]);
  });
});

describe("viewer mode", () => {
  it("passes isDraggable and isResizable false, so nothing can be moved or resized", () => {
    render(<DashboardGrid onOpenLibrary={vi.fn()} viewer />);

    const grid = screen.getByTestId("grid");
    expect(grid).toHaveAttribute("data-draggable", "false");
    expect(grid).toHaveAttribute("data-resizable", "false");
  });

  it("leaves both enabled in the main window", () => {
    render(<DashboardGrid onOpenLibrary={vi.fn()} />);

    const grid = screen.getByTestId("grid");
    expect(grid).toHaveAttribute("data-draggable", "true");
    expect(grid).toHaveAttribute("data-resizable", "true");
  });

  it("renders no card Remove button", () => {
    render(<DashboardGrid onOpenLibrary={vi.fn()} viewer />);
    expect(screen.queryByRole("button", { name: "Remove card" })).not.toBeInTheDocument();
  });
});
