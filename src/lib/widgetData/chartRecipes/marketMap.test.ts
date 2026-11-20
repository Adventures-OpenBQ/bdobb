// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import cap from '../../../test/fixtures/marketMapCap.json';
import index from '../../../test/fixtures/marketMapIndex.json';
import zeroBound from '../../../test/fixtures/marketMapIndexZeroBound.json';
import { datasetFromBytes } from '../../localTableData';
import type { WidgetDataset } from '../types';
import { chartPresentationProvenance, projectChartSources } from './chartSourceContracts';
import { buildMarketHierarchy } from './marketMap';
import { runRecipe } from './run';
import type { MarketMapOptions } from './types';

const capOptions: MarketMapOptions = {
  kind: 'market-map', version: 1, mode: 'delivered-cap', universe: 'delivered-sample', session: 'latest',
  fields: { listing: 'listing', sector: 'sector', area: 'area', change: 'change', session: 'session' },
};
const indexOptions: MarketMapOptions = {
  ...capOptions, mode: 'index-weight', universe: index.chart_sources.receipts[0].universe,
};
const context = { theme: 'light', maxDecimals: 2, today: '2026-11-20', viewportWidth: 320, viewportHeight: 260 } as const;
const load = (file: unknown) => datasetFromBytes('market.json', new TextEncoder().encode(JSON.stringify(file)), 'market-source', 1);
const rows = (first: number, second: number) => [{ ...cap.rows[0], area: first }, { ...cap.rows[1], area: second }];
const render = (dataset: WidgetDataset, options = capOptions) => runRecipe(dataset, options, context);
const visibleOnly = (dataset: WidgetDataset) => {
  const rows = dataset.rows.slice(0, 1);
  return { ...dataset, rows, provenance: projectChartSources(chartPresentationProvenance(dataset.provenance, true), dataset.columns, rows) };
};

it('known_result: sectors and root conserve visible absolute cap areas', async () => {
  const dataset = await load({ ...cap, rows: rows(100, 200) });
  const result = buildMarketHierarchy(dataset, capOptions);
  if (!result.ok) throw new Error(result.message);
  const { root, sectors: sectorChildren, listings } = result.value;
  expect(root.value).toBe(300);
  expect(sectorChildren.map(x => x.value)).toEqual([100, 200]);
  expect(listings.map(x => [x.listing, x.value])).toEqual([['ALFA.US', 100], ['BETA.US', 200]]);
  expect(listings[1].parentId).toBe(sectorChildren[1].id);
  expect(result.value.denomination).toBe('USD');
  expect(result.notes.join(' ')).toMatch(/Capitalization retrieved 2026-11-13T22:00:00Z/);
  expect(result.notes.join(' ')).toMatch(/Completed close-to-close return 2026-11-12 to 2026-11-13/);
});

it('zero_missing_and_scope: a delivered sample keeps its name, zero retains its color, missing has an explicit category and fill', async () => {
  const dataset = await load(cap);
  const result = render({ ...dataset, completeness: { ...dataset.completeness, kind: 'paged' } });
  if (!result.ok) throw new Error(result.message);
  expect(result.marketMap).toMatchObject({ scope: 'delivered', colorBound: .01, listings: [
    { change: 0 }, { sector: null, change: null },
  ] });
  expect(result.figure.layout.title).toMatchObject({ text: expect.stringContaining('Delivered-sample market cap') });
  const trace = result.figure.data[0];
  expect(trace).toMatchObject({
    type: 'treemap', branchvalues: 'total',
    marker: { showscale: true, colors: [expect.any(String), expect.any(String), expect.any(String), 0, expect.any(String)] },
    hovertext: expect.arrayContaining([expect.stringContaining('0%'), expect.stringContaining('Return unavailable')]),
  });
  dataset.rows[0].values.change = null;
  const noPerformance = render(dataset);
  if (!noPerformance.ok) throw new Error(noPerformance.message);
  expect(noPerformance.marketMap?.colorBound).toBeNull();
  expect(noPerformance.figure.data[0]).toMatchObject({ marker: { showscale: false } });
  expect(render(dataset, indexOptions)).toMatchObject({ ok: false, refused: true });
  dataset.provenance.metadata = {};
  expect(render(dataset, indexOptions)).toMatchObject({ ok: false, message: expect.stringMatching(/acquired/i) });
});

