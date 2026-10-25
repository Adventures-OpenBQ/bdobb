// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { save } from "@tauri-apps/plugin-dialog";
import { BaseDirectory, remove, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";

/** Decided per build (vite.config.ts envPrefix), not by sniffing the user agent. */
const IOS = import.meta.env.TAURI_ENV_PLATFORM === "ios";

type Writer = (path: string, options?: { baseDir: BaseDirectory }) => Promise<void>;

/** The dialog dance both save paths share -- see saveTextFile's comment for the iOS half. */
async function saveThrough(name: string, filters: { name: string; extensions: string[] }[], write: Writer): Promise<boolean> {
  if (!IOS) {
    const path = await save({ defaultPath: name, filters });
    if (path === null) return false;
    await write(path);
    return true;
  }
  const doc = { baseDir: BaseDirectory.Document } as const;
  await write(name, doc);
  try {
    return (await save({ defaultPath: name, filters })) !== null;
  } finally {
    await remove(name, doc).catch(() => {});
  }
}

/**
 * Ask where to put a file, then write `text` there. Resolves false when the
 * user cancels; the caller has nothing to report then.
 *
 * `extension` defaults to "json" (the only kind saveTextFile wrote until the
 * Logs tab needed a ".txt" export alongside it) so every existing caller is
 * unaffected.
 *
 * Every export goes through here because iOS has no save dialog. The dialog
 * plugin fakes one: it creates an EMPTY Documents/<name>, hands that to a
 * "move to..." picker, and returns wherever the user put it -- and it skips
 * creating the file when one already exists. Writing to the returned path
 * afterwards, as on the desktop, exported an empty file. So on iOS the
 * content is written to Documents/<name> FIRST and the picker exports the
 * finished file; the Documents copy is removed after, since the picker
 * copies rather than moves and a credential-bearing file has no business
 * lingering in a directory nothing else reads.
 */
export async function saveTextFile(
  name: string,
  filterName: string,
  text: string,
  extension = "json",
): Promise<boolean> {
  const written = await saveThrough(name, [{ name: filterName, extensions: [extension] }],
    (path, options) => writeTextFile(path, text, options));
  // Web build only: the shimmed save() never shows a real picker, so a file
  // the user asked to export would otherwise land only in memfs. An anchor
  // download hands them the actual bytes. Shim-level on purpose: it applies to
  // every export, which is the point. Gated on MODE so a packaged build never
  // creates a stray anchor.
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

/** The same dance for bytes: the chart's PNG snapshot. */
export async function saveBinaryFile(name: string, filterName: string, bytes: Uint8Array, extension: string): Promise<boolean> {
  return saveThrough(name, [{ name: filterName, extensions: [extension] }],
    (path, options) => writeFile(path, bytes, options));
}
