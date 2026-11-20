// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import file from '../../../test/fixtures/estimateVintageSnapshot.json';
import { datasetFromBytes, datasetFromRows } from '../../localTableData';
import type { WidgetDataset } from '../types';
import { chartPresentationProvenance, projectChartSources } from './chartSourceContracts';
import { buildEstimateRevisions, compareEstimateVintages } from './estimateRevisions';
import { runRecipe } from './run';
import { decodeRecipeOptions, decodeRecipeRequestOptions } from './settings';
import type { EstimateRevisionsOptions, RecipeContext } from './types';

const receipt = file.chart_sources.receipts[0];
const options: EstimateRevisionsOptions = {
  version: 1, kind: 'estimate-revisions', metric: 'eps', view: 'slope',
  target: { start: '2027-01-01', end: '2027-03-31', kind: 'FQ' },
  vintages: ['snap-c', 'snap-a'],
  fields: { issuer: 'issuer', vintage: 'vintage', targetStart: 'target_start', targetEnd: 'target_end', targetKind: 'target_kind', value: 'value' },
};
const path: EstimateRevisionsOptions = { ...options, view: 'path', vintages: ['snap-c', 'snap-b', 'snap-a'] };
const bump: EstimateRevisionsOptions = { ...path, view: 'bump' };
const context: RecipeContext = { maxDecimals: 2, today: '2026-11-20', theme: 'light', viewportWidth: 640, viewportHeight: 420 };

type RawRow = typeof file.rows[number];
const alfa = 'ALFA.US', beta = 'BETA.CA', gamma = 'GAMMA.US';
const original = file.rows.filter(row => row.issuer === alfa);

function snapshot(rows: RawRow[], patch: Record<string, unknown> = {}) {
  const issuers = [...new Set(rows.map(row => row.issuer))].sort().map(issuer => {
    const { entity_ref, currency, unit, basis, basis_ref } = rows.find(row => row.issuer === issuer)!;
    return { issuer, entity_ref, currency, unit, basis, basis_ref };
  });
  const members = issuers.map(i => i.issuer);
  return { ...file, rows, chart_sources: { version: 1, receipts: [{
    ...receipt, issuers, universe: { ...receipt.universe, members }, inputs: receipt.inputs.map(input => ({ ...input, members })),
    coordinates: rows.map(({ issuer, vintage }) => ({ issuer, vintage })),
    raw_count: rows.length, normalized_count: rows.length, delivered_count: rows.length, ...patch,
  }] } };
}
const oneIssuer = (values: (number | null)[]) => snapshot(original.map((row, index) => ({ ...row, value: values[index] })));
const thirdMember = () => original.map(row => ({ ...row, issuer: gamma, currency: 'EUR', entity_ref: 'acquired/gamma',
  basis_ref: 'acquired/gamma/share-class-a' }));
function threeIssuers(a: (number | null)[], b: (number | null)[], c: (number | null)[]) {
  return snapshot([original, file.rows.filter(row => row.issuer === beta), thirdMember()]
    .flatMap((rows, i) => rows.map((row, j) => ({ ...row, value: [a, b, c][i][j] }))));
}
function acquire(input: unknown, id = 'estimate-source', revision = 1) {
  return datasetFromBytes('recorded.json', new TextEncoder().encode(JSON.stringify(input)), id, revision);
}
function present(dataset: WidgetDataset, rows: WidgetDataset['rows']): WidgetDataset {
  return { ...dataset, rows, provenance: projectChartSources(chartPresentationProvenance(dataset.provenance, true), dataset.columns, rows) };
}
function compared(result: ReturnType<typeof compareEstimateVintages>) {
  expect(result.ok, result.ok ? '' : result.message).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}
function plotted(result: ReturnType<typeof buildEstimateRevisions>) {
  expect(result.ok, result.ok ? '' : result.message).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result;
}

it('known_result preserves original consensus and signs the absolute and fractional change', async () => {
  const dataset = await acquire(oneIssuer([10, 11, 12]));
  const data = compared(compareEstimateVintages(dataset, options));
  expect(data.vintages.map(v => v.id)).toEqual(['snap-a', 'snap-c']);
  const [first, second] = data.series[0].observations;
  expect(first).toMatchObject({ value: 10, change: null });
  expect(second).toMatchObject({ value: 12 });
  expect(second.change).toMatchObject({ absolute: 2, percent: .2 });
  const worker = plotted(runRecipe(dataset, options, context));
  expect(worker.figure.data[0]).toMatchObject({ type: 'scatter', y: [10, 12], connectgaps: false });
  expect(worker.estimateRevisions).toEqual(data);
  expect(worker.notes.join(' ')).toMatch(/FQ.*2027-01-01.*2027-03-31/);
  expect(worker.notes.join(' ')).toMatch(/USD\/share/);
});

