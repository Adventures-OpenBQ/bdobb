// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { logError } from "./logger";
import { __resetSerializeForTests, serialize } from "./serialize";

const fsOpts = { baseDir: BaseDirectory.AppData } as const;
const renameOpts = {
  oldPathBaseDir: BaseDirectory.AppData,
  newPathBaseDir: BaseDirectory.AppData,
} as const;

export const ABSENT = "absent" as const;
export type Validator<T> = (value: unknown) => value is T;

/**
 * Every invariant lives at module scope, which is why this is one module
 * rather than three: two domains racing the same path is impossible by
 * construction rather than by convention.
 *
 * One `serialize` chain per path, which *every* operation joins — write,
 * remove, and the read-and-maybe-quarantine sequence. Separate queues per
 * operation kind would leave the cross-kind races open: a quarantine could
 * move a concurrently saved file to .corrupt, and a queued write could
 * recreate a file that was just removed.
 */
const QUEUE_PREFIX = "json:";
let tempCounter = 0;

/**
 * A monotonic counter beats a clock *within* a process: two writes in the
 * same millisecond would share a `Date.now()` name, the counter never
 * repeats. Across processes the counter alone is strictly weaker — it
 * restarts at 0 every launch, so two app instances, or a restart racing a
 * leftover temp, would both produce `.tmp.1`. The nonce closes that gap: one
 * session, one namespace. It is deliberately not re-rolled by
 * `__resetJsonStoreForTests` — a session is a process, and the reset exists
 * to give tests a predictable counter, not a new process.
 */
const sessionNonce = Math.random().toString(36).slice(2).padEnd(8, "0").slice(0, 8);

/**
 * Chains `fn` onto this path's queue and hands back its result. `serialize`
 * carries the chaining itself; the wrapper is the path -> key mapping, so
 * every operation in this module joins one queue per path and nothing else
 * in the app can land on the same key.
 *
 * Not re-entrant: anything already running inside the lock (quarantine, say)
 * must not call back in for the same path.
 */
function withPathLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  return serialize(`${QUEUE_PREFIX}${path}`, fn);
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/**
 * A present-but-unusable file is preserved, never overwritten. An existing
 * .corrupt file is never clobbered either — a second corruption takes a
 * numeric suffix.
 */
async function quarantine(path: string): Promise<void> {
  let target = `${path}.corrupt`;
  let n = 1;
  while (await exists(target, fsOpts)) {
    target = `${path}.corrupt.${n}`;
    n += 1;
  }
  await rename(path, target, renameOpts);
  // Reporting the quarantine must not become the failure; the quarantine
  // itself already succeeded, and the caller must only ever observe ABSENT.
  await logError(`quarantined ${path} -> ${target}`);
}

async function readValidated<T>(
  path: string,
  validate: Validator<T>,
): Promise<T | typeof ABSENT> {
  if (!(await exists(path, fsOpts))) return ABSENT;

  // The read sits OUTSIDE the quarantine try, and that placement is the whole
  // point. Corruption and an I/O failure are different events with opposite
  // correct responses: unparseable BYTES are the file's fault, so quarantine
  // and reseed; a read that never produced bytes at all (no permission, a
  // vanished volume, a hardware error) says nothing about the content, and
  // treating it as corruption would rename a perfectly good file out of the
  // way and reseed defaults over it.
  //
  // It also silently swallowed the loader failure the startup banner exists to
  // report. With the read inside, an unreadable settings.json quarantined ->
  // renamed -> returned ABSENT -> `loadSettings` reseeded -> the loader
  // SUCCEEDED, so `bootstrap` had nothing to name and no banner appeared. Out
  // here the rejection propagates and the loader genuinely fails.
  let text: string;
  try {
    text = await readTextFile(path, fsOpts);
  } catch (err) {
    // Remembered, so saveJson refuses to write over what could not be read.
    unreadable.add(path);
    throw err;
  }
  unreadable.delete(path);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    await quarantine(path);
    return ABSENT;
  }

  if (!validate(parsed)) {
    await quarantine(path);
    return ABSENT;
  }
  return parsed;
}

/**
 * The read takes the path lock, so it cannot interleave with a write or a
 * remove — and the quarantine it may trigger runs inside that same lock.
 */
export function loadJson<T>(
  path: string,
  validate: Validator<T>,
): Promise<T | typeof ABSENT> {
  return withPathLock(path, () => readValidated(path, validate));
}

export async function loadJsonDir<T>(
  dir: string,
  validate: Validator<T>,
): Promise<T[]> {
  if (!(await exists(dir, fsOpts))) return [];

  const entries = await readDir(dir, fsOpts);
  const out: T[] = [];
  for (const entry of entries) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    const path = `${dir}/${entry.name}`;
    // A single entry can reject outright — `exists` failing, or the rename
    // quarantine attempts on a corrupt file. One unreadable dashboard must
    // not discard every good one already read, so each entry is isolated.
    try {
      const value = await loadJson(path, validate);
      if (value !== ABSENT) out.push(value);
    } catch (err) {
      // Reporting the failure must not become the failure; there is nowhere
      // left to report a broken log to.
      await logError(`failed to load ${path}: ${err}`);
    }
  }
  return out;
}

/**
 * Atomic: write a temp file, then rename over the target, so a crash cannot
 * truncate a config. Serialized: one in-flight write per path, chained.
 * Temp names come from a monotonic counter, never a clock, namespaced by a
 * per-session nonce so the guarantee holds across processes too.
 */
/**
 * Paths whose last read failed with an I/O error (readValidated), cleared by
 * the next read that succeeds. An unreadable file says nothing about its
 * content, so its loader fails and the app runs on in-memory defaults -- and
 * every store writes WHOLE files from memory, so the first save after that
 * would replace a good settings.json, backends.json, folders.json or
 * chat.json with defaults. Refusing here, once, means no store can forget to.
 */
const unreadable = new Set<string>();

export function saveJson(path: string, value: unknown): Promise<void> {
  return withPathLock(path, async () => {
    if (unreadable.has(path)) {
      throw new Error(
        `not saving ${path}: it could not be read this session, and saving would replace it with what the app has in memory`,
      );
    }
    const dir = dirOf(path);
    if (dir) await mkdir(dir, { ...fsOpts, recursive: true });

    tempCounter += 1;
    const temp = `${path}.tmp.${sessionNonce}.${tempCounter}`;
    await writeTextFile(temp, `${JSON.stringify(value, null, 2)}\n`, fsOpts);
    try {
      await rename(temp, path, renameOpts);
    } catch (err) {
      // The temp is already on disk; a failed rename would otherwise orphan
      // one file per failed save. The original error is what the caller
      // needs, so a failed cleanup must not mask it.
      await remove(temp, fsOpts).catch(() => {});
      throw err;
    }
  });
}

export function removeJson(path: string): Promise<void> {
  return withPathLock(path, async () => {
    if (await exists(path, fsOpts)) await remove(path, fsOpts);
  });
}

export function __resetJsonStoreForTests(): void {
  __resetSerializeForTests(QUEUE_PREFIX);
  tempCounter = 0;
  unreadable.clear();
}
