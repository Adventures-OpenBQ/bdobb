// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { liveMetricReceipt, liveMetricRows, metricReceipt, metricRows, revisedEps } from '../../../test/fixtures/metricEvidence';
import { metricReferencesComparable, parseMetricSource } from './metricEvidence';
import { acquiredChartSources, captureChartSources, localChartSources } from './chartSourceContracts';

const local = (receipt: unknown, rows: Record<string, unknown>[] = metricRows, scope = 'complete') =>
  localChartSources({ version: 1, receipts: [receipt] }, rows, scope);

it('binds each dated acquisition by identity in either row order and preserves a real zero or null', () => {
  expect(local(metricReceipt)).toEqual({ metric: metricReceipt });
  expect(local(metricReceipt, [...metricRows].reverse())).toEqual({ metric: metricReceipt });
  expect(local(metricReceipt, metricRows.map(row => ({ ...row, eps_ttm: null })))).toBeDefined();
});

it.each([
  { observation_id: 'first-report' }, { metric: 'price' }, { issuer: 'OTHER.US' }, { listing: 'OTHER.NYSE' },
  { share_class: 'Preferred' }, { vintage: '2026-11-04T13:00:00Z' }, { unit_kind: 'multiple' },
  { currency: 'GBP' }, { reporting_basis: 'IFRS' }, { as_of: '2026-11-20' }, { period_end: '2026-06-30' },
  { adjustment_basis: 'split-adjusted' }, { basis_reference: 'ordinary-after-split' },
  { eps_ttm: '0.00' }, { eps_ttm: NaN }, { eps_ttm: Infinity }, { eps_ttm: undefined },
])('refuses contradictory acquired rows %o', change => {
  expect(local(metricReceipt, [{ ...metricRows[0], ...change }, metricRows[1]])).toBeUndefined();
});

it.each([
  { unit: { kind: 'fraction' } }, { unit: { kind: 'money-per-share' } }, { origin: 'forward_eps' }, { observation_id: '76.544' }, { basis_reference: '76.544' },
  { as_of_unknown: false }, { as_of: '2026-02-30', as_of_unknown: false }, { as_of: '2026-12-01', as_of_unknown: false },
  { period_kind: 'FQ' }, { period_start: null }, { period_start: '2026-09-30' }, { reporting_basis: null },
  { adjustment_basis: 'as-traded' }, { basis_reference: 5 }, { value: 5 }, { acquired_consensus: true },
  { vintage: '2026-11-20T04:16:46.000001Z' }, { observation_id: 'first-report' },
])('refuses contradictory evidence even on an additional observation %o', change => {
  const entry = { ...metricReceipt.metrics.eps_ttm, additional_observations: [{ ...revisedEps, ...change }] };
  expect(parseMetricSource({ ...metricReceipt, metrics: { eps_ttm: entry } })).toBeUndefined();
});

it('requires pre-drop facts and a full, closed family declaration', () => {
  for (const change of [{ raw_count: 3 }, { delivered_count: 1 }, { metrics: {} }, { range: [0, 100] },
    { metrics: { arbitrary: metricReceipt.metrics.eps_ttm } }, { issuer: 'EXAMPLE' }, { diagnostics: ['period_conflict'] },
    { unsafe: { ...metricReceipt.unsafe, unit_conflict: true } }, { origin: 'eodhd-key-metrics' }])
    expect(parseMetricSource({ ...metricReceipt, ...change })).toBeUndefined();
  expect(local(metricReceipt, metricRows, 'sample')).toBeUndefined();
});

it('cannot certify a completed quote, metrics, ratios or screener using a local declaration or chart_source flag', () => {
  const envelope = { version: 1, receipts: [metricReceipt] };
  const source = local(metricReceipt);
  expect(source).toBeDefined();
  for (const path of ['equity/price/quote', 'equity/fundamental/metrics', 'equity/fundamental/ratios', 'equity/discovery/screener'])
    for (const selector of ['results', 'results.rows']) {
      const context = { endpoint: '/api/v1/' + path, selector, parameters: { chart_source: 'true', symbol: 'EXAMPLE', provider: 'eodhd' }, retrievedAt: 1 };
      expect(captureChartSources(context, { results: metricRows, extra: { results_metadata: { chart_sources: envelope } } }, metricRows)).toBeUndefined();
      expect(acquiredChartSources(source, metricRows, 'complete', context)).toBeUndefined();
    }
});

