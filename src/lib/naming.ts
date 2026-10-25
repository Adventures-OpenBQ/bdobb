// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The name a newly created dashboard or tab gets, since the platform cannot
 * ask for one: WKWebView has no window.prompt (see
 * docs/superpowers/specs/2026-08-27-inline-naming-native-confirm-design.md).
 * Create with this, then rename inline.
 *
 * "Untitled" when unused, else the first unused "Untitled N" for N >= 2 —
 * first unused, not highest + 1, so deleting "Untitled 2" makes that name
 * available again. Existing names are trimmed before comparison, which is
 * otherwise exact: "untitled" does not occupy "Untitled".
 */
export function nextUntitledName(existing: string[]): string {
  const taken = new Set(existing.map((name) => name.trim()));
  if (!taken.has("Untitled")) return "Untitled";
  // Terminates: `taken` is finite, so some N is always free.
  for (let n = 2; ; n++) {
    const candidate = `Untitled ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
