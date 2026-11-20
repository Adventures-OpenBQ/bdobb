// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { datasetFromRows } from '../../localTableData';
import { captureChartSources, localChartSources, projectChartSources } from '../chartRecipes/chartSourceContracts';
import { liveMetricReceipt, liveMetricRows, metricReceipt, metricRows } from '../../../test/fixtures/metricEvidence';
import type { WidgetDataset } from '../types';
import { buildKpiSnapshot, formatKpiValue } from './build';
import { decodeLinkedKpiOptions } from './settings';
import type { LinkedKpiOptions } from './types';

const latest: LinkedKpiOptions = {
  version: 1, metric: 'eps_ttm', valueField: 'eps_ttm', observation: { mode: 'latest' }, view: 'card',
};
const pinFirst: LinkedKpiOptions = { ...latest, observation: { mode: 'pinned', id: 'first-report' } };
const compare: LinkedKpiOptions = { ...latest, reference: { kind: 'observation', id: 'first-report' } };
const gauge: LinkedKpiOptions = { ...latest, view: 'gauge', range: { min: 0, max: 100, label: 'Review range' } };

function prepared(values = [0, 76.544], changes: Record<string, unknown> = {}, shareClass: string | null = 'Ordinary-A', optionalFacts?: Record<string, unknown>) {
  const { unit: usd, ...next } = metricReceipt.metrics.eps_ttm.additional_observations[0];
  const revised = { ...next, ...changes, unit: changes.unit as typeof usd ?? usd };
  const receipt = { ...metricReceipt, share_class: shareClass, metrics: {
    eps_ttm: { ...metricReceipt.metrics.eps_ttm, additional_observations: [revised] },
  } };
  const rows = metricRows.map((row, index) => ({
    ...row, eps_ttm: values[index], share_class: shareClass, ...(index === 1 && optionalFacts), ...(index === 0 && {
      vintage: revised.vintage, period_start: revised.period_start, period_end: revised.period_end,
      adjustment_basis: revised.adjustment_basis, basis_reference: revised.basis_reference,
      reporting_basis: revised.reporting_basis, currency: revised.unit.currency,
    }),
  }));
  const chartSources = localChartSources({ version: 1, receipts: [receipt] }, rows, 'complete');
  const dataset = datasetFromRows(rows, 'eps', 1, 'localFile', undefined, [], { completeness: 'complete', chartSources });
  expect(dataset.provenance.metadata?.chartSources).toBeDefined();
  return dataset;
}
function live(yieldValue: number) {
  const rows = [{ ...liveMetricRows[0], dividend_yield: yieldValue }];
  const context = { endpoint: '/api/v1/eodhd/equity/fundamental/metrics', selector: 'results',
    parameters: { chart_source: 'true', symbol: 'AAPL' }, retrievedAt: 1 };
  const chartSources = captureChartSources(context, {
    results: rows, extra: { results_metadata: { chart_sources: { version: 1, receipts: [liveMetricReceipt] } } },
  }, rows);
  expect(chartSources).toBeDefined();
  return datasetFromRows(rows, 'live', 1, 'backend', undefined, [], undefined, { ...context, chartSources });
}
const yieldOptions: LinkedKpiOptions = { ...latest, metric: 'dividend_yield', valueField: 'dividend_yield' };

function projection(dataset: WidgetDataset, rows = dataset.rows, columns = dataset.columns): WidgetDataset {
  const provenance = { ...dataset.provenance, metadata: { ...dataset.provenance.metadata, chartSourceFiltered: true as const } };
  return { ...dataset, rows, columns, provenance: projectChartSources(provenance, columns, rows) };
}

it('known_result: computes an explicit same-period comparison and describes its original measurements', () => {
  const dataset = prepared([6, 4]);
  const result = buildKpiSnapshot(dataset, compare);
  if (!result.ok) throw Error(result.message);
  expect(result.snapshot).toMatchObject({ value: 6, deltaAbsolute: 2, deltaPercent: 50,
    unit: { kind: 'money-per-share', currency: 'USD' }, asOf: null, retrievedAt: '2026-11-20T04:16:46Z',
    issuer: 'EXAMPLE.US', listing: 'EXMPL.NYSE', shareClass: 'Ordinary-A',
    observation: { observation_id: 'revised-report', vintage: '2026-11-12T13:00:00Z', period_end: '2026-09-30' },
    reference: { kind: 'observation', value: 4, observation: { observation_id: 'first-report', vintage: '2026-11-02T13:00:00Z' } },
  });
  expect(buildKpiSnapshot({ ...dataset, rows: [...dataset.rows].reverse() }, compare)).toEqual(result);
});

