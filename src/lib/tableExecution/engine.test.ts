// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { identityWitness } from './identityWitness';
import { calculateView } from './engine';
import { input, definition } from './fixtures';
describe('complete calculation', () => {
  it('foldsDoNotChangePresentedRows', () => {
    const a = calculateView(input, definition, { kind: 'none' });
    const b = calculateView(input, { ...definition, table: { ...definition.table, pivot: { ...definition.table.pivot!, expanded: true } } }, { kind: 'none' });

    expect(a.selectionEligibleRows).toEqual(b.selectionEligibleRows);
    expect(a.selectionEligibleRows).toHaveLength(3);
    expect(a.groups).toHaveLength(2);
    expect(a.totals.values.revenue).toBe(40);
  });
  it('does not implicitly reaggregate aggregate inputs or conflate source fields', () => {
    const upstream = { ...input, provenance: { ...input.provenance, inputMayContainAggregates: true }, columns: input.columns.map(c => ({ ...c, sourceFieldId: 'same' })) };

    expect(calculateView(upstream, { search: '', table: {} }, { kind: 'none' }).logicalRows).toEqual(input.rows);
  });
  it('rejects unbound analytical definitions', () => expect(() => calculateView(input, { ...definition, analytical: {} }, { kind: 'none' })).toThrow('analytical'));
});

it('split-only aggregate is eligible and uses distinct incoming instance IDs', () => {
  const upstream = { ...input, columns: [{ id: 'actual', sourceFieldId: 'revenue', label: 'Actual', dtype: 'number' as const }, { id: 'budget', sourceFieldId: 'revenue', label: 'Budget', dtype: 'number' as const }, { id: 'region', label: 'Region', dtype: 'text' as const }], rows: input.rows.map(r => ({ ...r, values: { actual: r.values.revenue, budget: 100, region: r.values.region } })), provenance: { ...input.provenance, inputMayContainAggregates: true } };
  const v = calculateView(upstream, { search: '', table: { pivot: { enabled: true, grouping: [], split: ['region'], aggregationFns: { actual: 'mean', budget: 'sum' } } } }, { kind: 'none' });

  expect(v.groups).toEqual([]);
  expect(v.selectionEligibleRows).toHaveLength(1);
  expect(v.columns.filter(c => c.sourceFieldId === 'revenue')).toHaveLength(4);
  expect(v.columns.filter(c => c.aggregation === 'mean').map(c => v.selectionEligibleRows[0].values[c.id])).toEqual([15, 90]);
  expect(v.columns.filter(c => c.aggregation === 'sum').map(c => v.selectionEligibleRows[0].values[c.id])).toEqual([200, 100]);
  expect(v.provenance.inputMayContainAggregates).toBe(true);
});

it('group IDs survive folds sorts and operator edits but change with grouping definition', () => {
  const a = calculateView(input, definition, { kind: 'none' });
  const b = calculateView(input, { search: '', table: { sorting: [{ id: 'revenue', desc: true }], pivot: { ...definition.table.pivot!, aggregationFns: { revenue: 'sum' } } } }, { kind: 'none' });

  expect(a.groups.map(g => g.id).sort()).toEqual(b.groups.map(g => g.id).sort());
  const c = calculateView(input, { search: '', table: { pivot: { ...definition.table.pivot!, grouping: ['team', 'region'] } } }, { kind: 'none' });

  expect(c.groups[0].id).not.toBe(a.groups[0].id);
});

it('empty split-only input stays a successful empty result with empty totals', () => {
  const v = calculateView({ ...input, rows: [] }, { search: '', table: { pivot: { ...definition.table.pivot!, grouping: [], split: ['region'], aggregationFns: { revenue: 'sum' } } } }, { kind: 'none' });

  expect(v.logicalRows).toEqual([]);
  expect(v.presentedRows).toEqual([]);
  expect(v.totals.values).toEqual({});
  expect(v.completeness.kind).toBe('complete');
});

it('retains a configured split-member sort through absent members and empty input', () => {
  const sortId = '["string","A"]\x1frevenue';
  const model = { search: '', table: { hidden: ['date'], sorting: [{ id: sortId, desc: true }], pivot: { enabled: true, grouping: ['team'], split: ['region'], aggregationFns: { revenue: 'sum' as const } } } };
  const missingMember = calculateView({ ...input, rows: input.rows.filter(row => row.values.region === 'B') }, model, { kind: 'none' });
  expect(missingMember.columns.some(column => column.id === sortId)).toBe(false);
  expect(missingMember.definition.table.sorting).toEqual(model.table.sorting);

  const empty = calculateView({ ...input, rows: [] }, model, { kind: 'none' });
  expect(empty.presentedRows).toEqual([]);
  expect(empty.columns.some(column => column.id === sortId)).toBe(false);
  const restored = calculateView(input, model, { kind: 'none' });
  expect(restored.columns.some(column => column.id === sortId)).toBe(true);
});

