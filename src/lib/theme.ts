// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useSettingsStore } from "../stores/settingsStore";
import type { Settings } from "./types";

/**
 * The one query the app follows: dark is what it asks about, so a host that
 * has no opinion (no match) reads as light -- the same way a browser does.
 */
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** globalThis rather than window: identical in the app (they are the same
 * object in a browser), and it also answers under vitest's node environment,
 * where `window` is not even defined. */
type MediaHost = { matchMedia?: (query: string) => MediaQueryList };

/**
 * The live `prefers-color-scheme: dark` list, or null where the host has no
 * matchMedia at all -- jsdom implements none, and neither does a bare Node.
 */
function darkQuery(): MediaQueryList | null {
  const matchMedia = (globalThis as unknown as MediaHost).matchMedia;
  if (typeof matchMedia !== "function") return null;
  return matchMedia(DARK_QUERY);
}

/**
 * What `theme: "system"` currently resolves to.
 *
 * With no matchMedia there is no OS appearance to follow, and dark is the
 * app's own default theme, so that is the fallback rather than light (D5).
 */
export function systemTheme(): "dark" | "light" {
  const query = darkQuery();
  if (query === null) return "dark";
  return query.matches ? "dark" : "light";
}

/**
 * The theme every consumer actually renders with: the setting itself unless
 * it is `"system"`, in which case the OS appearance decides (D5).
 *
 * Non-hook, for callers outside a React render -- dataClient builds a URL at
 * request time, from the store rather than from props. It lives in src/lib
 * rather than beside the hook so that dataClient (src/lib) does not have to
 * import out of src/hooks. Reads the media query at the moment of the call,
 * so a request made after the OS flipped carries the new theme without
 * anything having had to re-render.
 */
export function resolvedTheme(): "dark" | "light" {
  const theme: Settings["theme"] = useSettingsStore.getState().settings.theme;
  return theme === "system" ? systemTheme() : theme;
}
