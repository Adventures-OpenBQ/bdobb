// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import {
  acquiredOwnershipPartition, acquiredOwnershipRows, liveOwnershipContext, liveOwnershipReceipt, liveOwnershipRows, unsafeOwnershipPartition,
} from '../../../test/fixtures/ownershipEvidence';
import { datasetFromBytes, datasetFromRows } from '../../localTableData';
import type { WidgetDataset } from '../types';
import { ownershipInputFields } from './bindings';
import { captureChartSources, projectChartSources } from './chartSourceContracts';
import type { OwnershipMeasure } from './ownershipEvidence';
import { allocateWaffle, buildOwnershipSnapshot } from './ownershipSnapshot';
import { runRecipe } from './run';
import { decodeRecipeOptions } from './settings';
import type { OwnershipSnapshotOptions, RecipeContext } from './types';

const context: RecipeContext = { theme: 'light', today: '2026-11-20', maxDecimals: 2, viewportWidth: 600, viewportHeight: 320 };
const identity = { version: 1, kind: 'ownership-snapshot', issuer: 'EXAMPLE.US' } as const;
const bars: OwnershipSnapshotOptions = {
  ...identity, view: 'bars', fields: { insiders: 'insider_pct', institutions: 'institution_fraction', freeFloat: 'free_float' },
};
const waffle: OwnershipSnapshotOptions = {
  ...identity, view: 'waffle', fields: { bucket: 'bucket_id', share: 'reported_share' },
};
const barReceipt = {
  ...acquiredOwnershipPartition, raw_count: 1, normalized_count: 1, delivered_count: 1, bucket_keys: undefined,
  measures: {
    insiders: { unit: 'percent-points', basis: 'shares-outstanding', as_of: null },
    institutions: { unit: 'fraction', basis: null as OwnershipMeasure['basis'], as_of: '2026-09-30' },
    freeFloat: { unit: 'percent-points', basis: 'shares-outstanding', as_of: '2026-08-31' },
  },
  field_origins: bars.fields, partition: { status: 'unavailable' },
};
const barRow = {
  symbol: 'EXAMPLE.US', share_class: 'Class-A', insider_pct: .5, institution_fraction: .5,
  free_float: 50, date: '2026-11-20', float_shares: 100, outstanding_shares: 100,
};
const load = (receipt: unknown, rows: unknown[]) => datasetFromBytes('ownership.json', new TextEncoder().encode(JSON.stringify({
  rows, completeness: 'complete', chart_sources: { version: 1, receipts: [receipt] },
})), 'ownership', 1);
const refusal = (message: RegExp) => ({ ok: false, refused: true, message: expect.stringMatching(message) });
const buildBars = async (row = {}) => runRecipe(await load(barReceipt, [{ ...barRow, ...row }]), bars, context);

function partition(percentages: number[], rounding = 0) {
  const keys = percentages.map((_, i) => String.fromCharCode(97 + i));
  const receipt = { ...acquiredOwnershipPartition, raw_count: keys.length, normalized_count: keys.length,
    delivered_count: keys.length, bucket_keys: keys, partition: { ...acquiredOwnershipPartition.partition, rounding_bound_percent: rounding } };
  const rows = percentages.map((percent, i) => ({ ...acquiredOwnershipRows[0], bucket_id: keys[i], reported_share: percent }));
  return load(receipt, rows);
}

function liveDataset(receipt: unknown = liveOwnershipReceipt, row: Record<string, unknown> = liveOwnershipRows[0]) {
  const rows = [structuredClone(row)];
  const chartSources = captureChartSources(liveOwnershipContext, {
    results: rows, extra: { results_metadata: { chart_sources: { version: 1, receipts: [receipt] } } },
  }, rows);
  return datasetFromRows(rows, 'live-source', 1, 'backend', undefined, [], undefined, { ...liveOwnershipContext, chartSources });
}

