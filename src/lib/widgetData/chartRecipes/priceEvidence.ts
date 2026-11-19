// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from '../../isRecord';
import type { DatasetProvenance, DatasetRow, WidgetDataset } from '../types';

export type PriceScope = { start: string; end: string; interval: '1d' };

/** A timestamp denotes its authored trading date, including when its offset crosses UTC midnight. */
export function calendarDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) return null;
  const date = value.slice(0, 10);
  const time = Date.parse(date);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date
    && (value.length === 10 || Number.isFinite(Date.parse(value))) ? date : null;
}

/** A receipt and the parameters attached to the same acquired payload must agree. */
function fact(provenance: DatasetProvenance, key: string): unknown {
  const values = [provenance.parameters, provenance.receipt].flatMap(record =>
    Object.entries(record ?? {}).filter(([name]) => name.toLowerCase() === key).map(([, value]) => value));
  return values.every(value => value === values[0]) ? values[0] : null;
}
export function acquiredWindow(provenance: DatasetProvenance) {
  const start = fact(provenance, 'start_date'), end = fact(provenance, 'end_date');
  return typeof start === 'string' && typeof end === 'string' && start === calendarDate(start) && end === calendarDate(end)
    && start <= end ? { start, end } : null;
}
export function dailyScope(provenance: DatasetProvenance): PriceScope | null {
  const window = acquiredWindow(provenance);
  return window && fact(provenance, 'interval') === '1d' ? { ...window, interval: '1d' } : null;
}

export function observationSymbol(value: unknown): string | undefined {
  return typeof value === 'string' && !value.includes(',') ? value.trim() || undefined : undefined;
}
export function symbolList(provenance: DatasetProvenance): string[] | undefined {
  const declared = fact(provenance, 'symbol');
  if (declared === undefined) return undefined;
  if (typeof declared !== 'string') return [];
  const symbols = declared.split(',').map(s => s.trim());
  return symbols.every(Boolean) ? [...new Set(symbols)] : [];
}

function namedFields(ids: string[], ...names: string[]): string[] {
  return ids.filter(id => names.includes(id.toLowerCase()));
}
export function priceIdentityFields(ids: string[]): string[] {
  return namedFields(ids, 'symbol', 'ticker');
}

/** Verify every observed identity alias against the full acquisition. */
function priceIdentityIssue(dataset: WidgetDataset): string | undefined {
  const { rows, columns, provenance } = dataset;
  const ids = columns.map(c => c.id);
  const intervals = namedFields(ids, 'interval');
  if (rows.some(row => intervals.some(id => row.values[id] !== '1d')))
    return 'The observations and acquisition must agree on a daily interval.';
  const identities = priceIdentityFields(ids);
  const symbols = symbolList(provenance);
  if (symbols?.length === 0) return 'Repair conflicting or ambiguous acquisition symbols.';
  const allowed = symbols && new Set(symbols);
  const venues = new Map<string, string>();
  const exchangeFields = namedFields(ids, 'exchange');
  for (const row of rows) {
    const symbol = identities.length ? observationSymbol(row.values[identities[0]])
      : symbols?.length === 1 ? symbols[0] : undefined;
    if (identities.length && (!symbol || (allowed && !allowed.has(symbol))
      || identities.some(id => observationSymbol(row.values[id]) !== symbol))) return 'Repair mixed or missing price symbol identities.';
    for (const id of exchangeFields) {
      const exchange = row.values[id];
      if (!symbol || typeof exchange !== 'string' || !exchange.trim() || (venues.has(symbol) && venues.get(symbol) !== exchange))
        return 'Repair conflicting or missing exchange identity for a price symbol.';
      venues.set(symbol, exchange);
    }
  }
}

