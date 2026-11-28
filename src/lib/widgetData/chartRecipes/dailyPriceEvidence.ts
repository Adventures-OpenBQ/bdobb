// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { DatasetColumn, DatasetProvenance, WidgetDataset } from '../types';
import {
  readChartSource, readChartSourceProjection, type ChartSourceAdapter, type ChartSourceReceipt,
} from './chartSourceContracts';
import { exact, count, isChartSourceArray as array, isChartSourceRecord as record } from './chartSourceShape';
import { acquiredColumnOrigin, isoDate, utcTimestamp } from './financialEvidence';
import type { PriceCoordinate, PriceScope } from './priceEvidence';

// Keep this order in sync with the provider's sorted unsafe diagnostics.
const unsafeKeys = ['conflicting_duplicates', 'identity_conflict', 'invalid_response',
  'missing_adjusted_basis', 'partial_acquisition', 'undatable_loss'] as const;
type UnsafeKey = typeof unsafeKeys[number];

export type DailyPriceListingFacts = {
  symbol: string;
  raw_count: number;
  normalized_count: number;
  delivered_count: number;
  duplicate_count: number;
  omissions: PriceCoordinate[];
};
export type DailyPriceReceipt = ChartSourceReceipt & {
  kind: 'daily-price';
  interval: '1d';
  start_date: string;
  end_date: string;
  symbols: string[];
  date_field: 'date';
  price_field: 'adjusted_close';
  symbol_field: 'symbol' | null;
  listings: DailyPriceListingFacts[];
  diagnostics: UnsafeKey[];
  unsafe: Record<UnsafeKey, boolean>;
};

const countKeys = ['raw_count', 'normalized_count', 'delivered_count'] as const;
const receiptKeys = ['version', 'kind', 'retrieved_at', ...countKeys, 'diagnostics', 'unsafe',
  'interval', 'start_date', 'end_date', 'symbols', 'date_field', 'price_field', 'symbol_field', 'listings'] as const;
const listingKeys = ['symbol', ...countKeys, 'duplicate_count', 'omissions'] as const;
const usListing = (value: unknown): value is string => typeof value === 'string' && value.length <= 128
  && value.endsWith('.US') && /^[A-Z0-9][A-Z0-9_/-]*(?:\.[A-Z0-9_/-]+)*\.US$/.test(value);
const inWindow = (date: unknown, start: string, end: string): date is string => isoDate(date) && date >= start && date <= end;
const coordinateId = (point: PriceCoordinate) => JSON.stringify(point);

function coordinate(value: unknown, start: string, end: string): value is PriceCoordinate {
  return array(value) && value.length === 2 && usListing(value[0]) && inWindow(value[1], start, end);
}

function listingFacts(value: unknown, symbol: string, start: string, end: string, allowUnaccounted: boolean): value is DailyPriceListingFacts {
  if (!exact(value, listingKeys) || value.symbol !== symbol
    || !count(value.raw_count) || !count(value.normalized_count) || !count(value.delivered_count)
    || !count(value.duplicate_count) || value.normalized_count !== value.delivered_count
    || !array(value.omissions) || !value.omissions.every(
      (point): point is PriceCoordinate => coordinate(point, start, end) && point[0] === symbol,
    )) return false;
  const coordinates = value.normalized_count + value.omissions.length;
  const accounted = coordinates + value.duplicate_count;
  // In a safe ledger, the first occurrence is delivered or recorded as a dated omission.
  const complete = accounted === value.raw_count && (value.duplicate_count === 0 || coordinates > 0);
  return Number.isSafeInteger(accounted) && accounted <= value.raw_count && (allowUnaccounted || complete)
    && new Set(value.omissions.map(([, date]) => date)).size === value.omissions.length;
}

