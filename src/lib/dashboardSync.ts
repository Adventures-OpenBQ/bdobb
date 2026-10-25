// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { logError } from "./logger";

/**
 * The one Tauri event the app broadcasts: "dashboard <id> changed on disk".
 *
 * A dashboard opened with "Open in new window" was, until this, a snapshot
 * taken when the window opened -- the viewer reads once at bootstrap, writes
 * nothing, and had no way to hear about anything the main window did. A
 * grouped parameter changed in one window therefore left the other showing a
 * stale value, which is exactly what a shared group is supposed to prevent.
 *
 * The payload is the dashboard id, so a viewer showing a different dashboard
 * can ignore the event instead of re-reading the disk for nothing.
 */
export const DASHBOARD_CHANGED = "dashboard-changed";

/**
 * Best effort, and deliberately so: a window that never hears the event shows
 * stale data, while a save that fails because the notification failed would
 * lose the user's edit. The write has already landed by the time this runs,
 * so a rejection here is logged and swallowed.
 */
export async function notifyDashboardChanged(id: string): Promise<void> {
  try {
    await emit(DASHBOARD_CHANGED, id);
  } catch (err) {
    await logError(`could not announce a change to dashboard ${id}: ${err}`);
  }
}

/** Subscribe to the above. Resolves to the unlisten fn, for an effect cleanup. */
export function onDashboardChanged(handler: (id: string) => void): Promise<UnlistenFn> {
  return listen<string>(DASHBOARD_CHANGED, (event) => handler(event.payload));
}
