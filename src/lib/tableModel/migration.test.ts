// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { migratePivot } from './migration';
import { validateTableModel } from './validation';

describe('pivot migration', () => {
  it('migratesOldBucketsWithoutChangingAggregates', () => {
    const config = { enabled: true, grouping: ['date'], split: ['region'], buckets: { date: 'year' as const }, aggregationFns: { revenue: 'last' as const } };
    const model = migratePivot(config);
    expect(model.categories.map(c => [c.sourceFieldId, c.transform])).toEqual([['date', 'Y'], ['region', 'native']]);
    expect(model.layout).toEqual({ rows: [model.categories[0].id], columns: [model.categories[1].id], values: ['revenue'] });
    expect(model.measures).toEqual([{ id: 'revenue', sourceFieldId: 'revenue', aggregation: 'last' }]);
    const quarter = migratePivot({ ...config, grouping: [], split: ['date'], buckets: { date: 'quarter' } });
    expect(quarter.categories[0].id).not.toBe(model.categories[0].id);
    const moved = migratePivot({ ...config, grouping: [], split: ['date', 'region'] });
    expect(moved.categories[0].id).toBe(model.categories[0].id);
    expect(validateTableModel(model).model).toEqual(model);
  });
  it('retainsTemporarilyMissingFields', () => {
    const model = migratePivot({ enabled: false, grouping: ['gone'], split: [], aggregationFns: { absent: 'mean' } });
    expect(model.categories[0].sourceFieldId).toBe('gone');
    expect(model.measures[0]).toEqual({ id: 'absent', sourceFieldId: 'absent', aggregation: 'mean' });
    expect(model.legacyPivot?.enabled).toBe(false);
  });
  it('preserves ordered duplicate measures and authoritative empty/unset configuration', () => {
    const measures = [{ id: 'last', sourceFieldId: 'price', aggregation: 'last' as const }, { id: 'unset', sourceFieldId: 'price' }];
    const config = { enabled: true, grouping: [], split: [], measures, aggregationFns: { price: 'sum' as const } };
    expect(migratePivot(config).measures).toEqual(measures);
    expect(migratePivot({ ...config, measures: [] }).measures).toEqual([]);
    expect(migratePivot({ enabled: false, grouping: [], split: [] }, { sourceOrder: ['price'] }).measures).toEqual([{ id: 'price', sourceFieldId: 'price' }]);
  });
  it('retains week/month recipes and detached legacy intent without changing input', () => {
    const config = { enabled: true, grouping: ['date'], split: [], buckets: { date: 'month' as const }, aggregationFns: { date: 'first' as const } };
    const model = migratePivot(config);
    expect(model.categories[0]).toMatchObject({ transform: 'native', legacyBucket: 'month' });
    expect(validateTableModel(model).model).toBeDefined();
    expect(validateTableModel(model).diagnostics).toContainEqual(expect.objectContaining({ code: 'legacy-bucket', severity: 'warning' }));
    config.grouping.push('other');
    expect(model.legacyPivot?.grouping).toEqual(['date']);
    expect(model.legacyPivot?.aggregationFns).toEqual({ date: 'first' });
  });
});
