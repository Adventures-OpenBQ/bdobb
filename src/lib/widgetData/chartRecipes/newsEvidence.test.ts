// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest';
import { backend, widget } from '../../../test/fixtures';
import { startMockServer } from '../../../test/mockServer';
import { newsEnvelope, newsReceipt, newsResponse, newsRows, newsSnapshot } from '../../../test/fixtures/newsEvidence';
import { fetchWidgetData } from '../../dataClient';
import type { BackendAcquisition } from './financialEvidence';
import { datasetFromBytes, datasetFromRows, parseTableSnapshot } from '../../localTableData';
import { captureChartSources, chartRequestContext, readChartSource } from './chartSourceContracts';
import { parseNewsSource } from './newsEvidence';

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args),
}));

const mirror = '/api/v1/eodhd/news/company';
const standard = '/api/v1/news/company';
const request = { endpoint: mirror, selector: 'results', retrievedAt: 1, parameters: { chart_source: 'true', symbol: 'aapl' } };
const loadSnapshot = (snapshot: unknown) =>
  datasetFromBytes('company-news.json', new TextEncoder().encode(JSON.stringify(snapshot)), 'root', 1);

it('binds the response only to a matching completed CompanyNews request and its complete result array', () => {
  expect(captureChartSources(request, newsResponse, newsRows)).toEqual({ news: newsReceipt });
  expect(captureChartSources({ ...request, endpoint: standard, parameters: { ...request.parameters, provider: 'eodhd' } },
    newsResponse, newsRows)).toEqual({ news: newsReceipt });
  for (const context of [
    { ...request, endpoint: standard },
    { ...request, endpoint: '/api/v1/eodhd/news/world' },
    { ...request, endpoint: '/news/company' },
    { ...request, selector: 'results.rows' },
    ...[
      { chart_source: 'false' }, { symbol: 'AAPL,MSFT' }, { symbol: 'AAPL.LSE' }, { symbol: 'AAPL', exchange: 'LSE' },
      { provider: 'other' }, { limit: '51' }, { offset: '50' }, { start_date: '2024-02-29' },
      { end_date: '2024-03-01' }, { topic: 'TECH' },
    ].map(parameters => ({ ...request, parameters: { ...request.parameters, ...parameters } })),
  ]) expect(captureChartSources(context, newsResponse, newsRows)).toBeUndefined();

  expect(captureChartSources(request, newsResponse, [...newsRows])).toBeUndefined();
  expect(captureChartSources(request, { results: newsRows }, newsRows)).toBeUndefined();
  expect(captureChartSources(request, { ...newsResponse, completeness: 'complete' }, newsRows)).toBeUndefined();
  expect(captureChartSources(request, { ...newsResponse, completeness: 'paged' }, newsRows)).toEqual({ news: newsReceipt });

  const url = (params: string) => new URL('https://example.com' + mirror + '?' + params);
  expect(chartRequestContext(url('symbol=AAPL&chart_source=true&key=hidden'), 'results', 1, 'key'))
    .toEqual({ ...request, parameters: { ...request.parameters, symbol: 'AAPL' } });
  expect(chartRequestContext(url('symbol=AAPL&symbol=AAPL&chart_source=true'), 'results', 1)).toBeUndefined();
  expect(chartRequestContext(url('symbol=AAPL&chart_source=true'), 'results', 1, 'symbol')).toBeUndefined();
});

it('carries the matching HTTP receipt into the backend dataset on initial and subsequent pages', async () => {
  const next = { ...newsReceipt, scope: { ...newsReceipt.scope, offset: 50 } };
  const response = { results: newsRows, extra: { results_metadata: { chart_sources: { version: 1, receipts: [next] } } } };
  const server = await startMockServer({ [mirror]: (url: URL) => {
    if (!url.searchParams.has('chart_source')) return { results: newsRows };
    return url.searchParams.get('offset') === '50' ? response : newsResponse;
  } });
  const get = async (params: Record<string, string>) => {
    let complete: BackendAcquisition | undefined;
    const result = await fetchWidgetData(backend({ baseUrl: server.url }),
      widget({ type: 'table', endpoint: mirror, dataKey: 'results' }), params,
      undefined, undefined, undefined, acquired => { complete = acquired; });
    expect(result).toEqual(newsRows);
    return datasetFromRows(result as Record<string, unknown>[], 'test', 1, 'backend', undefined, [], undefined, complete);
  };
  try {
    const params = { symbol: 'AAPL.US', chart_source: 'true' };
    expect((await get(params)).provenance.metadata?.chartSources).toEqual({ news: newsReceipt });
    expect((await get({ ...params, offset: '50' })).provenance.metadata?.chartSources).toEqual({ news: next });
    expect((await get({ symbol: 'AAPL.US' })).provenance.metadata?.chartSources).toBeUndefined();
  } finally { await server.close(); }
});