function parseDailyPriceReceipt(value: unknown): DailyPriceReceipt | undefined {
  if (!exact(value, receiptKeys) || value.version !== 1 || value.kind !== 'daily-price' || !utcTimestamp(value.retrieved_at)
    || !countKeys.every(key => count(value[key]))
    || value.interval !== '1d' || !isoDate(value.start_date) || !isoDate(value.end_date) || value.start_date > value.end_date
    || value.date_field !== 'date' || value.price_field !== 'adjusted_close'
    || !array(value.symbols) || !value.symbols.length || value.symbols.length > 12 || !value.symbols.every(usListing)
    || new Set(value.symbols).size !== value.symbols.length || value.symbol_field !== (value.symbols.length > 1 ? 'symbol' : null)
    || !array(value.listings) || value.listings.length !== value.symbols.length
    || !exact(value.unsafe, unsafeKeys)
    || !array(value.diagnostics)) return;
  const { start_date: start, end_date: end, symbols, unsafe, diagnostics, listings } = value;
  if (!unsafeKeys.every(key => typeof unsafe[key] === 'boolean')) return;
  const declared = unsafeKeys.filter(key => unsafe[key] === true);
  if (declared.length !== diagnostics.length || declared.some((key, i) => key !== diagnostics[i])) return;
  // A flagged provider receipt may report losses it could not assign a coordinate.
  // The safe ledger must account for every raw row before the source is admitted.
  const allowUnaccounted = declared.some(key => key !== 'missing_adjusted_basis');
  if (!listings.every((facts, i): facts is DailyPriceListingFacts => listingFacts(facts, symbols[i], start, end, allowUnaccounted))) return;
  if (!countKeys.every(key => listings.reduce((total, facts) => total + facts[key], 0) === value[key])) return;
  return value as DailyPriceReceipt;
}

const symbolAliases = ['symbol', 'ticker', 'code', '_symbol'];
const exchangeAliases = ['exchange', 'exchange_code'];
const partialKeys = new Set(['partial', 'ispartial', 'truncated', 'incomplete', 'paging', 'pagination',
  'hasmore', 'next', 'nextpage', 'cursor', 'nextcursor', 'offset', 'page', 'pagesize', 'totalpages']);
const partialMarker = (name: string) => partialKeys.has(name.toLowerCase().replaceAll('_', ''));

// Python str.strip() accepts these characters, excluding U+FEFF.
// eslint-disable-next-line no-control-regex -- Match the provider's symbol qualification.
const pythonWhitespace = /^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu;
const normalizedTicker = (value: string) => value.replace(pythonWhitespace, '').toUpperCase();

const declarationNames = [...symbolAliases, ...exchangeAliases, 'interval', 'period', 'currency', 'unit'];
type Denominations = Map<string, Map<string, string>>;

function declarationsAgree(symbol: string, entries: Iterable<[string, unknown]>, denominations: Denominations): boolean {
  for (const [key, value] of entries) {
    if (partialMarker(key)) return false;
    if (value == null) continue;
    const name = key.toLowerCase();
    if (symbolAliases.includes(name) || exchangeAliases.includes(name)) {
      if (typeof value !== 'string') return false;
      const normalized = normalizedTicker(value);
      if (symbolAliases.includes(name) ? normalized !== symbol && normalized !== symbol.slice(0, -3) : normalized !== 'US') return false;
    }
    if (name === 'interval' && value !== '1d' || name === 'period' && value !== 'd') return false;
    if (name !== 'currency' && name !== 'unit') continue;
    if (typeof value !== 'string' || !value.trim()) return false;
    const listing = denominations.get(symbol) ?? new Map<string, string>();
    if (listing.has(name) && listing.get(name) !== value) return false;
    listing.set(name, value);
    denominations.set(symbol, listing);
  }
  return true;
}

