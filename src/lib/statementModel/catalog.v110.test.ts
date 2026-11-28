// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TAXONOMY as QUICK_VIEW } from '../statementTaxonomy';
import { CURRENT_STATEMENT_TEMPLATE_VERSION, INSTALLED_STATEMENT_TEMPLATES, statementTemplate } from './catalog';
import { intent } from './testFixtures';
import { statementOwnedIds } from './types';
import { previewStatementUpdate } from './updates';
import { validateStatementIntent } from './validation';
import { EMPHASIS, UNITS, VOCABULARY } from './vocabulary';

const IDS = ['income', 'balance', 'cashflow'] as const;
// sha256 of JSON.stringify(statementTemplate(id, '1.0.0')) at release/v10 3cc0d9c, before 1.1.0 existed.
const V100 = {
  income: 'ff6a3d409a4a4a0630f657c8627a499e6a4b6e0e252ab157adafdc501e7dc807',
  balance: 'c9895bb29550a8edcb2e76c5a4dc45c777c26541c95e2e528b78152f6ac06a0d',
  cashflow: 'f95f08ff4270a9d8e6cc9de441af32e4818df3e55e29de6d2ddaec6d58f4cde7',
};

describe('statement template 1.1.0', () => {
  it.each(IDS)('%s: 1.0.0 is byte-identical to what shipped', (id) => {
    expect(createHash('sha256').update(JSON.stringify(statementTemplate(id, '1.0.0'))).digest('hex')).toBe(V100[id]);
  });

  it('is installed beside 1.0.0 and is what a new Statement starts from', () => {
    for (const id of IDS) for (const version of ['1.0.0', '1.1.0']) expect(INSTALLED_STATEMENT_TEMPLATES).toContainEqual({ id, version });
    expect(CURRENT_STATEMENT_TEMPLATE_VERSION).toBe('1.1.0');
  });

  it.each(IDS)('%s: carries every vocabulary line, in vocabulary order, and validates', (id) => {
    const t = statementTemplate(id, '1.1.0')!;
    const owned = statementOwnedIds(t);
    const formula = id === 'income' ? [owned.line('calculated_gross_profit')] : [];
    expect(t.sections.map((s) => s.label)).toEqual(Object.keys(VOCABULARY[id]));
    for (const section of t.sections) {
      const expected = VOCABULARY[id][section.label].map(owned.line);
      expect(section.lineIds).toEqual(section.label === 'Profit' ? [...expected, ...formula] : expected);
    }
    expect(t.sections.flatMap((s) => s.lineIds)).toEqual(t.lines.map((l) => l.id));
    expect(new Set(t.lines.map((l) => l.id)).size).toBe(t.lines.length);
    expect(validateStatementIntent({ ...intent(id), template: t, bindings: { ...intent(id).bindings, mappings: [] } }).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('carries units and emphasis from the vocabulary', () => {
    const income = statementTemplate('income', '1.1.0')!;
    const line = (field: string) => income.lines.find((l) => l.id.endsWith(`/line/${field}`))!;
    expect(line('total_revenue').emphasis).toBe('total');
    expect(line('gross_profit').emphasis).toBe('subtotal');
    expect(line('cost_of_revenue').emphasis).toBeUndefined();
    expect(line('diluted_eps').unit).toBe('per_share');
    expect(line('basic_average_shares').unit).toBe('shares');
    expect(line('cost_of_revenue').unit).toBe('currency');
    for (const id of IDS) {
      const t = statementTemplate(id, '1.1.0')!;
      for (const l of t.lines.filter((x) => x.policy !== 'formula')) {
        const field = l.id.slice(l.id.lastIndexOf('/') + 1);
        expect(l.emphasis).toBe(EMPHASIS[id][field]);
        expect(l.unit).toBe(UNITS[id][field] ?? 'currency');
      }
    }
  });

  it('refuses emphasis on a 1.0.0 snapshot', () => {
    const value = structuredClone(intent('income'));
    value.template.lines[0] = { ...value.template.lines[0], emphasis: 'total' };
    expect(validateStatementIntent(value).diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('refuses an emphasis it does not know', () => {
    const t = structuredClone(statementTemplate('income', '1.1.0')!);
    (t.lines[0] as { emphasis?: string }).emphasis = 'loud';
    expect(validateStatementIntent({ ...intent('income'), template: t, bindings: { ...intent('income').bindings, mappings: [] } }).diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it.each(IDS)('%s: a 1.0.0 statement updates to 1.1.0 with no conflict', (id) => {
    const { next, conflicts } = previewStatementUpdate(intent(id), statementTemplate(id, '1.1.0')!);
    expect(conflicts).toEqual([]);
    expect(next.template.version).toBe('1.1.0');
    expect(validateStatementIntent(next).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('places a line in the same section as the quick Statement view does', () => {
    expect(QUICK_VIEW.income).toBe(VOCABULARY.income);
    expect(QUICK_VIEW.balance).toBe(VOCABULARY.balance);
    expect(QUICK_VIEW.cash).toBe(VOCABULARY.cashflow);
  });
});