it.each(['denomination_conflict', 'session_conflict', 'duplicate_conflict'] as const)(
  'hidden_unsafe_fact: filtering cannot repair raw %s',
  async flag => {
    const base = cap.chart_sources.receipts[0];
    const receipt = { ...base, raw_count: base.raw_count + 1, rejected_count: 1, diagnostics: [flag],
      unsafe: { ...base.unsafe, [flag]: true } };
    const dataset = await load({ ...cap, chart_sources: { version: 1, receipts: [receipt] } });
    expect(render(visibleOnly(dataset))).toMatchObject({ ok: false, message: expect.stringMatching(/acquisition reports/i) });
  },
);

it('completed_session: refuses intraday companions, wrong row session, lost membership proof and unavailable pins', async () => {
  const dataset = await load(cap);
  expect(render(dataset, { ...capOptions, session: '2026-11-12' })).toMatchObject({ ok: false, message: expect.stringMatching(/pinned.*unavailable/i) });
  dataset.rows[0].values.price_basis = 'intraday';
  expect(render(dataset)).toMatchObject({ ok: false, message: expect.stringMatching(/price basis/i) });
  dataset.rows[0].values.price_basis = cap.rows[0].price_basis;
  dataset.rows[0].values.session = '2026-11-12';
  expect(render(dataset)).toMatchObject({ ok: false, message: expect.stringMatching(/session/i) });
  const named = await load(index);
  named.rows[0].values.weight_valid_for = '2026-11-11';
  expect(render(named, indexOptions)).toMatchObject({ ok: false, message: expect.stringMatching(/weight valid for/i) });
});

it('boundaries: index totals retain rounding evidence, an active filter only downgrades scope and visible excess refuses', async () => {
  const exact = render(await load(zeroBound), indexOptions);
  if (!exact.ok) throw new Error(exact.message);
  expect(exact.marketMap).toMatchObject({ scope: 'complete', roundingBound: 0, roundingDiscrepancy: 0, root: { value: 1 } });
  const base = index.chart_sources.receipts[0];
  const adjusted = await load({ ...index, rows: [index.rows[0], { ...index.rows[1], area: .39995 }],
    chart_sources: { version: 1, receipts: [{ ...base, rounding_bound_fraction: .0001, rounding_reference: 'example/precision' }] } });
  const complete = render(adjusted, indexOptions);
  if (!complete.ok) throw new Error(complete.message);
  expect(complete.marketMap).toMatchObject({ scope: 'complete', root: { value: .99995 } });
  expect(complete.marketMap?.roundingDiscrepancy).toBeCloseTo(-.00005, 12);
  const filtered = render(visibleOnly(adjusted), indexOptions);
  if (!filtered.ok) throw new Error(filtered.message);
  expect(filtered.marketMap).toMatchObject({ scope: 'delivered', omittedCount: 1, root: { value: .6 } });
  expect(filtered.figure.layout.title).toMatchObject({ text: expect.stringContaining('Delivered index components') });
  const partial = await load({ ...index, completeness: 'partial', chart_sources: { version: 1, receipts: [{ ...base, coverage: 'partial' }] } });
  partial.rows[1].values.area = .400000000002;
  expect(render(partial, indexOptions)).toMatchObject({ ok: false, message: expect.stringMatching(/exceeds 100%/i) });
  const noOmissions = { ...adjusted, provenance: chartPresentationProvenance(adjusted.provenance, true) };
  const allSelected = render(noOmissions, indexOptions);
  if (!allSelected.ok) throw new Error(allSelected.message);
  expect(allSelected.marketMap).toMatchObject({ scope: 'delivered', omittedCount: 0, root: { value: .99995 } });
  expect(allSelected.marketMap?.roundingDiscrepancy).toBeCloseTo(-.00005, 12);
});