it('zero_missing_and_scope: separates true zero, missing, cell error and unselected many-row input', () => {
  const zero = buildKpiSnapshot(prepared(), latest);
  if (!zero.ok) throw Error(zero.message);
  expect(zero.snapshot.value).toBe(0);
  expect(zero.snapshot.deltaPercent).toBeUndefined();
  const baseline = buildKpiSnapshot(prepared([2, 0]), compare);
  if (!baseline.ok) throw Error(baseline.message);
  expect(baseline.snapshot.deltaAbsolute).toBe(2);
  expect(baseline.snapshot.deltaPercent).toBeUndefined();
  const negativeBaseline = buildKpiSnapshot(prepared([2, -1]), compare);
  if (!negativeBaseline.ok) throw Error(negativeBaseline.message);
  expect(negativeBaseline.snapshot.deltaAbsolute).toBe(3);
  expect(negativeBaseline.snapshot.deltaPercent).toBeUndefined();
  const input = prepared();
  const [row, older] = input.rows;
  expect(buildKpiSnapshot(input, { ...latest, observation: undefined } as unknown as LinkedKpiOptions)).toMatchObject({ ok: false });
  expect(buildKpiSnapshot({ ...input, rows: [...input.rows, row] }, latest)).toMatchObject({ ok: false, message: expect.stringMatching(/ambiguous/i) });
  const change = (value: unknown) => ({ ...input, rows: [{ ...row, values: { ...row.values, eps_ttm: value } }, older] });
  expect(buildKpiSnapshot(change(null), latest)).toMatchObject({ ok: false, message: expect.stringMatching(/missing/i) });
  expect(buildKpiSnapshot(change('0.00'), latest)).toMatchObject({ ok: false, message: expect.stringMatching(/numeric/i) });
  const broken = { ...row, cellErrors: { eps_ttm: { code: 'DOMAIN', message: 'User-controlled error' } } };
  expect(buildKpiSnapshot({ ...input, rows: [broken, older] }, latest)).toMatchObject({ ok: false, message: expect.stringMatching(/cell error/i) });
});

it('hidden_unsafe_fact: refuses raw conflicts after filters and never recovers hidden current or reference values', () => {
  const input = prepared();
  const onlyOlder = projection(input, [input.rows[1]]);
  expect(buildKpiSnapshot(onlyOlder, latest)).toMatchObject({ ok: false, message: expect.stringMatching(/latest.*unavailable/i) });
  expect(buildKpiSnapshot(onlyOlder, pinFirst)).toMatchObject({ ok: true, snapshot: { value: 76.544,
    scope: { acquiredRowCount: 2, presentedRowCount: 1, filtered: true, omittedObservationCount: 1 } },
  });
  const onlyCurrent = projection(input, [input.rows[0]]);
  expect(buildKpiSnapshot(onlyCurrent, pinFirst)).toMatchObject({ ok: false, message: expect.stringMatching(/pinned.*unavailable/i) });
  expect(buildKpiSnapshot(onlyCurrent, compare)).toMatchObject({ ok: false, message: expect.stringMatching(/reference.*unavailable/i) });
  expect(buildKpiSnapshot({ ...onlyOlder, rows: input.rows }, latest)).toMatchObject({ ok: false });
  const unsafe = { ...metricReceipt, diagnostics: ['unit_conflict'], unsafe: { ...metricReceipt.unsafe, unit_conflict: true } };
  onlyOlder.provenance.metadata!.chartSources = { metric: unsafe };
  expect(buildKpiSnapshot(onlyOlder, pinFirst)).toMatchObject({ ok: false, message: expect.stringMatching(/unsafe/i) });
});

it('numerical_limits: refuses bad source numbers, overflowing deltas and collapsed positions', () => {
  const input = prepared();
  for (const value of [NaN, Infinity, -Infinity]) {
    const row = { ...input.rows[0], values: { ...input.rows[0].values, eps_ttm: value } };
    expect(buildKpiSnapshot({ ...input, rows: [row, input.rows[1]] }, latest)).toMatchObject({ ok: false, message: expect.stringMatching(/finite/i) });
  }
  expect(buildKpiSnapshot(prepared([Number.MAX_VALUE, -Number.MAX_VALUE]), compare)).toMatchObject({ ok: false, message: expect.stringMatching(/delta/i) });
  expect(buildKpiSnapshot(prepared([20, Number.MIN_VALUE]), compare)).toMatchObject({ ok: false, message: expect.stringMatching(/delta/i) });
  expect(buildKpiSnapshot(prepared([Number.MIN_VALUE, 0]), gauge)).toMatchObject({ ok: false, message: expect.stringMatching(/geometry/i) });
  expect(buildKpiSnapshot(prepared([Number.MAX_VALUE / 2, 0]), {
    ...gauge, range: { min: -Number.MAX_VALUE, max: Number.MAX_VALUE, label: 'Wide range' },
  })).toMatchObject({ ok: true, gauge: { data: [{ type: 'indicator', value: .75 }] } });
});

