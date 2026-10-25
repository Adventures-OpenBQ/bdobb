// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { invoke } from "@tauri-apps/api/core";
import { exportApp, exportCompatibleApp, type App } from "./appsJson";
import type { ExtensionResult } from "./appsExtensionsV3";
import type { Dashboard } from "./types";

export type WorkspaceFormat = "strict" | "bdobb";

/** The rail's single Save…: its two formats, in the order the Format pop-up
 * lists them. The first is the default. src-tauri/src/save_panel.rs carries
 * the same labels in the same order. */
export const WORKSPACE_FORMATS: { id: WorkspaceFormat; label: string }[] = [
  { id: "strict", label: "Strict OpenBB Workspace" },
  { id: "bdobb", label: "BDOBB Workspace" },
];

/** Strict OpenBB Workspace is the plain OpenBB app; BDOBB Workspace is the
 * compatible export, which may refuse. */
export function workspaceApp(dashboard: Dashboard, format: WorkspaceFormat): ExtensionResult<App> {
  return format === "bdobb" ? exportCompatibleApp(dashboard) : { ok: true, value: exportApp(dashboard) };
}

/** The native macOS Save panel with its Format pop-up. Null on cancel. The
 * command also admits the chosen path to the fs scope, as the dialog plugin's
 * own save() does. */
export async function pickWorkspaceFile(
  defaultName: string,
): Promise<{ path: string; format: WorkspaceFormat } | null> {
  return invoke("save_workspace_panel", { defaultName });
}
