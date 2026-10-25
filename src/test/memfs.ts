// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * In-memory stand-in for @tauri-apps/plugin-fs. Installed once for every test
 * file by `src/test/setup.ts` (vite.config.ts's `setupFiles`) — a test file
 * needs no vi.mock of its own. A file that wants a different fs still wins by
 * declaring its own vi.mock("@tauri-apps/plugin-fs", …).
 */

type Entry = { content: string };

const files = new Map<string, Entry>();
/**
 * Binary writes, kept apart from `files` because their bytes are not text.
 * They ARE visible to exists(), readFile() and remove() — a stored local file
 * is written as bytes and read back as bytes — but deliberately not to
 * readTextFile() or __list(), which answer for the JSON stores only; a test
 * that wants the raw bytes asks __readBytes for them.
 */
const binaries = new Map<string, Uint8Array>();
const dirs = new Set<string>();
/**
 * Every path handed to writeTextFile or writeFile, in call order — kept so a
 * test can observe the names a writer actually used, not just the files it
 * left behind. Temp files are renamed away, so `__list` cannot see them.
 */
const writes: string[] = [];
/** Paths whose operations are made to fail, for exercising I/O error paths. */
const failing = new Set<string>();
/**
 * Paths whose CONTENT read fails while the file still exists and can still be
 * renamed — the `chmod 000` case, and the narrowest way to reach an I/O error
 * without also disabling the recovery paths that error is supposed to trigger.
 * `failing` above is the blunt instrument; this is the scalpel.
 */
const failingReads = new Set<string>();

export const BaseDirectory = { AppData: 13 } as const;

function key(path: string): string {
  return path.replace(/^\/+/, "");
}

function guard(path: string): void {
  if (failing.has(key(path))) throw new Error(`EIO: ${path}`);
}

function guardRead(path: string): void {
  guard(path);
  if (failingReads.has(key(path))) throw new Error(`EACCES: ${path}`);
}

// ---- test helpers ----
export function __reset(): void {
  files.clear();
  binaries.clear();
  dirs.clear();
  writes.length = 0;
  failing.clear();
  failingReads.clear();
}
export function __readBytes(path: string): Uint8Array | undefined {
  return binaries.get(key(path));
}
export function __failPath(path: string): void {
  failing.add(key(path));
}
/** Fails only reads of `path`: it still exists, and can still be renamed. */
export function __failRead(path: string): void {
  failingReads.add(key(path));
}
/** Undoes __failRead: the file reads again, as after a volume comes back. */
export function __restoreRead(path: string): void {
  failingReads.delete(key(path));
}
export function __seed(path: string, content: string): void {
  files.set(key(path), { content });
}
export function __read(path: string): string | undefined {
  return files.get(key(path))?.content;
}
export function __list(): string[] {
  return [...files.keys()].sort();
}
export function __writes(): string[] {
  return [...writes];
}

// ---- plugin-fs surface ----
export async function exists(path: string): Promise<boolean> {
  guard(path);
  const k = key(path);
  if (files.has(k) || binaries.has(k) || dirs.has(k)) return true;

  // A directory "exists" if it was mkdir-ed OR if any file lives under it,
  // matching real filesystem semantics and readDir's own directory
  // inference. Without this, exists() on a directory populated only via
  // __seed (never mkdir) falsely reports absent.
  const prefix = `${k}/`;
  for (const fileKey of [...files.keys(), ...binaries.keys()]) {
    if (fileKey.startsWith(prefix)) return true;
  }
  for (const dirKey of dirs) {
    if (dirKey.startsWith(prefix)) return true;
  }
  return false;
}

export async function readTextFile(path: string): Promise<string> {
  guardRead(path);
  const f = files.get(key(path));
  if (!f) throw new Error(`ENOENT: ${path}`);
  return f.content;
}

export async function writeTextFile(
  path: string,
  content: string,
  options?: { append?: boolean },
): Promise<void> {
  guard(path);
  const k = key(path);
  writes.push(k);
  const prior = options?.append ? (files.get(k)?.content ?? "") : "";
  files.set(k, { content: prior + content });
}

/**
 * The binary counterpart of readTextFile. A file written as TEXT reads back
 * as its UTF-8 bytes: a real filesystem draws no line between the two, and a
 * seeded fixture (e2e/fixtures.ts hands only strings) is the only way a test
 * can put a file where the app will find one at boot.
 */
export async function readFile(path: string): Promise<Uint8Array> {
  guard(path);
  const k = key(path);
  const bytes = binaries.get(k);
  if (bytes) return bytes;
  const text = files.get(k);
  if (text) return new TextEncoder().encode(text.content);
  throw new Error(`ENOENT: ${path}`);
}

/** The binary counterpart of writeTextFile; plugin-fs takes a Uint8Array. */
export async function writeFile(path: string, data: Uint8Array): Promise<void> {
  guard(path);
  const k = key(path);
  writes.push(k);
  binaries.set(k, data);
}

export async function rename(oldPath: string, newPath: string): Promise<void> {
  guard(oldPath);
  guard(newPath);
  const k = key(oldPath);
  const f = files.get(k);
  if (!f) throw new Error(`ENOENT: ${oldPath}`);
  files.delete(k);
  files.set(key(newPath), f);
}

export async function remove(path: string): Promise<void> {
  guard(path);
  files.delete(key(path));
  binaries.delete(key(path));
}

export async function mkdir(path: string): Promise<void> {
  guard(path);
  dirs.add(key(path));
}

export async function readDir(path: string) {
  guard(path);
  const prefix = `${key(path)}/`;
  // Real plugin-fs readDir throws on a missing directory rather than
  // returning an empty listing. A directory is present if it was mkdir-ed or
  // if anything lives under it; a plain file is not a directory at all.
  const isDir =
    dirs.has(key(path)) ||
    [...files.keys(), ...dirs].some((k) => k.startsWith(prefix));
  if (!isDir) throw new Error(`ENOENT: ${path}`);

  const fileEntries = [...files.keys()]
    .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
    .map((k) => k.slice(prefix.length));

  const dirNames = new Set<string>();
  for (const k of files.keys()) {
    if (!k.startsWith(prefix)) continue;
    const rest = k.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash !== -1) dirNames.add(rest.slice(0, slash));
  }
  for (const d of dirs) {
    if (!d.startsWith(prefix)) continue;
    const rest = d.slice(prefix.length);
    if (rest.length === 0) continue;
    const slash = rest.indexOf("/");
    dirNames.add(slash === -1 ? rest : rest.slice(0, slash));
  }

  return [
    ...fileEntries.map((name) => ({
      name,
      isFile: true,
      isDirectory: false,
      isSymlink: false,
    })),
    ...[...dirNames].map((name) => ({
      name,
      isFile: false,
      isDirectory: true,
      isSymlink: false,
    })),
  ];
}

export async function stat(path: string): Promise<{ size: number }> {
  guard(path);
  const f = files.get(key(path));
  if (!f) throw new Error(`ENOENT: ${path}`);
  return { size: f.content.length };
}
