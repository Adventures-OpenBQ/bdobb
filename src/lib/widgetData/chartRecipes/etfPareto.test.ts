// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { datasetFromRows } from '../../localTableData';
import { readEtfEvidence } from './etfEvidence';
import { buildEtfPareto } from './etfPareto';
import type { RecipeOptions, RecipeResult } from './types';

const context = { theme: 'light', maxDecimals: 2, today: '2026-02-01' } as const;
const options = {
  version: 1, kind: 'etf-pareto', fields: { holding: 'symbol', weight: 'weight', label: 'name' },
} satisfies RecipeOptions;
const receipt = {
  fund_symbol: 'FUND.US', etf_kind: 'holdings', weight_basis: 'fund-assets',
  retrieved_at: '2026-01-05T13:45:00Z',
};

function holdings(weights: number[], completeness: 'unknown' | 'paged' | 'complete' = 'unknown') {
  return datasetFromRows(weights.map((weight, i) => ({ symbol: `H${i}`, weight, name: `Holding ${i}` })),
    'holdings-source', 1, 'localFile', undefined, [], { receipt, completeness });
}

type Trace = { type: string; x: string[]; y: number[]; yaxis?: string; customdata: string[][] };
function plotted(result: RecipeResult) {
  if (!result.ok) throw new Error(result.message);
  const [bars, line] = result.figure.data as Trace[];
  return { bars, line, traceCount: result.figure.data.length, layout: result.figure.layout, notes: result.notes };
}

it('accumulates original fund weights without rescaling', () => {
  const { bars, line, layout } = plotted(buildEtfPareto(holdings([.2, .1, .3]), options, context));
  expect(bars.type).toBe('bar');
  expect(line.type).toBe('scatter');
  expect(bars.y).toEqual([.3, .2, .1]);
  expect(line.y[0]).toBeCloseTo(.3);
  expect(line.y[1]).toBeCloseTo(.5);
  expect(line.y[2]).toBeCloseTo(.6);
  expect(line.x).toEqual(bars.x);
  expect(line.yaxis).toEqual(bars.yaxis);
  expect(layout).not.toHaveProperty('yaxis2');
  expect(layout.yaxis).toMatchObject({ range: [0, 1] });
});

it.each(['unknown', 'paged'] as const)('discloses %s transport and unknown provider coverage when filtering a snapshot', completeness => {
  const dataset = holdings([.3, .2, .1], completeness);
  dataset.rows.pop();
  const { notes } = plotted(buildEtfPareto(dataset, options, context));
  expect(notes).toEqual(expect.arrayContaining([
    expect.stringMatching(new RegExp(`Transport coverage is ${completeness}.*Provider holdings coverage is unknown`)),
    expect.stringMatching(/Filtered source delivered 2 of 3 acquired rows/),
    'Holdings as-of date not supplied.',
    'Snapshot retrieved 2026-01-05T13:45:00.000Z.',
  ]));
});

it('does not infer coverage from exactly 50 holdings near a whole fund weight', () => {
  const { notes } = plotted(buildEtfPareto(holdings(Array<number>(50).fill(.02)), options, context));
  expect(notes).toContain('Transport coverage is unknown. Provider holdings coverage is unknown.');
});

it('uses separate identities for equal labels, orders equal weights by ID and includes zero', () => {
  const dataset = holdings([.2, .2, 0]);
  dataset.rows[0].values = { symbol: 'B', weight: .2, name: '<Same & name>' };
  dataset.rows[1].values = { symbol: 'A', weight: .2, name: '<Same & name>' };
  const { bars, line, layout } = plotted(buildEtfPareto(dataset, options, context));
  expect(new Set(bars.x).size).toBe(3);
  expect(bars.customdata.map(([, id]) => id)).toEqual(['A', 'B', 'H2']);
  expect(bars.y).toEqual([.2, .2, 0]);
  expect(line.y).toEqual([.2, .4, .4]);
  expect(layout.xaxis).toMatchObject({ tickvals: bars.x, ticktext: ['&lt;Same &amp; name&gt;', '&lt;Same &amp; name&gt;', 'Holding 2'] });
});

