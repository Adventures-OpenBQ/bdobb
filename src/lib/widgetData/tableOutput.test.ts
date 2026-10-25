// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { calculateView } from '../tableExecution/engine';
import { input, definition, revision } from '../tableExecution/fixtures';
import { createResultStore } from '../tableExecution/resultStore';
import { eligiblePresentedRows } from './tableOutput';

it('default deepest output is independent of folds and preserves aggregate provenance', () => {
  const closed = calculateView(input, definition, { kind: 'none' });
  const open = calculateView(input, { ...definition, table: { pivot: { ...definition.table.pivot!, expanded: true } } }, { kind: 'none' });
  expect(eligiblePresentedRows(closed)).toEqual(eligiblePresentedRows(open));
  expect(closed.presentedRows).toHaveLength(3);
  expect(closed.provenance.inputMayContainAggregates).toBe(true);
});
it('select all is symbolic with only one fetched row and deselection excludes that row', () => {
  const view = calculateView(input, { table: {}, search: '' }, { kind: 'none' });
  const store = createResultStore(view, revision);
  store.rows('one', revision, { groupPath: [], offset: 0, limit: 1 });
  const all = store.selection('all', revision, { kind: 'all' }, ['r0']);
  expect(all.selection).toEqual({ kind: 'allMatching', excludedIds: [] });
  expect(all).toMatchObject({ selectedCount: 3, eligibleCount: 3, checked: true });
  const selected = createResultStore(calculateView(input, { table: {}, search: '' }, all.selection), revision);
  expect(selected.selection('toggle', revision, { kind: 'toggle', rowId: 'r0' }, ['r0'])).toMatchObject({ selection: { kind: 'allMatching', excludedIds: ['r0'] }, selectedCount: 2, checked: false, indeterminate: true });
});
it('parent replaces unloaded descendants, descendant replaces parent, and raw pivot leaves cannot select', () => {
  const original = calculateView(input, definition, { kind: 'none' });
  const parent = original.groups[0], [child, sibling] = parent.children;
  const store = createResultStore(calculateView(input, definition, { kind: 'explicit', ids: [child.id, sibling.id] }), revision);
  const chosen = store.selection('parent', revision, { kind: 'toggle', rowId: parent.id }, [parent.id, 'r0']);
  expect(chosen.selection).toEqual({ kind: 'explicit', ids: [parent.id] });
  expect(chosen.rows).toEqual([{ rowId: parent.id, selectable: true, checked: true, indeterminate: false }, { rowId: 'r0', selectable: false, checked: false, indeterminate: false }]);
  expect(chosen.selectedCount).toBe(1);
  const next = createResultStore(calculateView(input, definition, chosen.selection), revision);
  expect(next.selection('child', revision, { kind: 'toggle', rowId: child.id }, []).selection).toEqual({ kind: 'explicit', ids: [child.id] });
  expect(() => next.selection('raw', revision, { kind: 'toggle', rowId: 'r0' }, [])).toThrow('selectable');
});
it('hidden selections survive filters; vanished identities reconcile to none with notice', () => {
  const selected = { kind: 'explicit' as const, ids: ['r0'] };
  const hidden = calculateView(input, { table: {}, search: 'missing' }, selected);
  expect(hidden.selection).toEqual(selected);
  expect(hidden.presentedRows).toEqual([]);
  const refreshed = calculateView({ ...input, rows: input.rows.slice(1) }, { table: {}, search: '' }, selected);
  expect(refreshed.selection).toEqual({ kind: 'none' });
  expect(refreshed.presentedRows).toHaveLength(2);
  expect(refreshed.diagnostics).toContainEqual(expect.objectContaining({ code: 'SELECTION_RECONCILED' }));
  expect(calculateView(input, { table: {}, search: '' }, { kind: 'explicit', ids: [] }).presentedRows).toEqual([]);
});
it('group arrangement changes reconcile identities but filtering never makes them disappear', () => {
  const view = calculateView(input, definition, { kind: 'none' });
  const selected = { kind: 'explicit' as const, ids: [view.groups[0].id] };
  expect(calculateView(input, { ...definition, search: 'missing' }, selected).selection).toEqual(selected);
  const changed = calculateView(input, { ...definition, table: { pivot: { ...definition.table.pivot!, grouping: ['team', 'region'] } } }, selected);
  expect(changed.selection).toEqual({ kind: 'none' });
});
it('split-only Total is eligible only for nonempty input and selection actions fence revisions', () => {
  const def = { table: { pivot: { enabled: true, grouping: [], split: ['region'] } }, search: '' };
  const view = calculateView(input, def, { kind: 'none' });
  expect(eligiblePresentedRows(view)).toHaveLength(1);
  const store = createResultStore(view, revision);
  expect(store.selection('one', revision, { kind: 'all' }, [view.logicalRows[0].id]).rows[0].selectable).toBe(true);
  expect(() => store.selection('old', { ...revision, output: 0 }, { kind: 'all' }, [])).toThrow('revision');
  expect(eligiblePresentedRows(calculateView({ ...input, rows: [] }, def, { kind: 'none' }))).toEqual([]);
});
it('checking an indeterminate allMatching parent restores every descendant including unloaded siblings', () => {
  const initial = calculateView(input, definition, { kind: 'none' });
  const parent = initial.groups[0], child = parent.children[0];
  const store = createResultStore(calculateView(input, definition, { kind: 'allMatching', excludedIds: [child.id] }), revision);
  expect(store.selection('summary', revision, { kind: 'summary' }, [parent.id]).rows[0]).toMatchObject({ checked: false, indeterminate: true });
  const chosen = store.selection('parent', revision, { kind: 'toggle', rowId: parent.id }, [parent.id]);
  expect(chosen.selection).toEqual({ kind: 'allMatching', excludedIds: [] });
  expect(chosen.rows[0]).toMatchObject({ checked: true, indeterminate: false });
});
it('normalizes overlapping restored explicit selections to one parent aggregate', () => {
  const original = calculateView(input, definition, { kind: 'none' });
  const parent = original.groups[0], child = parent.children[0];
  const view = calculateView(input, definition, { kind: 'explicit', ids: [child.id, parent.id, child.id] });
  expect(view.selection).toEqual({ kind: 'explicit', ids: [parent.id] });
  expect(view.presentedRows.map(r => r.id)).toEqual([parent.id]);
  expect(view.diagnostics.some(d => d.code === 'SELECTION_RECONCILED')).toBe(false);
});
it('unchecking a visibly checked parent also excludes hidden descendants', () => {
  const original = calculateView(input, definition, { kind: 'none' });
  const parent = original.groups[0], hiddenChild = parent.children[0];
  const filtered = { ...definition, table: { ...definition.table, columnFilters: [{ id: 'revenue', value: { min: 15 } }] } };
  const store = createResultStore(calculateView(input, filtered, { kind: 'allMatching', excludedIds: [hiddenChild.id] }), revision);
  expect(store.selection('status', revision, { kind: 'summary' }, [parent.id]).rows[0].checked).toBe(true);
  const chosen = store.selection('toggle', revision, { kind: 'toggle', rowId: parent.id }, [parent.id]);
  expect(chosen.rows[0].checked).toBe(false);
  expect(calculateView(input, definition, chosen.selection).presentedRows.map(r => r.id)).toEqual([original.groups[1].children[0].id]);
});
it('linked reconciliation rejects incompatible namespaces without treating compatible absence as deletion', () => {
  const original = calculateView(input, definition, { kind: 'none' });
  const selection = { kind: 'explicit' as const, ids: [original.groups[0].id] };
  const hiddenInput = { ...input, rows: input.rows.slice(2) };
  const split = { ...definition, table: { pivot: { ...definition.table.pivot!, split: ['date'] } } };
  const retained = calculateView(hiddenInput, split, selection, false);
  expect(retained.selection).toEqual(selection); expect(retained.presentedRows).toEqual([]);
  expect(retained.diagnostics.some(d => d.code === 'SELECTION_RECONCILED')).toBe(false);
  const changed = calculateView(hiddenInput, { ...definition, table: { pivot: { ...definition.table.pivot!, grouping: ['team'] } } }, selection, false);
  expect(changed.selection).toEqual({ kind: 'none' });
  expect(changed.diagnostics).toContainEqual(expect.objectContaining({ code: 'SELECTION_RECONCILED' }));
});
it('linked bucket changes remove old local namespace and pivot off uses previous namespace proof only', () => {
  const dateDefinition = { search: '', table: { pivot: { enabled: true, grouping: ['date'], split: [] } } };
  const original = calculateView(input, dateDefinition, { kind: 'none' });
  const selection = { kind: 'explicit' as const, ids: [original.groups[0].id] };
  const hiddenInput = { ...input, rows: input.rows.slice(2) };
  const changed = calculateView(hiddenInput, { ...dateDefinition, table: { pivot: { ...dateDefinition.table.pivot, buckets: { date: 'month' as const } } } }, selection, false);
  expect(changed.selection).toEqual({ kind: 'none' });
  expect(changed.diagnostics).toContainEqual(expect.objectContaining({ code: 'SELECTION_RECONCILED' }));
  expect(original.selectionNamespace).toBeDefined();
  const ordinary = { table: {}, search: '' };
  expect(calculateView(hiddenInput, ordinary, selection, false, original.selectionNamespace).selection).toEqual({ kind: 'none' });
  // On reopen there is no proof that group-looking IDs originated locally.
  expect(calculateView(hiddenInput, ordinary, selection, false).selection).toEqual(selection);
  const upstream = { ...input, rows: [original.groups[0].rows[0]] };
  expect(calculateView(upstream, ordinary, selection, false, original.selectionNamespace).presentedRows.map(r => r.id)).toEqual(selection.ids);
});
it('compatible hidden allMatching exclusions survive split changes and exclude groups when restored', () => {
  const original = calculateView(input, definition, { kind: 'none' });
  const selection = { kind: 'allMatching' as const, excludedIds: [original.groups[0].id] };
  const split = { ...definition, table: { pivot: { ...definition.table.pivot!, split: ['date'] } } };
  const hidden = calculateView({ ...input, rows: input.rows.slice(2) }, split, selection, false);
  expect(hidden.selection).toEqual(selection);
  const restored = calculateView(input, split, hidden.selection, false);
  expect(restored.presentedRows.map(r => r.id)).toEqual([original.groups[1].children[0].id]);
  const empty = calculateView({ ...input, rows: [] }, split, { kind: 'explicit', ids: [original.groups[0].id] }, false);
  expect(empty.selection).toEqual({ kind: 'explicit', ids: [original.groups[0].id] });
  expect(empty.presentedRows).toEqual([]);
});
