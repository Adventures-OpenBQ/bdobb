// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The padlock the rail's lock button wears (LeftRail). The glyph shows the
 * action, not the state -- a closed lock to lock, an open one to unlock -- so
 * `locked` is the rail's CURRENT state and picks the glyph for what a click
 * would do.
 */
export function LockGlyph({ locked }: { locked: boolean }) {
  return locked ? (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true" data-glyph="lock-open">
      <path d="M17 8h-1V6a4 4 0 0 0-7.9-.9l1.9.5A2 2 0 0 1 14 6v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zm0 11H7v-9h10z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true" data-glyph="lock-closed">
      <path d="M17 8h-1V6a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM10 6a2 2 0 0 1 4 0v2h-4zm7 13H7v-9h10z" />
    </svg>
  );
}
