// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { statementTemplate } from './catalog';
import { validateStatementIntent } from './validation';
import { intent } from './testFixtures';
describe('statement catalog', () => {
  it('validCatalogsHaveUniqueOrderedIds', () => {
    for (const id of ['income', 'balance', 'cashflow'] as const) {
      const value = intent(id); const t = value.template;
      expect(t).toBeDefined(); expect(validateStatementIntent(value).diagnostics).toEqual([]);
      expect(new Set(t.lines.map((l) => l.id)).size).toBe(t.lines.length);
      expect(t.sections.flatMap((s) => s.lineIds)).toEqual(t.lines.map((l) => l.id));
      expect(t.lines.every((l) => !l.required)).toBe(true);
      expect(statementTemplate(id, 'missing')).toBeUndefined();
      expect(statementTemplate(id, '1.0.0')).not.toBe(t);
      expect(Object.isFrozen(t.lines[0])).toBe(true);
    }
  });
  it('keeps provider aliases distinct and cash observations stock', () => {
    const t = statementTemplate('cashflow', '1.0.0')!;
    expect(t.lines.find(l => l.id.endsWith('/beginning_cash_position'))?.policy).toBe('stock');
    expect(t.lines.find(l => l.id.endsWith('/operating_cash_flow'))?.policy).toBe('flow');
    expect(statementTemplate('balance', '1.0.0')!.lines.find(l => l.id.endsWith('/common_shares_outstanding'))?.unit).toBe('shares');
  });
});
