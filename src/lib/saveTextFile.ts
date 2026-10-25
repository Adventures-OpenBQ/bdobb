// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

/**
 * Save-dialog then write, as one call. Returns false when the user cancels,
 * so a caller can distinguish "nothing to report" from a successful write
 * without inspecting the path itself.
 *
 * `extension` defaults to "json" (the only kind saveTextFile wrote until the
 * Logs tab needed a ".txt" export alongside it) so every existing caller is
 * unaffected.
 */
export async function saveTextFile(
  name: string,
  filterName: string,
  text: string,
  extension = "json",
): Promise<boolean> {
  const path = await save({
    defaultPath: name,
    filters: [{ name: filterName, extensions: [extension] }],
  });
  if (path === null) return false;
  await writeTextFile(path, text);
  const written = true;
  // `vite --mode browser` has no native save dialog (src/browser-shim/dialog.ts's
  // save() always "succeeds" against an in-memory path) and no Tauri filesystem
  // for the user to retrieve the file from afterwards -- so in that mode the
  // write above is followed by an actual browser download of the same bytes.
  if (written && import.meta.env.MODE === "browser") {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return written;
}
