// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A `{field}` template filled from one table row -- Workspace's sendToAgent
 * markdown. An unknown field is left literal rather than blanked, so a typo in
 * a manifest shows up in the message instead of silently vanishing; a `$`
 * before a brace (`${revenue}M`) is just a dollar sign. Own keys only, so a
 * field named like an Object.prototype member reads nothing.
 */
export function fillRowTemplate(markdown: string, row: Record<string, unknown>): string {
  return markdown.replace(/\{([^{}]+)\}/g, (whole, field: string) => {
    if (!Object.hasOwn(row, field)) return whole;
    const value = row[field];
    return value === null || value === undefined ? "" : String(value);
  });
}
