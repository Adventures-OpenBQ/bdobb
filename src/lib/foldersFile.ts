// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from "./isRecord";
import { ABSENT, loadJson, saveJson } from "./jsonStore";

const PATH = "folders.json";

/** A rail folder. `parentId: null` is a top-level folder. */
export type Folder = { id: string; name: string; parentId: string | null };

/**
 * The whole tree, flat on disk. Nesting lives in `parentId` and sibling order
 * in `folderOrder`, so `settings.dashboardOrder` never has to know folders
 * exist — it stays the single flat order of dashboards.
 */
export type FoldersFile = {
  folders: Folder[];
  /** Sibling order, all folders, across every level. */
  folderOrder: string[];
  /** dashboardId -> folderId. An absent key means top level. */
  placement: Record<string, string>;
  /** Folder ids currently collapsed in the rail. */
  collapsed: string[];
};

/**
 * A function, not a shared constant: the caller owns the arrays it gets back,
 * and a shared `DEFAULT_FOLDERS` would let one caller's push reach every
 * other caller.
 */
export function makeEmptyFolders(): FoldersFile {
  return { folders: [], folderOrder: [], placement: {}, collapsed: [] };
}

function isFolder(value: unknown): value is Folder {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.name !== "string") return false;
  return value.parentId === null || typeof value.parentId === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === "string");
}

export function isFoldersFile(value: unknown): value is FoldersFile {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.folders) || !value.folders.every(isFolder)) return false;
  if (!isStringArray(value.folderOrder)) return false;
  if (!isStringArray(value.collapsed)) return false;
  if (!isRecord(value.placement)) return false;
  // Object.values, not a for..in: only own enumerable keys, so nothing
  // inherited from Object.prototype is ever validated or carried.
  return Object.values(value.placement).every((x) => typeof x === "string");
}

export async function loadFolders(): Promise<FoldersFile> {
  const loaded = await loadJson(PATH, isFoldersFile);
  // Deliberately NOT seeded on ABSENT, unlike settings.json and
  // backends.json: an empty tree is exactly the absence of this file, and
  // writing one on every fresh boot buys nothing. A present-but-unusable file
  // is still quarantined by loadJson and arrives here as ABSENT.
  if (loaded === ABSENT) return makeEmptyFolders();
  return loaded;
}

export async function saveFolders(file: FoldersFile): Promise<void> {
  await saveJson(PATH, file);
}
