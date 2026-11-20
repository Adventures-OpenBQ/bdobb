// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import snapshots from '../../../test/fixtures/overlaySnapshots.json';
import { datasetFromBytes } from '../../localTableData';
import type { WidgetDataset } from '../types';
import { projectChartSources } from './chartSourceContracts';
import { buildDualAxisOverlay, prepareOverlaySeries } from './dualAxisOverlay';
import { runRecipe } from './run';
import { decodeRecipeOptions, decodeRecipeRequestOptions } from './settings';
import type { DualAxisOverlayOptions, RecipeResult } from './types';

const equity = snapshots['price-eps'], macro = snapshots['cpi-ten-year'];
type Snapshot = typeof equity | typeof macro;
const equityOptions: DualAxisOverlayOptions = {
  version: 1, kind: 'dual-axis-overlay', recipe: 'price-eps',
  fields: { series: 'series', date: 'date', value: 'value', availableAt: 'available_at',
    targetStart: 'target_start', targetEnd: 'target_end' },
};
const macroOptions: DualAxisOverlayOptions = {
  version: 1, kind: 'dual-axis-overlay', recipe: 'cpi-ten-year',
  fields: { series: 'series', date: 'date', value: 'value', availableAt: 'available_at' },
};
const context = { theme: 'light', maxDecimals: 2, today: '2026-11-19', viewportWidth: 600, viewportHeight: 460 } as const;

function paired(file: Snapshot, rows: Array<Record<string, unknown> & { series: string; date: string; available_at: string | null }>) {
  const [receipt] = file.chart_sources.receipts;
  const count = rows.length;
  const coordinates = Object.fromEntries((['left', 'right'] as const).map(side => {
    const series = receipt.series[side];
    return [side, rows.filter(row => row.series === series.id).map(row =>
      series.coordinate === 'availability-date' ? row.available_at : row.date)];
  }));
  return { ...file, rows, chart_sources: { version: 1, receipts: [
    { ...receipt, coordinates, raw_count: count, normalized_count: count, delivered_count: count },
  ] } };
}

function acquire(file: object, widgetId = 'overlay-source') {
  return datasetFromBytes('prepared.json', new TextEncoder().encode(JSON.stringify(file)), widgetId, 1);
}

function plotted(result: RecipeResult) {
  if (!result.ok) throw new Error(result.message);
  const traces = result.figure.data as { x: string[]; y: (number | null)[]; text: string[]; ids: string[];
    mode: string; yaxis: string; connectgaps: boolean }[];
  return { ...result, traces };
}

function project(dataset: WidgetDataset, rows: WidgetDataset['rows'], filtered = true): WidgetDataset {
  const provenance = { ...dataset.provenance, metadata: { ...dataset.provenance.metadata, chartSourceFiltered: filtered } };
  return { ...dataset, rows, provenance: projectChartSources(provenance, dataset.columns, rows) };
}

it('known_result plots FQ diluted EPS on its actual availability date and keeps fiscal dates in hover', async () => {
  const rows = [{ ...equity.rows[0], date: '2026-05-08' }, { ...equity.rows[1], date: '2026-03-31',
    target_start: '2026-01-01', target_end: '2026-03-31', available_at: '2026-05-08', session_timing: null }];
  const result = plotted(runRecipe(await acquire(paired(equity, rows)), equityOptions, context));
  const [priceTrace, epsTrace] = result.traces;
  expect(epsTrace.x).toEqual(['2026-05-08']);
  expect(epsTrace.x).not.toContain('2026-03-31');
  expect(epsTrace).toMatchObject({ mode: 'markers', yaxis: 'y2', y: [1.98765] });
  expect(priceTrace).toMatchObject({ yaxis: 'y', y: [302.0205] });
  expect(epsTrace.text[0]).toContain('2026-01-01 to 2026-03-31');
  expect(epsTrace.text[0]).toContain('1.98765 USD/share');
  expect(epsTrace.text[0]).toContain('date only');
  expect(result.notes.join(' ')).toMatch(/no ordering against the same day.s close/i);
});

