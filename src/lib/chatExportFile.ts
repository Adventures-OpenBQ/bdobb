// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

/** Save-dialog + write. Returns the chosen path, or null when cancelled. */
export async function exportChat(markdown: string, filename: string): Promise<string | null> {
  const path = await save({ defaultPath: filename, filters: [{ name: "Markdown", extensions: ["md"] }] });
  if (!path) return null;
  await writeTextFile(path, markdown);
  return path;
}