it.each([0, -2])('zero_missing_and_scope keeps the signed change from prior %s and marks percentage unavailable', async prior => {
  const source = await acquire(oneIssuer([prior, null, 12]));
  const data = compared(compareEstimateVintages(source, options));
  expect(data.series[0].observations[1].change).toMatchObject({ absolute: 12 - prior, percent: null, percentUnavailable: 'nonpositive-baseline' });
  const withGap = plotted(runRecipe(source, path, context));
  expect(withGap.estimateRevisions?.series[0].observations).toMatchObject([
    { value: prior }, { value: null, state: 'missing' }, { value: 12, change: null },
  ]);
  expect(withGap.figure.data[0]).toMatchObject({ y: [prior, null, 12], connectgaps: false });
  expect(compareEstimateVintages(await acquire(file), path)).toMatchObject({ ok: false, message: expect.stringMatching(/one.*issuer/i) });
  expect(compareEstimateVintages(present(await acquire(file), []), path)).toMatchObject({ ok: false, refused: true });
});

it('orders restatements by full UTC observation time and reports omitted or absent observations without bridging either gap', async () => {
  const rows = original.map((row, i) => ({ ...row, observed_at: [
    '2026-11-11T16:00:00.123456Z', '2026-11-11T16:00:00.123450+00:00', '2026-11-11T16:00:00.123455Z',
  ][i] }));
  // Use three distinct microseconds and make IDs and incoming rows disagree with the order.
  const vintages = rows.map(({ vintage: id, observed_at, batch }) => ({ id, observed_at, batch }));
  const input = snapshot([rows[1], rows[0], rows[2]], {
    vintages, universe: { ...receipt.universe, members: [alfa], baseline_batch: 'batch-b', current_batch: 'batch-a' },
  });
  const data = compared(compareEstimateVintages(await acquire(input), path));
  expect(data.vintages.map(v => v.id)).toEqual(['snap-b', 'snap-c', 'snap-a']);
  expect(data.series[0].observations[2].change).toMatchObject({ absolute: expect.closeTo(-.2), percent: expect.closeTo(-1 / 6) });

  const all = await acquire(oneIssuer([10, 11, 12]));
  const omitted = compared(compareEstimateVintages(present(all, all.rows.filter(row => row.values.vintage !== 'snap-b')), path));
  expect(omitted.series[0].observations[1]).toMatchObject({ value: null, state: 'omitted' });
  expect(compareEstimateVintages({ ...all, rows: [all.rows[0], all.rows[2]] }, path)).toMatchObject({
    ok: false, message: expect.stringMatching(/unexplained.*missing/i),
  });
  const absent = compared(compareEstimateVintages(await acquire(snapshot([original[0], original[2]])), path));
  expect(absent.series[0].observations[1]).toMatchObject({ value: null, state: 'missing' });
});

it('rejects a target date presented as a vintage and repairs missing explicit pins', async () => {
  const legacy = datasetFromRows([{ period_ending: '2027-03-31', date: '2027-03-31', eps_avg: 12 }], 'legacy', 1, 'backend');
  expect(compareEstimateVintages(legacy, options)).toMatchObject({ ok: false, message: expect.stringMatching(/independently recorded.*snapshot/i) });
  const valid = await acquire(oneIssuer([10, 11, 12]));
  expect(compareEstimateVintages(valid, { ...options, vintages: ['snap-a', '2027-03-31'] })).toMatchObject({
    ok: false, message: expect.stringMatching(/pinned.*unavailable.*select/i),
  });
  expect(compareEstimateVintages(valid, { ...options, fields: { ...options.fields, vintage: 'target_end', targetEnd: 'vintage' } }))
    .toMatchObject({ ok: false, message: expect.stringMatching(/physical.*fields/i) });
});

it('requires the same actual target start, end and FY/FQ kind, even when fiscal labels look identical', async () => {
  const dataset = await acquire(oneIssuer([10, 11, 12]));
  for (const target of [
    { ...options.target, start: '2026-12-31' },
    { ...options.target, end: '2027-03-30' },
    { ...options.target, kind: 'FY' as const },
  ]) expect(compareEstimateVintages(dataset, { ...options, target })).toMatchObject({ ok: false, message: expect.stringMatching(/pinned target/i) });
  const rows = dataset.rows.map((r, index) => index === 2 ? { ...r, values: { ...r.values, target_kind: 'FY' } } : r);
  expect(compareEstimateVintages({ ...dataset, rows }, options)).toMatchObject({ ok: false, message: expect.stringMatching(/visible.*acquired/i) });
});

