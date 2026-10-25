// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The positive counterpart to `DashboardGrid.realmount.test.tsx`: a genuinely
 * different layout must reach the dashboard save, carrying the new geometry.
 *
 * The guard involved is the mount-safety guard inside DashboardGrid's
 * `onLayoutChange` handler: the `const unchanged = next.every(...)` predicate
 * that compares each incoming item's {x,y,w,h} against the stored card before
 * `void persistLayout(next)` runs (`src/components/DashboardGrid.tsx`). The
 * source document calls it `layoutsEqual`; this tree has no function by that
 * name — it is that inline predicate.
 *
 * Why this file exists: hard-coding that predicate to `true` (suppress every
 * write) or deleting the `updateLayouts` call outright passes the rest of the
 * suite, because the existing `DashboardGrid.test.tsx` replaces `updateLayouts`
 * with a `vi.fn()` and so never exercises the store -> `saveDashboard` path.
 * Here `updateLayouts` is the real store action and only the file write at the
 * very end is stubbed, so the assertion is on what would actually be written.
 *
 * No drag is synthesized. jsdom has no layout engine, and faking
 * `getBoundingClientRect`/`offsetParent` plus react-grid-layout's pixel<->grid
 * arithmetic would test the fake, not the app. Instead the `onLayoutChange`
 * callback the component hands to the grid is captured and invoked directly —
 * with the same decorated item shape the real library emits (see the realmount
 * file, which proves that shape against the unmocked library).
 */
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/plotly", () => ({
  renderPlot: () => Promise.resolve(),
  purgePlot: () => {},
  REGISTERED_TRACE_TYPES: new Set(["scatter", "candlestick"]),
}));

/**
 * A capture-only stub: it records the callback and renders the children, and
 * deliberately does NOT fire anything on mount. Mount behaviour belongs to
 * the unmocked realmount file; this one is about a single, explicit, changed
 * layout and nothing else.
 */
let onLayoutChange: ((next: GridLayoutItem[]) => void) | null = null;
vi.mock("react-grid-layout", () => ({
  default: ({
    children,
    onLayoutChange: handler,
  }: {
    children: React.ReactNode;
    onLayoutChange: (next: unknown[]) => void;
  }) => {
    onLayoutChange = handler as (next: GridLayoutItem[]) => void;
    return <div data-testid="grid">{children}</div>;
  },
  WidthProvider: (Component: unknown) => Component,
}));

// Only the disk write is stubbed. `updateLayouts` -> `mutateActive` ->
// `saveDashboard` all run for real, so this asserts on the dashboard that
// would have been written.
vi.mock("../lib/dashboardsFile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/dashboardsFile")>()),
  saveDashboard: vi.fn().mockResolvedValue(undefined),
}));

import { saveDashboard } from "../lib/dashboardsFile";
import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import type { Dashboard } from "../lib/types";
import { useDashboardStore, type GridLayoutItem } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { __reset as __resetFs } from "../test/memfs";
import { card as makeCard, widget as makeWidget } from "../test/fixtures";
import { DashboardGrid } from "./DashboardGrid";

const card = (id: string, y: number) =>
  makeCard({ id, widgetId: "w1", layout: { x: 0, y, w: 20, h: 9 } });

/** The item shape react-grid-layout really emits, bookkeeping fields and all. */
const emitted = (l: GridLayoutItem) => ({
  ...l,
  moved: false,
  static: false,
  minW: undefined,
  maxW: undefined,
  isDraggable: undefined,
  resizeHandles: undefined,
});

const REAL_ACTIONS = {
  updateLayouts: useDashboardStore.getState().updateLayouts,
  removeCard: useDashboardStore.getState().removeCard,
};

const cardsOf = (d: Dashboard) => d.tabs.flatMap((t) => t.cards);

beforeEach(() => {
  onLayoutChange = null;
  vi.mocked(saveDashboard).mockClear();
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
    viewer: false,
  });
});

/** The geometry a drag/resize would have produced. Every field differs. */
const MOVED: GridLayoutItem[] = [
  { i: "c1", x: 5, y: 1, w: 10, h: 4 },
  { i: "c2", x: 0, y: 6, w: 8, h: 3 },
];

async function reportLayout(next: GridLayoutItem[]): Promise<void> {
  expect(onLayoutChange).not.toBeNull();
  await act(async () => {
    onLayoutChange?.(next);
  });
}

describe("DashboardGrid persists a changed layout", () => {
  it("writes the dashboard with the new geometry", async () => {
    render(<DashboardGrid onOpenLibrary={() => {}} />);
    await reportLayout(MOVED.map(emitted));

    expect(saveDashboard).toHaveBeenCalledTimes(1);
    const written = vi.mocked(saveDashboard).mock.calls[0][0];
    expect(cardsOf(written).map((c) => ({ i: c.id, ...c.layout }))).toEqual(MOVED);
  });

  it("leaves the same geometry in the store, so the UI and the file agree", async () => {
    render(<DashboardGrid onOpenLibrary={() => {}} />);
    await reportLayout(MOVED.map(emitted));

    const stored = useDashboardStore.getState().dashboards[0];
    expect(cardsOf(stored).map((c) => ({ i: c.id, ...c.layout }))).toEqual(MOVED);
  });

  // This does NOT isolate DashboardGrid's own stripping map (line 63's
  // `next.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h }))`).
  // `dashboardStore.updateLayouts` re-strips independently (its own `{ x, y,
  // w, h }` rebuild at persistence time), so this test passes with either
  // layer's map removed and only fails if BOTH stop stripping. What it
  // actually verifies is the pipeline end to end — that library bookkeeping
  // fields never survive the trip from `onLayoutChange` to the write,
  // regardless of which layer is doing the stripping at any given moment.
  it("persists geometry only — none of the library's bookkeeping fields reach the write", async () => {
    render(<DashboardGrid onOpenLibrary={() => {}} />);
    await reportLayout(
      MOVED.map((l) => ({ ...emitted(l), static: true, isDraggable: false, isResizable: false })),
    );

    const written = vi.mocked(saveDashboard).mock.calls[0][0];
    for (const c of cardsOf(written)) {
      expect(Object.keys(c.layout).sort()).toEqual(["h", "w", "x", "y"]);
    }
  });

  it("carries a card's non-geometry state through the write untouched", async () => {
    // A layout write must not be a chance to lose params or the widget binding.
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "Main",
          tabs: [
            {
              id: "t1",
              name: "Main",
              cards: [
                makeCard({ id: "c1", widgetId: "w1", params: { symbol: "AAPL" }, layout: { x: 0, y: 0, w: 20, h: 9 } }),
                card("c2", 9),
              ],
            },
          ],
        },
      ],
    });

    render(<DashboardGrid onOpenLibrary={() => {}} />);
    await reportLayout(MOVED.map(emitted));

    const written = vi.mocked(saveDashboard).mock.calls[0][0];
    const c1 = cardsOf(written).find((c) => c.id === "c1");
    expect(c1?.params).toEqual({ symbol: "AAPL" });
    expect(c1?.widgetId).toBe("w1");
  });

  it("writes once per reported change, not once per moved item", async () => {
    render(<DashboardGrid onOpenLibrary={() => {}} />);
    await reportLayout(MOVED.map(emitted));

    expect(saveDashboard).toHaveBeenCalledTimes(1);
  });
});
