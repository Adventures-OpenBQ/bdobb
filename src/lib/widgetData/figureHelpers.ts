// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

const COLORS = ['#4c9aff', '#ef8354', '#71c7a1', '#b08cde', '#e4c65a', '#65c6d4'];
export function color(id: string) { let hash = 0; for (const c of id)
    hash = (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0; return COLORS[hash % COLORS.length]; }
export function escape(value: unknown) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
/** At most five items, then how many more. */
export function list(items: string[]): string {
    return items.length > 5 ? `${items.slice(0, 5).join(', ')}, and ${items.length - 5} more` : items.join(', ');
}