it.each([['metrics', 'eodhd-key-metrics'], ['ratios', 'eodhd-financial-ratios']])(
  'binds %s only to its completed route, selector, primary issuer and original vintage', (path, origin) => {
    const receipt = { ...liveMetricReceipt, origin };
    const envelope = { version: 1, receipts: [receipt] };
    const context = { endpoint: '/api/v1/eodhd/equity/fundamental/' + path, selector: 'results',
      parameters: { chart_source: 'true', symbol: 'aapl' }, retrievedAt: 1 };
    const response = { results: liveMetricRows, extra: { results_metadata: { chart_sources: envelope } } };
    const captured = captureChartSources(context, response, liveMetricRows);
    expect(captured).toEqual({ metric: receipt });
    expect(localChartSources(envelope, liveMetricRows, 'complete')).toBeUndefined();
    expect(acquiredChartSources(captured, liveMetricRows, 'complete')).toBeUndefined();
    expect(acquiredChartSources(captured, liveMetricRows, 'complete', context)).toEqual(captured);
    for (const change of [{ endpoint: context.endpoint + 'x' }, { selector: 'rows' }, { endpoint: context.endpoint.replace('/eodhd', '') },
      ...[['symbol', 'AAPL.LSE'], ['exchange', 'TO'], ['provider', 'fmp'], ['limit', '99'], ['chart_source', 'false']]
        .map(([key, value]) => ({ parameters: { ...context.parameters, [key]: value } }))])
      expect(captureChartSources({ ...context, ...change }, response, liveMetricRows)).toBeUndefined();
    expect(captureChartSources({ ...context, endpoint: context.endpoint.replace('/eodhd', ''),
      parameters: { ...context.parameters, provider: 'eodhd' } }, response, liveMetricRows)).toEqual(captured);
    for (const change of [{ symbol: 'MSFT.US' }, { share_class: 'Class-A' }, { metric_vintage: '2026-11-19' },
      { dividend_yield: '0.3%' }, { pe_ratio: true }])
      expect(acquiredChartSources(captured, [{ ...liveMetricRows[0], ...change }], 'complete', context)).toBeUndefined();
  });

it('requires positive evidence for the two explicitly identified reference observations', async () => {
  const compare = (change: Record<string, unknown>, share_class: string | null = 'Ordinary-A') => {
    const entry = { ...metricReceipt.metrics.eps_ttm, additional_observations: [{ ...revisedEps, ...change }] };
    const source = parseMetricSource({ ...metricReceipt, share_class, metrics: { eps_ttm: entry } });
    expect(source).toBeDefined();
    return metricReferencesComparable(source!, 'eps_ttm', 'revised-report', 'first-report');
  };
  expect(compare({})).toBe(true);
  for (const change of [{ period_start: '2025-07-01', period_end: '2026-06-30' }, { reporting_basis: 'IFRS' },
    { adjustment_basis: 'diluted-split-adjusted' }, { basis_reference: 'post-split' },
    { unit: { kind: 'money-per-share', currency: 'CAD' } }])
    expect(compare(change)).toBe(false);
  expect(compare({}, null)).toBe(false);
});

it.each(['XXX', 'XTS', 'QQQ'])('rejects a non-currency or unknown denomination %s before binding', async currency => {
  const entry = { ...metricReceipt.metrics.eps_ttm, unit: { kind: 'money-per-share', currency } };
  expect(parseMetricSource({ ...metricReceipt, metrics: { eps_ttm: entry } })).toBeUndefined();
});

it('does not contradict a vintage or issuer explicitly present on the actual headline row', () => {
  const context = { endpoint: '/api/v1/eodhd/equity/fundamental/metrics', selector: 'results',
    parameters: { chart_source: 'true', symbol: 'AAPL' }, retrievedAt: 1 };
  const envelope = { version: 1, receipts: [liveMetricReceipt] };
  for (const delta of [{ listing: 'MSFT.US' }, { issuer: 'MSFT.US' }, { as_of: '2026-11-19' }]) {
    const rows = [{ ...liveMetricRows[0], ...delta }];
    expect(captureChartSources(context, { results: rows, extra: { results_metadata: { chart_sources: envelope } } }, rows)).toBeUndefined();
  }
});

it.each([
  ['price', 'money-per-share', 'GBX', 'as-traded', null],
  ['market_cap', 'money', 'CAD', 'issuer-all-classes', null],
  ['dividend_yield', 'fraction', null, 'trailing-dividend-per-share', 'TTM'],
  ['pe_ratio', 'multiple', null, 'trailing-diluted-earnings', 'TTM'],
  ['eps_ttm', 'money-per-share', 'USD', 'diluted-as-reported', 'TTM'],
  ['revenue_ttm', 'money', 'JPY', 'as-reported', 'TTM'],
])('accepts the exact prepared unit of %s and requires the original numeric field', (metric, kind, currency, basis, period) => {
  const report = metric === 'eps_ttm' || metric === 'revenue_ttm';
  const obs = { ...revisedEps, origin: metric, unit: currency ? { kind, currency } : { kind },
    adjustment_basis: basis, period_kind: period, period_start: report ? '2025-10-01' : null,
    period_end: report ? '2026-09-30' : null, reporting_basis: report ? 'US-GAAP' : null, additional_observations: [] };
  const receipt = { ...metricReceipt, metrics: { [metric!]: obs }, raw_count: 1, normalized_count: 1, delivered_count: 1 };
  const row = { ...metricRows[0], metric, [metric!]: 0, currency, unit_kind: kind, period_kind: period,
    period_start: obs.period_start, period_end: obs.period_end, reporting_basis: obs.reporting_basis, adjustment_basis: basis };
  expect(local(receipt, [row])).toEqual({ metric: receipt });
  expect(local(receipt, [{ ...row, [metric!]: undefined, arbitrary: 0 }])).toBeUndefined();
});

