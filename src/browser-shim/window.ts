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
export function getCurrentWindow(): {
  setTheme(theme?: "dark" | "light" | null): Promise<void>;
  onMoved(handler: () => void): Promise<() => void>;
  onScaleChanged(handler: () => void): Promise<() => void>;
} {
  // onMoved/onScaleChanged: useScreenSize listens only when isTauri(), which
  // the browser build never is; they resolve to a no-op unlisten regardless,
  // so a stray caller cannot crash the page.
  const never = () => Promise.resolve(() => {});
  return { setTheme: () => Promise.resolve(), onMoved: never, onScaleChanged: never };
}

/**
 * The monitor reads screenFit.ts makes (spec 2026-10-12 §5, §6). A browser
 * has no monitor list to give: nothing is known, so the app falls back to
 * window.screen exactly as it does on Wayland.
 */
export function currentMonitor(): Promise<null> {
  return Promise.resolve(null);
}

export function primaryMonitor(): Promise<null> {
  return Promise.resolve(null);
}

export function availableMonitors(): Promise<never[]> {
  return Promise.resolve([]);
}

/** Only ever used as a type here; declared so the import names resolve. */
export type Monitor = never;
