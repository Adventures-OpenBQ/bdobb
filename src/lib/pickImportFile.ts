// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, stat } from "@tauri-apps/plugin-fs";
import { importRefusal } from "./importLimits";

/**
 * The pick, size-check and read every JSON file import shares: null when the
 * user cancels, the refusal when the file is too big (sized through stat,
 * before it is read), else its text and size.
 */
export async function pickImportFile(name: string): Promise<null | { refusal: string } | { text: string; bytes: number }> {
  const path = await open({ multiple: false, filters: [{ name, extensions: ["json"] }] });
  if (path === null) return null;
  const bytes = (await stat(path)).size;
  const refusal = importRefusal(bytes);
  if (refusal !== null) return { refusal };
  return { text: await readTextFile(path), bytes };
}
