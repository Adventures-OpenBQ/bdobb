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

export function reconcileViewSelection(view: CalculatedView, selection: SelectionSpec, reconcile: boolean, previousSelectionNamespace?: string, provenAbsentIds: string[] = []): CalculatedView {
  const selectionNamespace = view.selectionNamespace;
  if (selection.kind !== 'none') {
    const knownIds = new Set(view.selectionIdentityRows.map(row => row.id));
    const absent = new Set(provenAbsentIds);
    const original = [...new Set(selection.kind === 'explicit' ? selection.ids : selection.excludedIds)];
    const retained = original.filter(id => {
      if (knownIds.has(id)) return true;
      if (reconcile || absent.has(id)) return false;
      const namespace = groupNamespace(id);
      // A current pivot defines exactly which ID namespace it can generate.
      // Compatible absent IDs may still be hidden upstream and must survive.
      if (selectionNamespace !== undefined) return namespace === selectionNamespace;
      // Ordinary linked input can itself contain upstream group IDs. Only a
      // prior locally generated namespace proves a pivot-off incompatibility.
      return previousSelectionNamespace === undefined || namespace !== previousSelectionNamespace;
    });
    if (retained.length < original.length) {
      selection = selection.kind === 'explicit'
        ? retained.length ? { kind: 'explicit', ids: retained } : { kind: 'none' }
        : { kind: 'allMatching', excludedIds: retained };
      view.diagnostics.push({ code: 'SELECTION_RECONCILED', severity: 'info', message: `${original.length - retained.length} selection identities removed because they are no longer available in this arrangement.` });
    }
  }
  if (selection.kind === 'explicit') {
    const ids = [...new Set(selection.ids)];
    const covered = new Set(ids.flatMap(id => view.selectionHierarchy.get(id) ?? []));
    selection = { kind: 'explicit', ids: ids.filter(id => !covered.has(id)) };
  } else if (selection.kind === 'allMatching') selection = { kind: 'allMatching', excludedIds: [...new Set(selection.excludedIds)] };
  view.selection = selection;
  view.presentedRows = selectPresentedRows(view, selection);
  return view;
}

/** Read only the typed local group namespace; never infer origin from a prefix. */
function groupNamespace(id: string): string | undefined {
  try {
    const value: unknown = JSON.parse(id);
    return Array.isArray(value) && value.length === 3 && value[0] === 'group'
      && typeof value[1] === 'string' && typeof value[2] === 'string' ? value[1] : undefined;
  } catch { return undefined; }
}