it('discloses current EPS restatement, independently acquired input vintages and exact UTC availability', async () => {
  const [receipt] = equity.chart_sources.receipts;
  const priceVintage = '2026-11-18T20:00:00Z';
  const file = { ...equity, rows: [{ ...equity.rows[0], input_vintage: priceVintage }, equity.rows[1]],
    chart_sources: { version: 1, receipts: [{ ...receipt, vintages: { ...receipt.vintages, left: priceVintage } }] } };
  const result = plotted(buildDualAxisOverlay(await acquire(file), equityOptions, context));
  const epsTrace = result.traces[1];
  expect(epsTrace.ids).toEqual(['reported_diluted_eps|2026-11-02T21:02:01.123456Z']);
  expect(epsTrace.text[0]).toContain('2026-11-02T21:02:01.123456Z');
  expect(epsTrace.text[0]).toContain('after-market');
  expect(epsTrace.text[0]).toContain('sample/earnings-release');
  expect(result.notes.join(' ')).toContain('currently restated; not historical as-known');
  expect(result.notes.join(' ')).toContain(priceVintage);
  expect(result.notes.join(' ')).toContain('2026-11-19T22:00:00.123456Z');

  const current = { ...file, rows: [file.rows[0], { ...file.rows[1], restated: false }],
    chart_sources: { version: 1, receipts: [{ ...file.chart_sources.receipts[0],
      series: { ...receipt.series, right: { ...receipt.series.right, restated: false } } }] } };
  const currentResult = plotted(buildDualAxisOverlay(await acquire(current), equityOptions, context));
  expect(currentResult.notes.join(' ')).toContain('current acquisition');
  expect(currentResult.notes.join(' ')).toContain('not historical as-known');
  expect(currentResult.notes.join(' ')).not.toContain('currently restated');
});

it.each([
  { basis: 'current-split-adjusted-basic-fq' }, { period_kind: 'FY' }, { period_kind: 'TTM' },
  { basis: 'per-ADR' }, { currency: 'EUR' },
])('refuses unsupported EPS definition %j', async patch => {
  const dataset = await acquire(equity);
  const [source] = equity.chart_sources.receipts;
  dataset.provenance.metadata!.chartSources = { overlay: { ...source,
    series: { ...source.series, right: { ...source.series.right, ...patch } } } };
  expect(prepareOverlaySeries(dataset, equityOptions)).toMatchObject({ ok: false, refused: true });
});

it.each([
  ['2025-09-26', '2025-12-25'], ['2025-09-20', '2025-12-26'], ['2025-01-31', '2025-04-29'],
])('keeps the acquired inclusive fiscal quarter %s through %s', async (start, end) => {
  const rows = [equity.rows[0], { ...equity.rows[1], date: end, target_start: start, target_end: end }];
  expect(prepareOverlaySeries(await acquire(paired(equity, rows)), equityOptions)).toMatchObject({
    ok: true, value: { right: { points: [expect.objectContaining({ targetStart: start, targetEnd: end })] } },
  });
});

it('zero_missing_and_scope preserves independent measurement calendars, one conversion and explicit gaps', async () => {
  const rows = macro.rows.map((row, i) => i === 4 ? { ...row, source_value: 0, value: 0 } : row);
  const result = plotted(buildDualAxisOverlay(await acquire({ ...macro, rows }), macroOptions, context));
  const [cpi, yieldTrace] = result.traces;
  expect(cpi).toMatchObject({ x: ['2026-09-01', '2026-10-01'], y: [336.298, 337.476], mode: 'markers', connectgaps: false });
  expect(yieldTrace).toMatchObject({
    x: ['2026-11-16', '2026-11-17', '2026-11-18'], y: [.0512, null, 0], connectgaps: false,
  });
  expect(yieldTrace.text[0]).toContain('5.12%');
  expect(yieldTrace.text[0]).toContain('0.0512');
  expect(yieldTrace.text[2]).toContain('0%');
  expect(cpi.text[0]).toContain('Release date/time unavailable');
  expect(cpi.text[1]).toContain('2026-11-10');
  expect(cpi.text[1]).toContain('sample/october-cpi-release');
  expect(result.notes.join(' ')).toMatch(/independent linear axes/i);
  expect(result.notes.join(' ')).toMatch(/1 explicit missing/i);

  const dataset = await acquire(macro);
  const projected = project(dataset, dataset.rows.filter((_, i) => i !== 3 && i !== 4));
  const filtered = plotted(buildDualAxisOverlay(projected, macroOptions, context));
  expect(filtered.traces[1].y).toEqual([.0512, null, null]);
  expect(filtered.notes.join(' ')).toMatch(/2 omitted/i);
  expect(filtered.notes.join(' ')).toMatch(/filtered/i);
  expect(prepareOverlaySeries({ ...dataset, rows: projected.rows }, macroOptions)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/unexplained missing/),
  });
});

it('hidden_unsafe_fact refuses when a prior raw conflict survives a filtered presentation', async () => {
  const [source] = macro.chart_sources.receipts;
  const dataset = await acquire({ ...macro, chart_sources: { version: 1, receipts: [{ ...source,
    raw_count: source.delivered_count + 1, unsafe: { ...source.unsafe, unit_conflict: true }, diagnostics: ['unit_conflict'],
  }] } });
  const projected = project(dataset, dataset.rows.filter((_, i) => i !== 3));
  expect(prepareOverlaySeries(projected, macroOptions)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/conflicting units/),
  });
});

