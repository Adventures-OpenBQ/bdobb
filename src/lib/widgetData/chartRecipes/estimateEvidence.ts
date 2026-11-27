// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from '../../isRecord';
import type { DatasetColumn, DatasetProvenance, DatasetRow, WidgetDataset } from '../types';
import { observationSymbol } from './priceEvidence';

const columnNames = (column: DatasetColumn) => [column.id, column.sourceFieldId ?? ''].map(name => name.toLowerCase());
const hasName = (column: DatasetColumn, ...names: string[]) => columnNames(column).some(name => names.includes(name));
export const sourceName = (column: DatasetColumn) => (column.sourceFieldId ?? column.id).toLowerCase();
export const read = (row: DatasetRow, field: string | undefined): unknown =>
  field !== undefined && !Object.hasOwn(row.cellErrors ?? {}, field) && Object.hasOwn(row.values, field)
    ? row.values[field] : undefined;
export const text = (value: unknown) => typeof value === 'string' ? value.trim() || undefined : undefined;

/** Request dimension evidence only from columns that the linked table presents. */
export function estimateRangeIdentityFields(columns: readonly DatasetColumn[]): string[] {
  return columns.filter(column => hasName(column, 'symbol', 'ticker', 'currency', 'unit')).map(column => column.id);
}

export function symbolFields(columns: readonly DatasetColumn[]) {
  return columns.filter(column => hasName(column, 'symbol', 'ticker'));
}

function namedValues(record: Record<string, unknown> | undefined, ...names: string[]) {
  return Object.entries(record ?? {}).filter(([name]) => names.includes(name.toLowerCase())).map(([, value]) => value);
}

export function instrument(dataset: WidgetDataset, requireSymbol: boolean) {
  const { columns, rows, provenance } = dataset;
  const symbols = new Set<string | undefined>();
  const fields = symbolFields(columns);
  for (const record of [provenance.parameters, provenance.receipt])
    for (const value of namedValues(record, 'symbol', 'ticker')) symbols.add(observationSymbol(value)?.toUpperCase());
  for (const column of fields)
    for (const row of rows) symbols.add(observationSymbol(read(row, column.id))?.toUpperCase());
  if (symbols.size > 1 || symbols.has(undefined)) return { issue: 'Choose one instrument with consistent symbol evidence.' };
  const [symbol] = symbols;
  if (symbol === undefined && requireSymbol)
    return { issue: 'Present a single symbol or use a source acquired for a single symbol.' };
  return { symbol };
}

export function unitValues(dataset: WidgetDataset, bound: DatasetColumn[], dimension: 'currency' | 'unit') {
  const { provenance, rows, columns } = dataset;
  const values = [
    ...namedValues(provenance.receipt, dimension),
    ...namedValues(provenance.parameters, dimension),
    ...bound.flatMap(column => namedValues(column.metadata, dimension)),
    ...columns.filter(column => hasName(column, dimension)).flatMap(column => rows.map(row => read(row, column.id))),
  ];
  return new Set(values.map(value => text(value)?.toLowerCase()));
}

/** A hidden dimension can only be used when the acquired rows agree. Carry field names
 * and the check outcome, never hidden cell values. Visible dimensions are rechecked on
 * the presented rows so a filter can resolve a mixed acquisition. */
export function estimateProvenance(dataset: WidgetDataset): DatasetProvenance {
  const { provenance, columns } = dataset;
  if (provenance.presentation || provenance.lineage?.length || provenance.inputMayContainAggregates ||
      ('kind' in dataset && dataset.kind === 'chartData')) return provenance;
  const guard = columns.find(column => sourceName(column) === 'band_status');
  if (!guard && !columns.some(column => sourceName(column).endsWith('_actual'))) return provenance;
  const unsafe: Record<string, string[]> = {};
  if (instrument(dataset, false).issue) unsafe.symbol = symbolFields(columns).map(column => column.id);
  for (const dimension of ['currency', 'unit'] as const) {
    const declared = columns.filter(column => hasName(column, dimension));
    if (!declared.length) continue;
    // Metadata can differ between EPS and revenue, so certify each metric independently.
    for (const metric of ['eps', 'revenue']) {
      const bound = columns.filter(column => [metric + '_low', metric + '_high', metric + '_avg', metric + '_average'].includes(sourceName(column)));
      const values = unitValues(dataset, bound, dimension);
      if (values.size > 1 || values.has(undefined)) unsafe[metric + '_' + dimension] = declared.map(column => column.id);
    }
  }
  return { ...provenance, metadata: { ...provenance.metadata, estimateEvidence: { guard: guard?.id ?? null, unsafe } } };
}

export function estimateProjectionIssue(dataset: WidgetDataset, metric?: string): string | undefined {
  const evidence = dataset.provenance.metadata?.estimateEvidence;
  const projected = ('kind' in dataset && dataset.kind === 'chartData') || dataset.provenance.presentation;
  if (!isRecord(evidence) || !isRecord(evidence.unsafe))
    return projected ? 'Reload the estimate source to verify its guard, instrument, currency and units.' : undefined;
  const presented = new Set(dataset.columns.map(column => column.id));
  if (typeof evidence.guard === 'string' && !presented.has(evidence.guard))
    return 'Present the provider band_status field to use guarded estimates.';
  for (const key of ['symbol', ...(metric ? [metric + '_currency', metric + '_unit'] : [])]) {
    const fields = evidence.unsafe[key];
    if (Array.isArray(fields) && fields.some(id => typeof id !== 'string' || !presented.has(id)))
      return key === 'symbol' ? 'Present the symbol field and choose one instrument.'
        : 'Present the declared currency or unit field to verify consistent estimate ranges.';
  }
}

/** Preserve the provider label and compare the identity across supported fiscal label spellings. */
export function fiscalKey(label: string | undefined) {
  if (!label) return undefined;
  const provider = /^FQ([1-4])\s+(\d{4})$/i.exec(label);
  if (provider) return `${provider[2]}-Q${provider[1]}`;
  return /^(?:FY\s*)?(\d{4}-Q[1-4])$/i.exec(label)?.[1].toUpperCase();
}
