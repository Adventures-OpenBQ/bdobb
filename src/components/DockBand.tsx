// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useSyncExternalStore } from "react";
import RGL, { WidthProvider } from "react-grid-layout";
import { DEFAULT_DOCK_ROWS, DOCK_LABEL, DOCK_ROWS_MAX, DOCK_ROWS_MIN, DOCKS_ID } from "../lib/dashboardsFile";
import { logError } from "../lib/logger";
import type { PinEdge } from "../lib/types";
import { GRID_COLS, GRID_ROW_HEIGHT, useDashboardStore, type GridLayoutItem } from "../stores/dashboardStore";
import { selectEffective, useSettingsStore } from "../stores/settingsStore";
import { ErrorBoundary } from "./ErrorBoundary";
import { WidgetCard } from "./WidgetCard";

const GridLayout = WidthProvider(RGL);
/**
 * The grid's side padding, DashboardGrid's [10, 10]. A band pads only its
 * OUTER edge (CSS on .dock-band-top / -bottom): the gap on the inner edge is
 * the dashboard's own top or bottom padding, and padding it too would double it.
 */
const PAD = 10;

/**
 * Every write from a dock is optimistic in memory and can still reject on the
 * disk write behind it -- cancelDockEdit especially, which restores the
 * snapshot BEFORE it writes. A rejection is logged, never unhandled.
 */
function report(edge: PinEdge, p: Promise<void>, what: string): void {
  void p.catch((err) => void logError(`dock ${edge} ${what}: ${err instanceof Error ? err.message : String(err)}`));
}

/** The height a band of `rows` rows reserves: the grid's rows plus the one outer pad. */
function bandHeight(rows: number, widgetGap: number): number {
  return rows * GRID_ROW_HEIGHT + (rows - 1) * widgetGap + PAD;
}

const onResize = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const windowHeight = () => window.innerHeight;

/**
 * What a short window leaves the dashboard between the two locked bands:
 * the tab bar and a few rows of grid.
 * ponytail: a fixed 200px, not measured from the tab bar or pinned bands;
 * measure them if a band ever caps where the grid still had room.
 */
const MIN_CANVAS_PX = 200;

/**
 * The most rows `edge`'s band can show in this window: what the other band
 * leaves of the window less MIN_CANVAS_PX, or half of that if both are tall
 * (DOCK_ROWS_MAX's 24 rows on both edges overflow an iPad). Where both bands
 * fit at their stored rows this is at least those rows, so nothing changes.
 * The stored rows are untouched (the docks sync to every device), so a
 * taller window shows them all again.
 * ponytail: the window, not .dashboard-area -- the area is the window's
 * height less the safe-area inset; measure the area if that inset matters.
 */
function useFitRows(edge: PinEdge, widgetGap: number): number {
  const height = useSyncExternalStore(onResize, windowHeight);
  const other: PinEdge = edge === "top" ? "bottom" : "top";
  const otherRows = useDashboardStore((s) =>
    (s.docks.tabs.find((t) => t.id === other)?.cards.length ?? 0) > 0 ? (s.docks.dockRows ?? DEFAULT_DOCK_ROWS)[other] : 0,
  );
  const room = height - MIN_CANVAS_PX;
  const px = Math.max(room / 2, room - (otherRows > 0 ? bandHeight(otherRows, widgetGap) : 0));
  return Math.max(DOCK_ROWS_MIN, Math.floor((px - PAD + widgetGap) / (GRID_ROW_HEIGHT + widgetGap)));
}

/**
 * One edge's cards as a small react-grid-layout of `rows` rows, with the
 * dashboard's 40-column measure and row height, so a card's w and h mean here
 * what they mean on a dashboard. Shared by the live band (locked cards,
 * nothing moves) and the editor's canvas (full chrome, drag and resize).
 * `maxRows` keeps a card inside the rows the edge reserves.
 */