it('collapses duplicate IDs with equal weight and discloses the dropped row', () => {
  const dataset = holdings([.2, .2, .1]);
  dataset.rows[1].values.symbol = dataset.rows[0].values.symbol;
  const { bars, notes } = plotted(buildEtfPareto(dataset, options, context));
  expect(bars.y).toEqual([.2, .1]);
  expect(notes).toContainEqual(expect.stringMatching(/Collapsed 1.*duplicate/i));
  expect(notes).toContainEqual(expect.stringMatching(/Delivered weight.*30%/i));
});

it('keeps distinct opaque holding IDs even if their trimmed text is the same', () => {
  const dataset = holdings([.2, .1]);
  dataset.rows[0].values.symbol = 'H';
  dataset.rows[1].values.symbol = 'H ';
  const { bars } = plotted(buildEtfPareto(dataset, options, context));
  expect(bars.y).toEqual([.2, .1]);
  expect(new Set(bars.x).size).toBe(2);
});

it('refuses conflicting weights for the same ID, including after the first 50 rows', () => {
  const dataset = holdings([...Array<number>(50).fill(.01), .02]);
  dataset.rows[50].values.symbol = dataset.rows[0].values.symbol;
  expect(buildEtfPareto(dataset, options, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/conflicting.*weight/i),
  });
});

it.each([null, -.1, NaN, Infinity, 1.01, '0.01'])('refuses an invalid delivered weight %s beyond the first 50 rows', invalid => {
  const dataset = holdings(Array<number>(51).fill(.01));
  // Change a presented value after the raw acquisition has been certified.
  dataset.rows[50].values.weight = invalid;
  expect(buildEtfPareto(dataset, options, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/weight.*fraction/i),
  });
});

it('refuses a weight with a delivered cell error even if it is numeric', () => {
  const dataset = holdings(Array<number>(51).fill(.01));
  dataset.rows[50].cellErrors = { weight: { code: 'fixture', message: 'Unavailable' } };
  expect(buildEtfPareto(dataset, options, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/weight.*cell error/i),
  });
});

it('requires an ID on every delivered row', () => {
  const dataset = holdings(Array<number>(51).fill(.01));
  dataset.rows[50].values.symbol = ' ';
  expect(buildEtfPareto(dataset, options, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/holding.*ID/i),
  });
});

it('refuses binding to an unrelated field and respects projected source IDs', () => {
  const dataset = holdings([.3, .2, .1]);
  dataset.columns.push({ id: 'other', label: 'Other', dtype: 'number' });
  expect(buildEtfPareto(dataset, { ...options, fields: { ...options.fields, weight: 'other' } }, context))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/other.*reported weight/i) });
  expect(buildEtfPareto(dataset, { ...options, fields: { ...options.fields, weight: 'hidden' } }, context))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/hidden.*unavailable/i) });
  dataset.columns = [{ id: 'presentedWeight', label: 'Weight', sourceFieldId: 'weight' },
    ...dataset.columns.filter(column => column.id !== 'weight')];
  for (const row of dataset.rows) row.values = { symbol: row.values.symbol, name: row.values.name, presentedWeight: row.values.weight };
  const result = plotted(buildEtfPareto(dataset, { ...options, fields: { ...options.fields, weight: 'presentedWeight' } }, context));
  expect(result.bars.y).toEqual([.3, .2, .1]);
});

it('falls back to the holding ID when no display label is bound', () => {
  const { bars, layout } = plotted(buildEtfPareto(holdings([.3]), {
    ...options, fields: { holding: 'symbol', weight: 'weight' },
  }, context));
  expect(layout.xaxis).toMatchObject({ tickvals: bars.x, ticktext: ['H0'] });
});

it('passes through the acquisition refusal', () => {
  const dataset = holdings([.3]);
  dataset.provenance.inputMayContainAggregates = true;
  const evidence = readEtfEvidence(dataset, 'holdings');
  if (evidence.ok) throw new Error('Expected an aggregate source to have no ETF evidence');
  expect(buildEtfPareto(dataset, options, context)).toEqual({ ...evidence, refused: true });
});

