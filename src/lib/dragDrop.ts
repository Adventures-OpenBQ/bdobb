// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/** Distinct from WidgetLibrary's WIDGET_DRAG_TYPE so a dashboard-row drag
 * (reorder, a move into a folder, or a drop into a workspace tile) and a
 * widget drag (add-to-dashboard) on the same rows never get misread as each
 * other. Lives here, not in LeftRail, because a workspace tile (WorkspaceTile)
 * needs to recognize the same drag LeftRail starts. */
export const DASHBOARD_REORDER_DRAG_TYPE = "application/x-bdobb-dashboard-reorder";

/**
 * True when `related` is still inside `container` -- i.e. a dragleave fired
 * only because the pointer crossed onto a child element, not because it
 * actually left the container. Without this check the highlight goes off and
 * stays off -- dragleave fires with nowhere for a later dragenter to bring it
 * back -- as soon as the pointer touches a child.
 *
 * Both drop targets in the app need it and neither may own it: the rail's
 * rows and folders (LeftRail.tsx) have a label and a shortcut chip inside
 * them, and a tab (TabBar.tsx) has its tab button and its close button.
 */
export function movedWithin(related: EventTarget | null, container: EventTarget | null): boolean {
  return related instanceof Node && container instanceof Node && container.contains(related);
}

/**
 * `items` with the member at `from` moved so that it sits at index `to` of the
 * ORIGINAL order. That is the standard list-reorder rule, and it is not the
 * same as "insert before `to`": dropped on a target AHEAD of it the member
 * lands after that target, dropped on one behind it, before. Always inserting
 * before would leave the last slot unreachable — dragging the first item onto
 * the last would only ever put it second-to-last.
 *
 * Three drop targets need this exact arithmetic and none may own it: the
 * rail's dashboard rows, the tab strip, and a table's column headers.
 */
export function moveBefore<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  next.splice(from, 1);
  next.splice(to, 0, items[from]);
  return next;
}