it('hidden_unsafe_fact refuses a conflicting duplicate even after its row is hidden', async () => {
  const input = oneIssuer([10, 11, 12]);
  const before = input.chart_sources.receipts[0];
  const dataset = await acquire(snapshot(input.rows, { raw_count: 4, diagnostics: ['duplicate_conflict'],
    unsafe: { ...before.unsafe, duplicate_conflict: true } }));
  const filtered = present(dataset, [dataset.rows[0], dataset.rows[2]]);
  expect(compareEstimateVintages(filtered, options)).toMatchObject({ ok: false, message: expect.stringMatching(/conflicting duplicate/i) });
});

it('validates physical aliases and companion facts without recovering a hidden or calculated measure', async () => {
  const source = await acquire(oneIssuer([10, 11, 12]));
  const renamed = { ...source,
    columns: source.columns.map(c => c.id === 'value' || c.id === 'currency' ? { ...c, id: 'alias_' + c.id, sourceFieldId: c.id } : c),
    rows: source.rows.map(r => ({ ...r, values: { ...r.values, alias_value: r.values.value, alias_currency: r.values.currency } })),
  };
  const option = { ...options, fields: { ...options.fields, value: 'alias_value' } };
  expect(compared(compareEstimateVintages(renamed, option)).series[0].observations[1].value).toBe(12);
  for (const change of [
    { columns: renamed.columns.filter(c => c.id !== 'alias_value') },
    { columns: [...renamed.columns, { id: 'another', label: 'Another', sourceFieldId: 'value' }] },
    { columns: renamed.columns.map(c => c.id !== 'alias_value' ? c : { ...c, analytical: { kind: 'formula', definitionId: 'fake', name: 'Fake' } as const }) },
    { provenance: { ...renamed.provenance, inputMayContainAggregates: true } },
  ]) expect(compareEstimateVintages({ ...renamed, ...change }, option)).toMatchObject({ ok: false, refused: true });

  for (const patch of [
    { alias_currency: 'CAD' }, { basis_ref: 'another-share-class' }, { entity_ref: 'other' },
    { observed_at: options.target.end }, { source_contract: 'target-period-history' }, { input_ref: 'another/input' }, { batch: 'batch-b' },
  ]) {
    const rows = renamed.rows.map((r, i) => i ? { ...r, values: { ...r.values, ...patch } } : r);
    expect(compareEstimateVintages({ ...renamed, rows }, option)).toMatchObject({ ok: false, message: expect.stringMatching(/visible.*acquired/i) });
  }
  const rows = renamed.rows.map((r, i) => i === 2 ? { ...r, values: { ...r.values, alias_value: null } } : r);
  expect(compared(compareEstimateVintages({ ...renamed, rows }, option)).series[0].observations[1].value).toBeNull();
});

it('ranks same-batch percentage revisions as competition ties across native issuer currencies', async () => {
  const dataset = await acquire(threeIssuers([10, 8, 12], [20, 40, 24], [30, 30, 33]));
  const result = plotted(runRecipe(dataset, bump, context));
  const series = result.estimateRevisions!.series;
  expect(series.map(s => s.issuer.issuer)).toEqual([alfa, beta, gamma]);
  expect(series.map(s => s.unitLabel)).toEqual(['USD/share', 'CAD/share', 'EUR/share']);
  expect(series.map(s => s.observations[0].rank)).toEqual([1, 1, 1]);
  expect(series.map(s => s.observations[1].rank)).toEqual([3, 1, 2]);
  const ranks = series.map(s => s.observations[2].rank);
  expect(ranks).toEqual([1, 1, 3]);
  expect(result.figure.data).toMatchObject([{ y: [1, 3, 1] }, { y: [1, 1, 1] }, { y: [1, 2, 3] }]);
  expect(result.notes.join(' ')).toMatch(/baseline.*batch-a/);
});

it('ranks unequal ratios even if rounded percentage fractions coincide', async () => {
  const source = await acquire(threeIssuers([1.0000000000000002, 1, 2.000000000000001], [1, 1, 2.0000000000000004], [1, 1, 1]));
  const series = compared(compareEstimateVintages(source, bump)).series;
  // BETA has the slightly larger exact ratio, though both round to the same display fraction.
  expect(series.slice(0, 2).map(s => s.observations[2].change?.percent)).toEqual([1.0000000000000004, 1.0000000000000004]);
  expect(series.map(s => s.observations[2].rank)).toEqual([2, 1, 3]);
});