function readObservation(receipt: DailyPriceReceipt, read: (origin: string) => unknown): PriceCoordinate | undefined {
  const symbol = receipt.symbol_field ? read(receipt.symbol_field) : receipt.symbols[0];
  const date = read(receipt.date_field);
  const price = read(receipt.price_field);
  if (typeof symbol !== 'string' || !receipt.symbols.includes(symbol) || !inWindow(date, receipt.start_date, receipt.end_date)
    || typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return;
  return [symbol, date];
}

function deliveredCoordinatesAgree(receipt: DailyPriceReceipt, value: unknown): value is PriceCoordinate[] {
  if (!array(value) || value.length !== receipt.delivered_count) return false;
  const remaining = new Map(receipt.listings.map(listing => [listing.symbol, listing.delivered_count]));
  const forbidden = new Set(receipt.listings.flatMap(listing => listing.omissions.map(coordinateId)));
  for (const point of value) {
    if (!coordinate(point, receipt.start_date, receipt.end_date)) return false;
    const amount = remaining.get(point[0]);
    const id = coordinateId(point);
    if (!amount || forbidden.has(id)) return false;
    remaining.set(point[0], amount - 1);
    forbidden.add(id);
  }
  return true;
}

function rowCoordinates(receipt: DailyPriceReceipt, rows: readonly Record<string, unknown>[]): PriceCoordinate[] | undefined {
  if (receipt.diagnostics.length || rows.length !== receipt.delivered_count) return;
  const points: PriceCoordinate[] = [];
  const denominations: Denominations = new Map();
  for (const row of rows) {
    if (!record(row)) return;
    const point = readObservation(receipt, key => Object.hasOwn(row, key) ? row[key] : undefined);
    if (!point || !declarationsAgree(point[0], Object.entries(row), denominations)) return;
    points.push(point);
  }
  if (deliveredCoordinatesAgree(receipt, points)) return points;
}

/** Record the delivered coordinates only after the backend acquisition has been checked. */
export function acquiredDailyPriceCoordinates(value: unknown, rows: readonly Record<string, unknown>[]): PriceCoordinate[] | undefined {
  const receipt = parseDailyPriceReceipt(value);
  return receipt && rowCoordinates(receipt, rows);
}

function capturedCoordinates(receipt: DailyPriceReceipt, provenance: DatasetProvenance) {
  if (provenance.sourceKind !== 'backend' || receipt.diagnostics.length || !record(provenance.metadata)) return;
  const points = provenance.metadata.dailyPriceCoordinates;
  if (deliveredCoordinatesAgree(receipt, points)) return points;
}

function acquiredFields(receipt: DailyPriceReceipt, columns: readonly DatasetColumn[]) {
  const fields = new Map<string, string>();
  for (const column of columns) {
    const origin = acquiredColumnOrigin(column);
    if (!origin || (origin !== receipt.date_field && origin !== receipt.price_field
      && !declarationNames.includes(origin.toLowerCase()) && !partialMarker(origin))) continue;
    if (fields.has(origin)) return;
    fields.set(origin, column.id);
  }
  if (new Set(fields.values()).size !== fields.size || (receipt.delivered_count > 0
    && (!fields.has(receipt.date_field) || !fields.has(receipt.price_field) || (receipt.symbol_field && !fields.has(receipt.symbol_field))))) return;
  return fields;
}

function presentedRowsAgree(receipt: DailyPriceReceipt, { columns, rows }: Pick<WidgetDataset, 'columns' | 'rows'>,
  provenance: DatasetProvenance, omitted: readonly string[]): boolean {
  const acquired = capturedCoordinates(receipt, provenance);
  if (!acquired || rows.length !== acquired.length - omitted.length) return false;

  const fields = acquiredFields(receipt, columns);
  if (!fields) return false;

  const remaining = new Set(acquired.map(coordinateId));
  for (const id of omitted) remaining.delete(id);
  const denominations: Denominations = new Map();
  const declarations = [...fields.keys()].filter(origin => declarationNames.includes(origin.toLowerCase()) || partialMarker(origin));
  for (const row of rows) {
    if (row.groupPath !== undefined || !record(row.values)) return false;
    const read = (origin: string) => {
      const field = fields.get(origin);
      if (field === undefined || !Object.hasOwn(row.values, field)) return undefined;
      return row.cellErrors?.[field] ? false : row.values[field];
    };
    const point = readObservation(receipt, read);
    if (!point || !remaining.delete(coordinateId(point))
      || !declarationsAgree(point[0], declarations.map(key => [key, read(key)]), denominations)) return false;
  }
  return remaining.size === 0;
}

const parameters = ['provider', 'symbol', 'exchange', 'start_date', 'end_date', 'interval'] as const;
function matchesRequest(receipt: DailyPriceReceipt, query: Readonly<Record<string, string>>, defaultProvider?: 'eodhd') {
  if ((query.provider ?? defaultProvider) !== 'eodhd' || (query.interval ?? '1d') !== receipt.interval
    || query.start_date !== receipt.start_date || query.end_date !== receipt.end_date || typeof query.symbol !== 'string') return false;
  const exchange = (query.exchange ?? 'US').toUpperCase();
  const symbols = query.symbol.split(',').map(normalizedTicker).filter(Boolean)
    .map(symbol => symbol.includes('.') ? symbol : `${symbol}.${exchange}`);
  return symbols.length === receipt.symbols.length && symbols.every((symbol, i) => symbol === receipt.symbols[i]);
}

function routes(endpoints: string[], defaultProvider?: 'eodhd'): ChartSourceAdapter<DailyPriceReceipt>['routes'] {
  return endpoints.map(endpoint => ({
    endpoint, selector: 'results', parameters,
    matches: (receipt, query) => matchesRequest(receipt, query, defaultProvider),
  }));
}

export const dailyPriceSourceAdapter: ChartSourceAdapter<DailyPriceReceipt> = {
  kind: 'daily-price',
  decode: parseDailyPriceReceipt,
  allowsLocal: () => false,
  responseAgrees(_receipt, response) {
    if (!record(response) || response.provider !== 'eodhd' || !record(response.extra)) return false;
    const metadata = response.extra.results_metadata;
    return record(metadata) && [response, response.extra, metadata].every(envelope =>
      !Object.keys(envelope).some(partialMarker)
      && (envelope.completeness === undefined || envelope.completeness === 'unknown'));
  },
  rowsAgree: (receipt, rows, scope) => (scope === undefined || scope === 'unknown') && !!rowCoordinates(receipt, rows),
  routes: [
    ...routes(['/api/v1/equity/price/historical', '/api/v1/etf/historical']),
    ...routes(['/api/v1/eodhd/equity/price/historical', '/api/v1/eodhd/etf/historical'], 'eodhd'),
  ],
  acquiredInputAgrees: presentedRowsAgree,
  coordinates(receipt, provenance) {
    const points = capturedCoordinates(receipt, provenance);
    return points && [{
      fields: receipt.symbol_field ? [receipt.symbol_field, receipt.date_field] : [receipt.date_field],
      points: points.map(point => ({ id: coordinateId(point), values: receipt.symbol_field ? point : [point[1]] })),
    }];
  },
};

export function readLiveDailyPriceSource(dataset: WidgetDataset): {
  receipt: DailyPriceReceipt; scope: PriceScope; symbols: string[]; rawOmissions: PriceCoordinate[]; tableOmissions: PriceCoordinate[];
} | undefined {
  const { provenance, completeness } = dataset;
  if (provenance.sourceKind !== 'backend' || provenance.metadata?.dailyPriceRejected === true
    || provenance.inputMayContainAggregates || completeness.kind !== 'unknown') return;
  const receipt = readChartSource(provenance, 'daily-price', parseDailyPriceReceipt);
  const projection = readChartSourceProjection(provenance, 'daily-price');
  if (!receipt || !projection || receipt.delivered_count !== completeness.acquiredRowCount) return;
  if (!presentedRowsAgree(receipt, dataset, provenance, projection.omitted)) return;
  return {
    receipt, scope: { start: receipt.start_date, end: receipt.end_date, interval: receipt.interval },
    symbols: [...receipt.symbols],
    tableOmissions: projection.omitted.map((id): PriceCoordinate => JSON.parse(id)),
    rawOmissions: receipt.listings.flatMap(listing => listing.omissions.map(([symbol, date]): PriceCoordinate => [symbol, date])),
  };
}