function DockGrid({ edge, editing, viewer }: { edge: PinEdge; editing: boolean; viewer: boolean }) {
  const cards = useDashboardStore((s) => s.docks.tabs.find((t) => t.id === edge)?.cards);
  const rows = useDashboardStore((s) => (s.docks.dockRows ?? DEFAULT_DOCK_ROWS)[edge]);
  const maximizedCardId = useDashboardStore((s) => s.maximizedCardId);
  const updateLayouts = useDashboardStore((s) => s.updateLayouts);
  const removeCard = useDashboardStore((s) => s.removeCard);
  const widgetGap = useSettingsStore((s) => selectEffective(s).widgetGap);
  const cornerDragHandles = useSettingsStore((s) => s.settings.cornerDragHandles);
  const list = cards ?? [];

  const layout = list.map((c) => ({ i: c.id, ...c.layout }));
  /**
   * react-grid-layout reports its layout back on mount and whenever the
   * `layout` prop changes reference, neither of which is a user move -- so
   * the guard is on content, the same one DashboardGrid uses.
   */
  const persist = (next: GridLayoutItem[]) => {
    const unchanged = next.every((l) => {
      const c = list.find((x) => x.id === l.i);
      return c !== undefined && c.layout.x === l.x && c.layout.y === l.y && c.layout.w === l.w && c.layout.h === l.h;
    });
    if (unchanged) return;
    report(edge, updateLayouts(next.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h }))), "layout");
  };

  return (
    <GridLayout
      className={cornerDragHandles ? "dashboard-grid dashboard-grid-corner-handles" : "dashboard-grid"}
      layout={layout}
      cols={GRID_COLS}
      rowHeight={GRID_ROW_HEIGHT}
      maxRows={rows}
      margin={[widgetGap, widgetGap]}
      containerPadding={[PAD, 0]}
      // As the dashboard grid (bdobb#6): a card stays where it was put.
      compactType={null}
      isDraggable={editing}
      isResizable={editing}
      draggableHandle=".card-title"
      resizeHandles={cornerDragHandles ? ["nw", "ne", "sw", "se"] : undefined}
      onLayoutChange={persist}
    >
      {list.map((card) => (
        // The class lands on the GRID ITEM, as in DashboardGrid: a maximized
        // card is `position: fixed` and must not be laid out against a
        // transformed ancestor.
        <div key={card.id} className={card.id === maximizedCardId ? "card-maximized" : undefined}>
          <ErrorBoundary label={card.widgetId}>
            <WidgetCard
              card={card}
              dashboardId={DOCKS_ID}
              viewer={viewer}
              locked={!editing}
              onRemove={() => report(edge, removeCard(card.id), `remove ${card.id}`)}
            />
          </ErrorBoundary>
        </div>
      ))}
    </GridLayout>
  );
}

/**
 * The live band: one edge's locked widgets, mounted once in App outside the
 * dashboard switch, so switching dashboards, tabs or local workspaces never
 * remounts a locked card (a News card's wire stays connected, a chart keeps
 * its zoom). Every card is `locked`. An empty edge renders nothing. While its
 * edge is being edited the band steps aside -- the editor's canvas is the one
 * view of it then -- and it comes back with whatever OK or Cancel left.
 */
export function DockBand({ edge, viewer = false }: { edge: PinEdge; viewer?: boolean }) {
  const count = useDashboardStore((s) => s.docks.tabs.find((t) => t.id === edge)?.cards.length ?? 0);
  const rows = useDashboardStore((s) => (s.docks.dockRows ?? DEFAULT_DOCK_ROWS)[edge]);
  const editing = useDashboardStore((s) => s.dockEdit?.edge === edge);
  const hasMaximized = useDashboardStore(
    (s) =>
      s.maximizedCardId !== null &&
      (s.docks.tabs.find((t) => t.id === edge)?.cards.some((c) => c.id === s.maximizedCardId) ?? false),
  );
  const widgetGap = useSettingsStore((s) => selectEffective(s).widgetGap);
  const shown = Math.min(rows, useFitRows(edge, widgetGap));

  if (editing || count === 0) return null;
  return (
    <section
      // A maximized card is `position: fixed`, but the band is a stacking
      // context, so the card would be trapped at the band's own level and
      // painted over by the sibling bands. The band rises to the card's level
      // for as long as one of its cards is maximized.
      className={`dock-band dock-band-${edge}${hasMaximized ? " dock-band-maximized" : ""}`}
      aria-label={DOCK_LABEL[edge]}
      // Capped to the window, the band scrolls its rows; the grid keeps all of
      // them (maxRows), so nothing is moved or rewritten by a short window.
      style={{ height: bandHeight(shown, widgetGap), overflowY: shown < rows ? "auto" : undefined }}
    >
      <DockGrid edge={edge} editing={false} viewer={viewer} />
    </section>
  );
}

