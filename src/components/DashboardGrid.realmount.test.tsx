// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DashboardGrid against the REAL react-grid-layout — deliberately UNMOCKED.
 *
 * The guard under test is the mount-safety guard inside DashboardGrid's
 * `onLayoutChange` handler: the `const unchanged = next.every(...)` predicate
 * that compares each incoming item's {x,y,w,h} against the stored card before
 * `void persistLayout(next)` runs (`src/components/DashboardGrid.tsx`). The
 * source document calls this `layoutsEqual`; this tree has no function by that
 * name — the guard is that inline predicate, and that is the thing every
 * assertion here is about.
 *
 * Why a separate file from `DashboardGrid.test.tsx`: that file stubs
 * `react-grid-layout` (at its line 12). A stub can only *imitate* the mount
 * callback, so it cannot prove the guard survives what the real library
 * actually emits — a layout run through `synchronizeLayoutWithChildren` /
 * `cloneLayoutItem` and therefore decorated with the library's own bookkeeping
 * fields (`moved`, `static`, `minW`, `maxW`, `isDraggable`, `resizeHandles`).
 * Mocked and unmocked styles cannot coexist in one file, so they stay split.
 *
 * The real library reports its layout back from `componentDidMount` (and again
 * from `componentDidUpdate` whenever its state layout changes, e.g. after a tab
 * switch). Neither is a user move, and a write there would rewrite dashboards
 * on disk on every mount.
 *
 * Limit of what "handler ran" proves here: the spy sits on the LIBRARY's own
 * `onLayoutMaybeChanged`, so it observes react-grid-layout's lifecycle, not
 * whether `DashboardGrid` is still wired to it. If `DashboardGrid` stopped
 * passing `onLayoutChange` to the grid altogether, every assertion in this
 * file would still pass (verified) — the library would still call its own
 * prototype method and report a decorated layout; nothing here would notice
 * the wire was cut. What closes that gap is the sibling
 * `DashboardGrid.persist.test.tsx`, which fails all five of its cases in that
 * scenario, because it asserts through `onLayoutChange` itself. The two files
 * together are the guarantee; this file alone is not. The coupling to the
 * library's internal method name is deliberate and stays acceptable because
 * it fails loudly, not silently: `vi.spyOn` throws at setup if a future
 * version renames or removes `onLayoutMaybeChanged`, rather than leaving this
 * file quietly asserting nothing.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RGL from "react-grid-layout";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/plotly", () => ({
  renderPlot: () => Promise.resolve(),
  purgePlot: () => {},
  REGISTERED_TRACE_TYPES: new Set(["scatter", "candlestick"]),
}));

// The dashboard save itself is the assertion target: `updateLayouts` ->
// `mutateActive` -> `saveDashboard`. Everything between the grid's callback
// and the disk stays REAL, so a guard that leaks lands here.
vi.mock("../lib/dashboardsFile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/dashboardsFile")>()),
  saveDashboard: vi.fn().mockResolvedValue(undefined),
}));

import { saveDashboard } from "../lib/dashboardsFile";
import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { __reset as __resetFs } from "../test/memfs";
import { card as makeCard, widget as makeWidget } from "../test/fixtures";
import { DashboardGrid } from "./DashboardGrid";

// The two cards this produces — {x:0,y:0,w:20,h:9} and {x:0,y:9,w:20,h:9} on
// the GRID_COLS=40 grid — are deliberately contiguous and non-overlapping, so
// react-grid-layout's vertical compaction is a no-op: the mount-reported
// geometry equals the stored geometry, and "writes no dashboard on mount"
// below is testing the guard, not compaction noise. A future fixture with
// overlapping or out-of-bounds cards will make the library's mount write
// legitimately differ from the stored layout, and that test will then fail
// for a correct reason — fix the fixture in that case, not the guard.
const card = (id: string, y: number) =>
  makeCard({ id, widgetId: "w1", layout: { x: 0, y, w: 20, h: 9 } });

type LayoutItem = Record<string, unknown> & { i: string; x: number; y: number; w: number; h: number };

/**
 * react-grid-layout funnels every callback it is about to make through the
 * prototype method `onLayoutMaybeChanged(next, previous)`, which forwards to
 * `props.onLayoutChange(next)` only when the two differ. Recording both
 * arguments — while calling straight through, so the library behaves exactly
 * as it would unspied — is how this file can show that the mount callback
 * really did fire and what shape it carried, without stubbing the library.
 *
 * If a future version renames the method, `vi.spyOn` throws rather than
 * leaving these tests silently asserting nothing.
 */
