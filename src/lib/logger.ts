// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {
  BaseDirectory,
  exists,
  mkdir,
  remove,
  rename,
  stat,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { __resetSerializeForTests, serialize } from "./serialize";

const LOG_DIR = "logs";
export const LOG_PATH = `${LOG_DIR}/bdobb.log`;

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 5;

const fsOpts = { baseDir: BaseDirectory.AppData } as const;
const renameOpts = {
  oldPathBaseDir: BaseDirectory.AppData,
  newPathBaseDir: BaseDirectory.AppData,
} as const;

/** All writes are serialized through this one `serialize` chain. */
const QUEUE_KEY = "logger";
const onceKeys = new Set<string>();

/** Rotation is checked before each write, not on a timer. */
async function rotateIfNeeded(): Promise<void> {
  if (!(await exists(LOG_PATH, fsOpts))) return;
  const info = await stat(LOG_PATH, fsOpts);
  if (info.size < MAX_BYTES) return;

  // The oldest generation is deleted, then .4....1 each shift up by one.
  if (await exists(`${LOG_PATH}.${MAX_FILES}`, fsOpts)) {
    await remove(`${LOG_PATH}.${MAX_FILES}`, fsOpts);
  }
  for (let n = MAX_FILES - 1; n >= 1; n--) {
    if (await exists(`${LOG_PATH}.${n}`, fsOpts)) {
      await rename(`${LOG_PATH}.${n}`, `${LOG_PATH}.${n + 1}`, renameOpts);
    }
  }
  await rename(LOG_PATH, `${LOG_PATH}.1`, renameOpts);
}

/**
 * A logging failure must never become the caller's failure — every call
 * site used to guard this individually with an identical `.catch(() => {})`.
 * The chain inside `serialize` still carries the real (possibly rejected)
 * settlement forward, so serialization and rotation behavior are unchanged;
 * only the promise handed back to the caller is guaranteed never to reject.
 */
function write(level: "INFO" | "ERROR", message: string): Promise<void> {
  const line = `${new Date().toISOString()} ${level} ${message}\n`;
  return serialize(QUEUE_KEY, async () => {
    await mkdir(LOG_DIR, { ...fsOpts, recursive: true });
    await rotateIfNeeded();
    await writeTextFile(LOG_PATH, line, { ...fsOpts, append: true });
  }).catch(() => {});
}

export function logInfo(message: string): Promise<void> {
  return write("INFO", message);
}

export function logError(message: string): Promise<void> {
  return write("ERROR", message);
}

/** Once-per-session notices — never once per render. */
export function logOnce(key: string, message: string): Promise<void> {
  if (onceKeys.has(key)) return Promise.resolve();
  onceKeys.add(key);
  return write("INFO", message);
}

export function __resetLoggerForTests(): void {
  __resetSerializeForTests(QUEUE_KEY);
  onceKeys.clear();
}
