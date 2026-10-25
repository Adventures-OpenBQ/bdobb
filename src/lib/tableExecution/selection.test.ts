// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { it, expect } from 'vitest';
import { calculateView } from './engine';
import { selectPresentedRows } from './selection';
import { toggleGroupSelection } from '../widgetData/tableOutput';
import { input, definition } from './fixtures';
it('allMatchingIncludesUnloadedRowsExceptExclusions', () => {
  const v = calculateView(input, { table: {}, search: '' }, { kind: 'none' });

  expect(selectPresentedRows(v, { kind: 'allMatching', excludedIds: ['r1'] }).map(r => r.id)).toEqual(['r0', 'r2']);
});

it('filteredExplicitSelectionStaysEmpty', () => {
  const v = calculateView(input, { table: { columnFilters: [{ id: 'revenue', value: { min: 50 } }] }, search: '' }, { kind: 'explicit', ids: ['r0'] });

  expect(selectPresentedRows(v, { kind: 'explicit', ids: ['r0'] })).toEqual([]);
});

it('pivotSelectionHasNoAncestorOverlap', () => {
  const v = calculateView(input, definition, { kind: 'none' });
  const parent = v.groups[0];
  const child = parent.children[0];
  const selected = selectPresentedRows(v, { kind: 'explicit', ids: [parent.id, child.id] });

  expect(selected.map(r => r.id)).toEqual([parent.id]);
  expect(toggleGroupSelection({ kind: 'explicit', ids: [parent.id] }, child.rows[0], new Map([[parent.id, [child.id]]]))).toEqual({ kind: 'explicit', ids: [child.id] });
});

it('allMatching excludes aggregate descendants when parent is excluded', () => {
  const v = calculateView(input, definition, { kind: 'none' });

  expect(selectPresentedRows(v, { kind: 'allMatching', excludedIds: [v.groups[0].id] })).toHaveLength(1);
});

it('reselects an excluded child while its sibling remains excluded', () => {
  const view = calculateView(input, definition, { kind: 'none' });
  const parent = view.groups[0];
  const [child, sibling] = parent.children;
  const hierarchy = new Map([[parent.id, [child.id, sibling.id]]]);
  const excludedParent = toggleGroupSelection({ kind: 'allMatching', excludedIds: [] }, parent.rows[0], hierarchy);
  const selectedChild = toggleGroupSelection(excludedParent, child.rows[0], hierarchy);

  expect(selectPresentedRows(view, selectedChild).map(row => row.id))
    .toEqual([child.id, view.groups[1].children[0].id]);
  expect(selectedChild).toEqual({ kind: 'allMatching', excludedIds: [sibling.id] });
});

it('reselects a descendant from a compact ancestor exclusion', () => {
  const hierarchy = new Map([
    ['root', ['branch', 'child', 'sibling', 'other']],
    ['branch', ['child', 'sibling']],
  ]);
  const selected = toggleGroupSelection({ kind: 'allMatching', excludedIds: ['root'] }, { id: 'child', values: {} }, hierarchy);

  expect(selected).toEqual({ kind: 'allMatching', excludedIds: ['sibling', 'other'] });
});
