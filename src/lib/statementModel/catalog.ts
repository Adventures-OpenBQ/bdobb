// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { TAXONOMY } from './taxonomy';
import { EMPHASIS, UNITS, VOCABULARY } from './vocabulary';
import { statementOwnedIds, type StatementTemplate } from './types';
import type { FormulaAst } from '../tableModel/types';
type TemplateId = 'income' | 'balance' | 'cashflow';
type TemplateLine = StatementTemplate['lines'][number];
const observations = new Set(['cash_at_beginning_of_period', 'cash_at_end_of_period', 'beginning_cash_position', 'end_cash_position']);
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
/**
 * One template from a section → fields list. `describe` supplies what a
 * version knows about a line beyond its policy; the calculated gross profit
 * line closes the income statement's Profit section in every version.
 */
function buildTemplate(id: TemplateId, version: string, lists: Record<string, readonly string[]>, describe: (field: string) => Partial<TemplateLine>): StatementTemplate {
  const owned = statementOwnedIds({ id, version });
  const template: StatementTemplate = { schemaVersion: 1, id, version, sections: [], lines: [] };
  for (const [label, fields] of Object.entries(lists)) {
    const section = { id: owned.section(label), label, lineIds: fields.map(owned.line) };
    template.sections.push(section);
    for (const field of fields) template.lines.push({ id: owned.line(field), label: field, required: false, policy: id === 'balance' || observations.has(field) ? 'stock' : 'flow', ...describe(field) });
    if (id === 'income' && label === 'Profit') {
      const member = (line: string): FormulaAst => ({ kind: 'member', value: { kind: 'reference', target: 'measure', id: owned.value }, selectors: [{ categoryId: owned.item, memberKey: owned.line(line) }] });
      const lineId = owned.line('calculated_gross_profit');
      section.lineIds.push(lineId);
      template.lines.push({ id: lineId, label: 'Calculated gross profit', required: false, policy: 'formula', unit: 'currency', formula: { id: owned.formula('calculated_gross_profit'), name: 'Calculated gross profit', scope: 'aggregate', expression: 'Value[Item=revenue] - Value[Item=cost_of_revenue]', ast: { kind: 'binary', operator: '-', left: member('revenue'), right: member('cost_of_revenue') } } });
    }
  }
  return freeze(template);
}

/** 1.0.0: the FMP and EODHD lists, pinned. Its taxonomy file is never edited. */
const v100 = (id: TemplateId) => buildTemplate(id, '1.0.0', TAXONOMY[id], field => ({ unit: field === 'common_shares_outstanding' ? 'shares' : 'currency' }));
/** 1.1.0: the shared vocabulary -- adds the yfinance and SEC lines, a Per share section, units and emphasis. */
const v110 = (id: TemplateId) => buildTemplate(id, '1.1.0', VOCABULARY[id], field => ({
  unit: UNITS[id][field] ?? 'currency',
  ...(EMPHASIS[id][field] ? { emphasis: EMPHASIS[id][field] } : {}),
}));

const IDS = ['income', 'balance', 'cashflow'] as const;
// Pin initial metadata once. Imported taxonomy changes cannot rewrite a version.
export const INSTALLED_STATEMENT_TEMPLATES: readonly { id: TemplateId; version: string }[] = [
  ...IDS.map(id => ({ id, version: '1.0.0' })),
  ...IDS.map(id => ({ id, version: '1.1.0' })),
];
/** The version a new Statement starts from. */
export const CURRENT_STATEMENT_TEMPLATE_VERSION = '1.1.0';
const snapshots: Readonly<Record<string, StatementTemplate>> = freeze(Object.fromEntries(IDS.flatMap(id => [[`${id}@1.0.0`, v100(id)], [`${id}@1.1.0`, v110(id)]])));
export function statementTemplate(id: TemplateId, version: string): StatementTemplate | undefined {
  const key = `${id}@${version}`;
  if (!INSTALLED_STATEMENT_TEMPLATES.some(t => t.id === id && t.version === version) || !Object.hasOwn(snapshots, key)) return undefined;
  return freeze(structuredClone(snapshots[key]));
}