it('checks dated page defaults and qualified instrument on the completed request', () => {
  const receipt = { ...newsReceipt, scope: { kind: 'sample', start: '2024-02-29', end: '2024-03-01', limit: 5, offset: 10 } };
  const response = { results: newsRows, extra: { results_metadata: { chart_sources: { version: 1, receipts: [receipt] } } } };
  const context = { ...request, parameters: { chart_source: '1', symbol: ' aapl.us ', exchange: 'LSE',
    start_date: '2024-02-29', end_date: '2024-03-01', limit: '5', offset: '10' } };
  expect(captureChartSources(context, response, newsRows)).toEqual({ news: receipt });
  expect(captureChartSources({ ...context, parameters: { ...context.parameters, offset: '11' } }, response, newsRows)).toBeUndefined();
});

it('uses only the explicit local snapshot boundary and refuses contradictory acquired rows and scope', async () => {
  const local = await loadSnapshot(newsSnapshot);
  expect(local.provenance.metadata?.chartSources).toEqual({ news: newsReceipt });
  expect(local.completeness.kind).toBe('sample');
  expect(parseTableSnapshot(newsSnapshot)).toEqual({ data: newsRows, snapshot: { completeness: 'sample' } });
  expect(datasetFromRows(structuredClone(newsRows), 'legacy', 1, 'backend', undefined, [], undefined, request)
    .provenance.metadata?.chartSources).toBeUndefined();
  expect((await loadSnapshot(newsRows)).provenance.metadata?.chartSources).toBeUndefined();

  const [first, ...rest] = newsRows;
  const { polarity: _polarity, ...absentPolarity } = newsRows[1];
  for (const invalid of [
    { ...newsSnapshot, completeness: 'complete' }, { ...newsSnapshot, rows: rest },
    ...[
      { url: newsRows[1].url }, { url: 'https://example.com/different' },
      { date: '2024-03-01T00:45:00Z' }, { date: '2024-02-30T00:45:00Z' }, { date: '2024-02-29' },
      { polarity: null }, { polarity: '0' }, { polarity: 2 }, { symbols: 'AAPL.LSE,MSFT.US' },
      { symbols: 'aapl.US,MSFT.US' }, { symbols: 'AAPL.US,bare' },
    ].map(change => ({ ...newsSnapshot, rows: [{ ...first, ...change }, ...rest] })),
    { ...newsSnapshot, rows: [first, { ...newsRows[1], polarity: 0 }, newsRows[2]] },
    { ...newsSnapshot, rows: [first, absentPolarity, newsRows[2]] },
  ]) await expect(loadSnapshot(invalid)).rejects.toThrow('Could not parse local table');
});

it('rejects open or inconsistent news receipts even when a read callback permits them', async () => {
  for (const invalid of [
    { ...newsReceipt, score: 5 },
    { ...newsReceipt, polarity_unit: 'probability' },
    { ...newsReceipt, field_origins: { ...newsReceipt.field_origins, polarity: 'sentiment.pos' } },
    { ...newsReceipt, raw_count: 3 },
    { ...newsReceipt, normalized_count: 2 },
    { ...newsReceipt, delivered_count: 2 },
    { ...newsReceipt, normalized_count: 4, raw_count: 51 },
    { ...newsReceipt, coordinates: [newsReceipt.coordinates[0], newsReceipt.coordinates[0], newsReceipt.coordinates[2]] },
    { ...newsReceipt, coordinates: [{ ...newsReceipt.coordinates[0], body: 'hidden' }, ...newsReceipt.coordinates.slice(1)] },
    { ...newsReceipt, coordinates: [{ ...newsReceipt.coordinates[0], article_id: 'https://a:b@example.com/neutral' }, ...newsReceipt.coordinates.slice(1)] },
    { ...newsReceipt, coordinates: [{ ...newsReceipt.coordinates[0], utc_day: '2024-02-30' }, ...newsReceipt.coordinates.slice(1)] },
    { ...newsReceipt, scope: { ...newsReceipt.scope, limit: null } },
    { ...newsReceipt, scope: { ...newsReceipt.scope, start: '2024-03-01', end: '2024-02-29' } },
    { ...newsReceipt, scope: { ...newsReceipt.scope, start: '2024-03-01' } },
    { ...newsReceipt, scope: { kind: 'bounded', start: '2024-02-29', end: '2024-03-01', limit: null, offset: null },
      raw_count: 5, normalized_count: 4 },
    { ...newsReceipt, unsafe: { ...newsReceipt.unsafe, invalid_timestamp: false } },
    { ...newsReceipt, unsafe: { ...newsReceipt.unsafe, another_fact: false } },
    { ...newsReceipt, diagnostics: ['unscored'] },
  ]) {
    const snapshot = { ...newsSnapshot, chart_sources: { ...newsEnvelope, receipts: [invalid] } };
    await expect(loadSnapshot(snapshot)).rejects.toThrow('Could not parse local table');
    expect(readChartSource({ sourceWidgetId: 'x', metadata: { chartSources: { news: invalid } } },
      'news', () => ({ ...newsReceipt, diagnostics: [], unsafe: {} }))).toBeUndefined();
  }
});