it('numerical_limits: finite extremes are retained, unsafe totals or collapsed paths refuse', async () => {
  const dataset = await load({ ...cap, rows: [
    { ...cap.rows[0], area: 1e308, change: Number.MAX_VALUE },
    { ...cap.rows[1], area: 4e307, change: -.02 },
  ] });
  const result = render(dataset);
  if (!result.ok) throw new Error(result.message);
  expect(result.marketMap).toMatchObject({ root: { value: 1.4e308 }, colorBound: Number.MAX_VALUE,
    listings: [{ value: 1e308, change: Number.MAX_VALUE }, { value: 4e307, change: -.02 }] });
  expect(result.figure.data[0]).toMatchObject({ values: [1.4e308, 1e308, 4e307, 1e308, 4e307] });
  expect(render(await load({ ...cap, rows: rows(1e308, 1e308) }))).toMatchObject({ ok: false, message: expect.stringMatching(/sum.*represent/i) });
  expect(render(await load({ ...cap, rows: rows(1, Number.MIN_VALUE) }))).toMatchObject({ ok: false, message: expect.stringMatching(/geometry.*BETA.US/i) });
});

it('renderer sum overflow: refuses when Plotly cannot calculate a hierarchy with a finite exact total', async () => {
  const halfUlpAndMore = 2 ** 970 + 2 ** 918;
  const receipt = { ...cap.chart_sources.receipts[0], raw_count: 3, normalized_count: 3, delivered_count: 3,
    listing_keys: ['ALFA.US', 'BETA.US', 'GAMMA.US'] };
  const dataset = await load({ ...cap, chart_sources: { version: 1, receipts: [receipt] }, rows: [
    { ...cap.rows[0], sector: 'Agriculture', area: Number.MAX_VALUE - 2 ** 971 },
    { ...cap.rows[1], sector: 'Banks', area: halfUlpAndMore },
    { ...cap.rows[1], sector: 'Capital Goods', area: halfUlpAndMore, listing: 'GAMMA.US' },
  ] });
  expect(buildMarketHierarchy(dataset, capOptions)).toMatchObject({ ok: true, value: { root: { value: Number.MAX_VALUE } } });
  expect(render(dataset)).toMatchObject({ ok: false, message: expect.stringMatching(/Plotly.*area sum/i) });
});

it('tiny_cells_and_typed_ids: exact small values and distinct qualified listings survive an identical display label', async () => {
  const dataset = await load({
    ...cap, rows: [
      { ...cap.rows[0], listing: 'BETA.LSE', sector: 'Sector unavailable', area: .0001, change: .0000001 },
      { ...cap.rows[1], area: 1_000, change: -.1 },
    ], chart_sources: { version: 1, receipts: [{ ...cap.chart_sources.receipts[0], listing_keys: ['BETA.LSE', 'BETA.US'] }] },
  });
  const result = render(dataset);
  if (!result.ok) throw new Error(result.message);
  expect(result.marketMap).toMatchObject({ colorBound: .1, sectors: [{ sector: 'Sector unavailable' }, { sector: null }],
    listings: [{ listing: 'BETA.LSE', value: .0001, change: .0000001 }, { listing: 'BETA.US', value: 1000, change: -.1 }] });
  expect(new Set([result.marketMap?.root, ...result.marketMap!.sectors, ...result.marketMap!.listings].map(node => node?.id)).size).toBe(5);
  expect(result.figure.data[0]).toMatchObject({ hovertext: expect.arrayContaining([expect.stringContaining('0.0001 USD'), expect.stringContaining('-10%')]) });
});

