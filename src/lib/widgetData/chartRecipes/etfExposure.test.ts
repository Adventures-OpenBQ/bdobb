// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { datasetFromRows } from '../../localTableData';
import { readEtfEvidence } from './etfEvidence';
import { buildEtfExposure } from './etfExposure';
import type { RecipeOptions, RecipeResult } from './types';

type ExposureOptions = Extract<RecipeOptions, { kind: 'etf-exposure' }>;
const context = { theme: 'light', maxDecimals: 2, today: '2026-02-01' } as const;
const sector: ExposureOptions = {
  version: 1, kind: 'etf-exposure', mode: 'sector', fields: { category: 'sector', weight: 'weight' },
};
const region: ExposureOptions = {
  version: 1, kind: 'etf-exposure', mode: 'region', fields: { category: 'country', weight: 'weight' },
};

function exposure(options: ExposureOptions, values: [string, number][], receiptFields: Record<string, string> = {}) {
  const receipt = { fund_symbol: 'FUND.US', etf_kind: options.mode, weight_basis: 'equity-exposure', ...receiptFields };
  return datasetFromRows(values.map(([label, weight]) => ({ [options.fields.category]: label, weight })),
    'exposure-source', 1, 'localFile', undefined, [], { receipt, completeness: 'unknown' });
}

type Trace = {
  type: string; mode: string; x: (number | null)[]; y: (string | null)[]; customdata?: string[][];
  cliponaxis?: boolean; marker?: { size?: number }; hovertemplate?: string;
};
function plotted(result: RecipeResult) {
  if (!result.ok) throw new Error(result.message);
  const { data, layout } = result.figure;
  const traces = data as Trace[];
  expect(traces).toHaveLength(2);
  const dots = traces.find(trace => trace.type === 'scatter' && trace.mode === 'markers');
  const stems = traces.find(trace => trace.type === 'scatter' && trace.mode === 'lines');
  if (!dots || !stems) throw new Error('Expected one scatter trace each for dots and stems');
  const axes = layout as { xaxis: Record<string, unknown>; yaxis: Record<string, unknown>; height: number };
  return { dots, stems, figure: { layout: axes }, notes: result.notes };
}

it('preserves geographic labels and original equity weights', () => {
  const dataset = exposure(region, [['United Kingdom', .2], ['Other supplied region', 0], ['North America', .4]]);
  const { dots, figure } = plotted(buildEtfExposure(dataset, region, context));
  expect(dots.x).toEqual([.4, .2, 0]);
  expect(dots.y).toEqual(['North America', 'United Kingdom', 'Other supplied region']);
  expect(figure.layout.xaxis.range).toEqual([0, 1]);
});

it('plots a visible zero and separates each sector stem', () => {
  const dataset = exposure(sector, [['Energy', 0], ['Utilities', .2], ['Technology', .4]]);
  const { dots, stems, figure } = plotted(buildEtfExposure(dataset, sector, context));
  expect(dots.x).toEqual([.4, .2, 0]);
  expect(dots.y).toEqual(['Technology', 'Utilities', 'Energy']);
  expect(dots.marker?.size).toBeGreaterThan(0);
  expect(dots.cliponaxis).toBe(false);
  expect(stems.x).toEqual([0, .4, null, 0, .2, null, 0, 0, null]);
  expect(stems.y).toEqual(['Technology', 'Technology', null, 'Utilities', 'Utilities', null, 'Energy', 'Energy', null]);
  expect(figure.layout.xaxis).toMatchObject({ title: { text: 'Reported equity exposure (%)' }, range: [0, 1] });
  expect(figure.layout.height).toBe(280);
});

it('orders equal weights by literal category label and escapes rendered text', () => {
  const dataset = exposure(sector, [['Technology', .6], ['<Energy & fuels>', .6], ['Utilities', .8]]);
  const { dots, figure } = plotted(buildEtfExposure(dataset, sector, context));
  expect(dots.x).toEqual([.8, .6, .6]);
  expect(dots.y).toEqual(['Utilities', '<Energy & fuels>', 'Technology']);
  expect(figure.layout.yaxis).toMatchObject({
    categoryorder: 'array', categoryarray: dots.y, autorange: 'reversed',
    ticktext: ['Utilities', '&lt;Energy &amp; fuels&gt;', 'Technology'],
  });
  expect(dots.customdata?.[1]).toEqual(['&lt;Energy &amp; fuels&gt;', '60%']);
  expect(dots.hovertemplate).toContain('Weight basis is equity exposure');
});

it('discloses delivered scope, coverage and the reported snapshot date', () => {
  const dataset = exposure(region, [['United Kingdom', .2], ['North America', .4]], {
    as_of: '2026-01-02', retrieved_at: '2026-01-05T13:45:00Z',
  });
  dataset.rows.pop();
  const { notes } = plotted(buildEtfExposure(dataset, region, context));
  expect(notes).toEqual(expect.arrayContaining([
    'Transport coverage is unknown. Provider holdings coverage is unknown.',
    'Filtered source delivered 1 of 2 acquired rows.',
    'Snapshot as of 2026-01-02.',
    'Snapshot retrieved 2026-01-05T13:45:00.000Z.',
  ]));
});

