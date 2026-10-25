// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { moveBefore, movedWithin } from "../lib/dragDrop";
import { logError } from "../lib/logger";
import { nextUntitledName } from "../lib/naming";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { InlineRename } from "./InlineRename";

/**
 * Defined where the drag originates, as WIDGET_DRAG_TYPE is in
 * WidgetLibrary.tsx and DASHBOARD_REORDER_DRAG_TYPE is in LeftRail.tsx. The
 * payload is the tab id, nothing else.
 *
 * Distinct from every other drag type in the app for the usual reason:
 * nothing that lands on a tab may be misread as something else, and nothing a
 * tab drag lands on may misread it. The rail's row and folder handlers gate
 * on carriesWidget / carriesDashboardReorder, so a tab dragged out over the
 * rail matches neither and is inert.
 */
export const TAB_REORDER_DRAG_TYPE = "application/x-bdobb-tab";

function carriesTab(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(TAB_REORDER_DRAG_TYPE);
}

/**
 * The active dashboard's own tab strip, and — since the outer dashboard
 * switcher (formerly DashboardTabs.tsx) was removed in favor of the left
 * rail's "My Dashboards" list — the only tab strip left in the app. The
 * component kept its click/rename/delete/add idiom and the "TabBar" name
 * from when it needed to avoid colliding with that sibling; the type it
 * works with is DashboardTab.
 *
 * Naming is inline and deletes confirm through the native dialog: WKWebView
 * implements neither window.prompt nor window.confirm, so the modal ones the
 * v3.0.0 text called for silently did nothing. See
 * docs/superpowers/specs/2026-08-27-inline-naming-native-confirm-design.md.
 */