it('refuses an unproven ranking universe or a different baseline and marks the whole column unavailable for a missing member', async () => {
  const input = threeIssuers([10, 12, 13], [20, 22, 23], [30, null, 36]);
  const dataset = await acquire(input);
  const data = compared(compareEstimateVintages(dataset, bump));
  expect(data.series.map(s => s.observations[1].rank)).toEqual([null, null, null]);
  expect(data.series.map(s => s.observations[2].rank)).toEqual([1, 3, 2]);
  expect(data.columns[1]).toMatchObject({ status: 'unavailable', unavailableMembers: [gamma] });
  const allButGamma = present(dataset, dataset.rows.filter(row => row.values.issuer !== gamma));
  expect(compareEstimateVintages(allButGamma, bump)).toMatchObject({ ok: false, message: expect.stringMatching(/baseline.*every.*member/i) });
  const onlyCurrentMissing = present(dataset, dataset.rows.filter(row => !(row.values.issuer === gamma && row.values.vintage === 'snap-c')));
  expect(compared(compareEstimateVintages(onlyCurrentMissing, bump)).series.map(s => s.observations[2].rank)).toEqual([null, null, null]);
  const u = input.chart_sources.receipts[0];
  const unknown = snapshot(input.rows, { universe: { status: 'unknown' }, inputs: u.inputs.map(i => ({ ...i, members: null, universe_id: null })) });
  expect(compareEstimateVintages(await acquire(unknown), bump)).toMatchObject({ ok: false, message: expect.stringMatching(/complete.*universe/i) });
  expect(compareEstimateVintages({ ...dataset, completeness: { ...dataset.completeness, kind: 'partial' } }, bump))
    .toMatchObject({ ok: false, message: expect.stringMatching(/complete.*universe/i) });
  expect(compareEstimateVintages(dataset, { ...bump, vintages: ['snap-b', 'snap-c'] }))
    .toMatchObject({ ok: false, message: expect.stringMatching(/baseline.*current/i) });
});

it('forbids percentage ranks when any baseline is zero or negative', async () => {
  for (const value of [0, -1]) {
    const dataset = await acquire(threeIssuers([10, 12, 13], [20, 22, 23], [value, 30, 33]));
    expect(compareEstimateVintages(dataset, bump)).toMatchObject({ ok: false, message: expect.stringMatching(/positive.*baseline.*every.*member/i) });
  }
});

it('numerical_limits reports unsupported change magnitudes, preserves exact extreme rank order, and refuses misleading linear scales', async () => {
  const extreme = await acquire(oneIssuer([Number.MAX_VALUE, 1, -Number.MAX_VALUE]));
  expect(compared(compareEstimateVintages(extreme, options)).series[0].observations[1].change)
    .toMatchObject({ absolute: null, absoluteUnavailable: 'out-of-range', percent: -2 });
  expect(buildEstimateRevisions(extreme, options, context)).toMatchObject({ ok: false, message: expect.stringMatching(/linear scale.*faithfully/i) });
  const tiny = await acquire(oneIssuer([Number.MIN_VALUE, 0, 2 * Number.MIN_VALUE]));
  expect(compared(compareEstimateVintages(tiny, options)).series[0].observations[1].change)
    .toMatchObject({ absolute: Number.MIN_VALUE, percent: 1 });
  expect(buildEstimateRevisions(tiny, options, context)).toMatchObject({ ok: false, message: expect.stringMatching(/linear scale.*faithfully/i) });

  const ranked = await acquire(threeIssuers([1e-300, 1, 1e300], [2e-300, 1, 1e300], [1e300, 1, -1e300]));
  const data = compared(compareEstimateVintages(ranked, bump));
  expect(data.series.map(s => s.observations[2].rank)).toEqual([1, 2, 3]);
  expect(data.series[0].observations[2].change).toMatchObject({ percent: null, percentUnavailable: 'out-of-range' });
  expect(plotted(runRecipe(ranked, bump, context)).figure.data).toMatchObject([{ y: [1, 1, 1] }, { y: [1, 2, 2] }, { y: [1, 3, 3] }]);
});

it('accepts closed worker options only and rejects incomplete, executable or unstated comparison choices', async () => {
  const source = await acquire(oneIssuer([10, 11, 12]));
  expect(decodeRecipeRequestOptions(options)).toEqual({ ok: true, options });
  expect(decodeRecipeOptions(options, 'estimate-revisions')).toEqual({ ok: true, options });
  for (const settings of [
    { ...options, version: 2 }, { ...options, view: 'chart' }, { ...options, metric: 'price' },
    { ...options, vintages: ['snap-a', 'snap-a'] }, { ...options, vintages: ['snap-a'] },
    { ...path, vintages: ['snap-a', 'snap-b'] }, { ...options, vintages: ['snap-a', 'snap-b', 'snap-c'] },
    { ...options, target: { ...options.target, source: 'acquired' } }, { ...options, certify: true },
    { ...options, fields: { ...options.fields, value: 'vintage' } },
    { ...options, fields: { ...options.fields, get value() { throw new Error('settings must be data'); } } },
  ]) expect(runRecipe(source, settings as EstimateRevisionsOptions, context)).toMatchObject({ ok: false, refused: true });
});

