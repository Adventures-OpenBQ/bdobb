// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import type { PivotConfig } from '../types';
import { resolveMeasures } from './measureMigration';
const config: PivotConfig = { enabled: true, grouping: ['group'], split: [] };
it('migrates binding IDs in source order and preserves unavailable operator intent', () => {
  const pivot = { ...config, aggregationFns: { volume: 'mean' as const, missing: 'last' as const, group: 'count' as const } };
  const columns = [{ id: 'volume', label: 'Volume', sourceFieldId: 'origin' }, { id: 'other', label: 'Other' }];
  expect(resolveMeasures(pivot, columns, ['missing', 'group', 'volume'])).toEqual([{ id: 'missing', sourceFieldId: 'missing', aggregation: 'last' }, { id: 'volume', sourceFieldId: 'volume', aggregation: 'mean' }, { id: 'other', sourceFieldId: 'other' }]);
  expect(resolveMeasures(pivot, columns, ['volume'])).toEqual([{ id: 'volume', sourceFieldId: 'volume', aggregation: 'mean' }, { id: 'other', sourceFieldId: 'other' }, { id: 'missing', sourceFieldId: 'missing', aggregation: 'last' }]);
});
it('explicit ordered instances override legacy settings including deliberate unset and unavailable fields', () => {
  const measures = [{ id: 'copy', sourceFieldId: 'missing', customLabel: 'Keep' }, { id: 'volume', sourceFieldId: 'volume' }];
  expect(resolveMeasures({ ...config, aggregationFns: { volume: 'sum' }, measures }, [], ['volume'])).toEqual(measures);
  expect(resolveMeasures({ ...config, measures: [] }, [{ id: 'v', label: 'V' }], ['v'])).toEqual([]);
});
it('deduplicates legacy order and reads only own aggregation properties', () => {
  expect(resolveMeasures({ ...config, aggregationFns: {} }, [], ['__proto__', '__proto__'])).toEqual([{ id: '__proto__', sourceFieldId: '__proto__' }]);
});
it('keeps every legacy operator without implicit sum or mutation of ordinary source order', () => {
  const order = ['sum', 'min', 'max', 'mean', 'median', 'count', 'uniqueCount', 'first', 'last', 'unset'];
  const aggregationFns = { sum: 'sum', min: 'min', max: 'max', mean: 'mean', median: 'median', count: 'count', uniqueCount: 'uniqueCount', first: 'first', last: 'last' } as const;
  const result = resolveMeasures({ ...config, aggregationFns }, [], order);
  expect(result.map(m => m.aggregation)).toEqual(['sum', 'min', 'max', 'mean', 'median', 'count', 'uniqueCount', 'first', 'last', undefined]);
  expect(order).toEqual(['sum', 'min', 'max', 'mean', 'median', 'count', 'uniqueCount', 'first', 'last', 'unset']);
});
