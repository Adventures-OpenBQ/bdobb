// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { StatementOverrides, StatementTemplate } from './types';
/** Sections as displayed: own lines not moved away, then lines moved in, in template line order. */
export function displayedSections(template: StatementTemplate, overrides: StatementOverrides): { id: string; label: string; lineIds: string[] }[] {
  const placed = overrides.lineSection ?? {};
  return template.sections.map(({ id, label, lineIds }) => ({
    id, label,
    lineIds: [...lineIds.filter(line => (placed[line] ?? id) === id), ...template.lines.map(line => line.id).filter(line => placed[line] === id && !lineIds.includes(line))],
  }));
}