it('keeps the retrieval and current acquisition times separate from a missing snapshot date', () => {
  const dataset = datasetFromRows([{ sector: 'Energy', weight: .6 }], 'exposure-source', 1, 'backend', undefined, [], {
    completeness: 'unknown',
    receipt: {
      fund_symbol: 'FUND.US', etf_kind: 'sector', weight_basis: 'equity-exposure', retrieved_at: '2026-01-05T13:45:00Z',
    },
  }, { endpoint: '/eodhd/etf/sectors', parameters: { symbol: 'FUND.US' }, retrievedAt: Date.parse('2026-01-06T09:50:00Z') });
  const { notes } = plotted(buildEtfExposure(dataset, sector, context));
  expect(notes).toEqual(expect.arrayContaining([
    'Snapshot as-of date not supplied.',
    'Snapshot retrieved 2026-01-05T13:45:00.000Z.',
    'Request completed 2026-01-06T09:50:00.000Z.',
  ]));
});

it.each([['matching', .2], ['different', .3]] as const)('refuses a duplicate category with %s weights', (_, weight) => {
  const dataset = exposure(sector, [['Energy', .2], ['Energy', weight]]);
  expect(buildEtfExposure(dataset, sector, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/duplicate.*category/i),
  });
});

it('passes through evidence refusals for a different mode or holdings source', () => {
  for (const dataset of [
    exposure(region, [['North America', .5]]),
    exposure(sector, [['Energy', .5]], { etf_kind: 'holdings', weight_basis: 'fund-assets' }),
  ]) {
    const evidence = readEtfEvidence(dataset, 'sector');
    if (evidence.ok) throw new Error('Expected a different exposure kind');
    expect(buildEtfExposure(dataset, sector, context)).toEqual({ ...evidence, refused: true });
  }
});

it('refuses fund-assets evidence for the requested exposure mode', () => {
  const dataset = exposure(sector, [['Energy', .5]], { weight_basis: 'fund-assets' });
  expect(buildEtfExposure(dataset, sector, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/basis/i),
  });
});

it('refuses acquisitions whose rows identify multiple funds', () => {
  const dataset = datasetFromRows([
    { symbol: 'FUND.US', sector: 'Energy', weight: .2 },
    { symbol: 'DIFFERENT.US', sector: 'Finance', weight: .4 },
  ], 'exposure-source', 1, 'localFile', undefined, [], {
    completeness: 'unknown',
    receipt: { fund_symbol: 'FUND.US', etf_kind: 'sector', weight_basis: 'equity-exposure' },
  });
  expect(buildEtfExposure(dataset, sector, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/fund identity/i),
  });
});

it.each([null, -.1, NaN, Infinity, 1.01, '0.4'])('refuses a delivered invalid weight of %s', invalid => {
  const dataset = exposure(sector, [['Energy', .4]]);
  dataset.rows[0].values.weight = invalid;
  expect(buildEtfExposure(dataset, sector, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/weight.*fraction/i),
  });
});

it.each(['sector', 'weight'])('refuses a delivered %s cell error', field => {
  const dataset = exposure(sector, [['Energy', .4]]);
  dataset.rows[0].cellErrors = { [field]: { code: 'fixture', message: 'Unavailable' } };
  expect(buildEtfExposure(dataset, sector, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/cell error/i),
  });
});

it('refuses a field absent from the presentation', () => {
  const dataset = exposure(region, [['North America', .6]]);
  dataset.columns = dataset.columns.filter(column => column.id !== 'country');
  expect(buildEtfExposure(dataset, region, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/country.*unavailable/i),
  });
});

it('checks runtime options at the exported builder boundary', () => {
  const unsupported = { ...sector, mode: 'holdings' } as unknown as ExposureOptions;
  expect(buildEtfExposure(exposure(sector, [['Energy', .2]]), unsupported, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/choose sector or region/i),
  });
});

it('retains a long category list and reserves plot height for every delivered row', () => {
  const values: [string, number][] = Array.from({ length: 65 }, (_, i) => [`Category ${String(i).padStart(2, '0')}`, .02]);
  const { dots, stems, figure } = plotted(buildEtfExposure(exposure(region, values), region, context));
  expect(dots.y).toEqual(values.map(([label]) => label));
  expect(dots.x).toEqual(Array<number>(65).fill(.02));
  expect(stems.x).toHaveLength(195);
  expect(figure.layout.height).toBe(2420);
});

it.each([sector, region])('binds only the $mode dimension in a mixed snapshot', options => {
  const data = exposure(options, [['Example', .5]]);
  data.columns = [{ id: 'industry', sourceFieldId: 'sector', label: 'Industry' },
    { id: 'place', sourceFieldId: 'country', label: 'Place' }, { id: 'weight', label: 'Weight' }];
  data.rows[0].values = { industry: 'Industrials', place: 'Canada', weight: .5 };
  for (const category of ['industry', 'place']) {
    const result = buildEtfExposure(data, { ...options, fields: { ...options.fields, category } }, context);
    if ((options.mode === 'sector') === (category === 'industry')) {
      expect(plotted(result).dots.y).toEqual([category === 'industry' ? 'Industrials' : 'Canada']);
    } else expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/category/i) });
  }
});
