// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { arrangementOf, type Workspace } from "../lib/workspacesFile";
import { PRESETS, readingOrder, tileLetter, type PresetId } from "../lib/workspacePresets";
import { isKnownCalendar } from "../lib/calendar";
import { CATALOGUE } from "../lib/calendars/catalogue";
import { WORKSPACE_FORMATS, type WorkspaceFormat } from "../lib/saveWorkspace";
import type { MenuItem } from "./RowContextMenu";

/** Every folder, flattened depth-first, for the Move to submenu. */
export type FolderChoice = { id: string; name: string; depth: number };

/** `null` is the section-level menu; the three variants are a row's own. */
export type MenuTarget =
  | { kind: "dashboard"; id: string; name: string; groupsDisabled: boolean; exchange?: string }
  | { kind: "folder"; id: string; name: string }
  | {
      kind: "workspace";
      id: string;
      name: string;
      preset: PresetId;
      /** It has a `layout` of its own, so it shows no preset and none is checked. */
      customised: boolean;
      /** A launch candidate (spec 2026-10-12 §5). */
      openAtLaunch?: boolean;
    }
  | null;

/** What the rail can do about whatever was right-clicked. */
export type RailMenuActions = {
  create: (parentId: string | null) => void;
  createFolder: (parentId: string | null) => void;
  /** Opens the workspace dialog on a workspace, or on a new one for null. It creates nothing itself. */
  openWorkspace: (id: string | null) => void;
  /** Makes the workspace active and turns Arrange mode on (spec 2026-10-01 §3). */
  arrangeWorkspace: (id: string) => void;
  importApps: () => void;
  /** v8: every dashboard, then the locked-widgets docks when they hold one, to one file. */
  exportAllApps: () => void;
  openWindow: (id: string, name: string) => void;
  /** No format: the native Save panel asks for it. */
  save: (id: string, format?: WorkspaceFormat) => void;
  rename: (id: string) => void;
  duplicate: (id: string) => void;
  moveTo: (dashboardId: string, folderId: string | null) => void;
  toggleGrouping: (id: string, next: boolean) => void;
  /** v5.4.0: the dashboard's default exchange; null is Default (XNYS). */
  setExchange: (id: string, exchange: string | null) => void;
  remove: (id: string, name: string) => void;
  removeFolder: (id: string, name: string) => void;
  setPreset: (id: string, preset: PresetId) => void;
  /** Marks or clears it as a launch candidate (spec 2026-10-12 §8). */
  setOpenAtLaunch: (id: string, on: boolean) => void;
  /** Applies a saved layout to a workspace: a copy (spec 2026-10-01 §4). */
  applyLayout: (id: string, layoutId: string) => void;
  duplicateWorkspace: (id: string) => void;
  removeWorkspace: (id: string, name: string) => void;
  /** Issue #320: what a click on the row does -- open it alone, leaving any workspace. */
  open: (id: string) => void;
  /** Issue #320: put the dashboard in that tile of the active workspace, and focus it. */
  putInPanel: (dashboardId: string, slot: string) => void;
};

/**
 * The rail's context menu, as data for `RowContextMenu`. A function rather
 * than a component of its own: what varies between the three menus is the
 * item list, and the chrome — position, Escape at capture, outside-press
 * dismissal, arrow keys — is the primitive's job.
 *
 * `formatInSavePanel` is false where no native Save panel carries the Format
 * pop-up (browser mode, iOS): Save… then asks for the format in a flyout first.
 */
