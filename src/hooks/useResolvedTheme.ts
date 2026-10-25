// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { selectEffective, useSettingsStore } from "../stores/settingsStore";
import { useMediaQuery } from "./useMediaQuery";

/**
 * The same resolution as `resolvedTheme()` (src/lib/theme.ts) but as a hook,
 * re-rendering the caller when either half of it changes: the setting
 * (through the store) or, under `"system"`, the OS appearance (through the
 * media query's `change` event, so a macOS auto-switch flips the app live
 * rather than at the next restart).
 *
 * The subscription exists only while the setting IS `"system"`: a null query
 * is useMediaQuery's way of not subscribing at all. With no matchMedia there
 * is no OS appearance to follow, and dark is the app's own default (D5).
 */
export function useResolvedTheme(): "dark" | "light" {
  const theme = useSettingsStore((s) => selectEffective(s).theme);
  const dark = useMediaQuery(theme === "system" ? "(prefers-color-scheme: dark)" : null);
  if (theme !== "system") return theme;
  return dark === false ? "light" : "dark";
}