it('known_result', async () => {
  expect(allocateWaffle([{ id: 'a', percent: 33.3 }, { id: 'b', percent: 33.3 }, { id: 'c', percent: 33.4 }])).toEqual({ a: 33, b: 33, c: 34 });
  const result = runRecipe(await partition([33.3, 33.3, 33.4]), waffle, context);
  expect(result).toMatchObject({ ok: true, ownershipSnapshot: {
    view: 'waffle', issuer: 'EXAMPLE.US', shareClass: 'Class-A', asOf: '2026-09-30',
    denominator: 'outstanding-shares', retrievedAt: acquiredOwnershipPartition.retrieved_at,
    buckets: [{ id: 'a', percent: 33.3, cells: 33 }, { id: 'b', percent: 33.3, cells: 33 }, { id: 'c', percent: 33.4, cells: 34 }],
  } });
  if (!result.ok) return;
  expect(result.figure.data).toEqual([expect.objectContaining({ type: 'scatter', x: expect.any(Array), y: expect.any(Array) })]);
  expect((result.figure.data[0] as { x: number[] }).x).toHaveLength(100);
  expect(result.notes.join(' ')).toMatch(/1%.*discrepancy/i);
});

it('zero_missing_and_scope', async () => {
  const result = await buildBars({ insider_pct: 0, institution_fraction: null });
  expect(result).toMatchObject({ ok: true, ownershipSnapshot: {
    shareClass: 'Class-A', retrievedAt: barReceipt.retrieved_at,
    measures: [
      { id: 'insiders', status: 'observed', reported: 0, fraction: 0, unit: 'percent-points', asOf: null },
      { id: 'institutions', status: 'unavailable', reported: null, fraction: null, unit: 'fraction', asOf: '2026-09-30', basis: null },
      { id: 'freeFloat', status: 'observed', reported: 50, fraction: .5, asOf: '2026-08-31' },
    ],
  } });
  if (!result.ok) return;
  expect(result.notes).toEqual(expect.arrayContaining([
    expect.stringMatching(/Insider ownership.*0%.*as of unknown/i),
    expect.stringMatching(/Institutional ownership.*Unavailable.*2026-09-30.*basis unknown/i),
  ]));
  const dataset = await load(barReceipt, [barRow]);
  expect(runRecipe(dataset, { ...bars, issuer: 'EXAMPLE.LSE' }, context)).toMatchObject(refusal(/acquired issuer EXAMPLE.US/i));
  expect(runRecipe({ ...dataset, completeness: { ...dataset.completeness, kind: 'sample' } }, bars, context)).toMatchObject(refusal(/sample/i));
});

it('hidden_unsafe_fact', async () => {
  const data = await load(unsafeOwnershipPartition, acquiredOwnershipRows);
  data.rows = data.rows.slice(0, 1);
  data.provenance = projectChartSources(data.provenance, data.columns, data.rows);
  expect(runRecipe(data, waffle, context)).toMatchObject(refusal(/issuer.*date.*partition/i));

  const clean = await load(acquiredOwnershipPartition, acquiredOwnershipRows);
  clean.provenance.metadata!.chartSourceFiltered = true;
  expect(runRecipe(clean, waffle, context)).toMatchObject({ ok: true, notes: expect.arrayContaining([expect.stringMatching(/active filters/i)]) });
  clean.rows = clean.rows.slice(0, 1);
  clean.provenance = projectChartSources(clean.provenance, clean.columns, clean.rows);
  expect(runRecipe(clean, waffle, context)).toMatchObject(refusal(/omits.*bucket/i));
  clean.rows = data.rows;
  expect(runRecipe({ ...clean, rows: [...clean.rows, ...clean.rows] }, waffle, context)).toMatchObject(refusal(/omits.*bucket/i));

  for (const mutate of [
    (dataset: WidgetDataset) => { dataset.rows[1] = structuredClone(dataset.rows[0]); },
    (dataset: WidgetDataset) => { dataset.rows[1].values.share_class = 'Class-C'; },
    (dataset: WidgetDataset) => { dataset.rows[1].values.as_of = '2026-09-29'; },
    (dataset: WidgetDataset) => { dataset.rows[1].values.denominator = 'free-float'; },
    (dataset: WidgetDataset) => { dataset.rows[1].values.reported_share = null; },
    (dataset: WidgetDataset) => { dataset.rows[1].values.reported_share = 101; },
    (dataset: WidgetDataset) => { dataset.rows[1].values.reported_share = -.00001; },
    (dataset: WidgetDataset) => { dataset.rows.push(structuredClone(dataset.rows[0])); },
    (dataset: WidgetDataset) => { dataset.provenance.inputMayContainAggregates = true; },
    (dataset: WidgetDataset) => { dataset.rows[0].groupPath = []; },
  ]) {
    const dataset = await load(acquiredOwnershipPartition, acquiredOwnershipRows);
    mutate(dataset);
    expect(runRecipe(dataset, waffle, context)).toMatchObject(refusal(/repair|raw/i));
  }
});