export function railMenuItems(
  target: MenuTarget,
  folders: FolderChoice[],
  on: RailMenuActions,
  /** The saved layouts, by name, for a workspace row's Layout ▸. */
  layouts: readonly { id: string; name: string }[] = [],
  /** The active workspace, if any: its tiles are what Put in panel ▸ lists. */
  workspace?: Workspace,
  formatInSavePanel = true,
): MenuItem[] {
  if (target === null) {
    return [
      { label: "New dashboard", onSelect: () => on.create(null) },
      { label: "New folder", onSelect: () => on.createFolder(null) },
      // A workspace is a sibling concept to a dashboard, not a child of one,
      // so it sits beside them here rather than under either. The ellipsis is
      // load-bearing: unlike the two above, it opens the workspace dialog
      // before anything is created.
      { label: "New workspace…", onSelect: () => on.openWorkspace(null) },
      // The ellipsis is load-bearing here as on New workspace…: unlike New
      // dashboard and New folder, this one opens a file picker before anything
      // happens.
      { label: "Import apps.json…", onSelect: () => on.importApps() },
      { label: "Export all dashboards…", onSelect: () => on.exportAllApps() },
    ];
  }

  if (target.kind === "folder") {
    return [
      { label: "Rename", onSelect: () => on.rename(target.id) },
      { label: "New dashboard here", onSelect: () => on.create(target.id) },
      { label: "New folder here", onSelect: () => on.createFolder(target.id) },
      { label: "Delete folder", onSelect: () => on.removeFolder(target.id, target.name) },
    ];
  }

  if (target.kind === "workspace") {
    return [
      // Edit… opens the whole workspace in its dialog; Rename and Layout stay
      // beside it as the quick single-field changes they always were.
      { label: "Edit…", onSelect: () => on.openWorkspace(target.id) },
      // After Edit… (spec 2026-10-01 §3). Offered at every width: this line
      // has no 600px rule and no dock editor.
      { label: "Arrange…", onSelect: () => on.arrangeWorkspace(target.id) },
      { label: "Rename", onSelect: () => on.rename(target.id) },
      {
        // Built from PRESETS rather than a hand-written list: adding the
        // iPad preset at v7 is one entry in that table and nothing here.
        label: "Layout",
        submenu: [
          ...Object.entries(PRESETS).map(([id, preset]) => ({
            label: preset.name,
            // A workspace with a layout of its own shows no preset (spec 2026-10-01 §4).
            checked: !target.customised && target.preset === id,
            onSelect: () => on.setPreset(target.id, id as PresetId),
          })),
          // Then the saved layouts, never checked: applying one copies it, so
          // no workspace stays linked to one.
          ...layouts.map((l, n) => ({
            label: l.name,
            separatorBefore: n === 0,
            onSelect: () => on.applyLayout(target.id, l.id),
          })),
        ],
      },
      {
        // After Layout (spec 2026-10-12 §8). Any number may be marked; the
        // launch rule picks the largest minimum that fits the screen.
        label: "Open at launch",
        checked: target.openAtLaunch === true,
        onSelect: () => on.setOpenAtLaunch(target.id, target.openAtLaunch !== true),
      },
      { label: "Duplicate", onSelect: () => on.duplicateWorkspace(target.id) },
      { label: "Delete", onSelect: () => on.removeWorkspace(target.id, target.name) },
    ];
  }

  return [
    // Issue #320: Open is the click's keyboard route, so it leads. Put in
    // panel ▸ is placing, which the click no longer does: one entry per tile
    // of the CURRENT arrangement in reading order, by the letter its Arrange
    // cover shows, the tile already showing this dashboard checked. Only
    // while a workspace is active -- outside one there are no panels.
    { label: "Open", onSelect: () => on.open(target.id) },
    ...(workspace
      ? [
          {
            label: "Put in panel",
            submenu: readingOrder(arrangementOf(workspace)).map((tile, i) => ({
              label: tileLetter(i),
              checked: workspace.slots.some((s) => s.slot === tile.slot && s.dashboardId === target.id),
              onSelect: () => on.putInPanel(target.id, tile.slot),
            })),
          },
        ]
      : []),
    { label: "Rename", onSelect: () => on.rename(target.id) },
    {
      label: "Move to",
      submenu: [
        { label: "Top level", depth: 0, onSelect: () => on.moveTo(target.id, null) },
        ...folders.map((f) => ({
          label: f.name,
          depth: f.depth,
          onSelect: () => on.moveTo(target.id, f.id),
        })),
      ],
    },
    { label: "Duplicate", onSelect: () => on.duplicate(target.id) },
    { label: "Open in a new window", onSelect: () => on.openWindow(target.id, target.name) },
    { label: "Delete", onSelect: () => on.remove(target.id, target.name) },
    formatInSavePanel
      ? { label: "Save…", separatorBefore: true, onSelect: () => on.save(target.id) }
      : {
          label: "Save…",
          separatorBefore: true,
          submenu: WORKSPACE_FORMATS.map((f) => ({ label: f.label, onSelect: () => on.save(target.id, f.id) })),
        },
    {
      label: "Disable grouping",
      checked: target.groupsDisabled,
      onSelect: () => on.toggleGrouping(target.id, !target.groupsDisabled),
    },
    {
      // Spec 2026-10-24: Default clears the field, then every catalogue calendar in the catalogue's order, the current
      // one checked, behind a search box. A stored name outside the catalogue stays listed, checked, for repair.
      label: "Exchange",
      search: "Search exchanges",
      submenu: [
        { label: "Default (XNYS)", checked: target.exchange === undefined, onSelect: () => on.setExchange(target.id, null) },
        ...(target.exchange !== undefined && !isKnownCalendar(target.exchange)
          ? [{ label: `${target.exchange} · not a served calendar`, checked: true, disabled: true }]
          : []),
        ...CATALOGUE.map((e) => ({
          label: `${e.mic} · ${e.name}`,
          checked: target.exchange === e.mic,
          onSelect: () => on.setExchange(target.id, e.mic),
        })),
      ],
    },
  ];
}