/** The acquisition supplies currency/unit even when a chart projects those columns away. */
function priceUnits(dataset: WidgetDataset, priceField?: string): Record<string, string> | string {
  const { rows, columns, provenance } = dataset;
  const ids = columns.map(c => c.id);
  const metadata = columns.find(c => c.id === priceField)?.metadata ?? {};
  const acquired = provenance.metadata?.acquiredPriceUnits;
  const result: Record<string, string> = {};
  for (const dimension of ['currency', 'unit']) {
    const units = new Set<unknown>();
    const declared = fact(provenance, dimension);
    if (declared !== undefined) units.add(declared);
    if (isRecord(acquired) && Object.hasOwn(acquired, dimension)) units.add(acquired[dimension]);
    for (const id of namedFields(Object.keys(metadata), dimension)) units.add(metadata[id]);
    for (const id of namedFields(ids, dimension)) for (const row of rows) units.add(row.values[id]);
    if (!units.size) continue;
    const [value] = units;
    if (units.size !== 1 || typeof value !== 'string' || !value.trim()) return `Repair mixed or missing price ${dimension} values.`;
    result[dimension] = value;
  }
  return result;
}

export function priceDimensionIssue(dataset: WidgetDataset, priceField: string): string | undefined {
  const units = priceUnits(dataset, priceField);
  return priceIdentityIssue(dataset) ?? (typeof units === 'string' ? units : undefined);
}

/** Only raw acquired rows can certify dimensions that a later table projection may omit. */
export function priceAcquisitionProvenance(dataset: WidgetDataset): DatasetProvenance {
  const { provenance, completeness } = dataset;
  if ((!provenance.receipt && !provenance.parameters) || !dailyScope(provenance) || provenance.presentation || provenance.lineage?.length || provenance.inputMayContainAggregates
    || ('kind' in dataset && dataset.kind === 'chartData') || completeness.acquiredRowCount !== dataset.rows.length
    || completeness.kind !== 'complete' && completeness.kind !== 'bounded') return provenance;
  const units = priceUnits(dataset);
  const issue = priceIdentityIssue(dataset) ?? (typeof units === 'string' ? units : undefined);
  const priceSymbolFields = priceIdentityFields(dataset.columns.map(c => c.id));
  return { ...provenance, metadata: { ...provenance.metadata, priceDimensionsChecked: true, priceSymbolFields,
    acquiredPriceUnits: typeof units === 'string' ? {} : units, ...(issue ? { priceDimensionIssue: issue } : {}) } };
}

/** Omitted coordinates carry no prices. Emit them only for requested, presented dimensions. */
export function priceOmissionEvidence(
  dataset: Pick<WidgetDataset, 'provenance' | 'completeness'>, universe: DatasetRow[], presented: DatasetRow[], fields: string[],
): DatasetProvenance {
  const { provenance, completeness } = dataset;
  const dates = namedFields(fields, 'date');
  if (!dailyScope(provenance) || provenance.inputMayContainAggregates || dates.length !== 1
    || !namedFields(fields, 'adjusted_close').length || completeness.acquiredRowCount !== universe.length || universe.length <= presented.length) return provenance;
  const dateField = dates[0];
  const symbolFields = priceIdentityFields(fields);
  const symbolField = symbolFields[0];
  const symbols = symbolList(provenance);
  const single = symbols?.length === 1 ? symbols[0] : undefined;
  if (!symbolField && !single) return provenance;
  const symbolFor = (row: DatasetRow) => symbolField ? observationSymbol(row.values[symbolField]) : single;
  const retained = new Set(presented.map(row => row.id)), visibleSymbols = new Set(presented.map(symbolFor));
  const omitted: [string, string][] = [];
  for (const row of universe) {
    if (retained.has(row.id)) continue;
    const symbol = symbolFor(row);
    if (!symbol) return provenance;
    if (!visibleSymbols.has(symbol)) continue;
    const date = calendarDate(row.values[dateField]);
    if (!date) return provenance;
    omitted.push([symbol, date]);
  }
  return { ...provenance, metadata: { ...provenance.metadata, priceOmissions: {
    acquired: universe.length, delivered: presented.length, dateField, symbolFields, points: omitted,
  } } };
}