it('verified units display a fraction once and reject formatting or field substitutions and hidden live modes', () => {
  const dataset = live(.04);
  const result = buildKpiSnapshot(dataset, yieldOptions);
  if (!result.ok) throw Error(result.message);
  expect(result.snapshot).toMatchObject({ value: .04, unit: { kind: 'fraction' }, asOf: null, shareClass: null,
    observation: { adjustment_basis: null }, label: 'Trailing dividend yield' });
  expect(formatKpiValue(result.snapshot.value, result.snapshot.unit)).toBe('4%');
  expect(formatKpiValue(.029, { kind: 'fraction' })).toBe('2.9%');
  expect(formatKpiValue(1.234, { kind: 'money-per-share', currency: 'GBX' })).toBe('1.234 GBX per share');
  expect(buildKpiSnapshot(dataset, { ...yieldOptions, valueField: 'pe_ratio' })).toMatchObject({ ok: false });
  expect(buildKpiSnapshot(dataset, { ...yieldOptions, metric: 'pe_ratio', valueField: 'pe_ratio' })).toMatchObject({
    ok: true, snapshot: { value: 39.2483, asOf: null, unit: { kind: 'multiple' } },
  });
  for (const metric of ['price', 'market_cap', 'eps_ttm', 'revenue_ttm'] as const)
    expect(buildKpiSnapshot(dataset, { ...yieldOptions, metric, valueField: metric })).toMatchObject({ ok: false });
  expect(buildKpiSnapshot(dataset, { ...yieldOptions, reference: { kind: 'observation', id: 'other-date' } })).toMatchObject({ ok: false });
  const rawAlias = dataset.columns.map(c => c.id !== 'dividend_yield' ? c : { ...c, id: 'display-yield', sourceFieldId: c.id });
  const rows = [{ ...dataset.rows[0], values: { ...dataset.rows[0].values, 'display-yield': .04 } }];
  expect(buildKpiSnapshot({ ...dataset, columns: rawAlias, rows }, { ...yieldOptions, valueField: 'display-yield' })).toMatchObject({ ok: true });
  const changed = rawAlias.map(c => c.id !== 'display-yield' ? c : { ...c, aggregation: 'sum' as const });
  expect(buildKpiSnapshot({ ...dataset, columns: changed, rows }, { ...yieldOptions, valueField: 'display-yield' })).toMatchObject({ ok: false });
});

it('preserves exceeded values as cards and treats user ranges and targets as assumptions', () => {
  const exceeded = buildKpiSnapshot(prepared([120, 0]), gauge);
  expect(exceeded).toMatchObject({ ok: true, snapshot: { value: 120, outOfRange: true },
    notes: [expect.stringMatching(/outside/i)] });
  expect(exceeded.ok && exceeded.gauge).toBeUndefined();
  const result = buildKpiSnapshot(live(.04), {
    ...yieldOptions, view: 'gauge', range: { min: 0, max: .1, label: '<b>Plan</b>' },
    reference: { kind: 'user-target', value: .02 },
  });
  expect(result).toMatchObject({ ok: true, snapshot: { value: .04, deltaAbsolute: .02, deltaPercent: 100,
    referenceLabel: expect.stringMatching(/user target.*assumption/i), reference: { kind: 'user-target', value: .02 },
    range: { label: expect.stringMatching(/user range.*assumption/i) },
  } });
  expect(result.ok && JSON.stringify(result.gauge)).toContain('&lt;b&gt;Plan&lt;/b&gt;');
  expect(result.ok && result.gauge?.layout.annotations).toEqual(expect.arrayContaining([expect.objectContaining({ text: '4%' })]));
  expect(buildKpiSnapshot(prepared(), { ...gauge, range: undefined })).toMatchObject({ ok: false });
  expect(buildKpiSnapshot(prepared(), { ...gauge, range: { min: 2, max: 2, label: 'Flat' } })).toMatchObject({ ok: false });
});

