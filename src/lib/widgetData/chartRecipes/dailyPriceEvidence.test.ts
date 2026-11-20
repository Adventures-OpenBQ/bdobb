// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest';
import { backend, widget } from '../../../test/fixtures';
import { startMockServer } from '../../../test/mockServer';
import {
  dailyPriceParameters, dailyPricePaths, dailyPriceReceipt, dailyPriceResponse, dailyPriceRows,
} from '../../../test/fixtures/chartSources';
import { fetchWidgetData } from '../../dataClient';
import { datasetFromBytes, datasetFromRows } from '../../localTableData';
import {
  captureChartSources, chartRequestContext, projectChartSources, readChartSourceProjection, validatedChartProvenance,
} from './chartSourceContracts';
import { readLiveDailyPriceSource } from './dailyPriceEvidence';
import type { BackendAcquisition } from './financialEvidence';

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args),
}));

const context = (endpoint = dailyPricePaths[0], parameters: Record<string, string> = dailyPriceParameters): BackendAcquisition =>
  ({ endpoint, parameters, selector: 'results', retrievedAt: 1 });
const url = (endpoint: string, parameters = dailyPriceParameters) =>
  new URL(`https://example.com${endpoint}?${new URLSearchParams(parameters)}`);
const capture = (receipt: unknown, rows: Record<string, unknown>[] = dailyPriceRows, request = context()) =>
  captureChartSources(request, dailyPriceResponse(receipt, rows), rows);

it('test_completed_request_and_selected_rows_required', () => {
  const response = dailyPriceResponse();
  for (const path of dailyPricePaths) {
    const request = chartRequestContext(url(path), 'results', 1);
    expect(request).toEqual(context(path));
    expect(captureChartSources(request!, response, response.results)).toEqual({ 'daily-price': dailyPriceReceipt });
  }
  expect(captureChartSources(context(), response, [...response.results])).toBeUndefined();
  expect(captureChartSources(context(), { ...response, provider: 'yfinance' }, response.results)).toBeUndefined();
  expect(captureChartSources(context(), { ...response, extra: {} }, response.results)).toBeUndefined();
  expect(captureChartSources(context(), { ...response, completeness: 'partial' }, response.results)).toBeUndefined();
  expect(captureChartSources({ ...context(), selector: 'extra.results' },
    { ...response, extra: { ...response.extra, results: response.results } }, response.results)).toBeUndefined();
  expect(capture(dailyPriceReceipt, dailyPriceRows, context('/api/v1/eodhd/crypto/price/historical'))).toBeUndefined();
});

it('requires the effective ordered provider selection and an explicit date window', () => {
  const { provider: _provider, ...defaultProvider } = dailyPriceParameters;
  const { start_date: _start, ...noStart } = dailyPriceParameters;
  const { end_date: _end, ...noEnd } = dailyPriceParameters;
  const { chart_source: _optIn, ...plain } = dailyPriceParameters;
  for (const parameters of [
    defaultProvider, noStart, noEnd, plain,
    { ...dailyPriceParameters, provider: 'yfinance' },
    { ...dailyPriceParameters, interval: '1W' },
    { ...dailyPriceParameters, start_date: '2026-10-13' },
    { ...dailyPriceParameters, end_date: '2026-11-18' },
    { ...dailyPriceParameters, chart_source: 'false' },
    { ...dailyPriceParameters, symbol: 'AAPL.US,MCD.US' },
    { ...dailyPriceParameters, symbol: 'MCD.US,AAPL.US,AAPL.US' },
    { ...dailyPriceParameters, symbol: 'MCD.US' },
    { ...dailyPriceParameters, symbol: 'MCD,AAPL', exchange: 'TO' },
    { ...dailyPriceParameters, adjustment: 'unadjusted' },
  ]) expect(capture(dailyPriceReceipt, dailyPriceRows, context(dailyPricePaths[0], parameters))).toBeUndefined();

  const { interval: _interval, ...defaultDaily } = defaultProvider;
  expect(capture(dailyPriceReceipt, dailyPriceRows, context(dailyPricePaths[2], {
    ...defaultDaily, symbol: ' mcd ,, aapl ', exchange: 'us',
  }))).toEqual({ 'daily-price': dailyPriceReceipt });
  expect(capture(dailyPriceReceipt, dailyPriceRows, context(dailyPricePaths[0], {
    ...dailyPriceParameters, exchange: 'TO',
  }))).toEqual({ 'daily-price': dailyPriceReceipt });
});

