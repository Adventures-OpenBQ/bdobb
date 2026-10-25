// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { TAXONOMY } from './taxonomy';
import { statementOwnedIds, type StatementTemplate } from './types';
import type { FormulaAst } from '../tableModel/types';
const observations = new Set(['cash_at_beginning_of_period', 'cash_at_end_of_period', 'beginning_cash_position', 'end_cash_position']);
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function buildTemplate(id: 'income' | 'balance' | 'cashflow'): StatementTemplate {
  const version = '1.0.0';
  const owned = statementOwnedIds({ id, version });
  const template: StatementTemplate = { schemaVersion: 1, id, version, sections: [], lines: [] };
  for (const [label, fields] of Object.entries(TAXONOMY[id])) {
    const section = { id: owned.section(label), label, lineIds: fields.map(owned.line) };
    template.sections.push(section);
    for (const field of fields) template.lines.push({ id: owned.line(field), label: field, required: false, policy: id === 'balance' || observations.has(field) ? 'stock' : 'flow', unit: field === 'common_shares_outstanding' ? 'shares' : 'currency' });
  }
  if (id === 'income') {
    const member = (line: string): FormulaAst => ({ kind: 'member', value: { kind: 'reference', target: 'measure', id: owned.value }, selectors: [{ categoryId: owned.item, memberKey: owned.line(line) }] });
    const lineId = owned.line('calculated_gross_profit');
    template.sections[2].lineIds.push(lineId);
    template.lines.push({ id: lineId, label: 'Calculated gross profit', required: false, policy: 'formula', unit: 'currency', formula: { id: owned.formula('calculated_gross_profit'), name: 'Calculated gross profit', scope: 'aggregate', expression: 'Value[Item=revenue] - Value[Item=cost_of_revenue]', ast: { kind: 'binary', operator: '-', left: member('revenue'), right: member('cost_of_revenue') } } });
  }
  return freeze(template);
}

// Pin initial metadata once. Imported taxonomy changes cannot rewrite a version.
const snapshots = freeze({ income: buildTemplate('income'), balance: buildTemplate('balance'), cashflow: buildTemplate('cashflow') });
export function statementTemplate(id: 'income' | 'balance' | 'cashflow', version: string): StatementTemplate | undefined {
  if (version !== '1.0.0' || !Object.hasOwn(snapshots, id)) return undefined;
  return freeze(structuredClone(snapshots[id]));
}