it('rejects a lookalike without prepared lineage and a receipt for the other recipe', async () => {
  const dataset = await acquire(equity);
  expect(prepareOverlaySeries({ ...dataset, provenance: { ...dataset.provenance, metadata: {} } }, equityOptions))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/prepared/) });
  expect(prepareOverlaySeries(dataset, macroOptions)).toMatchObject({ ok: false, refused: true });
  const [source] = equity.chart_sources.receipts;
  dataset.provenance.metadata!.chartSources = { overlay: { ...source, preparation: { ...source.preparation, input_refs: ['x', 'x'] } } };
  expect(prepareOverlaySeries(dataset, equityOptions)).toMatchObject({ ok: false, refused: true });
});

it('uses only unique, physical bound fields; never recovers hidden values from source_value', async () => {
  const dataset = await acquire(equity);
  const valueAlias = { ...dataset.columns.find(column => column.id === 'value')!, id: 'Presented EPS', sourceFieldId: 'value' };
  const columns = dataset.columns.map(column => column.id === 'value' ? valueAlias : column);
  const rows = dataset.rows.map(({ values: { value, ...other }, ...row }) => ({ ...row, values: { ...other, 'Presented EPS': value } }));
  const alias = { ...dataset, columns, rows };
  const bound = { ...equityOptions, fields: { ...equityOptions.fields, value: 'Presented EPS' } };
  expect(plotted(buildDualAxisOverlay(alias, bound, context)).traces[1].y).toEqual([1.98765]);
  const releaseHidden = { ...alias, columns: alias.columns.filter(col => !['release_ref', 'session_timing'].includes(col.id)) };
  const hover = plotted(buildDualAxisOverlay(releaseHidden, bound, context)).traces[1].text[0];
  expect(hover).not.toContain('sample/earnings-release');
  expect(hover).not.toContain('after-market');

  for (const rejected of [
    { ...alias, columns: columns.filter(column => column.id !== valueAlias.id) },
    { ...alias, columns: [...columns, { ...valueAlias, id: 'another alias' }] },
    { ...alias, columns: columns.map(column => column.id === valueAlias.id ? { ...column, analytical: {
      kind: 'formula' as const, definitionId: 'f', name: 'Formula', scope: 'source' as const,
    } } : column) },
    { ...alias, provenance: { ...alias.provenance, inputMayContainAggregates: true } },
    { ...alias, rows: rows.map(row => ({ ...row, groupPath: [] })) },
    { ...alias, rows: rows.map(row => ({ ...row, cellErrors: { [valueAlias.id]: { code: 'bad', message: 'bad' } } })) },
  ]) expect(prepareOverlaySeries(rejected, bound)).toMatchObject({ ok: false, refused: true });
  expect(prepareOverlaySeries(alias, { ...bound, fields: { ...bound.fields, value: 'source_value' } }))
    .toMatchObject({ ok: false, refused: true });
});

it('refuses contradictory visible facts and duplicated or reassigned coordinates', async () => {
  const dataset = await acquire(equity);
  for (const patch of [
    { target_start: '2025-10-01' }, { date: '2026-09-29' }, { available_at: '2026-11-02' },
    { listing: 'MSFT.US' }, { period_kind: 'FY' }, { input_ref: 'sample/wrong-pair' },
    { session_timing: '<img src=x>' }, { release_ref: '<b>unverified</b>' },
    { source_contract: 'eodhd-annual-basic-eps' }, { value: NaN }, { value: '1.98765' },
  ]) expect(prepareOverlaySeries({ ...dataset, rows: [dataset.rows[0], { ...dataset.rows[1],
    values: { ...dataset.rows[1].values, ...patch } }] }, equityOptions)).toMatchObject({ ok: false, refused: true });
  expect(prepareOverlaySeries({ ...dataset, rows: [...dataset.rows, dataset.rows[1]] }, equityOptions))
    .toMatchObject({ ok: false, refused: true });
});

