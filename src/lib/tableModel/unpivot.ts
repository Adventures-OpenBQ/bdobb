// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { UnpivotSpec } from '../statementModel/types';
import type { Row } from '../tableColumns';
import { identifyRows } from '../widgetData/identity';
import type { DatasetColumn, DatasetRow, WidgetDataset } from '../widgetData/types';

export class UnpivotError extends Error {
  constructor(
    public readonly code: 'missing-reference' | 'duplicate-id' | 'invalid-type',
    message: string,
    public readonly fieldId?: string,
    public readonly recordId?: string,
  ) {
    super(message);
    this.name = 'UnpivotError';
  }
}

/** Explicit wide-to-long projection. Ownership is encoded, never derived from labels. */
export function unpivotDataset(input: WidgetDataset, spec: UnpivotSpec): WidgetDataset {
  return unpivotDatasetWithDescriptors(input, spec).dataset;
}

/** Worker-local mapping context; never attach this descriptor map to publication/selected datasets. */
export function unpivotDatasetWithDescriptors(input: WidgetDataset, spec: UnpivotSpec): { dataset: WidgetDataset; sourceColumnsByRowId: Map<string, DatasetColumn> } {
  const columns = new Map(input.columns.map(column => [column.id, column]));
  const requireField = (id: string) => {
    if (!columns.has(id)) throw new UnpivotError('missing-reference', `Unknown Unpivot source field: ${id}`, id);
  };
  const outputIds = [...spec.carryFieldIds, spec.itemFieldId, spec.valueFieldId];
  if (new Set(outputIds).size !== outputIds.length) {
    throw new UnpivotError('duplicate-id', 'Unpivot carry, item and value fields must be distinct');
  }
  if (new Set(spec.mappings.map(mapping => mapping.lineId)).size !== spec.mappings.length) {
    throw new UnpivotError('duplicate-id', 'Unpivot destination line IDs must be distinct');
  }
  spec.carryFieldIds.forEach(requireField);
  spec.mappings.forEach(mapping => requireField(mapping.sourceFieldId));

  const values: Row[] = [];
  const identities: Row[] = [];
  const contexts: Pick<DatasetRow, "cellErrors" | "cellFormats" | "groupPath">[] = [];
  const descriptors: DatasetColumn[] = [];
  const occurrences = new Map<string, number>();
  for (const source of input.rows) {
    // Normally DatasetRow IDs are unique. Still preserve separate records if a
    // malformed provider supplies duplicate IDs; never merge their facts.
    const occurrence = occurrences.get(source.id) ?? 0;
    occurrences.set(source.id, occurrence + 1);
    for (const mapping of spec.mappings) {
      const present = Object.hasOwn(source.values, mapping.sourceFieldId);
      const value = present ? source.values[mapping.sourceFieldId] : undefined;
      if (value !== null && value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
        throw new UnpivotError('invalid-type', `Unpivot requires a finite number, null or missing value: ${mapping.sourceFieldId}`, mapping.sourceFieldId, source.id);
      }
      const row = Object.fromEntries(spec.carryFieldIds
        .filter(id => Object.hasOwn(source.values, id))
        .map(id => [id, structuredClone(source.values[id])]));
      Object.defineProperty(row, spec.itemFieldId, { value: mapping.lineId, enumerable: true, writable: true, configurable: true });
      if (present) Object.defineProperty(row, spec.valueFieldId, { value, enumerable: true, writable: true, configurable: true });
      const errorBindings = [...spec.carryFieldIds.map(id => [id, id] as const), [mapping.sourceFieldId, spec.valueFieldId] as const];
      const cellErrors = Object.fromEntries(errorBindings
        .filter(([sourceId]) => source.cellErrors && Object.hasOwn(source.cellErrors, sourceId))
        .map(([sourceId, outputId]) => [outputId, structuredClone(source.cellErrors![sourceId])]));
      const cellFormats = Object.fromEntries(errorBindings
        .filter(([sourceId]) => source.cellFormats && Object.hasOwn(source.cellFormats, sourceId))
        .map(([sourceId, outputId]) => [outputId, structuredClone(source.cellFormats![sourceId])]));
      contexts.push({
        ...(Object.keys(cellFormats).length ? { cellFormats } : {}),
        ...(source.groupPath ? { groupPath: structuredClone(source.groupPath) } : {}),
        ...(Object.keys(cellErrors).length ? { cellErrors } : {}),
      });
      descriptors.push(structuredClone(columns.get(mapping.sourceFieldId)!));
      values.push(row);
      identities.push({ sourceWidgetId: input.provenance.sourceWidgetId, sourceRowId: source.id, occurrence, transformId: spec.id, lineId: mapping.lineId });
    }
  }
  const identified = identifyRows(identities, ['sourceWidgetId', 'sourceRowId', 'occurrence', 'transformId', 'lineId']);
  const { rows: _inputRows, columns: _inputColumns, ...envelope } = input;
  const dataset: WidgetDataset = {
    ...structuredClone(envelope),
    columns: [
      ...spec.carryFieldIds.map(id => structuredClone(columns.get(id)!)),
      { id: spec.itemFieldId, label: spec.itemFieldId, dtype: 'text' },
      { id: spec.valueFieldId, label: spec.valueFieldId, dtype: 'number' },
    ],
    rows: identified.map((row, index) => ({ id: row.id, values: values[index], ...contexts[index] })),
  };
  return { dataset, sourceColumnsByRowId: new Map(identified.map((row, index) => [row.id, descriptors[index]])) };
}