it('accepts a successful empty acquired interval and an explicit all-unscored snapshot', async () => {
  const safe = {
    ...newsReceipt.unsafe, invalid_timestamp: false, invalid_identity: false, duplicate_conflict: false,
  };
  const empty = {
    ...newsReceipt, unsafe: safe, scope: { kind: 'bounded', start: '2024-02-29', end: '2024-03-01', limit: null, offset: null },
    raw_count: 0, normalized_count: 0, delivered_count: 0, coordinates: [], diagnostics: [],
  };
  const local = await loadSnapshot({ rows: [], completeness: 'bounded', chart_sources: { version: 1, receipts: [empty] } });
  expect(local.rows).toEqual([]);
  expect(local.provenance.metadata?.chartSources).toEqual({ news: empty });

  const unscored = { ...newsReceipt, unsafe: safe, diagnostics: ['unscored'], raw_count: 1, normalized_count: 1,
    delivered_count: 1, coordinates: [newsReceipt.coordinates[1]] };
  const onlyUnscored = await loadSnapshot({ rows: [newsRows[1]], completeness: 'sample',
    chart_sources: { version: 1, receipts: [unscored] } });
  expect(onlyUnscored.columns.map(c => c.id)).toContain('polarity');
  expect(onlyUnscored.rows[0].values.polarity).toBeNull();
});

it.each([
  ['https://news.example/article?edition=2#section', true],
  ['HTTP://WWW.EXAMPLE.COM.:8443/story', true],
  ['http://192.0.2.1/story', true],
  ['https://[2001:db8::1]:443/story', true],
  ['https://news.example/crónica', true],
  ['https://999.999.999.999/article', false],
  ['http://192.00.2.1/story', false],
  ['http://0x7f.1/story', false],
  ['https://news.123/article', false],
  ['https://news..example/article', false],
  ['https://-news.example/article', false],
  ['https://xn--bcher-kva.example/article', false],
  ['https://[2001:db8:::1]/story', false],
  ['https://news.example:65536/story', false],
  ['https://user:pass@news.example/story', false],
  ['https://news.example/story\u0085', false],
  ['https://news.example/story\ufeff', false],
])('matches the provider identity contract for %s', (url, accepted) => {
  const coordinates = [{ ...newsReceipt.coordinates[0], article_id: url }, ...newsReceipt.coordinates.slice(1)];
  expect(parseNewsSource({ ...newsReceipt, coordinates })?.coordinates[0].article_id).toBe(accepted ? url : undefined);
});

it('retains the raw identity failure and valid sibling from a completed HTTP request', async () => {
  const rows = [newsRows[0]];
  const receipt = {
    ...newsReceipt,
    raw_count: 2, normalized_count: 1, delivered_count: 1,
    diagnostics: ['invalid_identity'],
    unsafe: { invalid_identity: true, invalid_timestamp: false, duplicate_conflict: false, unit_conflict: false },
    coordinates: [newsReceipt.coordinates[0]],
  };
  const server = await startMockServer({
    [mirror]: { results: rows, extra: { results_metadata: { chart_sources: { version: 1, receipts: [receipt] } } } },
  });
  try {
    let complete: BackendAcquisition | undefined;
    const result = await fetchWidgetData(backend({ baseUrl: server.url }),
      widget({ type: 'table', endpoint: mirror, dataKey: 'results' }), request.parameters,
      undefined, undefined, undefined, acquired => { complete = acquired; });
    expect(result).toEqual(rows);
    const dataset = datasetFromRows(result as Record<string, unknown>[], 'test', 1, 'backend', undefined, [], undefined, complete);
    expect(readChartSource(dataset.provenance, 'news', parseNewsSource)).toEqual(receipt);
  } finally { await server.close(); }
});