it('retains the provider’s qualified symbol syntax', () => {
  const symbol = 'A_B/C-D.A_.US';
  const receipt = { ...dailyPriceReceipt, symbols: ['MCD.US', symbol], listings: [
    dailyPriceReceipt.listings[0], { ...dailyPriceReceipt.listings[1], symbol, omissions: [[symbol, '2026-10-14']] },
  ] };
  const rows = [{ ...dailyPriceRows[0], symbol }, dailyPriceRows[1]];
  expect(capture(receipt, rows, context(dailyPricePaths[0], {
    ...dailyPriceParameters, symbol: 'mcd.us, a_b/c-d.a_.us ',
  }))).toEqual({ 'daily-price': receipt });
});

it.each(['symbol=AAPL.US', 'SYMBOL=MCD.US%2CAAPL.US', 'Chart_Source=true', 'limit=2', 'Price_field=close'])(
  'refuses ambiguous or unknown query key %s', (query) => {
    const request = url(dailyPricePaths[0]);
    request.search += '&' + query;
    expect(chartRequestContext(request, 'results', 1)).toBeUndefined();
  },
);

it('rejects a credential key that differs in case from a source parameter', () => {
  const request = url(dailyPricePaths[0]);
  request.searchParams.set('SYMBOL', 'token');
  expect(chartRequestContext(request, 'results', 1, 'SYMBOL')).toBeUndefined();
});

it('refuses a contradictory listing ledger and preserves exact duplicate accounting', () => {
  const [first, second] = dailyPriceReceipt.listings;
  for (const forged of [
    { ...dailyPriceReceipt, raw_count: 5 },
    { ...dailyPriceReceipt, normalized_count: 3 },
    { ...dailyPriceReceipt, delivered_count: 1 },
    { ...dailyPriceReceipt, start_date: '2026-02-30' },
    { ...dailyPriceReceipt, end_date: '2026-11-19\n' },
    { ...dailyPriceReceipt, date_field: 'trading_date' },
    { ...dailyPriceReceipt, price_field: 'close' },
    { ...dailyPriceReceipt, symbol_field: null },
    { ...dailyPriceReceipt, listings: [second, first] },
    { ...dailyPriceReceipt, listings: [{ ...first, raw_count: 3 }, { ...second, raw_count: 1 }] },
    { ...dailyPriceReceipt, listings: [{ ...first, omissions: [['MCD.US', '2026-11-20']] }, second] },
    { ...dailyPriceReceipt, listings: [{ ...first, omissions: [['AAPL.US', '2026-10-14']] }, second] },
    { ...dailyPriceReceipt, listings: [{ ...first, omissions: [['MCD.US', '2026-10-13']] }, second] },
    { ...dailyPriceReceipt, listings: [{ ...first, duplicate_count: 1 }, second] },
    { ...dailyPriceReceipt, listings: [{ ...first, adjusted_close: 104 }, second] },
    { ...dailyPriceReceipt, series: dailyPriceRows },
    { ...dailyPriceReceipt, unsafe: { ...dailyPriceReceipt.unsafe, other: false } },
    { ...dailyPriceReceipt, unsafe: { ...dailyPriceReceipt.unsafe, partial_acquisition: 'false' } },
    { ...dailyPriceReceipt, diagnostics: ['arbitrary'] },
  ]) expect(capture(forged)).toBeUndefined();
  const withDuplicate = { ...dailyPriceReceipt, raw_count: 5,
    listings: [{ ...first, raw_count: 3, duplicate_count: 1 }, second] };
  expect(capture(withDuplicate)).toEqual({ 'daily-price': withDuplicate });
});

it.each([
  { date: '2026-10-13T00:00:00Z' }, { date: '2026-11-20' }, { symbol: 'MSFT.US' },
  { adjusted_close: '104' }, { adjusted_close: null }, { adjusted_close: 0 },
  { ticker: 'MCD.US' }, { code: 'AAPL.TO' }, { _symbol: 'AAPL.LSE' }, { exchange_code: 'TO' },
])('refuses row facts inconsistent with the original receipt: %j', change => {
  expect(capture(dailyPriceReceipt, [{ ...dailyPriceRows[0], ...change }, dailyPriceRows[1]])).toBeUndefined();
});