/**
 * Settings ▸ Locked Widgets' editor: a panel over the dashboard area, opened
 * by Locked at Top… / Locked at Bottom…, holding a blank canvas the width of
 * the dashboard area and as tall as the rows the edge reserves -- so what is
 * laid out here is exactly what the band will show. The bar carries the
 * green + (⌘K too), the rows stepper, Cancel and OK. Escape is Cancel, after
 * menus, the library, dialogs and a maximized card (each consumes its own
 * Escape first); a cancelled edit goes back to Settings ▸ Locked Widgets.
 */
export function DockEditor({
  onOpenLibrary,
  onCancelled,
}: {
  onOpenLibrary: () => void;
  /** After Cancel (button or Escape) has restored the snapshot: App reopens Settings on Locked Widgets. */
  onCancelled?: () => void;
}) {
  const edge = useDashboardStore((s) => s.dockEdit?.edge ?? null);
  const rows = useDashboardStore((s) => (edge === null ? 0 : (s.docks.dockRows ?? DEFAULT_DOCK_ROWS)[edge]));
  const count = useDashboardStore((s) =>
    edge === null ? 0 : (s.docks.tabs.find((t) => t.id === edge)?.cards.length ?? 0),
  );
  const setDockRows = useDashboardStore((s) => s.setDockRows);
  const cancel = useDashboardStore((s) => s.cancelDockEdit);
  const commit = useDashboardStore((s) => s.commitDockEdit);
  const widgetGap = useSettingsStore((s) => selectEffective(s).widgetGap);
  // As tall as the live band can show here, so the canvas stays what the band shows.
  const maxRows = Math.min(DOCK_ROWS_MAX, useFitRows(edge ?? "top", widgetGap));

  useEffect(() => {
    if (edge === null) return;
    // Bubble phase on window: a menu (MenuPanel, capture), the library
    // (capture), a dialog (document) and an inline rename (React) all stop
    // their own Escape before it gets here; a maximized card restores first.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing || useDashboardStore.getState().maximizedCardId !== null) return;
      report(edge, cancel().then(() => onCancelled?.()), "cancel");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edge, cancel, onCancelled]);

  if (edge === null) return null;
  // setDockRows clamps (clampDockRows), and each button is disabled at its bound.
  const step = (delta: number) => report(edge, setDockRows(edge, rows + delta), "rows");

  return (
    <div className="dock-editor" role="dialog" aria-label={`Editing ${DOCK_LABEL[edge]}`}>
      <div className="dock-edit-bar" role="toolbar" aria-label={`Editing ${DOCK_LABEL[edge]}`}>
        <h2 className="dock-edit-title">{DOCK_LABEL[edge]}</h2>
        {/* The same green + the tab bar uses to add a widget, so the icon
            means one thing everywhere. */}
        <button type="button" className="quick-add-button" aria-label="Add widget" onClick={onOpenLibrary}>
          +
        </button>
        <span className="dock-edit-rows">
          <button type="button" aria-label="Shorter" onClick={() => step(-1)} disabled={rows <= DOCK_ROWS_MIN}>
            −
          </button>
          <span aria-live="polite">{rows} rows</span>
          <button type="button" aria-label="Taller" onClick={() => step(1)} disabled={rows >= maxRows}>
            +
          </button>
        </span>
        <button type="button" onClick={() => report(edge, cancel().then(() => onCancelled?.()), "cancel")}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={() => report(edge, commit(), "commit")}>
          OK
        </button>
      </div>
      <p className="dock-edit-hint">
        This canvas is the band as it will appear along the {edge} of every dashboard: the same width, {rows} rows
        tall. Add widgets, then move and size them here.
      </p>
      {/* The canvas: a blank band-sized area, or the grid at exactly the rows
          the edge reserves. Its width is the dashboard area's, so a card's
          columns mean here what they mean on the band. */}
      <section
        className={`dock-canvas dock-canvas-${edge}`}
        aria-label={`${DOCK_LABEL[edge]} canvas`}
        style={{ height: bandHeight(rows, widgetGap) }}
      >
        {count === 0 ? (
          <p className="empty-state dock-empty">Add a widget with ⌘K.</p>
        ) : (
          <DockGrid edge={edge} editing viewer={false} />
        )}
      </section>
    </div>
  );
}
