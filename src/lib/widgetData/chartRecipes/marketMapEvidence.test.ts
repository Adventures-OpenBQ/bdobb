// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import cap from '../../../test/fixtures/marketMapCap.json';
import zeroBound from '../../../test/fixtures/marketMapIndexZeroBound.json';
import index from '../../../test/fixtures/marketMapIndex.json';
import { datasetFromBytes } from '../../localTableData';
import { parseTableSnapshot } from '../../tableRowValues';
import { captureChartSources } from './chartSourceContracts';
import { chartSourceRegistry } from './chartSourceRegistry';

const decode = (value: unknown) => chartSourceRegistry['market-map']?.decode(value);
it.each([cap, index])('admits the two explicit local contracts and no backend route', async file => {
  const r = file.chart_sources.receipts[0];
  const d = await datasetFromBytes('market.json', new TextEncoder().encode(JSON.stringify(file)), 'local', 1);
  expect(d.provenance.metadata?.chartSources).toEqual({ 'market-map': r });
  expect(d.rows[0].values.change).toBe(0);
  expect(d.rows[1].values.change ?? null).toBeNull();
  expect(parseTableSnapshot(file).snapshot?.chartSources).toBeUndefined();
  for (const endpoint of ['/api/v1/equity/screener', '/api/v1/eodhd/equity/screener', '/api/v1/index/available', '/api/v1/index/price/historical']) {
    const ctx = { endpoint, selector: 'results', parameters: { provider: 'eodhd', chart_source: 'true' }, retrievedAt: 1 };
    expect(captureChartSources(ctx, { results: file.rows, extra: { results_metadata: { chart_sources: file.chart_sources } } }, file.rows)).toBeUndefined();
  }
});
it.each([cap, index])('requires closed coherent manifests, original unit, provenance and counts', file => {
  const r = file.chart_sources.receipts[0];
  expect(decode(r)).toEqual(r);
  const modePatches = file === cap ? [{ universe: 'GSPC.INDX' }, { denomination: 'ZZZ' }, { denomination: '$' }, { cap_retrieved_at: '2026-11-12T00:00:00Z' },
    { coverage: 'complete' }, { membership_as_of: r.session }] : [{ members: ['ALFA.US', 'ALFA.US'] }, { members: ['BETA.US'] },
    { weight_valid_for: r.prior_session }, { weight_reference: 'Unknown' }, { coverage: 'sample' }, { denomination: 'USD' },
    { rounding_bound_fraction: .0002, rounding_reference: 'example/precision' }, { rounding_bound_fraction: .00001 }];
  for (const p of [...modePatches, { source: 'eodhd' }, { origin: 'screener' }, { price_basis: 'five-day' }, { session_ref: null },
    { session: '2026-02-30' }, { session: '2026-11-14' }, { prior_session: r.session }, { listing_keys: ['1.25', 'BETA.US'] },
    { raw_count: 3 }, { normalized_count: 1 }, { excluded_areas: { negative: true, zero: 0, invalid: 0 } },
    { unsafe: { ...r.unsafe, duplicate_conflict: true } }]) expect(decode({ ...r, ...p })).toBeUndefined();
});
it.each([cap, index])('cross-checks all acquired rows and scope before projection', file => {
  for (const patch of [{ area: false }, { area: 0 }, { change: true }, { change: -1.01 }, { listing: 'BETA.US' }, { sector: false },
    { session: '2026-11-12' }, { session_ref: 'example/other' }, { price_basis: 'intraday' }, { area_ref: null },
    { acquisition_ref: 'example/other' }, { denomination: 'GBP' }, { membership_as_of: '2025-10-01' }, { extra: 1 }]) {
    expect(() => parseTableSnapshot({ ...file, rows: [{ ...file.rows[0], ...patch }, file.rows[1]] }, 'local-file')).toThrow();
  }
  for (const p of [{ completeness: 'paged' }, { receipt: { currency: 'EUR' } }])
    expect(() => parseTableSnapshot({ ...file, ...p }, 'local-file')).toThrow();
});
it('checks complete shortfalls, partial excess and extreme raw positives without imposing a cap-mode weight limit', () => {
  const r = index.chart_sources.receipts[0];
  for (const [coverage, area, bound, valid] of [
    ['complete', .39995, .0001, true], ['complete', .39995, null, false], ['partial', .39995, null, true],
    ['partial', .40005, null, false], ['partial', .40005, .0001, true], ['partial', 1e308, null, false],
  ] as const) {
    const receipt = { ...r, coverage, rounding_bound_fraction: bound, rounding_reference: bound ? 'example/precision' : null };
    const file = { ...index, completeness: coverage, chart_sources: { version: 1, receipts: [receipt] }, rows: [index.rows[0], { ...index.rows[1], area }] };
    if (valid) expect(parseTableSnapshot(file, 'local-file').snapshot?.chartSources).toBeDefined();
    else expect(() => parseTableSnapshot(file, 'local-file')).toThrow();
  }
  expect(parseTableSnapshot({ ...cap, rows: cap.rows.map(row => ({ ...row, area: 1e308 })) }, 'local-file').snapshot?.chartSources).toBeDefined();
});
it('rejects impossible repetition, collision and partial membership diagnostics', () => {
  const base = index.chart_sources.receipts[0];
  const r = { ...base, coverage: 'partial', raw_count: 1, delivered_count: 0, normalized_count: 0, listing_keys: [],
    rejected_count: 1, diagnostics: ['membership_conflict'], unsafe: { ...base.unsafe, membership_conflict: true } };
  for (const patch of [{ raw_count: 2, exact_repeats: 1 }, { diagnostics: [...r.diagnostics, 'duplicate_conflict'], unsafe: { ...r.unsafe, duplicate_conflict: true } },
    { rejected_count: 0, raw_count: 0 }]) expect(decode({ ...r, ...patch })).toBeUndefined();
});
it('imports the exact provider-prepared zero-bound index and honors both sides of the binary64 tie', async () => {
  const source = zeroBound.chart_sources.receipts[0];
  expect(source.rounding_bound_fraction).toBe(0);
  const d = await datasetFromBytes('index.json', new TextEncoder().encode(JSON.stringify(zeroBound)), 'index', 1);
  expect(d.provenance.metadata?.chartSources).toEqual({ 'market-map': source });
  expect(d.rows.map(row => row.values.area)).toEqual([.08, .69, .23]);
  for (const [weights, excess] of [[[1, 2 ** -54, 2 ** -54], false], [[1, 2 ** -53, Number.MIN_VALUE], true]] as const) {
    const file = { ...zeroBound, rows: zeroBound.rows.map((r, i) => ({ ...r, area: weights[i] })) };
    if (excess) expect(() => parseTableSnapshot(file, 'local-file')).toThrow();
    else expect(parseTableSnapshot(file, 'local-file').snapshot?.chartSources).toBeDefined();
  }
});
it.each([[0, 0], [1, 2]])('requires a possible positive raw contribution for excess with %s zeros and %s negatives', (zero, negative) => {
  const r = index.chart_sources.receipts[0];
  expect(decode({ ...r, coverage: 'partial', raw_count: zero + negative, normalized_count: 0, delivered_count: 0, listing_keys: [],
    diagnostics: ['excess_weight'], unsafe: { ...r.unsafe, excess_weight: true }, excluded_areas: { zero, negative, invalid: 0 } })).toBeUndefined();
});
