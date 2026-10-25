// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { saveTextFile } from "./saveTextFile";

/** Save-dialog + write. Returns the chosen path, or null when cancelled. */
export async function exportChat(markdown: string, filename: string): Promise<string | null> {
  // iOS's save() is a "move this file" picker over an EMPTY placeholder, so
  // writing to its path afterwards exported an empty file. saveTextFile writes
  // first there; the picker does not report a usable path, so the name stands in.
  if (import.meta.env.TAURI_ENV_PLATFORM === "ios") {
    return (await saveTextFile(filename, "Markdown", markdown, "md")) ? filename : null;
  }
  const path = await save({ defaultPath: filename, filters: [{ name: "Markdown", extensions: ["md"] }] });
  if (!path) return null;
  await writeTextFile(path, markdown);
  return path;
}
