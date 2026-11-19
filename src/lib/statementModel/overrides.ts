// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { StatementIntent } from './types';
import { statementSnapshot } from './persistence';
/** Omit id to reset all local settings. Source bindings and selection are preserved. */
export function resetStatementOverrides(intent: StatementIntent, id?: string): StatementIntent {
  const next = structuredClone(intent);
  if (id === undefined) next.overrides = {labels:{},lineOrder:{},hiddenIds:[],formulas:[]};
  else {
    delete next.overrides.labels[id];
    delete next.overrides.lineOrder[id];
    const target = next.overrides.lineSection?.[id], home = next.template.sections.find(s => s.lineIds.includes(id))?.id;
    if (target !== undefined && target !== home) {
      // The line returns to the end of its home section's local order, mirroring a move.
      if (next.overrides.lineOrder[target]) next.overrides.lineOrder[target] = next.overrides.lineOrder[target].filter(line => line !== id);
      if (home && next.overrides.lineOrder[home]) next.overrides.lineOrder[home].push(id);
    }
    delete next.overrides.lineSection?.[id];
    if (next.overrides.lineSection && !Object.keys(next.overrides.lineSection).length) delete next.overrides.lineSection;
    next.overrides.hiddenIds = next.overrides.hiddenIds.filter(value => value !== id);
    const formulaId=next.template.lines.find(line=>line.id===id)?.formula?.id;
    next.overrides.formulas = next.overrides.formulas.filter(f => f.id !== id && f.id !== formulaId);
    if (next.template.sections.some(s=>s.id===id)) delete next.overrides.sectionOrder;
  }
  return statementSnapshot(next);
}
