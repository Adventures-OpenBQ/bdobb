// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { DatasetColumn, WidgetDataset } from '../widgetData/types';
import type { IdentityWitness, TableDefinition } from './types';
import { calculateView } from './engine';
import { bucketOf } from '../pivotConfig';

/** Private proof over acquired input. Hidden values and the identity universe never leave this worker. */
export function identityWitness(input: WidgetDataset, path: TableDefinition[], ids: string[], rootDefinition: TableDefinition, rootColumns: DatasetColumn[]): IdentityWitness[] {
  const unknown = (): IdentityWitness[] => ids.map(id => ({ id, state: 'unknown' }));
  // Only ordinary ancestors preserve raw identities and grouping-field values.
  // The first definition is checked against this exact root result, not trusted
  // as an independent assertion that the root has no transformation.
  if (rootDefinition.table.pivot?.enabled || rootDefinition.analytical !== undefined
    || path.some(d => d.analytical !== undefined)
    || path.slice(0, -1).some(d => d.table.pivot?.enabled)
    || input.provenance.inputMayContainAggregates) return unknown();
  const target = path.at(-1)!;
  const hidden = new Set([rootDefinition, ...path.slice(0, -1)].flatMap(d => d.table.hidden ?? []));
  const columns = rootColumns.filter(column => !hidden.has(column.id));
  const required = [...(target.table.pivot?.enabled ? [...target.table.pivot.grouping, ...target.table.pivot.split] : [])];
  if (required.some(field => !columns.some(c => c.id === field && !c.measureId && !c.sourceBindingId && !c.aggregation && !c.splitPath?.length && (!c.sourceFieldId || c.sourceFieldId === c.id)))) return unknown();
  // Ordinary delivery preserves an explicit/inferred dtype once the root has
  // one. An untyped root column can instead be re-inferred from a child's
  // filtered subset (e.g. object first at root, date first at child). A date
  // bucket then has different key semantics, so full-root absence is no proof.
  if (target.table.pivot?.enabled && required.some(field => bucketOf(target.table.pivot!, field) !== 'native'
    && columns.find(column => column.id === field)?.dtype === undefined)) return unknown();
  try {
    // No ancestor filtering/selection participates in an existence proof. Target
    // calculation is private and used only for the same engine's typed group IDs.
    const universe = calculateView({ ...input, columns }, {
      ...target, search: '', table: { ...target.table, sorting: [], columnFilters: [] },
    }, { kind: 'none' }, false);
    const present = new Set(universe.selectionIdentityRows.map(row => row.id));
    return ids.map(id => ({ id, state: present.has(id) ? 'present' : 'absent' }));
  } catch {
    // Missing bindings or unsupported arrangements are not deletion evidence.
    return unknown();
  }
}
