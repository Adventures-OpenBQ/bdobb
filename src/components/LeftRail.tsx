import { SOURCE_CODE_LINK } from "../lib/sourceOffer";
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo, useState } from "react";
import type { HelpSet } from "../help/index";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { readTextFile, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useHoverPanel } from "../hooks/useHoverPanel";
import { moveBefore, movedWithin } from "../lib/dragDrop";
import { saveTextFile } from "../lib/saveTextFile";
import { pickWorkspaceFile, workspaceApp, type WorkspaceFormat } from "../lib/saveWorkspace";
import { buildTree, type FolderNode } from "../lib/folderTree";
import { importRefusal } from "../lib/importLimits";
import { logError } from "../lib/logger";
import { nextUntitledName } from "../lib/naming";
import { resolveSymbolOverride } from "../lib/params";
import type { Dashboard } from "../lib/types";
import { useDashboardStore } from "../stores/dashboardStore";
import { useFoldersStore } from "../stores/foldersStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { useWorkspaceSyncStore } from "../stores/workspaceSyncStore";
import { InlineRename } from "./InlineRename";
import { railMenuItems, type FolderChoice, type MenuTarget } from "./railMenu";
import { RailIcon } from "./RailIcon";
import { RowContextMenu } from "./RowContextMenu";
import { runAppsImport } from "./runAppsImport";
import { deleteSyncedDashboard, deleteTargets } from "./runDashboardSync";
import { WIDGET_DRAG_TYPE } from "./WidgetLibrary";

/** Distinct from WIDGET_DRAG_TYPE so a dashboard-row drag (reorder, or a move
 * into a folder) and a widget drag (add-to-dashboard) on the same rows never
 * get misread as each other. */
const DASHBOARD_REORDER_DRAG_TYPE = "application/x-bdobb-dashboard-reorder";

/**
 * Depth as a bare number on a custom property -- never as inline geometry.
 * The stylesheet turns it into the indent -- one 16px step per level of
 * `margin-left`, plus `width: auto` so the row still fills the space that
 * leaves -- for the expanded rail only.
 *
 * Two reasons it cannot be the geometry itself. Every row is `width: 100%`,
 * so indenting via `padding-left` alone would shift only a row's *content*
 * right -- its own box would still start flush with its unindented siblings,
 * because padding lives inside the border box; depth has to move the box.
 * And an inline `margin-left`/`padding-left` outranks every stylesheet rule,
 * including the collapsed rail's `padding: 8px 0; justify-content: center` --
 * which would leave a collapsed top-level badge sitting to the right of the
 * icon column, and a nested one clipped away entirely by the rail's
 * `overflow: hidden`. Collapsed, the rail is one icon column with no nesting
 * in it at all.
 */
function rowIndent(depth: number): React.CSSProperties {
  return { "--rail-depth": depth } as React.CSSProperties;
}

type Props = {
  onOpenLibrary: () => void;
  onOpenApps?: () => void;
  onOpenConnections: () => void;
  onOpenSettings: () => void;
  onOpenHelp: (set: HelpSet) => void;
};

function carriesWidget(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(WIDGET_DRAG_TYPE);
}

function carriesDashboardReorder(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(DASHBOARD_REORDER_DRAG_TYPE);
}

/** Depth-first, so the Move to list reads in the same order as the rail. */
function flattenFolders(nodes: FolderNode[], depth = 0): FolderChoice[] {
  return nodes.flatMap((node) => [
    { id: node.folder.id, name: node.folder.name, depth },
    ...flattenFolders(node.children, depth + 1),
  ]);
}

/**
 * The two feedback-routing items behind the rail's Help row, below the two
 * help items -- Quick Help (the built-in topics) and Reference Manual (the
 * vendored user guide).
 */
const HELP_LINKS: { label: string; url: string; title?: string }[] = [
  { label: "Report a Bug…", url: "https://github.com/Adventures-OpenBQ/bdobb/issues" },
  {
    label: "Request a Feature…",
    url: "https://artcashin.canny.io/bdobb",
    title: "Search first — upvote it if it's already there.",
  },
  SOURCE_CODE_LINK,
];

