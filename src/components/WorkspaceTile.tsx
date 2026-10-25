// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef } from "react";
import { DashboardGrid } from "./DashboardGrid";
import { DASHBOARD_REORDER_DRAG_TYPE } from "../lib/dragDrop";
import { logError } from "../lib/logger";
import type { TileRect } from "../lib/workspacePresets";
import { useDashboardStore } from "../stores/dashboardStore";
import { useWorkspacesStore } from "../stores/workspacesStore";

/**
 * One cell of a workspace. It owns three things the grid itself does not:
 * the focus gesture (mouse entry), the header that says which dashboard this
 * is, and the empty state.
 *
 * In Arrange mode it also owns the face that covers it (spec
 * docs/superpowers/specs/2026-10-01-workspace-arrange-design.md §3).
 *
 * `dashboardId` is null both for a slot nothing was put in and for a slot
 * naming a dashboard that has since been deleted. Those are deliberately the
 * same case here: a dangling reference is not an error to report, it is an
 * empty tile the user can refill, and treating it that way means a deleted
 * dashboard never has to be chased through every workspace file.
 */
export function WorkspaceTile({
  workspaceId,
  slot,
  dashboardId,
  showName,
  onOpenLibrary,
  rect,
  letter,
  arranging,
  onRemove,
  zoom = 1,
}: {
  workspaceId: string;
  slot: string;
  dashboardId: string | null;
  /**
   * The workspace's showTileNames, absence already read as true. False drops
   * the header line -- the name and the ✕ above the tab bar -- and hands the
   * ✕ to the dashboard's own tab bar instead (spec 2026-09-30 "Tile names").
   * An empty tile has no header either way.
   */
  showName: boolean;
  onOpenLibrary: () => void;
  /** Where the tile sits, in grid units: read only to re-measure a maximized card's insets when it moves. */
  rect: TileRect;
  /** The tile's place in reading order as a letter (spec 2026-10-01 §1), shown on the Arrange cover. */
  letter: string;
  /** True while this workspace is being arranged: the tile is covered by its face. */
  arranging: boolean;
  /** Removes the tile in Arrange mode; null on the last tile, which cannot be removed. */
  onRemove: (() => void) | null;
  /**
   * The grid's uniform zoom (spec 2026-10-12 §4), 1 when none. The insets
   * below are measured in viewport pixels but read inside the zoomed grid,
   * where every length is multiplied by it.
   */
  zoom?: number;
}) {
  const dashboard = useDashboardStore((s) => s.dashboards.find((d) => d.id === dashboardId));
  const focused = useDashboardStore((s) => s.activeId === dashboardId && dashboardId !== null);
  const setActive = useDashboardStore((s) => s.setActive);
  const assignSlot = useWorkspacesStore((s) => s.assignSlot);
  const clearSlot = useWorkspacesStore((s) => s.clearSlot);
  const setFocusedSlot = useWorkspacesStore((s) => s.setFocusedSlot);
  const tile = useRef<HTMLDivElement>(null);

  // A card maximized in this tile fills this tile's dashboard -- from the
  // bottom of the tile's own tab bar to the tile's inner edges -- and leaves
  // the other tiles in view. The card stays `position: fixed` (see
  // .react-grid-item.card-maximized in styles.css), and a fixed box is laid
  // out against the viewport, so the tile publishes where its dashboard is as
  // four VIEWPORT insets for styles.css to hand to `inset`.
  //
  // Measured rather than had for free by making the tile the card's containing
  // block (`contain: layout` or a transform would): that would re-base every
  // other fixed box inside the tile too.
  const held = dashboard?.id;
  useEffect(() => {
    const el = tile.current;
    if (!el || held === undefined) return;
    const bar = el.querySelector<HTMLElement>(".tab-bar");
    const measure = () => {
      const box = el.getBoundingClientRect();
      // clientLeft/Top and clientWidth/Height step inside the tile's border,
      // which a maximized card should not paint over. They are the tile's
      // own (unzoomed) pixels, so they are scaled into viewport pixels; the
      // four insets are then divided back by the zoom, because the card
      // reads them inside the zoomed grid (spec 2026-10-12 §4). At zoom 1
      // this is exactly the arithmetic it always was.
      const z = zoom > 0 ? zoom : 1;
      const left = box.left + el.clientLeft * z;
      const top = bar ? bar.getBoundingClientRect().bottom : box.top + el.clientTop * z;
      const right = window.innerWidth - left - el.clientWidth * z;
      const bottom = window.innerHeight - box.top - (el.clientTop + el.clientHeight) * z;
      el.style.setProperty("--tile-top", `${Math.round(top / z)}px`);
      el.style.setProperty("--tile-left", `${Math.round(left / z)}px`);
      el.style.setProperty("--tile-right", `${Math.round(right / z)}px`);
      el.style.setProperty("--tile-bottom", `${Math.round(bottom / z)}px`);
    };
    // The first measurement is the observer's, never a synchronous call here,
    // for the reason App gives where it measures --dashboard-top: a layout
    // flush at this point lands between react-grid-layout's two mount renders
    // and slides every card in from the corner. jsdom has no ResizeObserver
    // and gets the one call it would otherwise never get.
    if (typeof ResizeObserver === "undefined") {
      measure();
      return;
    }
    // The tile resizes with the window and the rail, which is every way its
    // place on screen changes; the bar's own height moves the top when its
    // tabs wrap.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (bar) observer.observe(bar);
    return () => observer.disconnect();
    // showName: the header line above the bar comes and goes with it, and
    // moves the bar without resizing the tile or the bar.
    //
    // rect: a tile can MOVE without changing size (spec 2026-10-01 §5), which
    // the observer never sees. Re-running re-observes, and the observer's
    // first callback measures the tile where it now is.
    //
    // zoom: the same tile at another zoom has other insets.
  }, [held, showName, rect.x, rect.y, rect.w, rect.h, zoom]);

  // Built once and worn in one of two places: the header line when names are
  // shown, the tab bar's trailing slot when they are hidden. One element, so
  // the two places can never drift apart in label or behaviour.
  const clear = dashboard ? (
    <button
      type="button"
      className="workspace-tile-clear"
      aria-label={`Clear ${dashboard.name} from this slot`}
      // A click with detail > 1 is the second of a double click. Done's double
      // click lands here once the Arrange bar has unmounted and the tiles have
      // moved up under the pointer: it must not clear a tile.
      onClick={(e) => {
        if (e.detail > 1) return;
        void clearSlot(workspaceId, slot).catch((err) => logError(`failed to clear slot ${slot}: ${err}`));
      }}
    >
      ✕
    </button>
  ) : null;

  return (
    <div
      ref={tile}
      className="workspace-tile"
      data-testid={`workspace-tile-${slot}`}
      data-focused={focused ? "true" : undefined}
      // Focus follows the mouse. mouseenter fires on this element when the
      // pointer crosses into it, descendants included, so entering a widget
      // deep inside has already set focus here — which is why no card-level
      // focus state is needed.
      //
      // The slot is tracked separately from the dashboard, and set
      // unconditionally: an EMPTY tile has no dashboard for setActive to
      // focus, but it is still a real target — a dashboard you create,
      // duplicate or import lands in the tile the mouse is over (#320: a rail
      // click no longer fills a tile; it opens the dashboard alone), so that
      // tile has to be known even when it is empty, or an empty slot in a
      // multi-tile workspace could only be filled by dragging onto it or by
      // the row menu's Put in panel ▸.
      onMouseEnter={() => {
        setFocusedSlot(slot);
        if (dashboard) setActive(dashboard.id, { keepMaximized: true });
      }}
      // A native file drag (dragging in from Finder) suppresses mouse events
      // for as long as it lasts, so onMouseEnter above never fires while one
      // is in progress -- focus stays wherever it was, even as the drag
      // crosses into a DIFFERENT tile. DropZone's single <main> wraps the
      // whole grid, so the eventual drop always lands through it and reads
      // addCard's target off activeId/activeTabIds[activeId], with no idea
      // which tile the file was dropped on. dragenter is the one event a
      // file drag still fires per element it crosses, so it takes over the
      // focus-follows-mouse job for exactly this gesture. Gated on "Files" so
      // it never fires for the dashboard-reorder drag onDragOver/onDrop
      // handle below, which must keep working exactly as it does.
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          setFocusedSlot(slot);
          if (dashboard) setActive(dashboard.id, { keepMaximized: true });
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DASHBOARD_REORDER_DRAG_TYPE)) e.preventDefault();
      }}
      onDrop={(e) => {
        const dropped = e.dataTransfer.getData(DASHBOARD_REORDER_DRAG_TYPE);
        if (!dropped) return;
        e.preventDefault();
        void assignSlot(workspaceId, slot, dropped).catch((err) =>
          logError(`failed to put dashboard ${dropped} in slot ${slot}: ${err}`),
        );
      }}
    >
      {/* While arranging, everything under the face is inert: the face stops
          the pointer, this stops Tab, Enter and assistive technology (spec
          2026-10-01 §3: nothing under the face can be used). display:
          contents so the wrapper adds no box and the tile's layout is
          unchanged; the face below stays outside it. */}
      <div inert={arranging} style={{ display: "contents" }}>
        {dashboard ? (
          <>
            {showName ? (
              <div className="workspace-tile-header">
                <span className="workspace-tile-name">{dashboard.name}</span>
                {clear}
              </div>
            ) : null}
            {/* Hidden names: the same ✕, same accessible name, as the LAST
                item of the tab bar. styles.css reserves its space and shows it
                only on hover or focus inside the tile. */}
            <DashboardGrid
              dashboardId={dashboard.id}
              onOpenLibrary={onOpenLibrary}
              trailing={showName ? undefined : clear}
            />
          </>
        ) : (
          <p className="empty-state workspace-tile-empty">
            Drag a dashboard here, or pick this tile under its row menu’s Put in panel.
          </p>
        )}
      </div>
      {arranging ? (
        // Arrange mode's face (spec 2026-10-01 §3): opaque, so the dashboard
        // underneath -- still mounted, still refreshing -- is covered and
        // nothing in it can be clicked or dragged. The face is the drag
        // handle (WorkspaceGrid's draggableHandle); the ✕ is excluded from it
        // (draggableCancel), so pressing it never starts a move.
        <div className="workspace-arrange-cover">
          <span className="workspace-arrange-letter">{letter}</span>
          <span className="workspace-arrange-name">{dashboard?.name ?? "Empty"}</span>
          {onRemove === null ? null : (
            <button
              type="button"
              className="workspace-arrange-remove"
              aria-label={`Remove tile ${letter}`}
              onClick={onRemove}
            >
              ✕
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
