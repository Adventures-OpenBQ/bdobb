// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { context, extremeRows, extremeSource, live, local, rawUnsafe, rows, stamp } from '../../../test/fixtures/etfHierarchyEvidence';
import { datasetFromRows } from '../../localTableData';
import { parseTableSnapshot } from '../../tableRowValues';
import { captureChartSources } from './chartSourceContracts';
import { chartSourceRegistry } from './chartSourceRegistry';

const envelope = (source: unknown) => ({ version: 1, receipts: [source] });
const response = (source: unknown, results: unknown[] = rows) =>
  ({ results, extra: { results_metadata: { chart_sources: envelope(source) } } });
const file = (source: unknown, results: unknown[] = rows, completeness = 'partial') =>
  ({ rows: results, chart_sources: envelope(source), completeness });
const capture = (source: unknown, results = rows) => captureChartSources(context, response(source, results), results);
const decode = (value: unknown) => chartSourceRegistry['etf-hierarchy']?.decode(value);

it('certifies only the original selected result array of a compatible completed holdings request', () => {
  expect(capture(live)).toEqual({ 'etf-hierarchy': live });
  const standard = { ...context, endpoint: '/api/v1/etf/holdings', parameters: { ...context.parameters, symbol: 'VTI.US', provider: 'eodhd' } };
  expect(captureChartSources(standard, response(live), rows)).toEqual({ 'etf-hierarchy': live });
  for (const bad of [
    { ...context, endpoint: '/api/v1/eodhd/etf/sectors' }, { ...context, endpoint: '/api/v1/etf/holdings' },
    { ...context, selector: 'results.rows' }, ...[{ symbol: 'VTI.LSE' }, { exchange: 'F' }, { symbol: 'SPY' },
      { chart_source: 'false' }, { provider: 'fmp' }, { complete: 'true' }].map(p => ({
      ...context, parameters: { ...context.parameters, ...p } })),
  ]) expect(captureChartSources(bad, response(live), rows)).toBeUndefined();
  expect(captureChartSources(context, response(live), [...rows])).toBeUndefined();
  expect(captureChartSources(context, { results: rows }, rows)).toBeUndefined();
  expect(captureChartSources(context, { ...response(live), completeness: 'complete' }, rows)).toBeUndefined();
});

it('separates independently acquired local authority from provider proof at every entry point', () => {
  const snapshot = parseTableSnapshot(file(local), 'local-file').snapshot;
  expect(snapshot?.chartSources).toEqual({ 'etf-hierarchy': local });
  expect(capture(local)).toBeUndefined();
  expect(() => parseTableSnapshot(file(live, rows, 'unknown'), 'local-file')).toThrow();
  expect(parseTableSnapshot(file(local)).snapshot?.chartSources).toBeUndefined();
  expect(datasetFromRows(rows, 'local', 1, 'localFile', undefined, [], {
    completeness: 'unknown', chartSources: { 'etf-hierarchy': decode(live) },
  }).provenance.metadata?.chartSources).toBeUndefined();
  expect(datasetFromRows(rows, 'backend', 1, 'backend', undefined, [], undefined, {
    ...context, chartSources: snapshot?.chartSources,
  }).provenance.metadata?.chartSources).toBeUndefined();
});

it('requires consistent counts, diagnostic facts, acquisition vintage and authority', () => {
  expect(decode(rawUnsafe)).toEqual(rawUnsafe);
  for (const delta of [{ raw_count: 3 }, { normalized_count: 1 }, { delivered_count: 1 }, { retrieved_at: '2026-11-20' },
    { as_of: '2026-11-19' }, { snapshot: '2026-11-19' }, { fund: 'VTI' }, { rounded: 'yes' },
    { weight_basis: 'equity-exposure' }, { holding_keys: ['AAPL.US','AAPL.US'] }, { holding_keys: ['0.069985','AAYA.F'] },
    { diagnostics: ['negative_weight'] }, { coverage: 'complete', coverage_reference: 'self:claim' },
    { missing_mass: { status: 'verified', reference: 'self:claim', fraction: .92767 } },
    { rounding_bound_fraction: .0001, rounding_reference: 'self:claim' },
  ]) expect(decode({ ...live, ...delta })).toBeUndefined();
  expect(decode({ ...live, raw_count: 3, diagnostics: ['exact_duplicate'] })).toBeTruthy();
});