it('numerical_limits', async () => {
  for (const [values, bound, passes] of [
    [[99.99999999999, 0], 0, true], [[99.9999999998, 0], 0, false],
    [[99.99924, 0], .001, true], [[99.998, 0], .001, false],
    [[99.991, 0], .1, true], [[99.989, 0], .1, false],
    [[99.99, 0], .01, true], [[99.98999999999998, 0], .01, false],
    [[100, .01], .01, true], [[100, .010000000000000002], .01, false],
    [[50.0005, 50], .001, true], [[50.002, 50], .001, false],
  ] as const) {
    const result = runRecipe(await partition([...values], bound), waffle, context);
    if (passes) {
      expect(result).toMatchObject({ ok: true, ownershipSnapshot: { totalDiscrepancyPercent: expect.any(Number) } });
      if (result.ok) expect(result.ownershipSnapshot).toMatchObject({
        buckets: values.map((percent, i) => expect.objectContaining({ id: i === 0 ? 'a' : 'b', percent })),
      });
    } else expect(result).toMatchObject(refusal(/discrepancy.*rounding/i));
  }
  expect(runRecipe(await partition([99.99, 0], .01), waffle, context))
    .toMatchObject({ ok: true, ownershipSnapshot: { totalDiscrepancyPercent: -.01 } });
  expect(runRecipe(await partition([100, .01], .01), waffle, context))
    .toMatchObject({ ok: true, ownershipSnapshot: { totalDiscrepancyPercent: .01 } });

  const valid = await load(barReceipt, [{ ...barRow, insider_pct: 100 }]);
  expect(runRecipe(valid, bars, context).ok).toBe(true);
  for (const bad of [Infinity, NaN, -1, 100.000001, '50', undefined]) {
    const dataset = structuredClone(valid);
    dataset.rows[0].values.insider_pct = bad;
    expect(runRecipe(dataset, bars, context)).toMatchObject(refusal(/percentage.*repair/i));
  }
  for (const tiny of [Number.MIN_VALUE, 1e-10]) {
    expect(await buildBars({ insider_pct: tiny })).toMatchObject(refusal(/geometry.*widen/i));
  }
  expect(buildOwnershipSnapshot(valid, bars, { ...context, viewportWidth: 50 })).toMatchObject(refusal(/geometry.*widen/i));
});

