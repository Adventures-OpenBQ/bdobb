// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { bdobb } from "./registry";

/** Stands in for @tauri-apps/plugin-opener: a new tab, plus a record a spec can assert on. */
export async function openUrl(url: string): Promise<void> {
  bdobb().opened.push(url);
  window.open(url, "_blank");
}