it('physical_bindings: allows unique aliases and refuses calculated, aggregate, ambiguous or duplicate identities', async () => {
  const dataset = await load(cap);
  const alias = 'c-user-area';
  const columns = dataset.columns.map(column => column.id === 'area' ? { ...column, id: alias, sourceFieldId: 'area' } : column);
  const aliased = { ...dataset, columns, rows: dataset.rows.map(row => ({ ...row, values: { ...row.values, [alias]: row.values.area } })) };
  const aliasedOptions = { ...capOptions, fields: { ...capOptions.fields, area: alias } };
  expect(render(aliased, aliasedOptions)).toMatchObject({ ok: true });
  expect(render({ ...aliased, columns: [...columns, { id: 'alternative', label: 'Alias 2', sourceFieldId: 'area' }] }, aliasedOptions))
    .toMatchObject({ ok: false, message: expect.stringMatching(/physical/i) });
  expect(render({ ...aliased, columns: columns.map(c => c.id === alias ? {
    ...c, analytical: { kind: 'formula', name: 'Edited amount', definitionId: 'formula' } as const,
  } : c) }, aliasedOptions)).toMatchObject({ ok: false, message: expect.stringMatching(/physical/i) });
  const replacedCompanion = dataset.columns.map(column => column.id === 'denomination' ? {
    ...column, analytical: { kind: 'formula', name: 'Edited currency', definitionId: 'other' } as const,
  } : column);
  expect(render({ ...dataset, columns: replacedCompanion })).toMatchObject({ ok: false, message: expect.stringMatching(/physical/i) });
  expect(render({ ...dataset, provenance: { ...dataset.provenance, inputMayContainAggregates: true } }))
    .toMatchObject({ ok: false, message: expect.stringMatching(/aggregation/i) });
  expect(render({ ...dataset, rows: [...dataset.rows, dataset.rows[0]] }))
    .toMatchObject({ ok: false, message: expect.stringMatching(/duplicated/i) });
});

it('exclusions: source and presentation counts stay independent and omitted amounts stay absent', async () => {
  const data = await load({ ...cap, chart_sources: { version: 1, receipts: [{
    ...cap.chart_sources.receipts[0], raw_count: 6, exact_repeats: 1, excluded_areas: { zero: 1, negative: 1, invalid: 1 },
  }] } });
  const result = render(visibleOnly(data));
  if (!result.ok) throw new Error(result.message);
  expect(result.marketMap).toMatchObject({ acquiredCount: 2, rawCount: 6, omittedCount: 1, exactRepeats: 1,
    sourceExcludedAreas: { zero: 1, negative: 1, invalid: 1 }, root: { value: 4600 } });
  expect(result.marketMap?.listings.map(row => row.listing)).toEqual(['ALFA.US']);
  data.rows[1].values.area = 0;
  expect(render(data)).toMatchObject({ ok: true, marketMap: {
    omittedCount: 0, presentationExcludedAreas: { zero: 1, negative: 0, invalid: 0 }, root: { value: 4600 },
  } });
});

it('worker_options_and_revision: validates closed settings, escapes labels and keys the question to resolved source identities', async () => {
  const dataset = await load({ ...cap, rows: [{ ...cap.rows[0], sector: '<b>Untrusted</b>' }, cap.rows[1]] });
  const first = render(dataset);
  if (!first.ok) throw new Error(first.message);
  expect(first.figure.data[0]).toMatchObject({ labels: expect.arrayContaining(['&lt;b&gt;Untrusted&lt;/b&gt;']),
    hovertext: expect.arrayContaining([expect.stringContaining('&lt;b&gt;Untrusted&lt;/b&gt;')]) });
  expect(render(dataset, { ...capOptions, receipt: cap.chart_sources.receipts[0] } as MarketMapOptions))
    .toMatchObject({ ok: false, message: expect.stringMatching(/unsupported recipe option/i) });
  expect(render(dataset, { ...capOptions, fields: { ...capOptions.fields, area: 'change' } }))
    .toMatchObject({ ok: false, message: expect.stringMatching(/distinct fields/i) });
  expect(runRecipe({ ...dataset, outputRevision: 50 }, capOptions, { ...context, viewportWidth: 720 })).toMatchObject({
    ok: true, revision: first.revision,
  });
  const filtered = render(visibleOnly(dataset));
  expect(filtered).toMatchObject({ ok: true });
  expect(filtered.ok && filtered.revision).not.toBe(first.revision);
  const receipt = { ...cap.chart_sources.receipts[0], session: '2026-11-12', prior_session: '2026-11-11' };
  const second = render(await load({ ...cap, rows: cap.rows.map(r => ({ ...r, session: receipt.session, prior_session: receipt.prior_session })),
    chart_sources: { version: 1, receipts: [receipt] } }));
  expect(second).toMatchObject({ ok: true, marketMap: { session: receipt.session } });
  expect(second.ok && second.revision).not.toBe(first.revision);
});
