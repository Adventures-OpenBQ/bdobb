// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { duplicateMeasure, measureLabel, updateMeasureAggregation } from './measures';

it('duplicates configured and unset instances with independent IDs without mutation', () => {
  for (const aggregation of ['mean', undefined] as const) {
    const original = [{ id: 'volume', sourceFieldId: 'volume', aggregation, customLabel: 'My volume' }];
    const copy = duplicateMeasure(original, 'volume', 'copy');
    expect(copy).toEqual([original[0], { ...original[0], id: 'copy' }]);
    expect(original).toHaveLength(1);
    expect(updateMeasureAggregation(copy, 'copy', 'sum')).toEqual([original[0], { ...original[0], id: 'copy', aggregation: 'sum' }]);
    expect(updateMeasureAggregation(copy, 'copy', undefined)[1].aggregation).toBeUndefined();
    expect(copy[0].aggregation).toBe(aggregation);
  }
});
it('rejects duplicate IDs and missing targets instead of corrupting identity', () => {
  const items = [{ id: 'a', sourceFieldId: 'v' }, { id: 'b', sourceFieldId: 'v' }];
  expect(() => duplicateMeasure(items, 'a', 'b')).toThrow();
  expect(() => duplicateMeasure(items, 'a', '')).toThrow();
  expect(() => duplicateMeasure(items, 'absent', 'c')).toThrow();
  expect(() => updateMeasureAggregation(items, 'absent', 'sum')).toThrow();
});
it('labels averages and totals and distinguishes identical defaults while preserving custom labels', () => {
  const items = [{ id: 'a', sourceFieldId: 'v', aggregation: 'mean' as const }, { id: 'b', sourceFieldId: 'v', aggregation: 'mean' as const }, { id: 'c', sourceFieldId: 'v', aggregation: 'sum' as const }];
  expect(items.map(m => measureLabel(m, 'Volume', items))).toEqual(['Volume — Average', 'Volume — Average (2)', 'Volume — Total']);
  expect(measureLabel({ ...items[0], customLabel: '' }, 'Volume', items)).toBe('');
  expect(measureLabel({ id: 'u', sourceFieldId: 'v' }, 'Volume', [])).toBe('Volume');
});
it('inserts after the selected instance while leaving later siblings and custom labels intact', () => {
  const items = [{ id: 'a', sourceFieldId: 'v', aggregation: 'last' as const }, { id: 'b', sourceFieldId: 'v', customLabel: 'Special' }];
  expect(duplicateMeasure(items, 'a', 'c')).toEqual([items[0], { id: 'c', sourceFieldId: 'v', aggregation: 'last' }, items[1]]);
  const cleared = updateMeasureAggregation(items, 'a', undefined);
  expect(cleared).toEqual([{ id: 'a', sourceFieldId: 'v' }, items[1]]);
  expect(Object.hasOwn(cleared[0], 'aggregation')).toBe(false);
  expect(measureLabel(items[1], 'Volume', items)).toBe('Special');
});