it('checks delivered row identity, unit, snapshot, weight, missing sectors, observed total and duplicates', () => {
  expect(capture(live, [rows[0], { ...rows[1], weight: 0 }])).toBeDefined();
  for (const delta of [{ fund_symbol: 'SPY.US' }, { snapshot: '2026-11-19' }, { symbol: 'AAPL.US' }, { symbol: 'NO.US' },
    { weight_basis: 'equity-exposure' }, { weight_unit: 'percent-points' }, { weight: 1 }, { weight: Infinity },
    { weight: -1 }, { sector: undefined }, { sector: 7 }, { as_of: '2026-11-19' }, { holdings_coverage: 'complete' },
    { etf_kind: 'sector' }, { basis: 'equity-exposure' }, { unit: 'percent-points' },
  ]) {
    const changed = [rows[0], { ...rows[1], ...delta }];
    expect(captureChartSources(context, response(live, changed), changed)).toBeUndefined();
  }
});

it('cross-checks complete and independently measured missing mass against acquired weights and declared precision', () => {
  const missing = { ...local, missing_mass: { status: 'verified', fraction: .92767, reference: 'issuer:omitted' } };
  expect(parseTableSnapshot(file(missing), 'local-file').snapshot?.chartSources).toBeDefined();
  const complete = { ...local, coverage: 'complete', as_of: '2026-09-30', snapshot: '2026-09-30',
    rounding_bound_fraction: .0001, rounding_reference: 'issuer:precision' };
  const close = [{ ...rows[0], weight: .2, snapshot: complete.snapshot },
    { ...rows[1], weight: .79991, snapshot: complete.snapshot }];
  expect(parseTableSnapshot(file(complete, close, 'complete'), 'local-file').snapshot?.chartSources).toBeDefined();
  for (const bad of [
    file({ ...missing, missing_mass: { ...missing.missing_mass, fraction: .99 } }),
    file({ ...complete, rounding_reference: null }, close, 'complete'), file(complete, close, 'sample'),
    file(complete, [{ ...close[0], weight: .1 }, close[1]], 'complete'),
    file({ ...complete, rounding_bound_fraction: .00011 }, close, 'complete'),
    file({ ...complete, coverage_reference: null }, close, 'complete'),
    file({ ...local, snapshot: stamp, as_of: '2026-12-01' }),
  ]) expect(() => parseTableSnapshot(bad, 'local-file')).toThrow();
});


it('refuses contradictory sibling ETF declarations while preserving compatible legacy and unrelated metadata', () => {
  const compatible = { fund_symbol: 'VTI.US', etf_kind: 'holdings', weight_basis: 'fund-assets',
    holdings_coverage: 'partial', unit: 'fraction', retrieved_at: stamp, currency: 'USD' };
  const good = parseTableSnapshot({ ...file(local), receipt: compatible }, 'local-file').snapshot;
  expect(good?.chartSources).toEqual({ 'etf-hierarchy': local });
  expect(good?.receipt).toEqual(compatible);
  const conflicts: Record<string, string>[] = [{ fund_symbol: 'SPY.US' }, { etf_kind: 'sector' }, { unit: 'percent-points' },
    { holdings_coverage: 'complete' }, { weight_basis: 'equity-exposure' }, { as_of: '2026-11-19' },
    { retrieved_at: '2026-11-20T04:16:45.000001Z' }];
  for (const delta of conflicts) {
    const receipt = { ...compatible, ...delta };
    expect(() => parseTableSnapshot({ ...file(local), receipt }, 'local-file')).toThrow();
    const direct = datasetFromRows(structuredClone(rows), 'local', 1, 'localFile', undefined, [], { ...good!, receipt });
    expect(direct.provenance.metadata?.chartSources).toBeUndefined();
    const result = { ...response(live), receipt: { ...receipt, holdings_coverage: 'unknown', ...delta } };
    expect(captureChartSources(context, result, rows)).toBeUndefined();
  }
});