it('does not grant positive proof to ambiguous or duplicate financial coordinates under distinct IDs', async () => {
  const first = metricReceipt.metrics.eps_ttm;
  const other = { ...revisedEps, vintage: first.vintage.replace('Z', '.000000+00:00') };
  expect(parseMetricSource({ ...metricReceipt, metrics: { eps_ttm: { ...first, additional_observations: [other] } } })).toBeUndefined();
});

it.each([
  ['2025-10-01', '2026-10-01', false], ['2023-03-01', '2024-02-28', false], ['2024-02-29', '2025-02-27', false],
  ['2023-03-01', '2024-02-29', true], ['2024-02-29', '2025-02-28', true],
  ['2025-10-01', '2026-09-29', true], ['2025-10-01', '2026-10-06', true],
] as const)('checks the actual calendar or week year %s through %s', (period_start, period_end, valid) => {
  const period = { period_start, period_end };
  const entry = { ...metricReceipt.metrics.eps_ttm, ...period, additional_observations: [{ ...revisedEps, ...period }] };
  const receipt = { ...metricReceipt, metrics: { eps_ttm: entry } };
  const acquired = local(receipt, metricRows.map(row => ({ ...row, ...period })));
  expect(!!acquired).toBe(valid);
  const source = parseMetricSource(acquired?.metric);
  expect(!!source && metricReferencesComparable(source, 'eps_ttm', 'revised-report', 'first-report')).toBe(valid);
});

it.each([
  ['share_class', '76.544'], ['share_class', '1e+3'], ['share_class', 'Unknown'], ['share_class', 'not_available'],
  ['basis_reference', 'UNKNOWN'], ['basis_reference', 'NA'], ['listing', '76.544'], ['issuer', '76.544'],
] as const)('refuses a matched pair with %s=%s during capture and comparison', (field, value) => {
  const receipt = structuredClone(metricReceipt);
  const rows = metricRows.map(row => ({ ...row, [field]: value }));
  if (field === 'basis_reference') {
    receipt.metrics.eps_ttm.basis_reference = value;
    receipt.metrics.eps_ttm.additional_observations[0].basis_reference = value;
  } else receipt[field] = value;
  expect(local(receipt, rows)).toBeUndefined();
  expect(parseMetricSource(receipt)).toBeUndefined();
  const altered = structuredClone(parseMetricSource(metricReceipt)!);
  if (field === 'basis_reference') {
    altered.metrics.eps_ttm!.basis_reference = value;
    altered.metrics.eps_ttm!.additional_observations[0].basis_reference = value;
  } else altered[field] = value;
  expect(metricReferencesComparable(altered, 'eps_ttm', 'first-report', 'revised-report')).toBe(false);
});

it.each([null, 'A', '1A', 'Class-1'])('keeps a standalone class %s and requires a known class for references', share_class => {
  const acquired = local({ ...metricReceipt, share_class }, metricRows.map(row => ({ ...row, share_class })));
  const source = parseMetricSource(acquired?.metric);
  expect(source).toBeDefined();
  expect(metricReferencesComparable(source!, 'eps_ttm', 'first-report', 'revised-report')).toBe(share_class !== null);
});

it.each([['metrics', 'eodhd-key-metrics'], ['ratios', 'eodhd-financial-ratios']])(
  'cross-checks optional observation facts on the completed %s wide row', (route, origin) => {
    const context = { endpoint: '/api/v1/eodhd/equity/fundamental/' + route, selector: 'results',
      parameters: { chart_source: 'true', symbol: 'AAPL' }, retrievedAt: 1 };
    const receipt = { ...liveMetricReceipt, origin };
    const capture = (change: Record<string, unknown>) => {
      const rows = [{ ...liveMetricRows[0], ...change }];
      return captureChartSources(context, { results: rows, extra: { results_metadata: { chart_sources: { version: 1, receipts: [receipt] } } } }, rows);
    };
    expect(capture({ as_of_unknown: true, period_kind: 'TTM', period_start: null, period_end: null,
      adjustment_basis: null, reporting_basis: null, basis_reference: null, currency: 'USD', fiscal_period: 'TTM', period_ending: '2026-09-30' }))
      .toEqual({ metric: receipt });
    for (const delta of [{ as_of_unknown: false }, { period_kind: 'FY' }, { adjustment_basis: 'as-traded' },
      { reporting_basis: 'IFRS' }, { basis_reference: 'basis-A' }, { period_start: '2025-10-01' }, { period_end: '2026-09-30' },
      { vintage: '2026-11-19T13:00:00Z' }, { unit_kind: 'money' }, { unit: { kind: 'money' } }, { observation_id: 'other' },
      { metric: 'eps_ttm' }, { origin: 'price' }])
      expect(capture(delta)).toBeUndefined();
  });
