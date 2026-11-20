// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it, vi } from 'vitest';
import { fetchWidgetData } from '../../dataClient';
import { datasetFromBytes, datasetFromRows } from '../../localTableData';
import { parseTableSnapshot } from '../../tableRowValues';
import { startMockServer } from '../../../test/mockServer';
import { backend, widget } from '../../../test/fixtures';
import type { BackendAcquisition } from './financialEvidence';
import { dailyPriceRows, priceFields } from './fixtures';
import { admitReturnSummary, dailyReturnSamples, prepareSelectedPrices } from './priceSamples';

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));

const own = { mode: 'own' } as const;
const day = (d: number) => '2026-01-' + String(d).padStart(2, '0');
const receipt = { interval: '1d', start_date: day(1), end_date: day(31) };
const prices = [100, 200, 400, 800, 1600, 3200, 6400, 12800];
const daily = dailyPriceRows(prices, 'AAA.US');
const bytes = (snapshot: unknown) => new TextEncoder().encode(JSON.stringify(snapshot));
const source = (rows: object[] = daily, facts: object = receipt, completeness = 'bounded') =>
  datasetFromBytes('daily.json', bytes({ rows, receipt: facts, completeness }), 'prices', 1);

it('admits separate listing calendars in selected order with both price endpoints inside inclusive common bounds', async () => {
  const [a, b] = ['AAA.US', 'BBB.US'].map(symbol => dailyPriceRows(prices, symbol));
  const oddCalendar = b.map((row, index) => ({ ...row, date: day([1, 2, 3, 4, 6, 7, 8, 10][index]) }));
  const result = admitReturnSummary(await source([...a, ...oddCalendar]), priceFields, ['BBB.US', 'AAA.US'], {
    mode: 'common', start: day(2), end: day(8),
  });
  if (!result.ok) throw new Error(result.message);
  expect(result.value.scope).toEqual({ start: day(1), end: day(31), interval: '1d' });
  expect(result.value.adjustmentBasis).toBe('adjusted-price');
  expect(result.value.commonWindow).toEqual({ start: day(1), end: day(8) });
  expect(result.value.series.map(({ symbol, samples, start, end }) => [symbol, samples.map(s => s.date), start, end])).toEqual([
    ['BBB.US', [3, 4, 6, 7, 8].map(day), day(3), day(8)],
    ['AAA.US', [3, 4, 5, 6, 7, 8].map(day), day(3), day(8)],
  ]);
});

it('counts both known exclusions around a missing close and excludes neither neighboring close itself', async () => {
  const rows = daily.map((row, i) => i === 2 ? { ...row, adjusted_close: null } : row);
  const result = admitReturnSummary(await source(rows), priceFields, ['AAA.US'], own);
  if (!result.ok) throw new Error(result.message);
  expect(result.value.series[0]).toMatchObject({
    samples: [2, 5, 6, 7, 8].map(d => ({ date: day(d), value: 1 })),
    start: day(2), end: day(8), excludedOpportunities: 2, gapCount: 1,
  });
});

it('refuses if every listing cannot supply five in-window returns', async () => {
  const peer = dailyPriceRows(prices.slice(0, 6), 'BBB.US');
  const data = await source([...daily, ...peer]);
  expect(admitReturnSummary(data, priceFields, ['BBB.US', 'AAA.US'], own).ok).toBe(true);
  expect(admitReturnSummary(data, priceFields, ['AAA.US', 'BBB.US'], { mode: 'common', start: day(2), end: day(8) }))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/five|5.*BBB\.US/i) });
});

it('refuses a common window for disjoint listing histories', async () => {
  const peer = dailyPriceRows(prices, 'BBB.US').map((row, index) => ({ ...row, date: day(index + 12) }));
  const data = await source([...daily, ...peer]);
  const selected = ['AAA.US', 'BBB.US'];
  expect(admitReturnSummary(data, priceFields, selected, own)).toMatchObject({ ok: true, value: { commonWindow: null } });
  expect(admitReturnSummary(data, priceFields, selected, { mode: 'common', start: day(1), end: day(31) }))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/overlap/i) });
});

it.each([
  { mode: 'common', start: day(9), end: day(8) },
  { mode: 'common', start: '2026-02-30', end: '2026-03-30' },
  { mode: 'common', start: '2025-12-31', end: day(8) },
] as const)('refuses invalid or out-of-acquisition common bounds %j', async window => {
  expect(admitReturnSummary(await source(), priceFields, ['AAA.US'], window))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/window|bound/i) });
});

it.each(['paged', 'partial', 'sample'] as const)('refuses %s acquisition despite enough delivered returns', async completeness => {
  expect(admitReturnSummary(await source(daily, receipt, completeness), priceFields, ['AAA.US'], own))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/fully loaded/i) });
});

it('refuses contradictory daily evidence and altered acquisition counts', async () => {
  const contradictory = await source();
  contradictory.provenance.parameters = { interval: '1wk' };
  expect(admitReturnSummary(contradictory, priceFields, ['AAA.US'], own))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/daily interval|acquisition date/i) });
  const deficient = await source();
  deficient.completeness.acquiredRowCount = daily.length + 1;
  expect(admitReturnSummary(deficient, priceFields, ['AAA.US'], own))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/continuity/i) });
  deficient.completeness.acquiredRowCount = daily.length - 1;
  expect(admitReturnSummary(deficient, priceFields, ['AAA.US'], own).ok).toBe(false);
  delete deficient.completeness.acquiredRowCount;
  expect(admitReturnSummary(deficient, priceFields, ['AAA.US'], own).ok).toBe(false);
});

