// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import file from '../../../test/fixtures/estimateVintageSnapshot.json';
import { datasetFromBytes } from '../../localTableData';
import { parseTableSnapshot } from '../../tableRowValues';
import { captureChartSources } from './chartSourceContracts';
import { chartSourceRegistry } from './chartSourceRegistry';

const receipt = file.chart_sources.receipts[0];
const decode = (v: unknown) => chartSourceRegistry['estimate-vintages']?.decode(v);
it('certifies only the explicitly acquired local history and keeps its missing observation', async () => {
  const input = await datasetFromBytes('estimates.json', new TextEncoder().encode(JSON.stringify(file)), 'root', 1);
  expect(input.provenance.metadata?.chartSources).toEqual({ 'estimate-vintages': receipt });
  expect(input.rows[2].values.value ?? null).toBeNull();
  expect(parseTableSnapshot(file).snapshot?.chartSources).toBeUndefined();
  for (const path of ['equity/estimates/historical', 'eodhd/equity/estimates/historical', 'equity/estimates/forward_eps']) {
    const context = { endpoint: '/api/v1/'+path, parameters: { provider: 'eodhd', chart_source: 'true' }, selector: 'results', retrievedAt: 1 };
    expect(captureChartSources(context, { results: file.rows, extra: { results_metadata: { chart_sources: file.chart_sources } } }, file.rows)).toBeUndefined();
  }
});
it('refuses an invented vintage, inconsistent lineage, currency, period, source scope or conflicting counts', () => {
  expect(decode(receipt)).toEqual(receipt);
  for (const patch of [
    { raw_count: 7 }, { exact_repeats: 7 }, { secret_value: 2.67543 }, { origin: 'eodhd' }, { diagnostics: ['unit_conflict'] },
    { target: { ...receipt.target, start: '2026-04-01' } }, { target: { ...receipt.target, start: '2000-01-01' } },
    { target: { ...receipt.target, kind: 'FY' } },
    ...[{ observed_at: receipt.target.end }, { observed_at: receipt.vintages[1].observed_at.replace('Z', '+00:00') },
      { batch: 'batch-c' }, { observed_at: '2099-01-01T00:00:00Z' }].map(v => ({ vintages: [{ ...receipt.vintages[0], ...v }, ...receipt.vintages.slice(1)] })),
    ...[{ reference: receipt.inputs[1].reference }, { members: ['ALFA.US'] }, { universe_id: null }].map(v => ({ inputs: [{ ...receipt.inputs[0], ...v }, ...receipt.inputs.slice(1)] })),
    ...[{ issuer: 'ALFA' }, { issuer: '1.25' }, { basis_ref: 'unknown' }, { currency: 'ZZZ' }, { unit: 'thousands' },
      { basis: 'money-per-share' }].map(v => ({ issuers: [{ ...receipt.issuers[0], ...v }, receipt.issuers[1]] })),
    { universe: { ...receipt.universe, baseline_batch: 'batch-c' } }, { coordinates: Array(6).fill(receipt.coordinates[0]) },
  ]) expect(decode({ ...receipt, ...patch })).toBeUndefined();
});
it('cross-checks every recorded row, target, denomination and batch before selection', () => {
  for (const patch of [{ input_ref: 'example/other' }, { vintage: 'snap-b' }, { batch: 'batch-c' }, { observed_at: receipt.target.end },
    { target_start: '2027-02-01' }, { target_kind: 'FY' }, { unit: 'millions' }, { currency: 'GBP' },
    { entity_ref: 'other' }, { basis_ref: 'different' }, { source_contract: 'earnings.Trend' }, { value: true }, { extra: true }]) {
    expect(() => parseTableSnapshot({ ...file, rows: [{ ...file.rows[0], ...patch }, ...file.rows.slice(1)] }, 'local-file')).toThrow();
  }
  for (const patch of [{ completeness: 'paged' }, { receipt: { currency: 'EUR' } }, { rows: file.rows.slice(1) }])
    expect(() => parseTableSnapshot({ ...file, ...patch }, 'local-file')).toThrow();
});
it('admits a declared universe with a missing coordinate as an honest gap and supports explicit unknown membership', () => {
  const rows = file.rows.slice(0, -1);
  const r = { ...receipt, coordinates: receipt.coordinates.slice(0, -1), raw_count: 5, normalized_count: 5, delivered_count: 5 };
  expect(parseTableSnapshot({ ...file, rows, chart_sources: { version: 1, receipts: [r] } }, 'local-file').data).toEqual(rows);
  const u = { ...r, universe: { status: 'unknown' }, inputs: r.inputs.map(i => ({ ...i, members: null, universe_id: null })) };
  expect(parseTableSnapshot({ ...file, completeness: 'partial', rows, chart_sources: { version: 1, receipts: [u] } }, 'local-file').snapshot?.chartSources).toBeDefined();
});


it.each([
  ['2024-02-29', '2025-02-27', 'FY', true], ['2024-01-01', '2024-12-30', 'FY', false],
  ['2023-10-01', '2024-10-05', 'FY', true], ['2022-09-25', '2022-12-31', 'FQ', true],
  ['2026-01-01', '2026-12-31', 'FQ', false], ['2000-01-01', '2026-12-31', 'FQ', false],
])('validates the inclusive declared %s through %s %s', (start, end, kind, valid) => {
  expect(!!decode({ ...receipt, target: { start, end, kind } })).toBe(valid);
});
it('reopens a revenue history with native currency units and an explicitly disclosed collapsed repeat', () => {
  const facts = { unit: 'money', basis: 'currency-units', basis_ref: null };
  const r = { ...receipt, metric: 'revenue', issuers: receipt.issuers.map(i => ({ ...i, ...facts })), raw_count: 7, exact_repeats: 1 };
  const rows = file.rows.map(row => ({ ...row, metric: 'revenue', ...facts }));
  expect(parseTableSnapshot({ ...file, rows, chart_sources: { version: 1, receipts: [r] } }, 'local-file').snapshot?.chartSources).toBeDefined();
});