const makeDataset = (receipt: unknown = dailyPriceReceipt, rows: Record<string, unknown>[] = dailyPriceRows,
  request = context(), sourceKind = 'backend') => datasetFromRows(structuredClone(rows),
  'source', 1, sourceKind, undefined, [], undefined, { ...request, chartSources: capture(receipt, rows, request) });

const expectedLiveSource = {
  receipt: dailyPriceReceipt, scope: { interval: '1d', start: '2026-10-12', end: '2026-11-19' },
  symbols: ['MCD.US', 'AAPL.US'], rawOmissions: [['MCD.US', '2026-10-14'], ['AAPL.US', '2026-10-14']],
};

it('carries the completed HTTP acquisition into the table and keeps ordinary rows available', async () => {
  const endpoint = dailyPricePaths[2];
  const server = await startMockServer({ [endpoint]: () => dailyPriceResponse() });
  const load = async (parameters: Record<string, string>, dataKey = 'results') => {
    let acquisition: BackendAcquisition | undefined;
    const selected = await fetchWidgetData(backend({ baseUrl: server.url }), widget({ type: 'table', endpoint, dataKey }),
      parameters, undefined, undefined, undefined, result => { acquisition = result; });
    return { selected, acquisition };
  };
  const dataset = ({ selected, acquisition }: Awaited<ReturnType<typeof load>>) => {
    expect(Array.isArray(selected)).toBe(true);
    return datasetFromRows(selected as Record<string, unknown>[], 'source', 1, 'backend', undefined, [], undefined, acquisition);
  };
  try {
    const { chart_source: _optIn, ...plain } = dailyPriceParameters;
    const live = dataset(await load(dailyPriceParameters));
    expect(live.completeness).toEqual({ kind: 'unknown', acquiredRowCount: 2, warnings: [] });
    expect(readLiveDailyPriceSource(structuredClone(live))).toEqual(expectedLiveSource);
    const ordinary = dataset(await load(plain));
    expect(ordinary.rows.map(row => row.values)).toEqual(dailyPriceRows);
    expect(ordinary.completeness.kind).toBe('unknown');
    expect(readLiveDailyPriceSource(ordinary)).toBeUndefined();
    expect((await load(dailyPriceParameters, 'other')).acquisition?.chartSources).toBeUndefined();
  } finally { await server.close(); }
});

it('test_live_authority_cannot_be_imported_or_filtered_clean', async () => {
  const valid = makeDataset();
  expect(readLiveDailyPriceSource(valid)).toEqual(expectedLiveSource);
  const forgedLocal = { ...valid.provenance, sourceKind: 'localFile' };
  expect(readLiveDailyPriceSource({ ...valid, provenance: forgedLocal })).toBeUndefined();
  expect(validatedChartProvenance(forgedLocal).metadata).toEqual({});

  const envelope = { version: 1, receipts: [dailyPriceReceipt] };
  const file = (input: unknown) => datasetFromBytes('quotes.json',
    new TextEncoder().encode(JSON.stringify(input)), 'source', 1);
  await expect(file({ rows: dailyPriceRows, completeness: 'unknown', chart_sources: envelope }))
    .rejects.toThrow('Could not parse local table');
  expect(readLiveDailyPriceSource(await file(dailyPriceRows))).toBeUndefined();
  expect(readLiveDailyPriceSource({ ...valid, provenance: {
    ...valid.provenance, metadata: { chartSources: { 'daily-price': dailyPriceReceipt } },
  } })).toBeUndefined();

  for (const unsafe of Object.keys(dailyPriceReceipt.unsafe)) {
    const acquired = makeDataset({ ...dailyPriceReceipt,
      diagnostics: [unsafe], unsafe: { ...dailyPriceReceipt.unsafe, [unsafe]: true },
    });
    expect(acquired.rows).toHaveLength(2);
    expect(acquired.completeness.kind).toBe('unknown');
    expect(readLiveDailyPriceSource(acquired)).toBeUndefined();
    const rows = acquired.rows.slice(0, 1);
    const provenance = projectChartSources(acquired.provenance, acquired.columns, rows);
    expect(readLiveDailyPriceSource({ ...acquired, rows, provenance })).toBeUndefined();
  }
});