it('refuses extra options at the builder boundary', () => {
  const unsupported = { ...options, normalize: true };
  expect(buildEtfPareto(holdings([.3]), unsupported, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/unsupported.*normalize/i),
  });
});

it('caps the display at 50 and separately discloses the delivered weight and count', () => {
  const { bars, line, notes, traceCount } = plotted(buildEtfPareto(holdings(Array<number>(60).fill(.01)), options, context));
  expect(traceCount).toBe(2);
  expect(bars.y).toHaveLength(50);
  expect(bars.y.every(weight => weight === .01)).toBe(true);
  expect(line.y).toHaveLength(50);
  expect(line.y.at(-1)).toBeCloseTo(.5);
  expect(notes).toContainEqual(expect.stringMatching(/shown.*50 of 60.*50%/i));
  expect(notes).toContainEqual(expect.stringMatching(/Delivered weight.*60%/i));
});

it('preserves a tolerated excess and clearly formats the upper end of the shared axis', () => {
  const { bars, line, layout, notes } = plotted(buildEtfPareto(holdings([1, .0000005]), options, context));
  expect(bars.y).toEqual([1, .0000005]);
  expect(line.y.at(-1)).toBe(1.0000005);
  expect(layout.yaxis).toMatchObject({ range: [0, 1.0000005], ticktext: expect.arrayContaining(['100.00005%']) });
  expect(notes).toContainEqual(expect.stringMatching(/Delivered weight.*100\.00005%/i));
});

it('refuses a delivered total outside the rounding tolerance', () => {
  expect(buildEtfPareto(holdings([1, .000002]), options, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/total.*rounding tolerance/i),
  });
});

it('keeps small reported weights when summing the displayed and delivered sets', () => {
  const { line, layout } = plotted(buildEtfPareto(holdings([1, ...Array<number>(60).fill(1e-17)]), options, context));
  expect(line.y.at(-1)).toBe(1.0000000000000004);
  expect(layout.yaxis).toMatchObject({ range: [0, 1.0000000000000007] });
});

it('keeps the question revision on a refresh of the same fund', () => {
  const original = buildEtfPareto(holdings([.3, .2]), options, context);
  const refresher = buildEtfPareto(holdings([.2, .4, .1]), options, context);
  if (!original.ok || !refresher.ok) throw new Error('Expected two valid figures');
  expect(refresher.revision).toBe(original.revision);
  expect(refresher.figure.layout.uirevision).toBe(original.revision);
});

it('refuses errors in an explicitly bound label even on duplicate rows', () => {
  const data = holdings([.5, .5]);
  data.rows[1].values.symbol = 'H0';
  data.rows[1].cellErrors = { name: { code: 'fixture', message: 'broken' } };
  expect(buildEtfPareto(data, options, context)).toMatchObject({ ok: false, message: expect.stringMatching(/label.*cell error/i) });
  const unbound = { ...options, fields: { holding: 'symbol', weight: 'weight' } };
  expect(plotted(buildEtfPareto(data, unbound, context)).bars.customdata[0][0]).toBe('H0');
});

it('changes the Pareto fund title and revision when a bare ticker changes exchange', () => {
  const chart = (exchange: string) => buildEtfPareto(datasetFromRows(
    [{ symbol: 'HOLDING', name: 'Holding', weight: .5 }], 'source', 1, 'backend', undefined, [], undefined,
    { endpoint: '/eodhd/etf/holdings', parameters: { symbol: 'DEMO', exchange }, retrievedAt: 3000 }), options, context);
  const london = chart('LSE'), us = chart('US');
  if (!london.ok || !us.ok) throw new Error('Expected both acquisitions to draw');
  expect(london.revision).not.toBe(us.revision);
  expect(london.figure.layout.title).toMatchObject({ text: expect.stringContaining('DEMO.LSE') });
  expect(us.figure.layout.title).toMatchObject({ text: expect.stringContaining('DEMO.US') });
});