it('refuses incompatible period, basis and currency and rejects settings proof and unknown unit overrides', () => {
  for (const facts of [{ period_start: '2025-07-01', period_end: '2026-06-30' }, { adjustment_basis: 'diluted-split-adjusted' },
    { basis_reference: 'new-basis' }, { reporting_basis: 'IFRS' }, { unit: { kind: 'money-per-share', currency: 'CAD' } }])
    expect(buildKpiSnapshot(prepared([2, 1], facts), compare)).toMatchObject({ ok: false, message: expect.stringMatching(/comparable/i) });
  expect(buildKpiSnapshot(prepared([2, 1], {}, null), latest)).toMatchObject({ ok: true, snapshot: { shareClass: null } });
  expect(buildKpiSnapshot(prepared([2, 1], {}, null), compare)).toMatchObject({ ok: false });
  expect(decodeLinkedKpiOptions({ ...gauge, range: { ...gauge.range, kind: 'fraction' } })).toMatchObject({ ok: false });
  expect(decodeLinkedKpiOptions({ ...latest, reference: { kind: 'user-target', value: 2, currency: 'CAD' } })).toMatchObject({ ok: false });
  expect(decodeLinkedKpiOptions({ ...latest, source: metricReceipt })).toMatchObject({ ok: false });
  expect(decodeLinkedKpiOptions({ ...latest, version: 2 })).toMatchObject({ ok: false });
});

it('changes revision with selected observations and reference choices, independent of routine input and row values', () => {
  const input = prepared([2, 1]);
  const initial = buildKpiSnapshot(input, latest);
  if (!initial.ok) throw Error(initial.message);
  expect(buildKpiSnapshot({ ...prepared([4, 3]), resultRevision: 481, outputRevision: 71 }, latest))
    .toMatchObject({ ok: true, revision: initial.revision });
  for (const [dataset, options] of [[input, pinFirst], [input, compare], [input, gauge],
    [prepared([2, 1], { vintage: '2026-11-12T13:00:00.000001Z' }), latest]] as const) {
    const result = buildKpiSnapshot(dataset, options);
    expect(result.ok && result.revision).not.toBe(initial.revision);
    expect(result.ok).toBe(true);
  }
  const tied = prepared([2, 1], { vintage: '2026-11-02T13:00:00.000000Z', period_start: '2025-07-01', period_end: '2026-06-30' });
  expect(buildKpiSnapshot(tied, latest)).toMatchObject({ ok: false, message: expect.stringMatching(/ambiguous/i) });
});

it('accepts normalized absent optional facts but rejects a visible contradiction on a selected observation', () => {
  const input = prepared([2, 1], {}, 'Ordinary-A', { symbol: 'EXMPL.NYSE', as_of_unknown: true });
  expect(input.rows[0].values.symbol).toBeNull();
  expect(buildKpiSnapshot(input, compare)).toMatchObject({ ok: true, snapshot: { value: 2, deltaAbsolute: 1 } });
  const [current, earlier] = input.rows;
  const wrong = { ...current, values: { ...current.values, currency: 'CAD' } };
  expect(buildKpiSnapshot({ ...input, rows: [wrong, earlier] }, latest))
    .toMatchObject({ ok: false, message: expect.stringMatching(/contradicts/i) });
});

it.each([
  ['price', 'money-per-share', 'GBX', 'as-traded', null, '23.71 GBX per share'],
  ['market_cap', 'money', 'CAD', 'issuer-all-classes', null, '23.71 CAD'],
  ['dividend_yield', 'fraction', null, 'trailing-dividend-per-share', 'TTM', '2371%'],
  ['pe_ratio', 'multiple', null, 'trailing-diluted-earnings', 'TTM', '23.71×'],
  ['eps_ttm', 'money-per-share', 'USD', 'diluted-as-reported', 'TTM', '23.71 USD per share'],
  ['revenue_ttm', 'money', 'JPY', 'as-reported', 'TTM', '23.71 JPY'],
] as const)('shows an explicit acquired %s snapshot in its declared units', (metric, kind, currency, adjustment_basis, period_kind, display) => {
  const reported = metric === 'eps_ttm' || metric === 'revenue_ttm';
  const observation = {
    ...metricReceipt.metrics.eps_ttm, origin: metric, unit: currency ? { kind, currency } : { kind },
    adjustment_basis, period_kind, period_start: reported ? '2025-10-01' : null, period_end: reported ? '2026-09-30' : null,
    reporting_basis: reported ? 'US-GAAP' : null, additional_observations: [],
  };
  const receipt = { ...metricReceipt, raw_count: 1, normalized_count: 1, delivered_count: 1, metrics: { [metric]: observation } };
  const rows = [{
    ...metricRows[1], [metric]: 23.71, metric, currency, unit_kind: kind, adjustment_basis, period_kind,
    period_start: observation.period_start, period_end: observation.period_end, reporting_basis: observation.reporting_basis,
  }];
  const chartSources = localChartSources({ version: 1, receipts: [receipt] }, rows, 'complete');
  const input = datasetFromRows(rows, 'prepared', 1, 'localFile', undefined, [], { completeness: 'complete', chartSources });
  const result = buildKpiSnapshot(input, { ...latest, metric, valueField: metric });
  if (!result.ok) throw Error(result.message);
  expect(result.snapshot.value).toBe(23.71);
  expect(formatKpiValue(result.snapshot.value, result.snapshot.unit)).toBe(display);
});