const seen: { next: LayoutItem[]; previous: LayoutItem[] | undefined }[] = [];
type MaybeChanged = { onLayoutMaybeChanged(next: LayoutItem[], previous?: LayoutItem[]): void };
const gridProto = RGL.prototype as unknown as MaybeChanged;
const realMaybeChanged = gridProto.onLayoutMaybeChanged;
let spy: ReturnType<typeof vi.spyOn>;

const REAL_ACTIONS = {
  updateLayouts: useDashboardStore.getState().updateLayouts,
  removeCard: useDashboardStore.getState().removeCard,
};

beforeEach(() => {
  seen.length = 0;
  spy = vi
    .spyOn(gridProto, "onLayoutMaybeChanged")
    .mockImplementation(function (this: unknown, next: LayoutItem[], previous?: LayoutItem[]) {
      seen.push({ next, previous });
      return realMaybeChanged.call(this as MaybeChanged, next, previous);
    } as MaybeChanged["onLayoutMaybeChanged"]);

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
      {
        id: "d1",
        name: "Main",
        tabs: [
          { id: "t1", name: "First", cards: [card("c1", 0), card("c2", 9)] },
          { id: "t2", name: "Second", cards: [card("c3", 0), card("c4", 9)] },
        ],
      },
    ],
    activeId: "d1",
    activeTabId: "t1",
    maximizedCardId: null,
    viewer: false,
  });
});

afterEach(() => {
  spy.mockRestore();
});

describe("DashboardGrid against the real react-grid-layout", () => {
  it("really mounts the library, not a stub", async () => {
    render(<DashboardGrid onOpenLibrary={() => {}} />);

    // .react-grid-item is applied by the library's own GridItem, and the
    // absolute positioning it computes is proof the real thing rendered.
    await waitFor(() => expect(document.querySelectorAll(".react-grid-item")).toHaveLength(2));
    expect(document.querySelector(".react-grid-layout")).not.toBeNull();
  });

  it("reports a decorated layout back on mount that still projects to the stored geometry", async () => {
    render(<DashboardGrid onOpenLibrary={() => {}} />);

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    const { next, previous } = seen[0];

    // The library forwards to onLayoutChange only when next !== previous, so
    // this inequality IS the proof that DashboardGrid's handler ran on mount.
    expect(next).not.toEqual(previous);

    // ...and it differs only by the library's own bookkeeping fields. This is
    // exactly why the guard compares x/y/w/h field-by-field: a deep-equality
    // or identity check against the stored layout would call every mount a
    // move.
    for (const item of next) {
      expect(item).toHaveProperty("moved", false);
      expect(item).toHaveProperty("static", false);
      expect(item).toHaveProperty("minW");
      expect(item).toHaveProperty("maxW");
      expect(item).toHaveProperty("isDraggable");
      expect(item).toHaveProperty("resizeHandles");
    }
    expect(next.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h }))).toEqual([
      { i: "c1", x: 0, y: 0, w: 20, h: 9 },
      { i: "c2", x: 0, y: 9, w: 20, h: 9 },
    ]);
  });

  it("writes no dashboard on mount, though the library did report a layout", async () => {
    render(<DashboardGrid onOpenLibrary={() => {}} />);

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    // Let any un-awaited persist promise settle before concluding it never ran.
    await Promise.resolve();
    await Promise.resolve();

    expect(saveDashboard).not.toHaveBeenCalled();
  });

  it("writes no dashboard when a tab switch makes the library report the new tab's layout", async () => {
    render(<DashboardGrid onOpenLibrary={() => {}} />);
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    const afterMount = seen.length;

    await userEvent.click(screen.getByRole("tab", { name: "Second" }));

    // The second tab's cards are now the grid's children, so the library
    // recomputes and reports again — the case a mount-only flag would miss.
    await waitFor(() => expect(seen.length).toBeGreaterThan(afterMount));
    expect(seen.at(-1)?.next.map((l) => l.i)).toEqual(["c3", "c4"]);
    await Promise.resolve();
    await Promise.resolve();

    expect(saveDashboard).not.toHaveBeenCalled();
  });
});
