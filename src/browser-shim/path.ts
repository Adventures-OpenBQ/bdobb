// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/** Stands in for @tauri-apps/api/path. The app only displays these; nothing reads them back. */
export async function appDataDir(): Promise<string> {
  return "/appdata";
}

export async function join(...parts: string[]): Promise<string> {
  return parts.join("/");
}
