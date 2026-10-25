// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { useScreenSize } from "../hooks/useScreenSize";
import { zoomFor } from "../lib/screenFit";
import RGL from "react-grid-layout";
import { arrangementOf } from "../lib/workspacesFile";
import {
  GRID_SIZE,
  MIN_TILE,
  type TilePlacement,
  isArrangement,
  readingOrder,
  swapTarget,
  swapTiles,
  tileLetter,
} from "../lib/workspacePresets";
import { WorkspaceArrangeBar } from "./WorkspaceArrangeBar";
import { WorkspaceTile } from "./WorkspaceTile";
import { useDashboardStore } from "../stores/dashboardStore";
import { effectiveWorkspace, useWorkspacesStore } from "../stores/workspacesStore";

/** The gap between tiles and around them, in px: the CSS grid's gap and padding before it. */
const GAP = 8;

/** A stable empty arrangement, for the frame with no workspace, so the memos below hold. */
const NO_TILES: readonly TilePlacement[] = [];

/**
 * What a resize, or a move that swaps nothing (settleDrag), leaves (spec
 * 2026-10-01 §3 "Pushing"): "unchanged" for a
 * press that moved nothing, the new arrangement, or "refused" when
 * react-grid-layout has pushed a tile off the grid. maxRows bounds the tile
 * being dragged but not one it pushes: with compactType null a collision
 * moves the other tile DOWN by its own height, and compact() keeps moving it
 * down until it overlaps nothing, with no row limit (react-grid-layout 1.5's
 * utils.js). So the result is checked once, when the gesture ends, and the
 * whole gesture is undone if it is not an arrangement. Exported for its test.
 */
export function settleGesture(
  tiles: readonly TilePlacement[],
  next: readonly RGL.Layout[],
): TilePlacement[] | "unchanged" | "refused" {
  let moved = false;
  const placed = tiles.map((t) => {
    const l = next.find((n) => n.i === t.slot);
    if (l === undefined || (l.x === t.x && l.y === t.y && l.w === t.w && l.h === t.h)) return t;
    moved = true;
    return { slot: t.slot, x: l.x, y: l.y, w: l.w, h: l.h };
  });
  if (!moved) return "unchanged";
  return isArrangement(placed) ? placed : "refused";
}

/**
 * What a MOVE leaves (spec 2026-10-01 §3): a swap when the dragged tile's
 * centre at release lies inside another tile as `tiles` had it when the drag
 * began -- the two exchange rectangles and nothing else moves, whatever the
 * library pushed about meanwhile -- and otherwise the push and its check
 * (settleGesture). `centre` is in grid units. A resize never comes here.
 * Exported for its test.
 */
export function settleDrag(
  tiles: readonly TilePlacement[],
  next: readonly RGL.Layout[],
  dragged: string,
  centre: { x: number; y: number },
): TilePlacement[] | "unchanged" | "refused" {
  const target = swapTarget(tiles, dragged, centre);
  return target === null ? settleGesture(tiles, next) : swapTiles(tiles, dragged, target);
}

/**
 * Where a drag event is, in viewport px. react-draggable 4.7.1 starts a
 * mouse drag on React's mousedown and stops it on the document's mouseup,
 * both carrying clientX/Y; a touch drag uses touchstart and touchend, and on
 * touchend only changedTouches still holds the point. Null when there is none.
 */
function pointOf(e: MouseEvent | TouchEvent): { x: number; y: number } | null {
  const p = "changedTouches" in e ? e.changedTouches[0] : e;
  return p === undefined ? null : { x: p.clientX, y: p.clientY };
}

/**
 * The tiled view: the workspace's arrangement (arrangementOf -- its own
 * `layout`, or its preset's tiles) on a 12 × 12 react-grid-layout that fills
 * the workspace area exactly, in Arrange mode and out of it (spec
 * docs/superpowers/specs/2026-10-01-workspace-arrange-design.md §5).
 *
 * The grid measures its own area rather than using the library's
 * WidthProvider: an arrangement is proportions of the area in BOTH
 * directions, so the row height has to follow the area's height too. The
 * dashboards inside need nothing from here when a tile changes size: their
 * own grids are WidthProvider(RGL), which observes its OWN element with a
 * ResizeObserver (react-grid-layout 1.5's lib/components/WidthProvider.jsx)
 * -- the same mechanism that already re-lays them out when the rail is
 * pinned (styles.css, above `.app-shell[data-rail-pinned]`).
 *
 * useCSSTransforms is off: a transformed tile would become the containing
 * block of every `position: fixed` box inside it -- the maximized card first,
 * placed in viewport coordinates (WorkspaceTile).
 *
 * Tiles are rendered in the arrangement's own order, never reading order: a
 * move that changes reading order must not make React reorder the tiles'
 * DOM nodes, which would reload any iframe in a moved one.
 */
