// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Stands in for @tauri-apps/api/window under `vite --mode browser`. The app
 * uses exactly one thing from it: the theme effect in App.tsx steering the
 * native window's appearance so the title bar matches an explicit Dark or
 * Light choice.
 *
 * A browser tab has no native window to steer -- the page's own
 * `prefers-color-scheme` already is the OS appearance, and `data-theme` is
 * what themes the document either way -- so this resolves and does nothing.
 * It is a real Promise rather than a bare undefined because the caller
 * chains `.catch` onto it.
 */
export function getCurrentWindow(): { setTheme(theme?: "dark" | "light" | null): Promise<void> } {
  return { setTheme: () => Promise.resolve() };
}