it('reconciles original columns and the exact presented coordinates after an alias and filter', () => {
  const full = makeDataset();
  const columns = [
    { id: 'listing', label: 'Listing', sourceFieldId: 'symbol' },
    { id: 'day', label: 'Day', sourceFieldId: 'date' },
    { id: 'price', label: 'Price', sourceFieldId: 'adjusted_close' },
  ];
  const [aapl, mcd] = full.rows;
  const rows = [{ ...mcd, values: { day: mcd.values.date, price: mcd.values.adjusted_close, listing: mcd.values.symbol } }];
  const provenance = projectChartSources(full.provenance, columns, rows);
  const projected = { ...full, rows, columns, provenance };
  expect(readLiveDailyPriceSource(projected)).toEqual(expectedLiveSource);
  expect(readChartSourceProjection(provenance, 'daily-price')).toEqual({
    filtered: false, omitted: ['["AAPL.US","2026-10-13"]'],
  });
  expect(provenance.metadata).not.toHaveProperty('priceOmissions');
  expect(readLiveDailyPriceSource({ ...projected, provenance: full.provenance })).toBeUndefined();
  expect(readLiveDailyPriceSource({ ...projected, columns: [
    ...columns.slice(0, 2), { id: 'price', label: 'adjusted_close', sourceFieldId: 'close' },
  ] })).toBeUndefined();
  expect(readLiveDailyPriceSource({ ...projected, columns: [
    ...columns, { id: 'another', label: 'Another', sourceFieldId: 'adjusted_close' },
  ] })).toBeUndefined();
  expect(readLiveDailyPriceSource({ ...projected, columns: [
    ...columns.slice(0, 2), { ...columns[2], aggregation: 'sum' },
  ] })).toBeUndefined();
  expect(readLiveDailyPriceSource({ ...projected, rows: [
    { ...rows[0], values: { ...rows[0].values, day: '2026-10-15' } },
  ] })).toBeUndefined();
  expect(readLiveDailyPriceSource({ ...full, rows: [mcd, aapl] })).toEqual(expectedLiveSource);
});

it('validates the delivered coordinate supplement without letting it supply numeric prices', () => {
  const full = makeDataset();
  const metadata = full.provenance.metadata;
  expect(metadata?.dailyPriceCoordinates).toEqual([['AAPL.US', '2026-10-13'], ['MCD.US', '2026-10-13']]);
  for (const dailyPriceCoordinates of [
    [['AAPL.US', '2026-10-13'], ['AAPL.US', '2026-10-13']],
    [['AAPL.US', '2026-10-14'], ['MCD.US', '2026-10-13']],
    [['AAPL.US', '2026-10-13', 104], ['MCD.US', '2026-10-13']],
    [['MSFT.US', '2026-10-13'], ['MCD.US', '2026-10-13']],
    [['AAPL.US', '2026-10-13']],
  ]) {
    const provenance = { ...full.provenance, metadata: { ...metadata, dailyPriceCoordinates } };
    expect(readLiveDailyPriceSource({ ...full, provenance })).toBeUndefined();
    expect(validatedChartProvenance(provenance).metadata).not.toHaveProperty('dailyPriceCoordinates');
  }
});

it('admits single-listing rows without a symbol field, including a counted empty acquisition', () => {
  const listing = dailyPriceReceipt.listings[1];
  const single = { ...dailyPriceReceipt, raw_count: 2, normalized_count: 1, delivered_count: 1,
    symbols: ['AAPL.US'], symbol_field: null, listings: [listing] };
  const request = context(dailyPricePaths[2], { ...dailyPriceParameters, symbol: 'AAPL.US' });
  const { symbol: _symbol, ...row } = dailyPriceRows[0];
  expect(readLiveDailyPriceSource(makeDataset(single, [row], request))).toMatchObject({
    receipt: single, symbols: ['AAPL.US'], rawOmissions: [['AAPL.US', '2026-10-14']],
  });
  const empty = { ...single, raw_count: 0, normalized_count: 0, delivered_count: 0,
    listings: [{ ...listing, raw_count: 0, normalized_count: 0, delivered_count: 0, omissions: [] }] };
  expect(readLiveDailyPriceSource(makeDataset(empty, [], request))).toMatchObject({
    receipt: empty, symbols: ['AAPL.US'], rawOmissions: [],
  });
});