it.each([3, -1, '7', 7.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, undefined])(
  'refuses a bounded seven-row acquisition with exact total %s', async total => {
    const data = await source(daily.slice(0, 7));
    data.completeness = { ...data.completeness, totalRowCountKind: 'exact', totalRowCount: total as number };
    expect(admitReturnSummary(data, priceFields, ['AAA.US'], own))
      .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/row counts.*continuity/i) });
  },
);

it.each([['bounded', 7, true], ['bounded', 8, true], ['complete', 7, true], ['complete', 8, false]] as const)(
  'checks %s seven-row acquisition against exact total %i', async (completeness, totalRowCount, allowed) => {
    const data = await source(daily.slice(0, 7), receipt, completeness);
    data.completeness = { ...data.completeness, totalRowCountKind: 'exact', totalRowCount };
    expect(admitReturnSummary(data, priceFields, ['AAA.US'], own).ok).toBe(allowed);
  },
);

it('keeps the closed snapshot parser and rejects positive receipt-free metadata', async () => {
  await expect(source(daily, { ...receipt, adjusted: 'yes' })).rejects.toThrow('Could not parse local table');
  const { data, snapshot } = parseTableSnapshot({ rows: daily, completeness: 'bounded' });
  const missing = datasetFromRows(data as typeof daily, 'prices', 1, 'backend', undefined, [], snapshot);
  expect(admitReturnSummary(missing, priceFields, ['AAA.US'], own)).toMatchObject({ ok: false, refused: true });
});

it('does not grant adjustment or listing proof through a saved numeric binding', async () => {
  const rows = daily.map(({ adjusted_close, ...row }) => ({ ...row, custom: adjusted_close }));
  expect(admitReturnSummary(await source(rows), { ...priceFields, price: 'custom' }, ['AAA.US'], own))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/adjusted.price/i) });
  const ambiguous = daily.map(row => ({ ...row, symbol: 'AAA' }));
  expect(admitReturnSummary(await source(ambiguous), priceFields, ['AAA'], own))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/qualified listing/i) });
});

it('requires an acquired trading-date field even if another column contains plausible calendar dates', async () => {
  const rows = daily.map(({ date, ...row }) => ({ ...row, authored: date }));
  expect(admitReturnSummary(await source(rows), { ...priceFields, date: 'authored' }, ['AAA.US'], own))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/trading.date/i) });
});

it('preserves the legacy fetched rows and refuses a request flag without acquired proof', async () => {
  const endpoint = '/api/v1/eodhd/equity/price/historical';
  const rows = daily.map(({ date, adjusted_close }) => ({
    date, adjusted_close, open: adjusted_close, high: adjusted_close, low: adjusted_close, close: adjusted_close, volume: 8000,
  }));
  const server = await startMockServer({ [endpoint]: { results: rows } });
  try {
    const config = backend({ baseUrl: server.url });
    const card = widget({ type: 'table', endpoint, dataKey: 'results' });
    const params = { ...receipt, symbol: 'AAA.US', provider: 'eodhd' };
    const read = async (query: typeof params & { chart_source?: string }) => {
      let acquisition: BackendAcquisition | undefined;
      const result = await fetchWidgetData(config, card, query, undefined, undefined, undefined, context => { acquisition = context; });
      expect(result).toEqual(rows);
      return datasetFromRows(result as typeof rows, 'prices', 1, 'backend', undefined, [], undefined, acquisition);
    };
    for (const query of [params, { ...params, chart_source: 'true' }]) {
      const acquired = await read(query);
      expect(admitReturnSummary(acquired, { date: 'date', price: 'adjusted_close' }, ['AAA.US'], own))
        .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/acquisition receipt/i) });
    }
  } finally { await server.close(); }
});

it('refuses a remote snapshot-shaped legacy response while admitting the same documented local snapshot', async () => {
  const endpoint = '/api/v1/eodhd/equity/price/historical';
  const envelope = { rows: daily.slice(0, 7), receipt, completeness: 'bounded' };
  const server = await startMockServer({ [endpoint]: { results: envelope } });
  try {
    const result = await fetchWidgetData(backend({ baseUrl: server.url }), widget({ type: 'table', endpoint, dataKey: 'results.rows' }), {
      ...receipt, symbol: 'AAA.US', provider: 'eodhd',
    });
    expect(result).toEqual(envelope);
    const { data, snapshot } = parseTableSnapshot(result);
    const remote = datasetFromRows(data as typeof daily, 'prices', 1, 'backend', undefined, [], snapshot);
    const prepared = prepareSelectedPrices(remote, priceFields, ['AAA.US']);
    if (!prepared.ok) throw new Error(prepared.message);
    expect(dailyReturnSamples(prepared.series[0]).samples).toHaveLength(6);
    expect(admitReturnSummary(remote, priceFields, ['AAA.US'], own))
      .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/local.*snapshot/i) });

    const local = await source(envelope.rows);
    const admitted = admitReturnSummary(local, priceFields, ['AAA.US'], own);
    if (!admitted.ok) throw new Error(admitted.message);
    expect(admitted.value.series[0].samples).toHaveLength(6);
  } finally { await server.close(); }
});

it.each([[], ['AAA.US', 'AAA.US'], Array.from({ length: 13 }, (_, i) => `AAA${i}.US`)].map(symbols => ({ symbols })))(
  'refuses an empty, repeated or oversized listing selection %j', async ({ symbols }) => {
    expect(admitReturnSummary(await source(), priceFields, symbols, own)).toMatchObject({ ok: false, refused: true });
  },
);