it('refuses overlapping independent ownership and legacy free float as an acquired partition or measure', async () => {
  const data = liveDataset();
  const liveBars: OwnershipSnapshotOptions = { ...bars, issuer: 'AAPL.US', fields: {
    insiders: 'percent_insiders', institutions: 'percent_institutions',
  } };
  const result = runRecipe(data, liveBars, context);
  expect(result).toMatchObject({ ok: true, ownershipSnapshot: { shareClass: null, measures: [
    { id: 'insiders', reported: 1.687, basis: null, asOf: null },
    { id: 'institutions', reported: 66.375, basis: null, asOf: null },
    { id: 'freeFloat', status: 'unavailable', reported: null, asOf: null },
  ] } });
  if (!result.ok) return;
  expect(result.notes.join(' ')).toMatch(/independent.*class unknown/i);
  const changedClass = structuredClone(data);
  changedClass.columns.push({ id: 'share_class', label: 'Share class' });
  changedClass.rows[0].values.share_class = 'Class-A';
  expect(runRecipe(changedClass, liveBars, context)).toMatchObject(refusal(/ownership coordinates/i));
  changedClass.columns.push({ id: 'class_alias', label: 'Share class', sourceFieldId: 'share_class' });
  changedClass.rows[0].values.class_alias = null;
  expect(runRecipe(changedClass, liveBars, context)).toMatchObject(refusal(/ownership coordinates/i));
  expect(JSON.stringify(result)).not.toMatch(/99\.827|2026-11-19|retail|outstanding_shares/i);
  expect(runRecipe(data, { ...liveBars, fields: { ...liveBars.fields, freeFloat: 'free_float' } }, context)).toMatchObject(refusal(/free float.*acquired/i));
  expect(runRecipe(data, { ...waffle, issuer: 'AAPL.US' }, context)).toMatchObject(refusal(/overlap.*certified partition/i));
  expect(runRecipe(await load(barReceipt, [barRow]), waffle, context)).toMatchObject(refusal(/overlap.*certified partition/i));

  const conflict = liveDataset({ ...liveOwnershipReceipt, diagnostics: ['unit_conflict'],
    unsafe: { ...liveOwnershipReceipt.unsafe, unit_conflict: true } },
  { ...liveOwnershipRows[0], percent_insiders: null });
  expect(runRecipe(conflict, liveBars, context)).toMatchObject(refusal(/unit conflict/i));
  expect(runRecipe(datasetFromRows(liveOwnershipRows, 'legacy', 1, 'backend'), liveBars, context)).toMatchObject(refusal(/acquir.*evidence/i));
});

it('normalizes only as declared and binds fresh source values through raw aliases', async () => {
  const result = await buildBars();
  expect(result).toMatchObject({ ok: true, figure: { data: [
    expect.objectContaining({ type: 'bar', x: [.005, .5, .5], orientation: 'h' }),
  ] }, ownershipSnapshot: { measures: [
    { id: 'insiders', reported: .5, fraction: .005, asOf: null },
    { id: 'institutions', reported: .5, fraction: .5, basis: null },
    { id: 'freeFloat', reported: 50, fraction: .5 },
  ] } });
  if (!result.ok) return;
  expect(JSON.stringify(result.figure)).toMatch(/0\.5%.*0\.5 percent-points/);
  expect(JSON.stringify(result.figure)).toMatch(/50%.*0\.5 fraction/);
  const precise = await buildBars({ insider_pct: 33.3, institution_fraction: .12345678901234568 });
  expect(precise).toMatchObject({ ok: true, ownershipSnapshot: { measures: [
    expect.objectContaining({ id: 'insiders', reported: 33.3, fraction: .333 }),
    expect.objectContaining({ id: 'institutions', reported: .12345678901234568, fraction: .12345678901234568 }),
    expect.objectContaining({ id: 'freeFloat' }),
  ] } });
  expect(JSON.stringify(precise)).toContain('12.345678901234568% (reported 0.12345678901234568 fraction)');

  const custom = await load({ ...barReceipt, field_origins: { ...barReceipt.field_origins, insiders: 'InsiderPercent' } },
    [{ ...barRow, InsiderPercent: .5 }]);
  expect(runRecipe(custom, { ...bars, fields: { ...bars.fields, insiders: 'InsiderPercent' } }, context).ok).toBe(true);

  const dataset = await load(barReceipt, [barRow]);
  const index = dataset.columns.findIndex(column => column.id === 'insider_pct');
  dataset.columns[index] = { id: 'alias', label: '<b>Untrusted label</b>', dtype: 'number', sourceFieldId: 'insider_pct' };
  dataset.rows[0].values.alias = dataset.rows[0].values.insider_pct;
  delete dataset.rows[0].values.insider_pct;
  const alias = { ...bars, fields: { ...bars.fields, insiders: 'alias' } };
  expect(ownershipInputFields(dataset.columns)).toEqual(['symbol', 'share_class']);
  const aliased = runRecipe(dataset, alias, context);
  expect(aliased.ok).toBe(true);
  expect(JSON.stringify(aliased)).not.toContain('Untrusted label');
  expect(runRecipe(dataset, alias, { ...context, viewportWidth: 500 })).toMatchObject({ revision: aliased.ok && aliased.revision });
  const unbound = runRecipe(dataset, { ...bars, fields: { freeFloat: 'free_float' } }, context);
  expect(unbound).toMatchObject({ ok: true, ownershipSnapshot: { measures: [
    { id: 'insiders', status: 'unbound', reported: null },
    { id: 'institutions', status: 'unbound', reported: null },
    { id: 'freeFloat', status: 'observed', reported: 50 },
  ] } });
  dataset.columns[index].analytical = { kind: 'formula', definitionId: 'f', name: 'f' };
  expect(runRecipe(dataset, alias, context)).toMatchObject(refusal(/raw.*repair/i));
});

