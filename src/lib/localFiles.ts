// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { BaseDirectory, exists, mkdir, readFile, remove, writeFile } from "@tauri-apps/plugin-fs";

const fsOpts = { baseDir: BaseDirectory.AppData } as const;

/** Every stored file lives here, under the app's own data directory. */
export const LOCAL_FILE_DIR = "files";

/**
 * The ceiling a dropped data file is refused above, and the reason it is
 * checked against `File.size` BEFORE a byte is read: pulling a
 * multi-hundred-MB file into the webview is itself the freeze this refuses.
 * Larger than IMPORT_MAX_BYTES because this file is copied, not parsed into
 * dashboards.
 */
export const LOCAL_FILE_MAX_BYTES = 50 * 1024 * 1024;

const BYTES_PER_MB = 1024 * 1024;

/**
 * A stored name and nothing else: a uuid, a dot, a short lowercase
 * extension. `card.params.file` is ordinary persisted card state that an
 * imported apps.json or a hand-edited dashboard can carry anything in, so
 * every path this module builds is validated before it is built -- "../" and
 * an absolute path both fail this shape.
 */
const STORED_NAME = /^[0-9a-f-]{36}\.[a-z0-9]{1,5}$/;

/** The line to show the user, or null when the file is within the limit. */
export function localFileRefusal(name: string, bytes: number): string | null {
  if (bytes <= LOCAL_FILE_MAX_BYTES) return null;
  // Rounded UP, so a file one byte over the cap does not read as the limit.
  const mb = Math.ceil((bytes / BYTES_PER_MB) * 10) / 10;
  return `${name} is ${mb} MB; the limit is ${LOCAL_FILE_MAX_BYTES / BYTES_PER_MB} MB.`;
}

/** The lower-cased extension of `name`, or "" when it has none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function pathOf(storedName: string): string {
  if (!STORED_NAME.test(storedName)) throw new Error("not a stored file name");
  return `${LOCAL_FILE_DIR}/${storedName}`;
}

/**
 * Copies the dropped file's bytes into `files/<uuid>.<ext>` and returns the
 * stored name -- which is what the card persists in `params.file`. The
 * original name is never part of the path: it is the user's own text, and a
 * uuid cannot collide with, escape or overwrite anything.
 */
export async function saveLocalFile(file: File): Promise<string> {
  const ext = extensionOf(file.name);
  const storedName = `${crypto.randomUUID()}.${ext}`;
  const path = pathOf(storedName);
  await mkdir(LOCAL_FILE_DIR, { ...fsOpts, recursive: true });
  await writeFile(path, new Uint8Array(await file.arrayBuffer()), fsOpts);
  return storedName;
}

/**
 * `async`, so a name that fails validation REJECTS rather than throwing
 * synchronously: every caller is in a promise chain, and a synchronous throw
 * out of one of them would escape the catch that is right there.
 */
export async function readLocalFile(storedName: string): Promise<Uint8Array> {
  return readFile(pathOf(storedName), fsOpts);
}

/** A file that is already gone is not an error: the card is being removed. */
export async function deleteLocalFile(storedName: string): Promise<void> {
  const path = pathOf(storedName);
  if (await exists(path, fsOpts)) await remove(path, fsOpts);
}