export function WorkspaceGrid({
  workspaceId,
  onOpenLibrary,
}: {
  workspaceId: string;
  onOpenLibrary: () => void;
}) {
  // Two selections, each a stable reference, and the overlay derived from
  // them with useMemo -- never one selector returning effectiveWorkspace(...):
  // that would allocate a new object on every store read, which zustand takes
  // for a change on every render, and the grid would re-render forever. The
  // draft is the workspace dialog's or Arrange mode's -- never both at once;
  // effectiveWorkspace lays it over only when it is for THIS workspace, so
  // editing the active workspace previews here and editing any other one
  // does not.
  const saved = useWorkspacesStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const draft = useWorkspacesStore((s) => s.draft);
  const workspace = useMemo(() => effectiveWorkspace(saved, draft), [saved, draft]);
  const dashboardIds = useDashboardStore((s) => s.dashboards.map((d) => d.id).join(","));
  const arranging = useWorkspacesStore((s) => s.arrangingId === workspaceId);
  const stageDraft = useWorkspacesStore((s) => s.stageDraft);
  const screenSize = useScreenSize();

  const area = useRef<HTMLDivElement>(null);
  // The area's inner size, which the grid is laid out to fill.
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Bumped by a refused gesture. react-grid-layout resets its own layout from
  // the `layout` prop only when the prop is deep-unequal to the last one it
  // saw, so the tiles alone, unchanged, would leave the pushed layout on
  // screen; this counter, carried on every item, makes the prop new.
  const [undo, setUndo] = useState(0);
  // Where the pointer was when the current drag began. A swap needs the
  // dragged tile's centre at release, and onDragStop's own `newItem` is not
  // it: the library's collision handling overwrites its `y` with the
  // collided tile's. So the centre is the tile's start (onDragStop's
  // `oldItem`) plus how far the pointer has travelled since.
  const dragFrom = useRef<{ x: number; y: number } | null>(null);

  const present = workspace !== undefined;
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    // The first measurement is the observer's, as in WorkspaceTile and for
    // the reason App gives where it measures --dashboard-top. jsdom has no
    // ResizeObserver and gets the one call it would otherwise never get.
    if (typeof ResizeObserver === "undefined") {
      measure();
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [present]);

  // arrangementOf answers the draft's or the file's own array, or the preset
  // table's, so this is a stable reference between real changes.
  const tiles = workspace === undefined ? NO_TILES : arrangementOf(workspace);
  const letters = useMemo(
    () => new Map(readingOrder(tiles).map((t, n) => [t.slot, tileLetter(n)] as const)),
    [tiles],
  );
  const layout = useMemo(
    () => tiles.map((t) => ({ i: t.slot, x: t.x, y: t.y, w: t.w, h: t.h, minW: MIN_TILE, minH: MIN_TILE, undo })),
    [tiles, undo],
  );

  if (!workspace) return <p className="empty-state">No workspace selected.</p>;

  const known = new Set(dashboardIds === "" ? [] : dashboardIds.split(","));
  // Uniform zoom (spec 2026-10-12 §4): a workspace whose minimum is larger
  // than the screen is laid out at the area's size over the zoom -- so it
  // still fills the area, with no letterboxing -- and drawn with CSS `zoom`.
  // Never a transform (see useCSSTransforms below). 1 while arranging:
  // react-grid-layout reads pointer deltas in CSS px, which a zoomed grid
  // would misread on some engines, and arranging saves proportions anyway.
  const zoom = arranging ? 1 : zoomFor(screenSize, workspace.minResolution);
  const laidOut = { width: size.width / zoom, height: size.height / zoom };
  // Twelve rows and their thirteen gaps (padding included) fill the height
  // exactly. Never negative: an area shorter than its gaps draws nothing.
  const rowHeight = Math.max(0, (laidOut.height - GAP * (GRID_SIZE + 1)) / GRID_SIZE);

  /**
   * A gesture's outcome, applied: an arrangement is staged, which also
   * resets the library's own layout from the new prop; a refusal bumps
   * `undo` so the unchanged tiles still make a new prop.
   */
  function apply(result: TilePlacement[] | "unchanged" | "refused") {
    if (result === "unchanged") return;
    if (result === "refused") setUndo((n) => n + 1);
    else stageDraft({ layout: result });
  }

  /** A resize: pushing and its check only -- a resize never swaps (spec §3). */
  function settle(next: RGL.Layout[]) {
    apply(settleGesture(tiles, next));
  }

  /**
   * A move. The centre in grid units is the dragged tile's centre when the
   * drag began (`oldItem`, the library's clone from onDragStart) plus the
   * pointer's travel over one column's and one row's pitch -- a cell and its
   * gap. Without both points (a drag the library started without us, which
   * does not happen) it is an ordinary move.
   */
  function dragStopped(next: RGL.Layout[], oldItem: RGL.Layout, _newItem: RGL.Layout, _placeholder: RGL.Layout, e: MouseEvent) {
    const from = dragFrom.current;
    dragFrom.current = null;
    const to = pointOf(e);
    if (from === null || to === null) {
      settle(next);
      return;
    }
    const centre = {
      x: oldItem.x + oldItem.w / 2 + (to.x - from.x) / ((size.width - GAP) / GRID_SIZE),
      y: oldItem.y + oldItem.h / 2 + (to.y - from.y) / (rowHeight + GAP),
    };
    apply(settleDrag(tiles, next, oldItem.i, centre));
  }

  /** The ✕ on a cover (spec §3): the tile and its slot entry go; the dashboard is untouched. */
  function removeTile(slot: string) {
    const current = useWorkspacesStore.getState().draft;
    if (current === null) return;
    stageDraft({
      layout: tiles.filter((t) => t.slot !== slot),
      slots: current.slots.filter((s) => s.slot !== slot),
    });
  }

  return (
    // A column: the Arrange bar above, while arranging, and the measured area
    // below. .dashboard-area was a plain scroll box rather than a flex column
    // before v8, so the view supplies the column itself.
    <div className="workspace-view">
      {/* Above the tiles, outside the measured area: the area shrinks by the
          bar's height and the tiles rescale into what is left. */}
      {arranging ? <WorkspaceArrangeBar workspaceId={workspace.id} /> : null}
      <div
        ref={area}
        className="workspace-grid"
        data-arranging={arranging ? "true" : undefined}
        data-zoom={Math.round(zoom * 100)}
        // The faint grid behind the tiles while arranging (styles.css): one
        // column and one row pitch, a cell plus its gap.
        style={
          arranging
            ? ({
                "--ws-col": `${(size.width - GAP) / GRID_SIZE}px`,
                "--ws-row": `${(size.height - GAP) / GRID_SIZE}px`,
              } as CSSProperties)
            : undefined
        }
      >
        <RGL
          width={laidOut.width}
          // react-grid-layout spreads this over its own height, so it wins.
          // The zoom itself is applied by styles.css from --ws-zoom.
          style={
            zoom < 1
              ? ({ "--ws-zoom": String(zoom), width: laidOut.width, height: laidOut.height } as CSSProperties)
              : undefined
          }
          cols={GRID_SIZE}
          maxRows={GRID_SIZE}
          rowHeight={rowHeight}
          margin={[GAP, GAP]}
          containerPadding={[GAP, GAP]}
          compactType={null}
          preventCollision={false}
          allowOverlap={false}
          useCSSTransforms={false}
          // The area is the frame; the grid's own height does not size anything.
          autoSize={false}
          isDraggable={arranging}
          isResizable={arranging}
          // The face is the handle; its ✕ never starts a move.
          draggableHandle=".workspace-arrange-cover"
          draggableCancel=".workspace-arrange-remove"
          resizeHandles={["nw", "ne", "sw", "se"]}
          layout={layout}
          onDragStart={(_layout, _oldItem, _newItem, _placeholder, e) => {
            dragFrom.current = pointOf(e);
          }}
          onDragStop={dragStopped}
          onResizeStop={settle}
        >
          {tiles.map((t) => {
            const held = workspace.slots.find((s) => s.slot === t.slot)?.dashboardId;
            return (
              // A plain div is the grid item: react-grid-layout clones it to
              // add its own style, class and handles, which WorkspaceTile could
              // not take.
              <div key={t.slot}>
                <WorkspaceTile
                  workspaceId={workspace.id}
                  slot={t.slot}
                  dashboardId={held !== undefined && known.has(held) ? held : null}
                  // Absent is shown: only an explicit false hides the title lines.
                  showName={workspace.showTileNames !== false}
                  onOpenLibrary={onOpenLibrary}
                  rect={t}
                  letter={letters.get(t.slot) ?? ""}
                  arranging={arranging}
                  zoom={zoom}
                  onRemove={tiles.length > 1 ? () => removeTile(t.slot) : null}
                />
              </div>
            );
          })}
        </RGL>
      </div>
    </div>
  );
}