it('rejects missing input and malformed generated sort bindings before silently changing semantics', () => {
  for (const table of [
    { columnFilters: [{ id: 'absent', value: 'A' }] },
    { sorting: [{ id: 'absent', desc: true }] },
    { pivot: { enabled: true, grouping: ['absent'], split: [] } },
    { pivot: { enabled: true, grouping: ['region'], split: [], aggregationFns: { absent: 'sum' as const } } },
    { sorting: [{ id: 'not-a-key\x1frevenue', desc: true }], pivot: { enabled: true, grouping: ['team'], split: ['region'] } },
  ]) {
    expect(() => calculateView(input, { search: '', table }, { kind: 'none' })).toThrow('Missing source field');
  }
});

it('rejects removed measures and invalid split structure while accepting the configured group label', () => {
  const generated = '["string","A"]\x1frevenue';
  const pivot = { enabled: true, grouping: ['team'], split: ['region'], aggregationFns: { revenue: 'sum' as const } };
  for (const table of [
    { pivot, hidden: ['revenue'], sorting: [{ id: generated, desc: true }] },
    { pivot: { ...pivot, split: [] }, sorting: [{ id: generated, desc: true }] },
    { pivot, sorting: [{ id: '["string","A"]\x1f["string","B"]\x1frevenue', desc: true }] },
    { pivot, sorting: [{ id: '["number","bogus"]\x1frevenue', desc: true }] },
  ]) {
    expect(() => calculateView(input, { search: '', table }, { kind: 'none' })).toThrow('Missing source field or output sort binding');
  }
  const view = calculateView(input, { search: '', table: { pivot, sorting: [{ id: '\x1egroup', desc: true }] } }, { kind: 'none' });
  expect(view.groups).toHaveLength(3);
});

it('calculates independent instances and totals from complete unequal groups', () => {
  const model = { search: '', table: { pivot: { enabled: true, grouping: ['region'], split: [], measures: [
    { id: 'revenue', sourceFieldId: 'revenue', aggregation: 'mean' as const },
    { id: 'total', sourceFieldId: 'revenue', aggregation: 'sum' as const },
  ] } } };
  const view = calculateView(input, model, { kind: 'none' });
  expect(view.groups.map(g => [g.rows[0].values.revenue, g.rows[0].values.total])).toEqual([[15, 30], [90, 90]]);
  expect(view.totals.values).toEqual({ revenue: 40, total: 120 });
  expect(view.columns.slice(1)).toMatchObject([{ id: 'revenue', measureId: 'revenue', sourceBindingId: 'revenue', aggregation: 'mean' }, { id: 'total', measureId: 'total', sourceBindingId: 'revenue', aggregation: 'sum' }]);
  expect(view.inputColumns).toEqual(input.columns);
  const renamed = structuredClone(model);
  renamed.table.pivot.measures[1] = { ...renamed.table.pivot.measures[1], aggregation: 'mean' };
  expect(calculateView(input, renamed, { kind: 'none' }).columns.map(c => c.id)).toEqual(view.columns.map(c => c.id));
});

it('retains split instance identities and origin separately from current input bindings', () => {
  const source = { ...input, columns: input.columns.map(c => c.id === 'revenue' ? { ...c, sourceFieldId: 'origin', format: { decimalPlaces: 2 } } : c), provenance: { ...input.provenance, inputMayContainAggregates: true } };
  const model = { search: '', table: { pivot: { enabled: true, grouping: [], split: ['region'], measures: [{ id: 'revenue', sourceFieldId: 'revenue', aggregation: 'mean' as const }, { id: 'copy', sourceFieldId: 'revenue', aggregation: 'mean' as const }] } } };
  const view = calculateView(source, model, { kind: 'none' });
  expect(view.columns.slice(1).map(c => c.id)).toEqual(['["string","A"]\x1frevenue', '["string","A"]\x1fcopy', '["string","B"]\x1frevenue', '["string","B"]\x1fcopy']);
  expect(view.columns[2]).toMatchObject({ sourceFieldId: 'origin', sourceBindingId: 'revenue', measureId: 'copy', splitPath: [{ field: 'region', value: 'A' }], format: { decimalPlaces: 2 } });
  expect(view.logicalRows[0].values['["string","A"]\x1fcopy']).toBe(15);
  expect(() => calculateView(source, { ...model, table: { ...model.table, pivot: { ...model.table.pivot, measures: [{ id: 'copy', sourceFieldId: 'missing' }] } } }, { kind: 'none' })).toThrow('Missing source field');
});