it('rejects unexplained raw losses and financial values or missing markers masquerading as authority', () => {
  for (const change of [
    { holding_keys: ['2.345E1','AAYA.F'] },
    { raw_count: 3, unsafe: { ...live.unsafe, excess_weight: true }, diagnostics: ['excess_weight'] },
    { coverage_reference: 'unknown' },
    { rounding_bound_fraction: .00001, rounding_reference: 'NA' },
    { missing_mass: { status: 'verified', fraction: .92767, reference: 'Unavailable' } },
  ]) expect(decode({ ...local, ...change })).toBeUndefined();
});


it('reopens explicit local JSON and keeps sibling metadata and independent field meanings', async () => {
  const { datasetFromBytes } = await import('../../localTableData');
  const reopen = (receipt: Record<string, string>) => datasetFromBytes('holdings.json', new TextEncoder().encode(
    JSON.stringify({ ...file(local), receipt })), 'local', 1);
  const good = await reopen({ fund_symbol: 'VTI.US', etf_kind: 'holdings', unit: 'fraction' });
  expect(good.provenance.metadata?.chartSources).toEqual({ 'etf-hierarchy': local });
  const unrelated = await reopen({ interval: '1d', unit: 'USD', currency: 'USD' });
  expect(unrelated.provenance.metadata?.chartSources).toEqual({ 'etf-hierarchy': local });
  expect(unrelated.provenance.receipt).toEqual({ interval: '1d', unit: 'USD', currency: 'USD' });
  await expect(reopen({ fund_symbol: 'SPY.US', unit: 'fraction' })).rejects.toThrow('Could not parse local table');
});

it.each([
  { weight_unit: 'percent-points' }, { basis: 'equity-exposure' }, { etf_ticker: 'SPY.US' },
  { exposure_kind: 'sector' }, { WeightUnit: 'percent-points' }, { weight_measure: 'equity-share' },
])('checks all ETF-marked sibling assertions before live or local certification: %o', delta => {
  const receipt = { fund_symbol: 'VTI.US', etf_kind: 'holdings', unit: 'fraction', ...delta };
  expect(captureChartSources(context, { ...response(live), receipt }, rows)).toBeUndefined();
  expect(() => parseTableSnapshot({ ...file(local), receipt }, 'local-file')).toThrow();
  const localSource = parseTableSnapshot(file(local), 'local-file').snapshot!;
  const direct = datasetFromRows(structuredClone(rows), 'local', 1, 'localFile', undefined, [], {
    ...localSource, receipt: Object.fromEntries(Object.entries(receipt)),
  });
  expect(direct.provenance.metadata?.chartSources).toBeUndefined();
});

it('honors compatible declared weight_unit and basis on the completed holdings response', () => {
  expect(captureChartSources(context, { ...response(live),
    receipt: { fund_symbol: 'VTI.US', unit: 'fraction', weight_unit: 'fraction', basis: 'fund-assets' },
  }, rows)).toEqual({ 'etf-hierarchy': live });
  expect(captureChartSources(context, { ...response(live), receipt: { weight_unit: 'percent-points' } }, rows)).toBeUndefined();
});

it('retains a captured raw excess flag when summing finite weights would overflow', () => {
  expect(capture(extremeSource, extremeRows)).toEqual({ 'etf-hierarchy': extremeSource });
  expect(extremeRows[0].weight).toBe(1.7e306);
  expect(capture({ ...extremeSource, diagnostics: [], unsafe: live.unsafe }, extremeRows)).toBeUndefined();
  const wrongLastRow = [...extremeRows.slice(0, -1), { ...extremeRows[106], weight_basis: 'equity-exposure' }];
  expect(capture(extremeSource, wrongLastRow)).toBeUndefined();
});
