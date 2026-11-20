// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { asRecord } from '../../isRecord';
import type { ChartSourceAdapter, ChartSourceReceipt } from './chartSourceContracts';
import { isoDate, qualifiedSymbol, utcTimestamp } from './financialEvidence';

const unsafeNames = ['invalid_identity', 'invalid_timestamp', 'duplicate_conflict', 'unit_conflict'] as const;
const diagnosticNames = [...unsafeNames, 'exact_duplicate', 'missing_title', 'unscored'] as const;
const scopeKinds = ['complete', 'bounded', 'partial', 'sample', 'unknown'] as const;
const origins = { timestamp: 'date', articleId: 'url', instrument: 'symbols', polarity: 'polarity' } as const;
type NewsDiagnostic = typeof diagnosticNames[number];
type NewsScope = {
  kind: typeof scopeKinds[number];
  start: string | null;
  end: string | null;
  limit: number | null;
  offset: number | null;
};
type NewsCoordinate = { article_id: string; utc_day: string; scored: boolean };

export type NewsSource = ChartSourceReceipt & {
  kind: 'news';
  diagnostics: NewsDiagnostic[];
  unsafe: Record<typeof unsafeNames[number], boolean>;
  instrument: string;
  polarity_unit: 'polarity[-1,1]';
  field_origins: typeof origins;
  scope: NewsScope;
  coordinates: NewsCoordinate[];
};

function closed<const K extends string>(value: unknown, keys: readonly K[]): value is Record<K, unknown> {
  const record = asRecord(value);
  return !!record && [null, Object.prototype].includes(Object.getPrototypeOf(record))
    && Reflect.ownKeys(record).length === keys.length
    && keys.every(key => {
      const field = Object.getOwnPropertyDescriptor(record, key);
      return field?.enumerable && 'value' in field;
    });
}

function denseList<T>(value: unknown, check: (item: unknown) => item is T): value is T[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let i = 0; i < value.length; i++) {
    const item = Object.getOwnPropertyDescriptor(value, i);
    if (!item?.enumerable || !('value' in item) || !check(item.value)) return false;
  }
  return true;
}

