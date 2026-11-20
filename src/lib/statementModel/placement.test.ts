// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { intent } from './testFixtures';
import { displayedSections } from './placement';
import { statementOwnedIds } from './types';

it('moves a line to the end of its displayed section and out of its home section', () => {
  const { template, overrides } = intent();
  const ids = statementOwnedIds(template);
  const [, expenses, profit] = template.sections;
  const shown = displayedSections(template, { ...overrides, lineSection: { [ids.line('gross_profit')]: expenses.id } });
  expect(shown.map(s => s.id)).toEqual(template.sections.map(s => s.id));
  expect(shown[1].lineIds).toEqual([...expenses.lineIds, ids.line('gross_profit')]);
  expect(shown[2].lineIds).toEqual(profit.lineIds.filter(id => id !== ids.line('gross_profit')));
});
it('lines moved into one section keep template line order', () => {
  const { template, overrides } = intent();
  const ids = statementOwnedIds(template);
  const income = template.sections[0].id;
  const shown = displayedSections(template, { ...overrides, lineSection: { [ids.line('net_income')]: income, [ids.line('cost_of_revenue')]: income } });
  expect(shown[0].lineIds.slice(-2)).toEqual([ids.line('cost_of_revenue'), ids.line('net_income')]);
});
it('absent, empty or home-section placement returns template membership exactly', () => {
  const { template, overrides } = intent();
  const ids = statementOwnedIds(template);
  const membership = template.sections.map(({ id, label, lineIds }) => ({ id, label, lineIds }));
  expect(displayedSections(template, overrides)).toEqual(membership);
  expect(displayedSections(template, { ...overrides, lineSection: {} })).toEqual(membership);
  expect(displayedSections(template, { ...overrides, lineSection: { [ids.line('revenue')]: template.sections[0].id } })).toEqual(membership);
});