it('numerical_limits protects finite range and exact times without changing either original unit', async () => {
  const rows = macro.rows.map((row, i) => i < 2 ? { ...row, value: 1e200 * (i + 1), source_value: 1e200 * (i + 1) } : row);
  const result = plotted(buildDualAxisOverlay(await acquire({ ...macro, rows }), macroOptions, context));
  expect(result.traces[0].y).toEqual([1e200, 2e200]);
  expect(result.traces[1].y).toEqual([.0512, null, .0507]);
  expect(result.figure.layout).toMatchObject({ xaxis: { type: 'date' }, yaxis: { type: 'linear', side: 'left' },
    yaxis2: { type: 'linear', side: 'right', overlaying: 'y' } });
  const clipped = rows.map((row, i) => i === 1 ? { ...row, value: Number.MAX_VALUE, source_value: Number.MAX_VALUE } : row);
  expect(buildDualAxisOverlay(await acquire({ ...macro, rows: clipped }), macroOptions, context))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/linear scale.*faithfully/) });

  const eps = equity.rows[1];
  const near = paired(equity, [equity.rows[0], eps, { ...eps, date: '2026-06-30', target_end: '2026-06-30',
    target_start: '2026-04-01', available_at: '2026-11-02T21:02:01.123457Z', value: 2.25, source_value: 2.25 }]);
  const acquired = await acquire(near);
  expect(prepareOverlaySeries(acquired, equityOptions)).toMatchObject({ ok: true, value: { right: { points: [
    expect.objectContaining({ coordinate: '2026-11-02T21:02:01.123456Z' }),
    expect.objectContaining({ coordinate: '2026-11-02T21:02:01.123457Z' }),
  ] } } });
  expect(buildDualAxisOverlay(acquired, equityOptions, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/distinct.*availability coordinates/i),
  });
});

it('keeps the question revision across viewport, theme and reacquired vintages and resets on source or bindings', async () => {
  const input = await acquire(equity);
  const first = plotted(buildDualAxisOverlay(input, equityOptions, context));
  const narrow = plotted(buildDualAxisOverlay(input, equityOptions, { ...context, theme: 'dark', viewportWidth: 320 }));
  expect(narrow.revision).toBe(first.revision);
  expect(narrow.figure.layout.uirevision).toBe(first.revision);
  const retrieved = '2026-11-20T00:00:00Z';
  const updated = await acquire({ ...equity, chart_sources: { version: 1,
    receipts: [{ ...equity.chart_sources.receipts[0], retrieved_at: retrieved }] } });
  expect(plotted(buildDualAxisOverlay(updated, equityOptions, context)).revision).toBe(first.revision);
  expect(plotted(buildDualAxisOverlay(await acquire(equity, 'new-source'), equityOptions, context)).revision)
    .not.toBe(first.revision);
  expect(plotted(buildDualAxisOverlay(await acquire(macro), macroOptions, context)).revision).not.toBe(first.revision);
  const columns = input.columns.map(c => c.id === 'value' ? { ...c, id: 'rawValue', sourceFieldId: 'value' } : c);
  const rows = input.rows.map(row => ({ ...row, values: { ...row.values, rawValue: row.values.value } }));
  expect(plotted(buildDualAxisOverlay({ ...input, columns, rows },
    { ...equityOptions, fields: { ...equityOptions.fields, value: 'rawValue' } }, context)).revision).not.toBe(first.revision);
});

it('accepts only the closed worker options without registering an authoring chart type', async () => {
  const dataset = await acquire(equity);
  expect(decodeRecipeRequestOptions(equityOptions)).toEqual({ ok: true, options: equityOptions });
  expect(decodeRecipeOptions(equityOptions, equityOptions.kind)).toMatchObject({ ok: false });
  for (const options of [
    { ...equityOptions, version: 2 }, { ...equityOptions, recipe: 'custom' }, { ...equityOptions, origin: 'acquired-snapshot' },
    { ...equityOptions, fields: { ...equityOptions.fields, measure3: 'other' } },
    { ...equityOptions, fields: { ...equityOptions.fields, value: 'date' } },
    { ...equityOptions, fields: { ...equityOptions.fields, availableAt: undefined } },
  ]) {
    expect(decodeRecipeRequestOptions(options)).toMatchObject({ ok: false });
    expect(runRecipe(dataset, options as DualAxisOverlayOptions, context)).toMatchObject({ ok: false, refused: true });
  }
});

it.each([['price-eps', equity, equityOptions], ['cpi-ten-year', macro, macroOptions]] as const)(
  '%s requires the minimum drawable size for both unit titles',
  async (_recipe, snapshot, options) => {
    const dataset = await acquire(snapshot);
    expect(runRecipe(dataset, options, { ...context, viewportWidth: 320, viewportHeight: 210 })).toMatchObject({ ok: true });
    for (const [viewportWidth, viewportHeight] of [[320, 190], [320, 209], [319, 210]]) {
      expect(runRecipe(dataset, options, { ...context, viewportWidth, viewportHeight })).toMatchObject({
        ok: false, refused: true, message: expect.stringMatching(/Increase the drawing area.*axes.*units/),
      });
    }
  },
);