it('infers duplicate output dtype from the current binding rather than origin metadata', () => {
  const source = { ...input, columns: input.columns.map(c => c.id === 'revenue' ? { id: c.id, label: c.label, sourceFieldId: 'unavailable-origin' } : c) };
  const view = calculateView(source, { search: '', table: { pivot: { enabled: true, grouping: ['region'], split: [], measures: [{ id: 'region', sourceFieldId: 'revenue', aggregation: 'sum' }] } } }, { kind: 'none' });
  expect(view.columns[1].dtype).toBe('number');
});

it('does not use a measure column as raw identity evidence even with unset aggregation', () => {
  const plain = { table: {}, search: '' };
  const target = { table: { pivot: { enabled: true, grouping: ['region'], split: [] } }, search: '' };
  const columns = input.columns.map(c => c.id === 'region' ? { ...c, measureId: 'region', sourceBindingId: 'region' } : c);
  expect(identityWitness(input, [plain, target], ['missing'], plain, columns)).toEqual([{ id: 'missing', state: 'unknown' }]);
});

it('blocks removed original and split instance sorts without rebinding to raw source or sibling', () => {
  const pivot = { enabled: true, grouping: ['region'], split: [], measures: [{ id: 'copy', sourceFieldId: 'revenue', aggregation: 'sum' as const }] };
  expect(() => calculateView(input, { search: '', table: { pivot, sorting: [{ id: 'revenue', desc: true }] } }, { kind: 'none' })).toThrow('output sort binding');
  const sorted = calculateView(input, { search: '', table: { pivot, sorting: [{ id: 'copy', desc: true }], widths: { revenue: 180, copy: 220 } } }, { kind: 'none' });
  expect(sorted.groups.map(g => g.rows[0].values.copy)).toEqual([90, 30]);
  expect(sorted.definition.table.widths).toEqual({ revenue: 180, copy: 220 });
  expect(() => calculateView(input, { search: '', table: { pivot: { ...pivot, grouping: ['team'], split: ['region'] }, sorting: [{ id: '["string","A"]\x1frevenue', desc: true }] } }, { kind: 'none' })).toThrow('output sort binding');
});

it('preserves explicit category sorts and legacy or disabled raw sorts', () => {
  const pivot = { enabled: true, grouping: ['region'], split: [], measures: [{ id: 'copy', sourceFieldId: 'revenue', aggregation: 'sum' as const }] };
  const categories = calculateView(input, { search: '', table: { pivot, sorting: [{ id: 'region', desc: true }] } }, { kind: 'none' });
  expect(categories.groups).toHaveLength(2);
  const disabled = calculateView(input, { search: '', table: { pivot: { ...pivot, enabled: false }, sorting: [{ id: 'revenue', desc: true }] } }, { kind: 'none' });
  expect(disabled.logicalRows.map(r => r.values.revenue)).toEqual([90, 20, 10]);
  const legacy = calculateView(input, { search: '', table: { pivot: { enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'mean' } }, sorting: [{ id: 'revenue', desc: true }] } }, { kind: 'none' });
  expect(legacy.groups.map(g => g.rows[0].values.revenue)).toEqual([90, 15]);
});

it('treats explicit unset and empty measures as authoritative despite stored legacy operators', () => {
  for (const measures of [[], [{ id: 'revenue', sourceFieldId: 'revenue' }]]) {
    const view = calculateView(input, { search: '', table: { pivot: { enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'sum', missing: 'sum' }, measures } } }, { kind: 'none' });
    expect(view.totals.values).toEqual({});
    expect(view.columns).toHaveLength(measures.length + 1);
    expect(view.groups.every(g => !Object.hasOwn(g.rows[0].values, 'revenue'))).toBe(true);
  }
});

it('preserves category precedence and raw leaf identities for colliding measure IDs', () => {
  const source = { ...input, rows: [90, 10, 20].map((revenue, index) => ({ id: `r${index}`, values: { region: index < 2 ? 'A' : 'B', revenue } })) };
  const view = calculateView(source, { search: '', table: { sorting: [{ id: 'region', desc: false }], pivot: { enabled: true, grouping: ['region'], split: [], measures: [{ id: 'region', sourceFieldId: 'revenue', aggregation: 'sum' }] } } }, { kind: 'none' });
  expect(view.groups.map(group => group.rows[0].groupPath?.[0].value)).toEqual(['A', 'B']);
  expect(view.groups[0].rows.slice(1).map(row => row.id)).toEqual(['r0', 'r1']);
  expect(view.groups.map(group => group.rows[0].values.region)).toEqual([100, 20]);
});
