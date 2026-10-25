// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { appDataDir, join } from "@tauri-apps/api/path";
import { BaseDirectory, exists, readTextFile } from "@tauri-apps/plugin-fs";
import { LOG_PATH } from "./logger";

const fsOpts = { baseDir: BaseDirectory.AppData } as const;

const MAX_LINES = 100;

export type LogTail = {
  /** Absolute path to the log file, so a Windows user can locate it without dev tools. */
  path: string;
  /** The last MAX_LINES lines of the log, oldest first. Empty when the file is absent. */
  lines: string[];
};

/**
 * An absent log file (fresh install, or nothing has logged yet) is a normal,
 * empty state -- not an error -- so this returns an empty tail rather than
 * throwing or requiring the caller to check existence first.
 */
export async function readLogTail(): Promise<LogTail> {
  const dir = await appDataDir();
  const path = await join(dir, LOG_PATH);

  if (!(await exists(LOG_PATH, fsOpts))) {
    return { path, lines: [] };
  }
  const content = await readTextFile(LOG_PATH, fsOpts);
  const lines = content === "" ? [] : content.replace(/\n$/, "").split("\n");
  return { path, lines: lines.slice(-MAX_LINES) };
}