it('apportions tied remainders by canonical ID, including zero-cell buckets', async () => {
  expect(allocateWaffle([{ id: 'b', percent: 10.5 }, { id: 'a', percent: 10.5 }, { id: 'c', percent: 79 }]))
    .toEqual({ a: 11, b: 10, c: 79 });
  const decimalValues = [10.1, 20.1, 9.1, 9.1, 9.1, 9.1, 9.1, 9.1, 9.1, 6.1];
  const decimalBuckets = decimalValues.map((percent, i) => ({ id: String.fromCharCode(97 + i), percent }));
  expect(allocateWaffle([...decimalBuckets].reverse())).toMatchObject({ a: 11, b: 20 });
  const tied = runRecipe(await partition(decimalValues), waffle, context);
  expect(tied).toMatchObject({ ok: true, ownershipSnapshot: {
    totalDiscrepancyPercent: 0,
    buckets: decimalBuckets.map(bucket => expect.objectContaining({ ...bucket,
      cells: Math.floor(bucket.percent) + Number(bucket.id === 'a') })),
  } });
  if (tied.ok) {
    const [trace] = tied.figure.data as [{ marker: { color: string[] } }];
    expect(new Set(trace.marker.color).size).toBe(decimalValues.length);
  }

  const dataset = await partition([99.995, .005, 0]);
  dataset.rows.reverse();
  const result = runRecipe(dataset, waffle, context);
  expect(result).toMatchObject({ ok: true, ownershipSnapshot: { buckets: [
    { id: 'a', percent: 99.995, cells: 100 }, { id: 'b', percent: .005, cells: 0 }, { id: 'c', percent: 0, cells: 0 },
  ] } });
});

it('accepts only closed versioned options with view-specific distinct fields', () => {
  for (const valid of [bars, waffle, { ...bars, fields: {} }])
    expect(decodeRecipeOptions(valid, 'ownership-snapshot')).toEqual({ ok: true, options: valid });
  for (const invalid of [
    { ...bars, version: 2 }, { ...bars, issuer: 'EXAMPLE' }, { ...bars, view: 'pie' }, { ...bars, evidence: { status: 'verified' } },
    { ...bars, fields: { ...bars.fields, partition: 'a' } }, { ...bars, fields: { insiders: '' } },
    { ...bars, fields: { insiders: 'pct', institutions: 'pct' } },
    { ...waffle, fields: { share: 'reported_share' } }, { ...waffle, fields: { ...waffle.fields, insiders: 'raw' } },
  ]) expect(decodeRecipeOptions(invalid, 'ownership-snapshot').ok).toBe(false);
});

