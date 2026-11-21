// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

export function ChevronIcon({ direction = "down" }: { direction?: "down" | "up" | "right" }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ display: "block", transform: direction === "up" ? "rotate(180deg)" : direction === "right" ? "rotate(-90deg)" : undefined }}>
    <path d="m6 9 6 6 6-6" />
  </svg>;
}
