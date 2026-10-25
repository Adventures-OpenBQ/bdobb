// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { WORKSPACE_FORMATS, type WorkspaceFormat } from "../lib/saveWorkspace";
import type { MenuItem } from "./RowContextMenu";

/** Every folder, flattened depth-first, for the Move to submenu. */
export type FolderChoice = { id: string; name: string; depth: number };

/** `null` is the section-level menu; the two variants are a row's own. */
export type MenuTarget =
  | { kind: "dashboard"; id: string; name: string; groupsDisabled: boolean }
  | { kind: "folder"; id: string; name: string }
  | null;

/** What the rail can do about whatever was right-clicked. */
export type RailMenuActions = {
  create: (parentId: string | null) => void;
  createFolder: (parentId: string | null) => void;
  importApps: () => void;
  openWindow: (id: string, name: string) => void;
  /** No format: the native Save panel asks for it. */
  save: (id: string, format?: WorkspaceFormat) => void;
  rename: (id: string) => void;
  duplicate: (id: string) => void;
  moveTo: (dashboardId: string, folderId: string | null) => void;
  toggleGrouping: (id: string, next: boolean) => void;
  remove: (id: string, name: string) => void;
  removeFolder: (id: string, name: string) => void;
};

/**
 * The rail's context menu, as data for `RowContextMenu`. A function rather
 * than a component of its own: what varies between the three menus is the
 * item list, and the chrome — position, Escape at capture, outside-press
 * dismissal, arrow keys — is the primitive's job.
 *
 * `formatInSavePanel` is false where no native Save panel carries the Format
 * pop-up (browser mode): Save… then asks for the format in a flyout first.
 */
export function railMenuItems(
  target: MenuTarget,
  folders: FolderChoice[],
  on: RailMenuActions,
  formatInSavePanel = true,
): MenuItem[] {
  if (target === null) {
    return [
      { label: "New dashboard", onSelect: () => on.create(null) },
      { label: "New folder", onSelect: () => on.createFolder(null) },
      // The ellipsis is load-bearing: unlike the two above, this one opens a
      // file picker before anything happens.
      { label: "Import apps.json…", onSelect: () => on.importApps() },
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

  return [
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
  ];
}
