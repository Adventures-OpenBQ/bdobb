// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import files from '../../../test/fixtures/overlaySnapshots.json';
import { datasetFromBytes } from '../../localTableData';
import { parseTableSnapshot } from '../../tableRowValues';
import { captureChartSources } from './chartSourceContracts';
import { chartSourceRegistry } from './chartSourceRegistry';

const equity = files['price-eps'], macro = files['cpi-ten-year'];
const source = equity.chart_sources.receipts[0];
const decode = (v: unknown) => chartSourceRegistry.overlay?.decode(v);
it.each(Object.entries(files))('reopens one prepared %s file and retains independent series coordinates and missing observations', async (_, file) => {
  const receipt = file.chart_sources.receipts[0];
  expect(decode(receipt)).toEqual(receipt);
  const acquired = await datasetFromBytes('prepared.json', new TextEncoder().encode(JSON.stringify(file)), 'root', 1);
  expect(acquired.provenance.metadata?.chartSources).toEqual({ overlay: receipt });
  expect(acquired.rows).toHaveLength(file.rows.length);
  expect(parseTableSnapshot(file).snapshot?.chartSources).toBeUndefined();
  for (const path of ['equity/price/historical', 'equity/fundamental/historical_eps', 'economy/cpi', 'fixedincome/government/treasury_rates']) {
    const context = { endpoint: '/api/v1/' + path, selector: 'results', retrievedAt: 1, parameters: { provider: 'eodhd', chart_source: 'true' } };
    expect(captureChartSources(context, { results: file.rows, extra: { results_metadata: { chart_sources: file.chart_sources } } }, file.rows)).toBeUndefined();
  }
});
it('rejects open, unsupported, contradictory and unexplained receipt facts', () => {
  for (const patch of [
    { origin: 'completed-request' }, { raw_count: 3 }, { normalized_count: 3 }, { diagnostics: ['unit_conflict'] },
    { unsafe: { ...source.unsafe, coordinate_conflict: true } }, { secret: 1 },
    { identity: { ...source.identity, listing: 'AAPL' } },
    { vintages: { ...source.vintages, right: '2026-11-19T22:00:00.123457Z' } },
    { coordinates: { ...source.coordinates, right: ['1.98765'] } },
    { preparation: { input_refs: ['one','one'], reference: 'sample/pair' } },
    { preparation: { input_refs: ['unknown','other'], reference: 'sample/pair' } },
    ...[{ id: 'epsActual' }, { period_kind: 'FY' }, { basis: 'per-ADR' }, { currency: 'EUR' }].map(delta => ({
      series: { ...source.series, right: { ...source.series.right, ...delta } } })),
  ]) expect(decode({ ...source, ...patch })).toBeUndefined();
});
it('checks the complete acquired rows against the preparation, financial definitions and coordinates', () => {
  const mutations: [typeof equity | typeof macro, number, Record<string, unknown>][] = [
    ...[{ issuer: 'another' }, { listing: 'AAPL.LSE' }, { currency: 'CAD' }, { share_basis_ref: null },
      { source_contract: 'epsActual' }, { available_at: null }, { release_ref: null }, { restated: false },
      { target_start: null }, { target_end: '2026-08-30' }, { unit: 'money' }, { unexpected: true },
      { input_ref: 'sample/eod' }, { session_timing: 'known-by-close' }].map(d => [equity, 1, d] as [typeof equity, number, Record<string, unknown>]),
    [macro, 0, { basis: 'annual-2010=100' }], [macro, 0, { date: '2026-09-13' }], [macro, 2, { value: 5.12 }],
    [macro, 2, { source_contract: 'DFII10' }], [macro, 1, { available_at: '2026-10-01' }],
  ];
  for (const [file, index, patch] of mutations) {
    const rows = file.rows.map((r, i) => i === index ? { ...r, ...patch } : r);
    expect(() => parseTableSnapshot({ ...file, rows }, 'local-file')).toThrow();
  }
  expect(() => parseTableSnapshot({ ...equity, rows: [equity.rows[0], equity.rows[0]] }, 'local-file')).toThrow();
  expect(() => parseTableSnapshot({ ...equity, receipt: { symbol: 'MSFT.US' } }, 'local-file')).toThrow();
});
it('admits date-only after-market reports as acquired dates', () => {
  const day = '2026-11-02';
  const receipt = { ...source, coordinates: { ...source.coordinates, right: [day] } };
  const rows = [equity.rows[0], { ...equity.rows[1], available_at: day }];
  const file = { ...equity, rows, chart_sources: { version: 1, receipts: [receipt] } };
  expect(parseTableSnapshot(file, 'local-file').snapshot?.chartSources).toEqual({ overlay: receipt });
});

it('rejects an unknown currency code even when every acquired row agrees on it', () => {
  const setCurrency = (s: typeof source.series.left) => ({ ...s, currency: 'ZZZ' });
  const receipt = { ...source, series: { left: setCurrency(source.series.left), right: { ...source.series.right, currency: 'ZZZ' } } };
  const rows = equity.rows.map(r => ({ ...r, currency: 'ZZZ' }));
  expect(() => parseTableSnapshot({ ...equity, rows, chart_sources: { version: 1, receipts: [receipt] } }, 'local-file')).toThrow();
});

it('admits both exact decimal and binary yield conversion from source percent', () => {
  for (const value of [0.0411, 4.11 / 100]) {
    const rows = macro.rows.map((r, i) => i === 2 ? { ...r, source_value: 4.11, value } : r);
    expect(parseTableSnapshot({ ...macro, rows }, 'local-file').snapshot?.chartSources).toBeDefined();
  }
});
