// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

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
  const requested = provenance.parameters?.[key], received = provenance.receipt?.[key];
  if (requested !== undefined && received !== undefined && requested !== received) return null;
  return received === undefined ? requested : received;
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

export const identityColumns = ['symbol', 'ticker'] as const;
export const venueColumn = 'exchange';
export const unitColumns = ['currency', 'unit'] as const;

/** Verify source dimensions while they are available. A projected chart needs only the verdict. */
export function priceDimensionIssue(dataset: WidgetDataset, priceField?: string): string | undefined {
  const { rows, columns, provenance } = dataset;
  if (columns.some(c => c.id === 'interval') && rows.some(row => row.values.interval !== '1d'))
    return 'The observations and acquisition must agree on a daily interval.';
  const identities = identityColumns.filter(id => columns.some(c => c.id === id));
  const symbols = symbolList(provenance);
  if (symbols?.length === 0) return 'Repair conflicting or ambiguous acquisition symbols.';
  const allowed = symbols && new Set(symbols);
  const venues = new Map<string, string>();
  const hasVenue = columns.some(c => c.id === venueColumn);
  for (const row of rows) {
    const symbol = identities.length ? observationSymbol(row.values[identities[0]])
      : symbols?.length === 1 ? symbols[0] : undefined;
    if (identities.length && (!symbol || (allowed && !allowed.has(symbol))
      || identities.some(id => observationSymbol(row.values[id]) !== symbol))) return 'Repair mixed or missing price symbol identities.';
    if (hasVenue) {
      const exchange = row.values[venueColumn];
      if (!symbol || typeof exchange !== 'string' || !exchange.trim() || (venues.has(symbol) && venues.get(symbol) !== exchange))
        return 'Repair conflicting or missing exchange identity for a price symbol.';
      venues.set(symbol, exchange);
    }
  }
  const price = columns.find(c => c.id === priceField);
  for (const id of unitColumns) {
    const units = new Set<unknown>();
    const declared = fact(provenance, id);
    if (declared !== undefined) units.add(declared);
    if (price?.metadata?.[id] !== undefined) units.add(price.metadata[id]);
    if (columns.some(c => c.id === id)) for (const row of rows) units.add(row.values[id]);
    if (units.size > 1 || [...units].some(v => typeof v !== 'string' || !v.trim()))
      return `Repair mixed or missing price ${id} values.`;
  }
}

/** Omitted coordinates carry no prices. Emit them only for requested, presented dimensions. */
export function priceOmissionEvidence(
  dataset: Pick<WidgetDataset, 'provenance' | 'completeness'>, universe: DatasetRow[], presented: DatasetRow[], fields: string[],
): DatasetProvenance {
  const { provenance, completeness } = dataset;
  if (!dailyScope(provenance) || provenance.inputMayContainAggregates || !fields.includes('date')
    || !fields.includes('adjusted_close') || completeness.acquiredRowCount !== universe.length || universe.length <= presented.length) return provenance;
  const symbolField = identityColumns.find(id => fields.includes(id));
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
    const date = calendarDate(row.values.date);
    if (!date) return provenance;
    omitted.push([symbol, date]);
  }
  return { ...provenance, metadata: { ...provenance.metadata, priceOmissions: {
    acquired: universe.length, delivered: presented.length, dateField: 'date', symbolField: symbolField ?? null, points: omitted,
  } } };
}
