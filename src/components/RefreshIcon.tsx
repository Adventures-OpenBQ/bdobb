// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/** Browser-style refresh: one circular arrow, inheriting the button's state colour. */
export function RefreshIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ display: "block" }}>
    <path d="M20 11a8 8 0 1 0-2.3 6.7" />
    <path d="M20 4v7h-7" />
  </svg>;
}
