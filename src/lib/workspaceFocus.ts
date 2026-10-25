// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { arrangementOf, type Workspace } from "./workspacesFile";
import { readingOrder } from "./workspacePresets";
import { logError } from "./logger";
import { useDashboardStore } from "../stores/dashboardStore";
import { useWorkspacesStore } from "../stores/workspacesStore";

/**
 * The slot ids the workspace's CURRENT arrangement shows, in reading order --
 * the one place that order is taken for focus, so the two rules below cannot
 * drift apart.
 */
function shownSlots(workspace: Workspace): string[] {
  return readingOrder(arrangementOf(workspace)).map((t) => t.slot);
}

/**
 * The dashboard a workspace focuses when it opens: the first tile in reading
 * order that holds a dashboard `exists` accepts, or null when no tile does.
 * Slot ids mean nothing about position once tiles can be swapped and
 * arranged, so this is never "the first slot entry".
 */
export function firstDashboardInReadingOrder(
  workspace: Workspace,
  exists: (dashboardId: string) => boolean,
): string | null {
  for (const slot of shownSlots(workspace)) {
    const held = workspace.slots.find((s) => s.slot === slot);
    if (held !== undefined && exists(held.dashboardId)) return held.dashboardId;
  }
  return null;
}

/**
 * Puts `dashboardId` in the active workspace's focused slot and focuses it --
 * the resolution a rail click on a dashboard row (LeftRail's `dashboardRow`)
 * and the ⌥N / ⌥0 "dashboards" shortcut (useDashboardShortcuts) both needed,
 * pulled out here so the two share one implementation instead of two copies
 * that can drift. Since issue #320 those two open a dashboard alone instead
 * (openDashboardAlone, below); what still lands here is a new, duplicated or
 * imported dashboard, and the rail menu's Put in panel ▸.
 * Returns false, doing nothing, when no workspace is active
 * -- the caller's own plain `setActive(dashboardId)` is single-dashboard
 * mode's unchanged fallback, and stays the caller's job rather than this
 * module's.
 *
 * This is deliberately a plain function reading both stores via `getState()`
 * rather than either store importing the other: workspacesStore must never
 * import dashboardStore (see its own header comment on why a slot id means
 * nothing outside its workspace), and the reverse would be just as circular.
 * A lib helper that reads both is the way out of that without either store
 * knowing the other exists.
 *
 * Slot resolution: a tile in the current arrangement already showing
 * `dashboardId` wins, so it is focused rather than moved. Next, the slot the mouse last entered wins when the workspace's
 * CURRENT arrangement actually has it. Failing that, the slot already showing the
 * focused dashboard -- but only if THAT slot survives the same check.
 * `workspace.slots` on disk deliberately keeps entries for tiles the current
 * arrangement does not have (the dashboards a smaller one hides), so a layout
 * change can leave either candidate
 * naming a slot the grid cannot show -- each one needs its own guard, or the
 * unchecked one would silently target a hidden slot. Failing both, the
 * arrangement's first tile in reading order.
 *
 * An `explicitSlot` skips all of that: the rail menu's Put in panel ▸
 * (issue #320) names its tile outright, from the arrangement's own reading
 * order, so there is nothing left to resolve.
 */
export function focusDashboardInWorkspace(dashboardId: string, explicitSlot?: string): boolean {
  const workspace = useWorkspacesStore.getState().activeWorkspace();
  if (!workspace) return false;

  const shown = shownSlots(workspace);
  const inArrangement = (slot: string | null): string | null =>
    slot !== null && shown.includes(slot) ? slot : null;

  const hoveredSlot = useWorkspacesStore.getState().focusedSlot;
  const activeId = useDashboardStore.getState().activeId;
  const slotShowingActiveId =
    workspace.slots.find((s) => s.dashboardId === activeId)?.slot ?? null;
  // An explicit slot gets the same arrangement check as the resolved ones:
  // the row menu that passes it is built from the current arrangement, but
  // nothing else guarantees a caller's slot is one the grid can show.
  const targetSlot =
    (explicitSlot !== undefined ? inArrangement(explicitSlot) : null) ??
    (explicitSlot !== undefined
      ? undefined
      : // A tile already showing it is just focused: assigning it elsewhere
        // would evict that tile's dashboard and save the shuffle.
        (inArrangement(workspace.slots.find((s) => s.dashboardId === dashboardId)?.slot ?? null) ??
        inArrangement(hoveredSlot) ??
        inArrangement(slotShowingActiveId) ??
        shown[0]));
  if (targetSlot === undefined) return true;

  void useWorkspacesStore
    .getState()
    .assignSlot(workspace.id, targetSlot, dashboardId)
    .then(() => {
      const { setActive, setActiveTab, dashboards } = useDashboardStore.getState();
      setActive(dashboardId);
      // setActive starts a dashboard on its first tab; in a tile it shows the
      // tab this workspace records, as a restart does (issue #23).
      const saved = workspace.activeTabIds?.[dashboardId];
      if (saved && dashboards.find((d) => d.id === dashboardId)?.tabs.some((t) => t.id === saved)) setActiveTab(dashboardId, saved);
    })
    .catch((err) => logError(`failed to put dashboard ${dashboardId} in a workspace slot: ${err}`));
  return true;
}

/**
 * Leaves workspace mode and shows `dashboardId` by itself -- what a rail click
 * on a dashboard row, the row menu's Open and the ⌥N / ⌥0 "dashboards"
 * shortcut do (issue #320). It writes nothing: the workspace keeps its tiles
 * and arrangement, and re-entering it shows them as they were. Outside a
 * workspace setActiveWorkspace(null) is a no-op, so this is the plain
 * dashboard switch single-dashboard mode has always had.
 *
 * Leaving goes through setActiveWorkspace(null), the same call a click on the
 * active workspace's own row makes, so the focused slot is dropped the same
 * way.
 */
export function openDashboardAlone(dashboardId: string): void {
  useWorkspacesStore.getState().setActiveWorkspace(null);
  useDashboardStore.getState().setActive(dashboardId);
}
