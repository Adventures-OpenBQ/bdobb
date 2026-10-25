// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { CalculatedView, LogicalGroup, SelectionSpec, SelectionAction, SelectionSummary } from './types';
import type { DatasetRow } from '../widgetData/types';
import { ExecutionProtocolError } from './validation';
import { toggleGroupSelection } from '../widgetData/tableOutput';
import { eligiblePresentedRows } from '../widgetData/tableOutput';
export function selectPresentedRows(view: CalculatedView, selection: SelectionSpec): DatasetRow[] {
  const eligible = eligiblePresentedRows(view);
  if (selection.kind === 'none')
    return eligible;
  if (selection.kind === 'allMatching') {
    const excluded = new Set(selection.excludedIds);
    const descend = (g: LogicalGroup, ancestorExcluded: boolean) => { const omit = ancestorExcluded || excluded.has(g.id); if (omit)
      excluded.add(g.id); g.children.forEach(child => descend(child, omit)); };
    view.groups.forEach(g => descend(g, false));
    return eligible.filter(r => !excluded.has(r.id));
  }
  const ids = new Set(selection.ids);
  if (!view.groups.length)
    return eligible.filter(r => ids.has(r.id));
  const rows: DatasetRow[] = [];
  const visit = (g: LogicalGroup) => { if (ids.has(g.id)) {
    rows.push(g.rows[0]);
    return;
  } g.children.forEach(visit); };
  view.groups.forEach(visit);
  return rows;
}

/** Counts and checkbox states are resolved over the complete worker view. */
export function selectionSummary(view: CalculatedView, action: SelectionAction, visibleIds: string[]): SelectionSummary {
  const selectable = new Map<string, DatasetRow>();
  const visit = (g: LogicalGroup) => { selectable.set(g.id, g.rows[0]); g.children.forEach(visit); };
  view.groups.forEach(visit);
  if (!view.groups.length) view.selectionEligibleRows.forEach(row => selectable.set(row.id, row));
  let selection = view.selection;
  if (action.kind === 'all') selection = { kind: 'allMatching', excludedIds: [] };
  if (action.kind === 'clear') selection = { kind: 'none' };
  if (action.kind === 'toggle') {
    const target = selectable.get(action.rowId);
    if (!target) throw new ExecutionProtocolError('INVALID_REQUEST', 'Row is not selectable');
    const select = selection.kind === 'allMatching'
      ? !selectionSummary(view, { kind: 'summary' }, [target.id]).rows[0].checked : undefined;
    selection = toggleGroupSelection(selection, target, view.selectionHierarchy, select);
  }
  const selected = new Set(selection.kind === 'none' ? [] : selectPresentedRows(view, selection).map(row => row.id));
  const eligible = view.selectionEligibleRows;
  const eligibleIds = new Set(eligible.map(row => row.id));
  const checked = eligible.length > 0 && eligible.every(row => selected.has(row.id));
  const rows = visibleIds.map(rowId => {
    const canSelect = selectable.has(rowId);
    const descendants = (view.selectionHierarchy.get(rowId) ?? []).filter(id => eligibleIds.has(id));
    const selectedDescendants = descendants.filter(id => selected.has(id)).length;
    // Explicit parent selection is one aggregate, not implicit leaf selection.
    const checked = canSelect && (selected.has(rowId) || (selection.kind === 'allMatching' && descendants.length > 0 && selectedDescendants === descendants.length));
    return { rowId, selectable: canSelect, checked, indeterminate: canSelect && !checked && selectedDescendants > 0 };
  });
  return { selection, selectedCount: selected.size, eligibleCount: eligible.length, checked, indeterminate: !checked && selected.size > 0, rows };
}
