// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from '../../isRecord';
import type { DatasetColumn, DatasetProvenance, DatasetRow, WidgetDataset } from '../types';
import type { PriceBindings } from './types';

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

export const documentedDailySnapshotMessage = 'Choose a local adjusted-price snapshot with an acquisition receipt documenting its daily interval and dates.';

export function hasDocumentedDailySnapshot(provenance: DatasetProvenance): boolean {
  return provenance.sourceKind === 'localFile' && dailyScope({ ...provenance, parameters: undefined }) !== null;
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
export const priceDateOrigins = ['date', 'trading_date', 'observation_date'];
export const adjustedPriceOrigins = ['adjusted_close', 'adj_close', 'adjusted_price'];

function priceFields(columns: readonly DatasetColumn[], ...names: string[]): string[] {
  return columns.filter(c => !c.analytical && !c.measureId && !c.aggregation && !c.splitPath?.length
    && names.includes((c.sourceFieldId ?? c.id).toLowerCase())).map(c => c.id);
}

export function priceDateFields(columns: readonly DatasetColumn[]): string[] {
  return priceFields(columns, ...priceDateOrigins);
}

export function priceIdentityFields(columns: readonly DatasetColumn[]): string[] {
  return priceFields(columns, 'symbol', 'ticker');
}

/** Recognized acquired origins identify the adjustment basis. */
export function priceBasisFields(columns: readonly DatasetColumn[]): string[] {
  return priceFields(columns, ...adjustedPriceOrigins);
}

/** Verify every observed identity alias against the full acquisition. */
function priceIdentityIssue(dataset: WidgetDataset): string | undefined {
  const { rows, columns, provenance } = dataset;
  const intervals = priceFields(columns, 'interval');
  if (rows.some(row => intervals.some(id => row.values[id] !== '1d')))
    return 'The observations and acquisition must agree on a daily interval.';
  const identities = priceIdentityFields(columns);
  const symbols = symbolList(provenance);
  if (symbols?.length === 0) return 'Repair conflicting or ambiguous acquisition symbols.';
  const allowed = symbols && new Set(symbols);
  const venues = new Map<string, string>();
  const exchangeFields = priceFields(columns, 'exchange');
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
  const metadata = columns.find(c => c.id === priceField)?.metadata ?? {};
  const acquired = provenance.metadata?.acquiredPriceUnits;
  const result: Record<string, string> = {};
  for (const dimension of ['currency', 'unit']) {
    const units = new Set<unknown>();
    const declared = fact(provenance, dimension);
    if (declared !== undefined) units.add(declared);
    if (isRecord(acquired) && Object.hasOwn(acquired, dimension)) units.add(acquired[dimension]);
    for (const id of namedFields(Object.keys(metadata), dimension)) units.add(metadata[id]);
    for (const id of priceFields(columns, dimension)) for (const row of rows) units.add(row.values[id]);
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
  const priceSymbolFields = priceIdentityFields(dataset.columns);
  const priceDuplicateConflicts: [string, string, string][] = [];
  if (!issue) {
    const scope = dailyScope(provenance)!;
    const allowed = symbolList(provenance);
    for (const date of priceDateFields(dataset.columns)) {
      for (const price of priceBasisFields(dataset.columns)) {
        const indexed = indexPriceObservations(dataset.rows, { date, price, symbol: priceSymbolFields[0] }, scope, allowed);
        if (typeof indexed !== 'string') {
          for (const symbol of indexed.conflicts) priceDuplicateConflicts.push([date, price, symbol]);
        }
      }
    }
  }
  return { ...provenance, metadata: { ...provenance.metadata, priceDimensionsChecked: true, priceSymbolFields,
    acquiredPriceUnits: typeof units === 'string' ? {} : units, ...(issue ? { priceDimensionIssue: issue } : {}),
    ...(priceDuplicateConflicts.length ? { priceDuplicateConflicts } : {}) } };
}

/** The same daily indexing checks apply before filtering and in a recipe. */
export function indexPriceObservations(
  rows: DatasetRow[], fields: PriceBindings, scope: PriceScope, symbols: string[] | undefined,
) {
  const allowed = symbols && new Set(symbols);
  const prices = new Map<string, Map<string, number | null>>();
  const conflicts = new Set<string>();
  let duplicates = 0;
  for (const { values, cellErrors } of rows) {
    const symbol = observationSymbol(fields.symbol ? values[fields.symbol] : symbols?.[0]);
    if (!symbol || (fields.symbol && cellErrors?.[fields.symbol])) return 'Each price observation needs one identified symbol.';
    if (allowed && !allowed.has(symbol)) return 'Source and observation symbols disagree.';
    const date = !cellErrors?.[fields.date] && calendarDate(values[fields.date]);
    if (!date || date < scope.start || date > scope.end) return 'Repair missing, invalid or out-of-window trading dates.';
    const rawPrice = values[fields.price];
    const price = !cellErrors?.[fields.price] && typeof rawPrice === 'number' && Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;
    let daily = prices.get(symbol);
    if (!daily) { daily = new Map(); prices.set(symbol, daily); }
    if (!daily.has(date)) daily.set(date, price);
    else if (daily.get(date) !== price) conflicts.add(symbol);
    else duplicates++;
  }
  return { prices, conflicts, duplicates };
}

export type PriceCoordinate = [symbol: string, date: string];

/** Count one coordinate per omitted source row, including wholly omitted listings. */
export function readPriceOmissions(provenance: DatasetProvenance, acquired: number, delivered: number) {
  const evidence = provenance.metadata?.priceOmissions;
  if (!isRecord(evidence) || Object.keys(evidence).length !== 5
    || evidence.acquired !== acquired || evidence.delivered !== delivered || typeof evidence.dateField !== 'string'
    || !Array.isArray(evidence.symbolFields) || !Array.from(evidence.symbolFields).every(field => typeof field === 'string')
    || new Set(evidence.symbolFields).size !== evidence.symbolFields.length
    || !Array.isArray(evidence.points) || evidence.points.length !== acquired - delivered) return;
  const scope = dailyScope(provenance);
  if (!scope) return;
  const symbols = symbolList(provenance);
  const allowed = symbols && new Set(symbols);
  const points: PriceCoordinate[] = [];
  for (const point of evidence.points) {
    if (!Array.isArray(point) || point.length !== 2 || typeof point[0] !== 'string' || observationSymbol(point[0]) !== point[0]
      || (allowed && !allowed.has(point[0]))) return;
    const date = calendarDate(point[1]);
    if (!date || date !== point[1] || date < scope.start || date > scope.end) return;
    points.push([point[0], date]);
  }
  return { dateField: evidence.dateField, symbolFields: evidence.symbolFields as string[], points };
}

/** This coordinate plan is private to a worker calculation. It carries no price values. */
export function priceCoordinatePlan(dataset: Pick<WidgetDataset, 'provenance' | 'completeness' | 'columns' | 'rows'>) {
  const { provenance, completeness, columns, rows } = dataset;
  const acquired = completeness.acquiredRowCount;
  const scope = dailyScope(provenance);
  if (acquired === undefined || !Number.isSafeInteger(acquired) || acquired < rows.length || !scope
    || !['complete', 'bounded'].includes(completeness.kind) || provenance.inputMayContainAggregates
    || provenance.metadata?.priceDimensionsChecked !== true || provenance.metadata.priceDimensionIssue) return;
  const primaryDates = priceFields(columns, 'date');
  const dates = primaryDates.length ? primaryDates : priceDateFields(columns);
  const prices = priceBasisFields(columns);
  if (dates.length !== 1 || !prices.length) return;
  const [dateField] = dates;
  const symbolFields = priceIdentityFields(columns);
  const symbols = symbolList(provenance);
  const allowed = symbols && new Set(symbols);
  const single = symbols?.length === 1 ? symbols[0] : undefined;
  const symbolField = symbolFields[0];
  if (!symbolField && !single) return;
  const previous = acquired === rows.length ? undefined : readPriceOmissions(provenance, acquired, rows.length);
  if (acquired > rows.length && (!previous || previous.dateField !== dateField
    || (symbolFields.length ? !symbolFields.some(field => previous.symbolFields.includes(field)) : !single))) return;
  const points: PriceCoordinate[] = [];
  for (const row of rows) {
    const date = !row.cellErrors?.[dateField] && calendarDate(row.values[dateField]);
    const symbol = symbolField ? !row.cellErrors?.[symbolField] && observationSymbol(row.values[symbolField]) : single;
    if (!date || date < scope.start || date > scope.end || !symbol || (allowed && !allowed.has(symbol))) return;
    points.push([symbol, date]);
  }
  return { acquired, dateField, symbolFields, prices, single: single !== undefined, previous: previous?.points ?? [], points };
}

/** Omitted source rows keep their coordinates only, even across multiple linked presentations. */
export function priceOmissionEvidence(
  dataset: Pick<WidgetDataset, 'provenance' | 'completeness' | 'columns'>, universe: DatasetRow[], presented: DatasetRow[], fields: string[],
): DatasetProvenance {
  const { provenance } = dataset;
  const hasOmissions = Object.hasOwn(provenance.metadata ?? {}, 'priceOmissions');
  if (dataset.completeness.acquiredRowCount === presented.length && !hasOmissions) return provenance;
  const plan = priceCoordinatePlan({ ...dataset, rows: universe });
  if (!plan && !hasOmissions) return provenance;
  const metadata = { ...provenance.metadata };
  delete metadata.priceOmissions;
  if (!plan || !fields.includes(plan.dateField) || !plan.prices.some(field => fields.includes(field))) return { ...provenance, metadata };
  const symbolFields = plan.symbolFields.filter(field => fields.includes(field));
  if (!symbolFields.length && !plan.single) return { ...provenance, metadata };
  const retained = new Set(presented.map(row => row.id));
  const points = [...plan.previous, ...plan.points.filter((_, i) => !retained.has(universe[i].id))];
  if (points.length === plan.acquired - presented.length && points.length) {
    metadata.priceOmissions = { acquired: plan.acquired, delivered: presented.length, dateField: plan.dateField, symbolFields, points };
  }
  return { ...provenance, metadata };
}