it('changes the waffle revision when the certified partition observation changes', async () => {
  async function render(source: typeof acquiredOwnershipPartition, revision = 1, width = context.viewportWidth) {
    const rows = acquiredOwnershipRows.map((row, i) => ({
      ...row, share_class: source.share_class, as_of: source.partition.as_of,
      reported_share: revision > 1 ? [30, 70][i] : row.reported_share,
    }));
    const input = await load(source, rows);
    const result = runRecipe({ ...input, resultRevision: revision, outputRevision: revision }, waffle,
      { ...context, viewportWidth: width });
    if (!result.ok) throw new Error(result.message);
    expect(result.figure.layout.uirevision).toBe(result.revision);
    return result.revision;
  }
  const first = await render(acquiredOwnershipPartition);
  expect(await render({ ...acquiredOwnershipPartition, retrieved_at: '2026-11-21T04:16:46Z' }, 2, 460)).toBe(first);
  for (const change of [
    { share_class: 'Class-C' },
    { partition: { ...acquiredOwnershipPartition.partition, as_of: '2026-10-31' } },
    { partition: { ...acquiredOwnershipPartition.partition, reference: 'example:another-register' } },
  ]) {
    expect(await render({ ...acquiredOwnershipPartition, ...change })).not.toBe(first);
  }
});

it('revises bars on selected field dates, denominator basis, class and unknown-date acquisition vintage', async () => {
  const dimensions = { ...context, viewportWidth: 500, viewportHeight: 280 };
  async function render(receipt: typeof barReceipt, options: OwnershipSnapshotOptions = bars, refreshed = false) {
    const row = { ...barRow, share_class: receipt.share_class,
      ...(refreshed && { institution_fraction: .67, date: '2026-11-21' }) };
    const input = await load(receipt, [row]);
    const runtime = refreshed ? { ...input, resultRevision: 2, outputRevision: 3 } : input;
    const result = runRecipe(runtime, options, refreshed ? dimensions : context);
    if (!result.ok) throw new Error(result.message);
    expect(result.figure.layout.uirevision).toBe(result.revision);
    expect(result.ownershipSnapshot).toMatchObject({ retrievedAt: receipt.retrieved_at });
    return result.revision;
  }
  const first = await render(barReceipt);
  expect(await render(barReceipt, bars, true)).toBe(first);
  const equivalentTimestamp = { ...barReceipt, retrieved_at: '2026-11-20T04:16:46.000000+00:00' };
  expect(await render(equivalentTimestamp, bars, true)).toBe(first);
  const newVintage = { ...barReceipt, retrieved_at: '2026-11-20T04:16:46.000001Z' };
  expect(await render(newVintage, bars, true)).not.toBe(first);
  expect(await render({ ...barReceipt, share_class: 'Class-C' })).not.toBe(first);

  const institutions = { ...bars, fields: { institutions: bars.fields.institutions } };
  const known = await render(barReceipt, institutions);
  expect(await render(newVintage, institutions, true)).toBe(known);
  const differentlyDated = { ...barReceipt.measures.institutions, as_of: '2026-10-31' };
  const newDate = { ...barReceipt, measures: { ...barReceipt.measures, institutions: differentlyDated } };
  expect(await render(newDate, institutions)).not.toBe(known);
  expect(await render(newDate)).not.toBe(first);
  const newBasis: typeof barReceipt = { ...barReceipt, measures: {
    ...barReceipt.measures, institutions: { ...barReceipt.measures.institutions, basis: 'shares-outstanding' },
  } };
  expect(await render(newBasis, institutions)).not.toBe(known);
});