const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const diagnostic = (value: unknown): value is NewsDiagnostic => diagnosticNames.some(name => name === value);
// eslint-disable-next-line no-control-regex -- Reject characters the URL parser would silently discard.
const unsafeUrlCharacter = /[\s\x00-\x1f\x7f\\]/;
const articleUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 4096 || unsafeUrlCharacter.test(value)
    || !/^https?:\/\/(?:[a-z0-9.-]+|\[[0-9a-f:]+\])(?::[0-9]+)?(?:[/?#]|$)/i.test(value)) return false;
  try { return new URL(value).hostname !== ''; }
  catch { return false; }
};

export function newsUtcDay(value: unknown): string | undefined {
  if (typeof value !== 'string' || !isoDate(value.slice(0, 10))
    || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return;
  const day = new Date(time).toISOString().slice(0, 10);
  return isoDate(day) ? day : undefined;
}

export function newsInstrumentMatches(value: unknown, instrument: string): boolean {
  if (typeof value !== 'string') return false;
  const symbols = value.split(',');
  return symbols.includes(instrument) && symbols.every(qualifiedSymbol);
}

export function isNewsPolarity(value: unknown): value is number {
  return typeof value === 'number' && value >= -1 && value <= 1;
}

function scopeAgrees(value: unknown): value is NewsScope {
  if (!closed(value, ['kind', 'start', 'end', 'limit', 'offset']) || !scopeKinds.some(kind => kind === value.kind)
    || (value.start !== null && !isoDate(value.start)) || (value.end !== null && !isoDate(value.end))
    || (value.start && value.end && value.start > value.end)) return false;
  if ((value.kind === 'complete' || value.kind === 'bounded') && (!value.start || !value.end || value.limit !== null)) return false;
  if (value.limit === null) return value.offset === null;
  return count(value.limit) && value.limit >= 1 && value.limit <= 1000 && count(value.offset) && value.offset + value.limit <= 10000;
}
const inScope = (day: string, scope: NewsScope) => (!scope.start || day >= scope.start) && (!scope.end || day <= scope.end);

const newsCoordinate = (value: unknown): value is NewsCoordinate =>
  closed(value, ['article_id', 'utc_day', 'scored']) && articleUrl(value.article_id)
    && isoDate(value.utc_day) && typeof value.scored === 'boolean';

export function parseNewsSource(value: unknown): NewsSource | undefined {
  if (!closed(value, ['version', 'kind', 'retrieved_at', 'raw_count', 'normalized_count', 'delivered_count', 'diagnostics',
    'unsafe', 'instrument', 'polarity_unit', 'field_origins', 'scope', 'coordinates'])
    || value.version !== 1 || value.kind !== 'news' || !utcTimestamp(value.retrieved_at)
    || !count(value.raw_count) || !count(value.normalized_count) || !count(value.delivered_count)
    || value.normalized_count > value.raw_count || value.delivered_count > value.normalized_count
    || !denseList(value.diagnostics, diagnostic) || new Set(value.diagnostics).size !== value.diagnostics.length
    || !closed(value.unsafe, unsafeNames) || !qualifiedSymbol(value.instrument) || value.polarity_unit !== 'polarity[-1,1]'
    || !closed(value.field_origins, ['timestamp', 'articleId', 'instrument', 'polarity'])
    || value.field_origins.timestamp !== origins.timestamp || value.field_origins.articleId !== origins.articleId
    || value.field_origins.instrument !== origins.instrument || value.field_origins.polarity !== origins.polarity
    || !scopeAgrees(value.scope) || !denseList(value.coordinates, newsCoordinate)) return;
  const { unsafe, diagnostics, scope, coordinates, raw_count, normalized_count, delivered_count } = value;
  if (unsafeNames.some(key => unsafe[key] !== diagnostics.includes(key))
    || (scope.limit !== null && raw_count > scope.limit) || delivered_count !== coordinates.length
    || ((scope.kind === 'complete' || scope.kind === 'bounded') && normalized_count !== delivered_count)
    || new Set(coordinates.map(coordinate => coordinate.article_id)).size !== delivered_count
    || coordinates.some(coordinate => !inScope(coordinate.utc_day, scope))
    || diagnostics.includes('unscored') !== coordinates.some(coordinate => !coordinate.scored)) return;
  const dropped = diagnostics.some(d => d !== 'unscored' && d !== 'unit_conflict');
  if (dropped !== (raw_count > normalized_count)) return;
  return value as NewsSource;
}

function rowsAgree(receipt: NewsSource, rows: readonly Record<string, unknown>[], scope: unknown) {
  if (scope !== undefined && scope !== 'unknown' && scope !== receipt.scope.kind
    && !(scope === 'paged' && receipt.scope.kind === 'sample' && receipt.scope.limit !== null)) return false;
  if (rows.length !== receipt.coordinates.length) return false;
  const expected = new Map(receipt.coordinates.map(coordinate => [coordinate.article_id, coordinate]));
  for (const row of rows) {
    if (typeof row.url !== 'string') return false;
    const coordinate = expected.get(row.url);
    if (!coordinate || newsUtcDay(row.date) !== coordinate.utc_day || !newsInstrumentMatches(row.symbols, receipt.instrument)
      || (coordinate.scored ? !isNewsPolarity(row.polarity) : row.polarity !== null)) return false;
    expected.delete(row.url);
  }
  return true;
}

const parameters = ['provider', 'symbol', 'exchange', 'start_date', 'end_date', 'limit', 'offset'] as const;
function matchesRequest(receipt: NewsSource, params: Readonly<Record<string, string>>, defaultProvider?: 'eodhd') {
  if ((params.provider ?? defaultProvider) !== 'eodhd' || receipt.scope.kind !== 'sample'
    || receipt.normalized_count !== receipt.delivered_count) return false;
  const symbol = params.symbol?.trim().toUpperCase();
  const instrument = symbol && (symbol.includes('.') ? symbol : symbol + '.' + (params.exchange ?? 'US').toUpperCase());
  const limit = params.limit ?? '50';
  const offset = params.offset ?? '0';
  return instrument === receipt.instrument && (params.start_date ?? null) === receipt.scope.start
    && (params.end_date ?? null) === receipt.scope.end && /^\d+$/.test(limit) && /^\d+$/.test(offset)
    && Number(limit) === receipt.scope.limit && Number(offset) === receipt.scope.offset;
}

export const newsSourceAdapter: ChartSourceAdapter<NewsSource> = {
  kind: 'news',
  decode: parseNewsSource,
  rowsAgree,
  routes: [
    { endpoint: '/api/v1/news/company', selector: 'results', parameters,
      matches: (receipt, params) => matchesRequest(receipt, params) },
    { endpoint: '/api/v1/eodhd/news/company', selector: 'results', parameters,
      matches: (receipt, params) => matchesRequest(receipt, params, 'eodhd') },
  ],
  coordinates: receipt => [{
    fields: [origins.articleId],
    points: receipt.coordinates.map(({ article_id }) => ({ id: article_id, values: [article_id] })),
  }],
};