it('keeps the semantic question across refresh and resizing, and changes it for a new pin, source or issuer', async () => {
  const refreshed = oneIssuer([11, 12, 13]);
  refreshed.chart_sources.receipts[0].retrieved_at = '2026-11-18T16:00:00Z';
  const first = plotted(runRecipe(await acquire(oneIssuer([10, 11, 12])), options, context));
  const next = plotted(runRecipe(await acquire(refreshed, 'estimate-source', 7), { ...options, vintages: ['snap-a', 'snap-c'] },
    { ...context, theme: 'dark', viewportWidth: 320 }));
  expect(next.revision).toBe(first.revision);
  expect(next.figure.layout.uirevision).toBe(first.revision);
  const other = plotted(runRecipe(await acquire(refreshed, 'other'), options, context));
  expect(other.revision).not.toBe(first.revision);
  const otherPin = plotted(runRecipe(await acquire(refreshed), { ...options, vintages: ['snap-a', 'snap-b'] }, context));
  expect(otherPin.revision).not.toBe(first.revision);
  const multi = await acquire(file);
  const betaOnly = plotted(runRecipe(present(multi, multi.rows.filter(r => r.values.issuer === beta)), options, context));
  const alfaOnly = plotted(runRecipe(present(multi, multi.rows.filter(r => r.values.issuer === alfa)), options, context));
  expect(betaOnly.revision).not.toBe(alfaOnly.revision);
});

function tiedCohort(count: number) {
  return snapshot(Array.from({ length: count }, (_, index) => {
    const issuer = `RANK${String(index).padStart(3, '0')}.US`, baseline = 10 + index;
    return original.map((row, position) => ({ ...row, issuer, entity_ref: 'recorded/entity/' + issuer,
      basis_ref: 'recorded/shares/' + issuer, value: baseline * [1, 3, 2][position] }));
  }).flat());
}

it('requires enough measured space to inspect all six issuers in one tied column', async () => {
  const dataset = await acquire(tiedCohort(6));
  const small = runRecipe(dataset, bump, { ...context, viewportWidth: 320, viewportHeight: 230 });
  expect(small).toMatchObject({ ok: false, refused: true,
    estimateRevisionsSurface: { width: 320, height: expect.any(Number) } });
  const minimum = small.estimateRevisionsSurface!;
  expect(minimum.height).toBeGreaterThan(302);
  const full = plotted(runRecipe(dataset, bump, { ...context, viewportWidth: minimum.width, viewportHeight: minimum.height }));
  expect(full.estimateRevisionsSurface).toEqual(minimum);
  expect(full.estimateRevisions?.series.map(s => s.observations[2].rank)).toEqual([1, 1, 1, 1, 1, 1]);
});

it('reserves enough horizontal room for all UTC ticks after precise value labels widen the left margin', async () => {
  const dataset = await acquire(oneIssuer([1e200, 1.0000000002e200, 1.0000000005e200]));
  const small = runRecipe(dataset, path, { ...context, viewportWidth: 320, viewportHeight: 230 });
  expect(small).toMatchObject({ ok: false, refused: true,
    estimateRevisionsSurface: { width: expect.any(Number), height: 230 } });
  const minimum = small.estimateRevisionsSurface!;
  expect(minimum.width).toBeGreaterThan(320);
  const full = plotted(runRecipe(dataset, path, { ...context, viewportWidth: minimum.width, viewportHeight: minimum.height }));
  expect(full.estimateRevisionsSurface).toEqual(minimum);
  expect(full.figure.layout.xaxis).toMatchObject({ tickangle: 0 });
});

it('refuses a measured surface beyond the supported drawing limit without returning an impossible size hint', async () => {
  const source = await acquire(tiedCohort(200));
  expect(compared(compareEstimateVintages(source, bump)).series.map(s => s.observations[2].rank)).toEqual(Array(200).fill(1));
  expect(runRecipe(source, bump, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/exceeds.*10,000.*drawing limit/i),
  });
  expect(runRecipe(source, bump, context).estimateRevisionsSurface).toBeUndefined();
});
