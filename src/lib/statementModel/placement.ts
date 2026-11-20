// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { StatementOverrides, StatementTemplate } from './types';

type PlacementTemplate = {
  sections: readonly StatementTemplate['sections'][number][];
  lines: readonly { id: string }[];
};

/** Keep home lines in section order, then append incoming lines in template line order. */
export function displayedSections(
  template: PlacementTemplate,
  overrides: Pick<StatementOverrides, 'lineSection'>,
): StatementTemplate['sections'] {
  const placed = overrides.lineSection ?? {};
  const shownAtHome = new Set<string>();
  const sections = template.sections.map(({ id, label, lineIds }) => {
    const homeLines = lineIds.filter(line => (placed[line] ?? id) === id);
    homeLines.forEach(line => shownAtHome.add(line));
    return { id, label, lineIds: homeLines };
  });
  const byId = new Map(sections.map(section => [section.id, section]));
  for (const { id } of template.lines) {
    if (!shownAtHome.has(id)) byId.get(placed[id])?.lineIds.push(id);
  }
  return sections;
}
