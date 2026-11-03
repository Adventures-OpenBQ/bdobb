// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, it, vi } from 'vitest';
import { deriveCategories } from './categories';
import { monthBounds } from './fiscalContext';
import type { CategoryDef } from './types';

vi.mock('./fiscalContext', async importOriginal => {
  const actual = await importOriginal<typeof import('./fiscalContext')>();
  return { ...actual, monthBounds: vi.fn(actual.monthBounds) };
});
beforeEach(() => { vi.mocked(monthBounds).mockClear(); });
const definitions: CategoryDef[] = ['Y', 'Q', 'M'].map(transform => ({ id: transform, name: transform, sourceFieldId: 'date', transform: transform as 'Y' | 'Q' | 'M' }));
const rows = ['2024-02-28', '2024-02-29'].map((date, i) => ({ id: String(i), values: { date } }));

it('reuses equal boundaries across rows but isolates periods and calculation lifetimes', () => {
  const input = structuredClone(rows);
  const result = deriveCategories(input, definitions, {});
  expect(monthBounds).toHaveBeenCalledTimes(3);
  const first = result.members.get('0')!.get('M')!;
  const second = result.members.get('1')!.get('M')!;
  expect(first).toMatchObject({ ok: true, value: { period: { start: '2024-02-01', end: '2024-02-29' } } });
  expect(second).toEqual(first);
  if (!first.ok || !second.ok) throw new Error('Expected successful month members');
  expect(first.value.period).not.toBe(second.value.period);
  first.value.period!.end = 'changed';
  expect(second.value.period!.end).toBe('2024-02-29');
  expect(input).toEqual(rows);
  expect(deriveCategories(input, definitions, {}).members.get('0')!.get('M')).toEqual(second);
  expect(monthBounds).toHaveBeenCalledTimes(6);
});
it('keeps years, quarters, months and leap-century boundaries distinct', () => {
  const dates = ['1900-02-28', '2000-02-29', '2024-12-31', '2025-01-01'];
  const result = deriveCategories(dates.map((date, i) => ({ id: String(i), values: { date } })), definitions, {});
  const periods = dates.map((_, i) => definitions.map(d => {
    const member = result.members.get(String(i))!.get(d.id)!;
    if (!member.ok) throw new Error('Expected successful period member');
    return member.value.period;
  }));
  expect(periods).toEqual([
    [{ start: '1900-01-01', end: '1900-12-31' }, { start: '1900-01-01', end: '1900-03-31' }, { start: '1900-02-01', end: '1900-02-28' }],
    [{ start: '2000-01-01', end: '2000-12-31' }, { start: '2000-01-01', end: '2000-03-31' }, { start: '2000-02-01', end: '2000-02-29' }],
    [{ start: '2024-01-01', end: '2024-12-31' }, { start: '2024-10-01', end: '2024-12-31' }, { start: '2024-12-01', end: '2024-12-31' }],
    [{ start: '2025-01-01', end: '2025-12-31' }, { start: '2025-01-01', end: '2025-03-31' }, { start: '2025-01-01', end: '2025-01-31' }],
  ]);
});
it('bounds cache admission without losing results for additional distinct periods', () => {
  const dates = Array.from({ length: 257 }, (_, i) => `${2000 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-01`);
  const source = [...dates, ...dates].map((date, i) => ({ id: String(i), values: { date } }));
  const result = deriveCategories(source, [definitions[2]], {});
  expect(monthBounds).toHaveBeenCalledTimes(258);
  expect(result.errors.size).toBe(0);
  for (let i = 0; i < dates.length; i++) expect(result.members.get(String(i))).toEqual(result.members.get(String(i + dates.length)));
});
