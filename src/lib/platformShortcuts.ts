// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/** WebView2 reports Win32 even for an ARM64 Windows guest. */
export function windowsShortcuts(): boolean {
  return import.meta.env.TAURI_ENV_PLATFORM === "windows" || /^Win/i.test(navigator.platform);
}

export function primaryShortcut(event: KeyboardEvent): boolean {
  return windowsShortcuts() ? event.ctrlKey && !event.metaKey : event.metaKey && !event.ctrlKey;
}