export function TabBar({
  onOpenLibrary,
  viewer = false,
}: {
  onOpenLibrary: () => void;
  /** The "Open in new window" window: tabs still switch, nothing else edits. */
  viewer?: boolean;
}) {
  const dashboard = useDashboardStore((s) => s.dashboards.find((d) => d.id === s.activeId));
  const activeTabId = useDashboardStore((s) => s.activeTabId);
  const setActiveTab = useDashboardStore((s) => s.setActiveTab);
  const addTab = useDashboardStore((s) => s.addTab);
  const renameTab = useDashboardStore((s) => s.renameTab);
  const removeTab = useDashboardStore((s) => s.removeTab);
  const refreshAll = useDashboardStore((s) => s.refreshAll);
  const reorderTabs = useDashboardStore((s) => s.reorderTabs);
  const renameGroup = useDashboardStore((s) => s.renameGroup);
  const deleteGroup = useDashboardStore((s) => s.deleteGroup);
  /** A second entry point to the same library the rail's own button opens. */
  const quickAdd = useSettingsStore((s) => s.settings.quickAddToolbar);
  /** The tab whose label is currently an InlineRename field, if any. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** The tab a reorder drag is currently over, if any. */
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  /** The group chip currently showing an InlineRename field, if any. */
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  async function rename(tabId: string, next: string) {
    setEditingId(null);
    try {
      await renameTab(tabId, next);
    } catch (err) {
      await logError(`failed to rename tab ${tabId}: ${err}`);
    }
  }

  async function remove(tabId: string, name: string) {
    // The native confirm is inside the try too: it is an IPC call that can
    // reject, and the caller does not await this.
    try {
      const ok = await confirm(`Delete tab "${name}"?`, {
        title: "Delete tab",
        kind: "warning",
        okLabel: "Delete",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
      await removeTab(tabId);
    } catch (err) {
      await logError(`failed to remove tab ${tabId}: ${err}`);
    }
  }

  async function renameGroupTo(groupId: string, next: string) {
    setEditingGroupId(null);
    try {
      await renameGroup(groupId, next);
    } catch (err) {
      await logError(`failed to rename group ${groupId}: ${err}`);
    }
  }

  async function removeGroup(groupId: string, name: string) {
    // `?? []` mirrors handleTabDrop below: this helper is only reachable from
    // a rendered chip, which only renders when there is an active dashboard.
    const members = (dashboard?.tabs ?? []).reduce(
      (n, t) => n + t.cards.filter((c) => c.bindings?.some((b) => b.groupId === groupId)).length,
      0,
    );
    // The native confirm is an IPC call that can reject too, so it sits inside
    // the try: the caller fires this with `void`, and nothing else would log it.
    try {
      const ok = await confirm(
        `Delete group "${name}"? Its ${members} ${members === 1 ? "card keeps its" : "cards keep their"} current value${members === 1 ? "" : "s"}.`,
        { title: "Delete group", kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" },
      );
      if (!ok) return;
      await deleteGroup(groupId);
    } catch (err) {
      await logError(`failed to delete group ${groupId}: ${err}`);
    }
  }

  async function add(existing: string[]) {
    try {
      await addTab(nextUntitledName(existing));
    } catch (err) {
      await logError(`failed to add tab: ${err}`);
    }
  }

  async function reorder(orderedIds: string[]) {
    try {
      await reorderTabs(orderedIds);
    } catch (err) {
      await logError(`failed to reorder tabs: ${err}`);
    }
  }

  /**
   * Splices the dragged tab into the target's index as it stands BEFORE the
   * removal -- byte-for-byte the arithmetic LeftRail.handleReorderDrop uses,
   * and the same rule as tableColumns.ts moveColumn. Read that way, a
   * leftward drag lands before its target and a rightward drag lands after
   * it, which is what reaches the last slot without a trailing drop zone.
   *
   * from === to, an empty payload, and an id that resolves to nothing (a
   * payload from a dashboard that is no longer active) are all silent no-ops.
   */
  function handleTabDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    setDropTargetId(null);
    const draggedId = e.dataTransfer.getData(TAB_REORDER_DRAG_TYPE);
    if (!draggedId || draggedId === targetId) return;
    // `?.` satisfies the type, not a case that arises: this handler is only
    // reachable from a rendered tab, and a tab only renders when there is an
    // active dashboard. The -1 guard below covers it either way.
    const ids = dashboard?.tabs.map((t) => t.id) ?? [];
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    void reorder(moveBefore(ids, from, to));
  }

  if (!dashboard) return null;

  return (
    <div className="tab-bar">
      {/* The tablist holds the tabs only: Add tab, Refresh all and Add widget
          are not tabs, and inside a tablist they were announced as part of
          it. Laid out as the bar's own row (.tab-bar-tabs). */}
      <div className="tab-bar-tabs" role="tablist" aria-label="Tabs">
      {dashboard.tabs.map((t) => {
        // The WRAPPER carries both roles, as .rail-item does -- not the
        // [role="tab"] button -- so the ✕ area is droppable too and there is
        // no dead strip inside a tab. Off in the viewer window, which
        // switches tabs but edits nothing, and off while this tab's label is
        // an InlineRename: a text field inside a draggable ancestor cannot be
        // selected with the mouse, because the drag starts instead.
        // Double-click-to-rename on a non-editing tab is unaffected --
        // draggable elements still deliver click and dblclick when no drag is
        // begun, which is how the rail's rows both drag and activate.
        const reorderable = !viewer && t.id !== editingId;
        return (
          <div
            key={t.id}
            className="tab-bar-tab"
            data-drop-target={dropTargetId === t.id ? "true" : undefined}
            draggable={reorderable}
            // One spread, not five `reorderable ? … : undefined` props: a tab
            // that cannot be reordered carries no reorder handlers at all.
            {...(reorderable
              ? {
                  onDragStart: (e: React.DragEvent) => {
                    e.dataTransfer.setData(TAB_REORDER_DRAG_TYPE, t.id);
                    // Without effectAllowed the cursor shows a copy badge.
                    e.dataTransfer.effectAllowed = "move";
                  },
                  onDragEnter: (e: React.DragEvent) => {
                    // Gate on the same check onDragOver uses to refuse the
                    // drop, so an unrelated drag never lights an outline on a
                    // tab that was always going to reject it.
                    if (carriesTab(e)) setDropTargetId(t.id);
                  },
                  onDragLeave: (e: React.DragEvent) => {
                    // The wrapper has element children, so without this guard
                    // the first crossing onto one fires dragleave and the
                    // highlight goes off and never comes back.
                    if (movedWithin(e.relatedTarget, e.currentTarget)) return;
                    setDropTargetId((cur) => (cur === t.id ? null : cur));
                  },
                  onDragOver: (e: React.DragEvent) => {
                    // Without preventDefault the browser fires no drop at
                    // all. Gating it on the type refuses everything else.
                    if (carriesTab(e)) e.preventDefault();
                  },
                  onDrop: (e: React.DragEvent) => {
                    if (carriesTab(e)) handleTabDrop(e, t.id);
                  },
                }
              : {})}
          >
            {t.id === editingId ? (
              // Replaces the tab button rather than nesting inside it: an input
              // inside a <button> is invalid, and the button would take the
              // clicks meant for the field.
              <InlineRename
                value={t.name}
                ariaLabel="Rename tab"
                onCommit={(next) => void rename(t.id, next)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={t.id === activeTabId}
                onClick={() => setActiveTab(t.id)}
                onDoubleClick={viewer ? undefined : () => setEditingId(t.id)}
              >
                {t.name}
              </button>
            )}
            {viewer ? null : (
              <button
                type="button"
                className="tab-close"
                aria-label={`Delete tab ${t.name}`}
                onClick={() => void remove(t.id, t.name)}
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
      </div>
      {viewer ? null : (
        <button
          type="button"
          aria-label="Add tab"
          onClick={() => void add(dashboard.tabs.map((t) => t.name))}
        >
          ＋
        </button>
      )}
      {/* A card's controls row would otherwise silently ignore its groups
          with nothing on screen saying why. */}
      {dashboard.groupsDisabled ? <span className="tab-bar-tag">grouping off</span> : null}
      {(dashboard.groups ?? []).length > 0 ? (
        <div className="tab-bar-groups" aria-label="Parameter groups">
          {dashboard.groups!.map((g, i) => (
            <span key={g.id} className="group-chip">
              <span className="param-badge">{i + 1}</span>
              {g.id === editingGroupId ? (
                <InlineRename
                  value={g.name}
                  ariaLabel="Rename group"
                  onCommit={(next) => void renameGroupTo(g.id, next)}
                  onCancel={() => setEditingGroupId(null)}
                />
              ) : (
                <span
                  className="group-chip-label"
                  onDoubleClick={viewer ? undefined : () => setEditingGroupId(g.id)}
                >
                  {`${g.name} · ${g.value}`}
                </span>
              )}
              {viewer ? null : (
                <button
                  type="button"
                  className="tab-close"
                  aria-label={`Delete group ${g.name}`}
                  onClick={() => void removeGroup(g.id, g.name)}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      ) : null}
      {/* Always enabled: with no fetching card on the active tab, a bump is
          simply a no-op, and a button that greys itself out based on what is
          on the tab is more surprising than one that does nothing. */}
      <button type="button" className="refresh-all" aria-label="Refresh all" onClick={refreshAll}>
        ↻
      </button>
      {viewer || !quickAdd ? null : (
        <button
          type="button"
          className="quick-add-button"
          aria-label="Add widget"
          onClick={onOpenLibrary}
        >
          +
        </button>
      )}
    </div>
  );
}