async function openLink(url: string) {
  try {
    await openUrl(url);
  } catch (err) {
    await logError(`failed to open ${url}: ${err}`);
  }
}

function RailSectionLabel({ children }: { children: string }) {
  return (
    <div className="rail-section-label" data-testid="rail-section-label">
      {children}
    </div>
  );
}

export function LeftRail({ onOpenApps, onOpenLibrary, onOpenConnections, onOpenSettings, onOpenHelp }: Props) {
  const panel = useHoverPanel();
  const dashboards = useDashboardStore((s) => s.dashboards);
  const activeId = useDashboardStore((s) => s.activeId);
  const setActive = useDashboardStore((s) => s.setActive);
  const addCardTo = useDashboardStore((s) => s.addCardTo);
  const addDashboard = useDashboardStore((s) => s.addDashboard);
  const renameDashboard = useDashboardStore((s) => s.renameDashboard);
  // Shared dashboards are read-only copies of someone else's: the rail marks them.
  const syncLinks = useWorkspaceSyncStore((s) => s.links);
  const sharedIds = new Set(syncLinks.filter((l) => l.shared && !l.dismissed).map((l) => l.dashboardId));
  const reorderDashboards = useDashboardStore((s) => s.reorderDashboards);
  const duplicateDashboard = useDashboardStore((s) => s.duplicateDashboard);
  const setGroupsDisabled = useDashboardStore((s) => s.setGroupsDisabled);

  const folders = useFoldersStore((s) => s.folders);
  const folderOrder = useFoldersStore((s) => s.folderOrder);
  const placement = useFoldersStore((s) => s.placement);
  const collapsed = useFoldersStore((s) => s.collapsed);
  const addFolder = useFoldersStore((s) => s.addFolder);
  const renameFolder = useFoldersStore((s) => s.renameFolder);
  const deleteFolder = useFoldersStore((s) => s.deleteFolder);
  const moveDashboard = useFoldersStore((s) => s.moveDashboard);
  const toggleCollapsed = useFoldersStore((s) => s.toggleCollapsed);

  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** The dashboard OR folder whose row label is currently an InlineRename field. */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // `target: null` is the section-level menu; a row's own right-click sets a
  // dashboard or folder target. One state variable serves all three, since
  // only one context menu is ever open at once.
  const [menuAt, setMenuAt] = useState<{
    x: number;
    y: number;
    target: MenuTarget;
    /** The row that was right-clicked, so closing the menu puts focus back on
     * it rather than on <body>. Null for the section background, which is not
     * focusable and so has nothing to return to. */
    trigger: HTMLElement | null;
  } | null>(null);
  const [helpMenuAnchor, setHelpMenuAnchor] = useState<HTMLElement | null>(null);
  /** One measurement for both coordinates: two getBoundingClientRect() calls
   * on the same element in the same render are two forced layouts for one
   * answer. Undefined while the menu is closed — the `?.` never measures. */
  const helpRect = helpMenuAnchor?.getBoundingClientRect();
  /**
   * The one line an export or an import leaves behind. Transient: cleared
   * whenever another one starts, and never persisted — it is about this
   * attempt, not about the rail.
   */
  const [notice, setNotice] = useState<string | null>(null);

  const tree = useMemo(
    () => buildTree(folders, folderOrder, placement, dashboards),
    [folders, folderOrder, placement, dashboards],
  );
  const folderChoices = useMemo(() => flattenFolders(tree.folders), [tree]);
  const collapsedSet = useMemo(() => new Set(collapsed), [collapsed]);

  // Naming is inline and deletes confirm through the native dialog:
  // WKWebView implements neither window.prompt nor window.confirm, so the
  // modal ones the v3.0.0 text called for silently did nothing. See
  // docs/superpowers/specs/2026-08-27-inline-naming-native-confirm-design.md.
  /**
   * Opens `id` if it is collapsed, and does nothing if it is already open —
   * `toggleCollapsed` alone would close an open one. Anything created inside
   * a collapsed folder is never mounted, and for a folder that is worse than
   * invisible: `renamingId` would be set with no InlineRename to clear it,
   * leaving the rail pinned open (`data-expanded`) around nothing.
   *
   * Reads `collapsed` from getState() rather than the render closure, since
   * the caller has already awaited a write by the time this runs.
   */
  async function expandFolder(id: string) {
    if (!useFoldersStore.getState().collapsed.includes(id)) return;
    await toggleCollapsed(id);
  }

  async function createDashboard(parentId: string | null) {
    setMenuAt(null);
    try {
      // addDashboard only creates; it does not switch to the new dashboard.
      // It answers null only when the viewer window refuses the write, and
      // the viewer renders no rail at all — so this is a guard, not a path.
      const id = await addDashboard(nextUntitledName(dashboards.map((d) => d.name)));
      if (id === null) return;
      if (parentId !== null) {
        await expandFolder(parentId);
        await moveDashboard(id, parentId);
      }
      setActive(id);
    } catch (err) {
      await logError(`failed to add dashboard: ${err}`);
    }
  }

  async function createFolder(parentId: string | null) {
    setMenuAt(null);
    try {
      if (parentId !== null) await expandFolder(parentId);
      // Same idiom as a new dashboard: created with a generated name, then
      // renamed inline, because there is no prompt to ask with.
      setRenamingId(await addFolder(nextUntitledName(folders.map((f) => f.name)), parentId));
    } catch (err) {
      await logError(`failed to add folder: ${err}`);
    }
  }

  /** One field serves both kinds of row, so the commit dispatches on the id. */
  async function commitRename(id: string, next: string) {
    setRenamingId(null);
    if (folders.some((f) => f.id === id)) return act(`rename folder ${id}`, () => renameFolder(id, next));
    await act(`rename dashboard ${id}`, () => renameDashboard(id, next));
  }

  /** Runs one rail action; a failure is logged as "failed to <what>", never thrown. */
  async function act(what: string, work: () => Promise<unknown>) {
    try {
      await work();
    } catch (err) {
      await logError(`failed to ${what}: ${err}`);
    }
  }

  /** The rail's delete confirm, shared by dashboards and folders. */
  async function confirmDelete(message: string, title: string, what: string, remove: () => Promise<unknown>) {
    // The native confirm is inside the try too: it is an IPC call that can
    // reject, and the caller does not await this.
    await act(what, async () => {
      const ok = await confirm(message, { title, kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" });
      if (ok) await remove();
    });
  }

  async function removeDashboardConfirm(id: string, name: string) {
    setMenuAt(null);
    // A synced dashboard says where else it goes (spec: Delete from the rail).
    const servers = deleteTargets(id);
    const message = servers.length > 0 ? `Delete "${name}" here and on ${servers.join(" and ")}?` : `Delete dashboard "${name}"?`;
    await confirmDelete(message, "Delete dashboard", `remove dashboard ${id}`, async () => {
      await deleteSyncedDashboard(id);
      // Its folder placement goes with it, or folders.json keeps the id for
      // good. Placing at the top level is exactly "no entry".
      await moveDashboard(id, null);
    });
  }

  async function removeFolderConfirm(id: string, name: string) {
    setMenuAt(null);
    // Says what actually happens: the folder goes, its contents move up.
    await confirmDelete(
      `Delete folder "${name}"? Its dashboards move up one level.`,
      "Delete folder",
      `remove folder ${id}`,
      () => deleteFolder(id),
    );
  }

  async function toggleFolder(id: string) {
    await act(`toggle folder ${id}`, () => toggleCollapsed(id));
  }

  /** The single place settings.dashboardOrder is written from the rail. */
  async function persistOrder(orderedIds: string[]): Promise<void> {
    try {
      await useSettingsStore.getState().save({ dashboardOrder: orderedIds });
    } catch (err) {
      await logError(`failed to persist dashboard order: ${err}`);
    }
  }

  async function duplicate(id: string) {
    setMenuAt(null);
    try {
      const copyId = await duplicateDashboard(id);
      if (copyId === null) return;
      // The store knows nothing about folders or about settings, so the
      // "same folder placement" and "inserted after the original in
      // dashboardOrder" halves of Duplicate are finished here. The store has
      // already put the copy directly after the original in memory.
      //
      // Order first: persistOrder swallows its own errors (it only logs), so
      // it always finishes, while moveDashboard's folder write can still
      // throw into the catch below. Doing it second would let a failed
      // placement write leave the copy missing from settings.dashboardOrder
      // even though it already exists in the dashboard list and on disk.
      await persistOrder(useDashboardStore.getState().dashboards.map((d) => d.id));
      const folderId = Object.hasOwn(placement, id) ? placement[id] : null;
      if (folderId !== null) await moveDashboard(copyId, folderId);
    } catch (err) {
      await logError(`failed to duplicate dashboard ${id}: ${err}`);
    }
  }

  /**
   * The rail's Save…. Natively the macOS Save panel's Format pop-up picks the
   * format, so the export runs after the panel answers; in browser mode the
   * menu's flyout already picked it and the existing save flow follows.
   */
  async function saveDashboard(id: string, chosen?: WorkspaceFormat) {
    setMenuAt(null);
    setNotice(null);
    const dashboard = dashboards.find((d) => d.id === id);
    if (!dashboard) return;
    const name = `${dashboard.name}.apps.json`;
    try {
      const picked = chosen ? null : await pickWorkspaceFile(name);
      if (!chosen && !picked) return;
      const format = chosen ?? picked!.format;
      const result = workspaceApp(dashboard, format);
      if (!result.ok) {
        setNotice(`Export refused: ${result.issue.code} at ${result.issue.path}: ${result.issue.message}`);
        return;
      }
      const text = `${JSON.stringify([result.value], null, 2)}\n`;
      if (picked) await writeTextFile(picked.path, text);
      else if (!(await saveTextFile(name, "apps.json", text))) return;
      setNotice(`Exported ${dashboard.name}${format === "bdobb" ? " with BDOBB v3 state" : ""}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNotice(`Export failed: ${message}`);
      // The dashboard id and the error only. An exported app carries every
      // param value the user typed into a card, and none of it belongs here.
      await logError(`failed to export dashboard ${id}: ${message}`);
    }
  }

  async function importAppsFile() {
    setMenuAt(null);
    setNotice(null);
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "apps.json", extensions: ["json"] }],
      });
      if (path === null) return;
      // Sized through stat, BEFORE the file is read: pulling a
      // multi-hundred-MB file into the webview is itself part of the freeze
      // this refuses, so neither readTextFile nor JSON.parse ever sees it.
      // open() adds the picked path to the fs scope, which covers stat as
      // much as it covers readTextFile.
      const bytes = (await stat(path)).size;
      const oversize = importRefusal(bytes);
      if (oversize !== null) {
        setNotice(oversize);
        return;
      }
      // Conflicts with your own dashboards are asked about, one per name,
      // before anything is written.
      setNotice(await runAppsImport(await readTextFile(path), bytes));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNotice(`Import failed: ${message}`);
      // The path is deliberately not logged either: it is the user's own
      // filesystem, and the message already says what went wrong.
      await logError(`failed to import apps.json: ${message}`);
    }
  }

  async function openInNewWindow(id: string, name: string) {
    setMenuAt(null);
    const label = `dash-${id}`;
    try {
      // Already open: focus it rather than failing on a duplicate label.
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        await existing.setFocus();
        return;
      }
      // Constructing it IS the request; a failure arrives on tauri://error
      // rather than as a rejection, so that is where it is caught.
      const created = new WebviewWindow(label, {
        url: `/?viewer=${id}`,
        title: name,
        width: 1200,
        height: 800,
        // As tauri.conf.json sets it for the main window: with Tauri's own
        // drag-drop handling on, the webview never sees a drop at all, and
        // DropZone's window-level guard could not stop one from navigating
        // this window away from the dashboard.
        dragDropEnabled: false,
      });
      void created.once<string>("tauri://error", (event) => {
        void logError(`failed to open dashboard ${id} in a new window: ${event.payload}`);
      });
    } catch (err) {
      await logError(`failed to open dashboard ${id} in a new window: ${err}`);
    }
  }

  async function moveTo(dashboardId: string, folderId: string | null) {
    setMenuAt(null);
    await act(`move dashboard ${dashboardId}`, () => moveDashboard(dashboardId, folderId));
  }

  async function toggleGrouping(id: string, next: boolean) {
    setMenuAt(null);
    await act(`toggle grouping for dashboard ${id}`, () => setGroupsDisabled(id, next));
  }

  async function handleDrop(e: React.DragEvent, dashboardId: string) {
    e.preventDefault();
    setDropTarget(null);
    // Split on the FIRST colon only: backendId is a crypto.randomUUID() and
    // cannot contain one, but widgetId is an unvalidated key straight out of
    // a backend's widgets.json and nothing stops it containing colons. A
    // naive split(":") would silently truncate such an id.
    const raw = e.dataTransfer.getData(WIDGET_DRAG_TYPE);
    const sep = raw.indexOf(":");
    if (sep === -1) {
      // No separator at all: not a payload we can parse, same as a widget
      // we can't resolve below — log and no-op rather than mis-slicing it.
      await logError(`dropped widget ${raw} is not in the registry`);
      return;
    }
    const backendId = raw.slice(0, sep);
    const widgetId = raw.slice(sep + 1);
    const widget = useWidgetRegistryStore.getState().find(backendId, widgetId);
    // The widget's backend can disappear mid-drag; a drop we cannot resolve
    // is a no-op rather than a thrown error.
    if (!widget) {
      await logError(`dropped widget ${widgetId} is not in the registry`);
      return;
    }
    // Switch immediately, before the write lands. mutateDashboard (which
    // addCardTo goes through) is itself optimistic — it set()s before
    // awaiting the write — so this matches the store's existing design, and
    // it means the last of several rapid drops naturally wins instead of a
    // stale snapshot silently discarding it.
    //
    // setActive resets activeTabId to the target dashboard's first tab when
    // switching TO it — but is a no-op if the drop target is already the
    // active dashboard, in which case activeTabId is left at whatever tab is
    // currently showing. Either way, reading it right here after setActive
    // is how this component picks a tab without needing any per-tab UI of
    // its own: a cross-dashboard drop lands on tab 1, a same-dashboard drop
    // lands on the tab you're already looking at.
    setActive(dashboardId);
    const tabId = useDashboardStore.getState().activeTabId;
    if (!tabId) {
      await logError(`dropped widget ${raw} has no tab to land on (dashboard ${dashboardId} has none)`);
      return;
    }
    const siblingCards =
      useDashboardStore
        .getState()
        .dashboards.find((d) => d.id === dashboardId)
        ?.tabs.find((t) => t.id === tabId)?.cards ?? [];
    const override = resolveSymbolOverride(widget, siblingCards, useSettingsStore.getState().settings);
    // The caller is `void handleDrop(...)`, so a failed write (addCardTo
    // ends in saveDashboard) is caught here or nowhere.
    try {
      await addCardTo(dashboardId, tabId, widget, override);
    } catch (err) {
      await logError(`failed to add the dropped widget ${widgetId} to dashboard ${dashboardId}: ${err}`);
    }
  }

  function handleReorderDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    setDropTarget(null);
    const draggedId = e.dataTransfer.getData(DASHBOARD_REORDER_DRAG_TYPE);
    if (!draggedId || draggedId === targetId) return;
    const currentIds = dashboards.map((d) => d.id);
    const from = currentIds.indexOf(draggedId);
    const to = currentIds.indexOf(targetId);
    if (from === -1 || to === -1) return;
    const reordered = moveBefore(currentIds, from, to);
    reorderDashboards(reordered);
    void persistOrder(reordered);
  }

  /**
   * A folder row takes the SAME reorder payload a dashboard row does — the
   * drag is "this dashboard", and where it lands decides what that means.
   * A widget payload is refused outright: a folder has no tab for a card to
   * land on, and guessing one would be worse than doing nothing.
   */
  async function handleFolderDrop(e: React.DragEvent, folderId: string) {
    e.preventDefault();
    setDropTarget(null);
    if (!carriesDashboardReorder(e)) return;
    const draggedId = e.dataTransfer.getData(DASHBOARD_REORDER_DRAG_TYPE);
    if (!draggedId) return;
    try {
      await moveDashboard(draggedId, folderId);
    } catch (err) {
      await logError(`failed to move dashboard ${draggedId} into folder ${folderId}: ${err}`);
    }
  }

  function dashboardRow(d: Dashboard, depth: number) {
    // The Option shortcut is the position in the FLAT dashboards array, not
    // in the tree — settings.dashboardOrder stays the single flat order.
    const index = dashboards.findIndex((x) => x.id === d.id);
    // Past the ninth there is no shortcut, but collapsed the badge is a
    // dashboard row's ONLY visible content, so without a stand-in rows 10+
    // were blank clickable strips. The name's first character takes the
    // badge's place; it is decorative, since the row's aria-label names it.
    const shortcut =
      index > -1 && index < 9 ? (
        <kbd className="rail-shortcut">⌥{index + 1}</kbd>
      ) : (
        <span className="rail-shortcut rail-initial" aria-hidden="true">
          {[...d.name][0] ?? "·"}
        </span>
      );
    const indent = rowIndent(depth);

    // The field replaces the row button rather than nesting inside it: an
    // input inside a <button> is invalid, and the button would take the
    // clicks meant for the field. The row is not clickable, draggable or a
    // drop target while it is being renamed.
    if (d.id === renamingId) {
      return (
        <div key={d.id} className="rail-item" style={indent}>
          <InlineRename
            value={d.name}
            ariaLabel="Rename dashboard"
            onCommit={(next) => void commitRename(d.id, next)}
            onCancel={() => setRenamingId(null)}
          />
          {shortcut}
        </div>
      );
    }

    return (
      <button
        key={d.id}
        type="button"
        className="rail-item"
        style={indent}
        // The plain name, not "⌥1 Main": collapsed, .rail-item-label is
        // display: none and leaves the accessibility tree, which would leave
        // this button nameless. The label span stays the visible name.
        aria-label={d.name}
        aria-current={d.id === activeId}
        data-drop-target={dropTarget === d.id ? "true" : undefined}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DASHBOARD_REORDER_DRAG_TYPE, d.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={() => setActive(d.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          // Stops the section-level handler above from also firing for this
          // same right-click — without it, both menus' state would be set in
          // the same event and the row-specific one (set last, since it's the
          // deeper handler in React's bubble order) would win by accident
          // rather than by design.
          e.stopPropagation();
          setMenuAt({
            x: e.clientX,
            y: e.clientY,
            trigger: e.currentTarget,
            target: {
              kind: "dashboard",
              id: d.id,
              name: d.name,
              groupsDisabled: d.groupsDisabled ?? false,
            },
          });
        }}
        onDragEnter={(e) => {
          // Gate on the same check onDragOver uses to refuse the drop —
          // otherwise a file or text drag lights the accept outline on a row
          // that was always going to reject it.
          if (carriesWidget(e) || carriesDashboardReorder(e)) setDropTarget(d.id);
        }}
        onDragLeave={(e) => {
          if (movedWithin(e.relatedTarget, e.currentTarget)) return;
          setDropTarget((cur) => (cur === d.id ? null : cur));
        }}
        onDragOver={(e) => {
          // Without preventDefault the browser never fires drop. Gating it on
          // the type refuses unrelated drags rather than accepting them.
          if (carriesWidget(e) || carriesDashboardReorder(e)) e.preventDefault();
        }}
        onDrop={(e) => {
          if (carriesDashboardReorder(e)) {
            handleReorderDrop(e, d.id);
          } else {
            void handleDrop(e, d.id);
          }
        }}
      >
        {/* Only the first nine get a shortcut. It leads the row, so a
            dashboard row has the same [glyph][label] shape as the fixed rows
            and its badge lands in the same column while collapsed. */}
        {shortcut}
        <span className="rail-item-label">{sharedIds.has(d.id) ? `${d.name} · shared` : d.name}</span>
      </button>
    );
  }

  function folderRow(node: FolderNode, depth: number) {
    const id = node.folder.id;
    const isCollapsed = collapsedSet.has(id);
    const indent = rowIndent(depth);

    return (
      <div key={id}>
        {id === renamingId ? (
          <div className="rail-item" style={indent}>
            <InlineRename
              value={node.folder.name}
              ariaLabel="Rename folder"
              onCommit={(next) => void commitRename(id, next)}
              onCancel={() => setRenamingId(null)}
            />
          </div>
        ) : (
          <button
            type="button"
            className="rail-item rail-folder-row"
            style={indent}
            // Same reason as a dashboard row: the collapsed rule hides the
            // label span, and a folder row has no badge to fall back on.
            aria-label={node.folder.name}
            aria-expanded={!isCollapsed}
            data-drop-target={dropTarget === id ? "true" : undefined}
            onClick={() => void toggleFolder(id)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuAt({
                x: e.clientX,
                y: e.clientY,
                trigger: e.currentTarget,
                target: { kind: "folder", id, name: node.folder.name },
              });
            }}
            onDragEnter={(e) => {
              if (carriesDashboardReorder(e)) setDropTarget(id);
            }}
            onDragLeave={(e) => {
              if (movedWithin(e.relatedTarget, e.currentTarget)) return;
              setDropTarget((cur) => (cur === id ? null : cur));
            }}
            onDragOver={(e) => {
              if (carriesDashboardReorder(e)) e.preventDefault();
            }}
            onDrop={(e) => void handleFolderDrop(e, id)}
          >
            <span className="rail-folder-caret" aria-hidden="true">
              {isCollapsed ? "▸" : "▾"}
            </span>
            <span className="rail-item-label">{node.folder.name}</span>
          </button>
        )}
        {isCollapsed ? null : (
          <>
            {node.children.map((child) => folderRow(child, depth + 1))}
            {node.dashboards.map((d) => dashboardRow(d, depth + 1))}
          </>
        )}
      </div>
    );
  }

  return (
    <nav
      className="left-rail"
      role="navigation"
      aria-label="Main"
      // Also expanded while a row is being renamed: the rail is
      // `overflow: hidden` at its collapsed width, so letting the hover timer
      // collapse it mid-rename would clip the field out of sight while it
      // still has focus.
      data-expanded={panel.open || renamingId !== null}
      {...panel.handlers}
    >
      <div className="rail-group rail-top">
        <button
          type="button"
          className="rail-item"
          // Collapsed, the label is display: none and so leaves the
          // accessibility tree; the aria-label keeps this button's name the
          // same in both states. Verbatim, ⌘K and parentheses included:
          // e2e/layout.spec.ts's quick-add toolbar test tells the tab bar's
          // "Add widget" from this row by an exact match, which a shorter
          // name here would break.
          aria-label="Add widget (⌘K)"
          onClick={() => {
            // Collapse first, for the same reason as the Widget Library
            // button below: the expanded rail (z-index 40) would otherwise
            // stay painted over the library overlay (z-index 30).
            panel.close();
            onOpenLibrary();
          }}
        >
          <RailIcon name="add" />
          <span className="rail-item-label">Add widget (⌘K)</span>
        </button>

        <RailSectionLabel>Library</RailSectionLabel>
        <button
          type="button"
          className="rail-item"
          aria-label="Widget Library"
          onClick={() => {
            // Collapse first: the expanded rail (z-index 40) would otherwise
            // stay painted over the library overlay (z-index 30).
            panel.close();
            onOpenLibrary();
          }}
        >
          <RailIcon name="library" />
          <span className="rail-item-label">Widget Library</span>
        </button>
        {onOpenApps ? <button type="button" className="rail-item" aria-label="Apps" onClick={() => { panel.close(); onOpenApps(); }}><RailIcon name="apps" /><span className="rail-item-label">Apps</span></button> : null}
        <div
          // Scopes "the dashboard rows" for the e2e specs: .rail-item-label is
          // on every row now, fixed rows included, so a rail-wide query by that
          // class no longer means "the dashboards".
          data-testid="rail-dashboards"
          onContextMenu={(e) => {
            e.preventDefault();
            setMenuAt({ x: e.clientX, y: e.clientY, target: null, trigger: null });
          }}
        >
          <RailSectionLabel>My Dashboards</RailSectionLabel>
          {/* Folders first, then the dashboards that are in no folder. */}
          {tree.folders.map((node) => folderRow(node, 0))}
          {tree.dashboards.map((d) => dashboardRow(d, 0))}
        </div>
      </div>

      <div className="rail-group rail-bottom">
        <button
          type="button"
          className="rail-item"
          aria-label="Connections"
          onClick={() => {
            panel.close();
            onOpenConnections();
          }}
        >
          <RailIcon name="connections" />
          <span className="rail-item-label">Connections</span>
        </button>
        <button
          type="button"
          className="rail-item"
          aria-label="Settings"
          onClick={() => {
            panel.close();
            onOpenSettings();
          }}
        >
          <RailIcon name="settings" />
          <span className="rail-item-label">Settings</span>
        </button>
        <button
          type="button"
          className="rail-item"
          aria-label="Help"
          aria-haspopup="menu"
          aria-expanded={helpMenuAnchor !== null}
          onClick={(e) => {
            // No panel.close() here, deliberately: this opens a small
            // anchored popover, not a full-screen overlay, so there is no
            // z-index conflict with the expanded rail (the right-click menu
            // behaves the same way).
            //
            // Capture currentTarget into a local first: React nulls it out
            // once the synthetic event finishes dispatching, and this
            // functional setState updater can run after that point.
            const button = e.currentTarget;
            setHelpMenuAnchor((cur) => (cur ? null : button));
          }}
        >
          <RailIcon name="help" />
          <span className="rail-item-label">Help</span>
        </button>
      </div>

      {notice ? (
        <p className="rail-notice" role="status">
          {notice}
        </p>
      ) : null}

      {helpMenuAnchor && helpRect ? (
        <RowContextMenu
          // Anchored to the Help row, which is pinned to the bottom of the
          // window: `openUp` makes `y` the menu's bottom edge, so it opens
          // above the row rather than off the bottom of the screen.
          x={helpRect.left}
          y={helpRect.top}
          openUp
          anchor={helpMenuAnchor}
          returnFocusTo={helpMenuAnchor}
          items={[
            {
              // The shortcut rides inside the label, exactly as the rail's own
              // "Add widget (⌘K)" row names its shortcut. A MenuItem is a
              // plain string, and one menu wanting a second column is not
              // reason enough to give all five of them one.
              label: "Quick Help (⌘?)",
              onSelect: () => {
                // panel.close() first, the same line the Connections and
                // Settings rows carry. Not strictly required -- the dialog is
                // a showModal() <dialog>, so the top layer already covers the
                // expanded rail -- but leaving the rail expanded behind a
                // modal it does not cover BY ACCIDENT OF ORDERING is not a
                // state worth having.
                panel.close();
                onOpenHelp("quick");
              },
            },
            {
              label: "Reference Manual",
              onSelect: () => {
                panel.close();
                onOpenHelp("manual");
              },
            },
            ...HELP_LINKS.map((link, i) => ({
              label: link.label,
              title: link.title,
              // Only above the first link: one rule separating the two help
              // items from the two feedback-routing items.
              separatorBefore: i === 0,
              onSelect: () => void openLink(link.url),
            })),
          ]}
          onClose={() => setHelpMenuAnchor(null)}
        />
      ) : null}

      {menuAt ? (
        <RowContextMenu
          x={menuAt.x}
          y={menuAt.y}
          returnFocusTo={menuAt.trigger}
          items={railMenuItems(menuAt.target, folderChoices, {
            create: (parentId) => void createDashboard(parentId),
            createFolder: (parentId) => void createFolder(parentId),
            importApps: () => void importAppsFile(),
            openWindow: (id, name) => void openInNewWindow(id, name),
            save: (id, format) => void saveDashboard(id, format),
            rename: (id) => setRenamingId(id),
            duplicate: (id) => void duplicate(id),
            moveTo: (dashboardId, folderId) => void moveTo(dashboardId, folderId),
            toggleGrouping: (id, next) => void toggleGrouping(id, next),
            remove: (id, name) => void removeDashboardConfirm(id, name),
            removeFolder: (id, name) => void removeFolderConfirm(id, name),
          }, import.meta.env.MODE !== "browser")}
          onClose={() => setMenuAt(null)}
        />
      ) : null}
    </nav>
  );
}
