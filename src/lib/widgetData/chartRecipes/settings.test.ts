// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import type { DatasetColumn, LinkedChartSettings } from '../types';
import { savedBindingIssue } from './bindings';
import { decodeRecipeOptions, requiredRecipeFields, validateRecipeOptions, withRecipeType } from './settings';
import type { RecipeOptions } from './types';

const priceFields = { date: 'trade_date', price: 'adjusted_close', symbol: 'ticker' };
const correlation = {
  version: 1, kind: 'correlation', fields: priceFields, symbols: ['AMD', 'AVGO'], lookback: 252, minOverlap: 60,
} satisfies RecipeOptions;
const monthly = { version: 1, kind: 'monthly-returns', fields: priceFields, symbol: 'AMD' } satisfies RecipeOptions;
const curve = { version: 1, kind: 'yield-curve', fields: { date: 'date', maturity: 'tenor', rate: 'rate' } } satisfies RecipeOptions;
const estimate = {
  version: 1, kind: 'estimate-range', metric: 'eps',
  fields: { periodEnd: 'period_end', fiscalPeriod: 'fiscal_period', status: 'band_status', note: 'band_status', low: 'eps_low', average: 'eps_average', high: 'eps_high' },
} satisfies RecipeOptions;

it('validates four risk recipe contracts without accepting certification', () => {
  const hist = { version: 1, kind: 'return-distribution', fields: priceFields, symbol: 'AMD', bins: 30 } as const;
  const multiples = { version: 1, kind: 'small-multiples', fields: priceFields, symbols: ['AMD'] } as const;
  const pareto = { version: 1, kind: 'etf-pareto', fields: { holding: 'holding', weight: 'weight' } } as const;
  const exposure = { version: 1, kind: 'etf-exposure', fields: { category: 'region', weight: 'weight' }, mode: 'region' } as const;

  expect(decodeRecipeOptions(hist, 'return-distribution').ok).toBe(true);
  expect(decodeRecipeOptions({ ...hist, bins: 4 }, hist.kind).ok).toBe(false);
  for (const bins of [101, 30.5, NaN, undefined]) {
    expect(decodeRecipeOptions({ ...hist, bins }, hist.kind).ok).toBe(false);
  }
  for (const bins of [5, 100]) {
    expect(decodeRecipeOptions({ ...hist, bins }, hist.kind).ok).toBe(true);
  }
  expect(decodeRecipeOptions({ ...hist, symbol: ['AMD'] }, hist.kind).ok).toBe(false);
  expect(decodeRecipeOptions({ ...hist, version: 2 }, hist.kind).ok).toBe(false);
  expect(decodeRecipeOptions({ ...hist, viewportWidth: 800 }, hist.kind).ok).toBe(false);

  const ordered = ['MSFT', 'AMD', 'NVDA', 'AVGO', 'ORCL', 'AMZN', 'AAPL', 'IBM', 'ADBE', 'CSCO', 'CRM', 'META'];
  for (const symbols of [['AMD'], ordered]) {
    const options = { ...multiples, symbols };
    expect(decodeRecipeOptions(options, multiples.kind)).toEqual({ ok: true, options });
  }
  for (const symbols of [[], [...ordered, 'TSLA'], ['AMD', 'AMD']]) {
    expect(decodeRecipeOptions({ ...multiples, symbols }, multiples.kind).ok).toBe(false);
  }

  expect(decodeRecipeOptions(pareto, pareto.kind).ok).toBe(true);
  expect(requiredRecipeFields(pareto)).toEqual(['holding', 'weight']);
  const labeled = { ...pareto, fields: { ...pareto.fields, label: 'name' } };
  expect(decodeRecipeOptions(labeled, pareto.kind).ok).toBe(true);
  expect(requiredRecipeFields(labeled)).toEqual(['holding', 'weight', 'name']);
  expect(decodeRecipeOptions({ ...pareto, fund: 'FORGED' }, pareto.kind).ok).toBe(false);
  expect(decodeRecipeOptions({ ...pareto, coverage: 'complete' }, pareto.kind).ok).toBe(false);
  expect(decodeRecipeOptions({ ...pareto, cap: 10 }, pareto.kind).ok).toBe(false);

  expect(decodeRecipeOptions(exposure, exposure.kind).ok).toBe(true);
  expect(decodeRecipeOptions({ ...exposure, mode: 'sector', fields: { ...exposure.fields, category: 'sector' } }, exposure.kind).ok).toBe(true);
  expect(decodeRecipeOptions({ ...exposure, mode: 'country' }, exposure.kind).ok).toBe(false);
  expect(decodeRecipeOptions({ ...exposure, normalize: true }, exposure.kind).ok).toBe(false);
  expect(decodeRecipeOptions({ ...exposure, fields: { ...exposure.fields, fund: 'fund' } }, exposure.kind).ok).toBe(false);

  for (const recipe of [
    { ...hist, fields: { ...hist.fields, price: hist.fields.date } },
    { ...multiples, fields: { ...multiples.fields, symbol: multiples.fields.date } },
    { ...pareto, fields: { ...pareto.fields, label: pareto.fields.holding } },
    { ...exposure, fields: { ...exposure.fields, weight: exposure.fields.category } },
  ]) {
    expect(decodeRecipeOptions(recipe, recipe.kind)).toMatchObject({ ok: false, message: expect.stringMatching(/distinct/i) });
  }
});

it('matches ETF bindings by the field origin after renaming', () => {
  const weight = { id: 'allocation', label: 'Allocation', sourceFieldId: 'weight', dtype: 'number' } as const;
  const label = { id: 'security', label: 'Security', sourceFieldId: 'name', dtype: 'text' } as const;
  const pareto = { version: 1, kind: 'etf-pareto', fields: { holding: 'asset', weight: 'allocation', label: 'security' } } as const;
  for (const sourceFieldId of ['symbol', 'ticker', 'holding_id']) {
    expect(savedBindingIssue(pareto, [{ id: 'asset', label: 'Asset', dtype: 'text', sourceFieldId }, weight, label])).toBeUndefined();
  }
  expect(savedBindingIssue(pareto, [{ id: 'asset', label: 'Asset', dtype: 'text', sourceFieldId: 'name' }, weight, label]))
    .toEqual(expect.stringMatching(/cannot supply/i));

  const exposure = { version: 1, kind: 'etf-exposure', fields: { category: 'bucket', weight: 'allocation' }, mode: 'sector' } as const;
  for (const [sourceFieldId, mode] of [['sector', 'sector'], ['country', 'region'], ['region', 'region']] as const) {
    expect(savedBindingIssue({ ...exposure, mode }, [{ id: 'bucket', label: 'Bucket', dtype: 'text', sourceFieldId }, weight])).toBeUndefined();
  }
});

it.each(['AMD,AVGO', ' AMD '])('rejects noncanonical return distribution symbol %j', symbol => {
  const histogram = { version: 1, kind: 'return-distribution', fields: priceFields, bins: 30, symbol };
  expect(decodeRecipeOptions(histogram, histogram.kind).ok).toBe(false);
});

it.each([
  { symbols: ['AMD,AVGO'] },
  { symbols: [' AMD '] },
  { symbols: ['AMD', ' AMD '] },
  { symbols: ['AMD', 'AMD'] },
])('rejects small multiples selection $symbols without distinct observation symbols', ({ symbols }) => {
  const multiples = { version: 1, kind: 'small-multiples', fields: priceFields, symbols };
  expect(decodeRecipeOptions(multiples, multiples.kind).ok).toBe(false);
});

it('preserves first-batch recipe symbol validation', () => {
  const legacyMonthly = { ...monthly, symbol: 'AMD,AVGO' };
  const legacyCorrelation = { ...correlation, symbols: ['AMD', ' AMD '] };
  expect(decodeRecipeOptions(legacyMonthly, legacyMonthly.kind)).toEqual({ ok: true, options: legacyMonthly });
  expect(decodeRecipeOptions(legacyCorrelation, legacyCorrelation.kind)).toEqual({ ok: true, options: legacyCorrelation });
});

it('refuses missing, nonnumeric, grouped and calculated ETF weight fields', () => {
  const exposure = { version: 1, kind: 'etf-exposure', fields: { category: 'sector', weight: 'allocation' }, mode: 'sector' } as const;
  const category: DatasetColumn = { id: 'sector', label: 'Sector', dtype: 'text' };
  const weight: DatasetColumn = { id: 'allocation', label: 'Allocation', dtype: 'number', sourceFieldId: 'weight' };
  expect(savedBindingIssue(exposure, [category])).toEqual(expect.stringMatching(/unavailable/i));
  for (const update of [
    { dtype: 'text' },
    { sourceFieldId: 'market_value' },
    { measureId: 'weight' },
    { aggregation: 'sum' },
    { splitPath: [{ field: 'region', value: 'US' }] },
    { analytical: { kind: 'formula', definitionId: 'formula', name: 'Weight' } },
  ] satisfies Partial<DatasetColumn>[]) {
    expect(savedBindingIssue(exposure, [category, { ...weight, ...update }])).toEqual(expect.stringMatching(/cannot supply/i));
  }
});

it('requires version 1 and the recipe kind that matches the chart type', () => {
  expect(validateRecipeOptions({ version: 2, kind: 'correlation' }, 'correlation')).toBeNull();
  expect(validateRecipeOptions({ version: 1, kind: 'drawdown' }, 'correlation')).toBeNull();
  expect(validateRecipeOptions({ ...correlation, version: 2 }, 'correlation')).toBeNull();
  expect(validateRecipeOptions(correlation, 'line')).toBeNull();
  expect(validateRecipeOptions({ ...correlation, kind: 'unknown' }, 'unknown')).toBeNull();
});

it('accepts each closed version-1 recipe shape with its own bindings', () => {
  const drawdown = { version: 1, kind: 'drawdown', fields: { date: 'date', price: 'adjusted_close' }, symbols: ['AMD'] };
  for (const recipe of [drawdown, curve, estimate, monthly, correlation]) {
    expect(validateRecipeOptions(recipe, recipe.kind)).toEqual(recipe);
  }
  expect(validateRecipeOptions({ ...estimate, metric: 'revenue' }, 'estimate-range')).toEqual({ ...estimate, metric: 'revenue' });
  expect(validateRecipeOptions({ ...estimate, metric: 'cash' }, 'estimate-range')).toBeNull();
  expect(validateRecipeOptions({ ...curve, fields: priceFields }, 'yield-curve')).toBeNull();
});

it('accepts 1 through 25 distinct correlation symbols', () => {
  for (let count = 1; count <= 25; count++) {
    const options = { ...correlation, symbols: Array.from({ length: count }, (_, i) => `SYMBOL${i}`) };
    expect(validateRecipeOptions(options, 'correlation')).toEqual(options);
  }
});

it.each([
  ['no symbols', []],
  ['duplicate symbols', ['AMD', 'AMD']],
  ['an empty symbol', ['AMD', '']],
  ['a blank symbol', ['AMD', ' ']],
  ['a sparse list', Array<string>(1)],
  ['26 symbols', Array.from({ length: 26 }, (_, i) => `SYMBOL${i}`)],
])('rejects %s in a correlation selection', (_, symbols) => {
  expect(validateRecipeOptions({ ...correlation, symbols }, 'correlation')).toBeNull();
});

it('accepts the inclusive minimum and maximum safe correlation windows', () => {
  for (const lookback of [3, Number.MAX_SAFE_INTEGER]) {
    const options = { ...correlation, lookback, minOverlap: lookback };
    expect(validateRecipeOptions(options, 'correlation')).toEqual(options);
  }
});

it.each([
  { lookback: 2, minOverlap: 3 },
  { lookback: 21.5, minOverlap: 3 },
  { lookback: Number.MAX_SAFE_INTEGER + 1, minOverlap: 3 },
  { lookback: Number.POSITIVE_INFINITY, minOverlap: 3 },
  { lookback: '252', minOverlap: 60 },
  { lookback: 252, minOverlap: 2 },
  { lookback: 252, minOverlap: 3.5 },
  { lookback: 252, minOverlap: 253 },
])('rejects correlation window $lookback with minimum overlap $minOverlap', bounds => {
  expect(validateRecipeOptions({ ...correlation, ...bounds }, 'correlation')).toBeNull();
});

it('requires exactly one symbol for monthly returns', () => {
  const { symbol: _, ...noSymbol } = monthly;
  expect(validateRecipeOptions(noSymbol, 'monthly-returns')).toBeNull();
  expect(validateRecipeOptions({ ...monthly, symbol: ' ' }, 'monthly-returns')).toBeNull();
  expect(validateRecipeOptions({ ...monthly, symbol: ['AMD', 'AVGO'] }, 'monthly-returns')).toBeNull();
  expect(validateRecipeOptions({ ...monthly, symbols: ['AMD', 'AVGO'] }, 'monthly-returns')).toBeNull();
});

it('rejects empty names for both required and optional bindings', () => {
  expect(validateRecipeOptions({ ...correlation, fields: { ...priceFields, price: '' } }, 'correlation')).toBeNull();
  expect(validateRecipeOptions({ ...monthly, fields: { ...priceFields, symbol: ' ' } }, 'monthly-returns')).toBeNull();
  expect(validateRecipeOptions({ ...estimate, fields: { ...estimate.fields, fiscalPeriod: '' } }, 'estimate-range')).toBeNull();
});

it('rejects extra options, extra bindings, functions, and accessors', () => {
  expect(validateRecipeOptions({ ...correlation, plotly: { data: [] } }, 'correlation')).toBeNull();
  expect(validateRecipeOptions({ ...correlation, fields: { ...priceFields, close: 'close' } }, 'correlation')).toBeNull();
  expect(validateRecipeOptions({ ...correlation, fields: { ...priceFields, price: () => 1 } }, 'correlation')).toBeNull();
  expect(validateRecipeOptions({ ...correlation, symbols: Object.assign(['AMD'], { toJSON: () => [] }) }, 'correlation')).toBeNull();
  const executable = { ...correlation, get lookback(): number { throw new Error('Option accessor ran'); } };
  expect(validateRecipeOptions(executable, 'correlation')).toBeNull();
});

it('lists binding IDs in declaration order without duplicates', () => {
  expect(requiredRecipeFields(estimate)).toEqual(['period_end', 'fiscal_period', 'band_status', 'eps_low', 'eps_average', 'eps_high']);
  expect(requiredRecipeFields({ ...monthly, fields: { date: 'date', price: 'adjusted_close' } })).toEqual(['date', 'adjusted_close']);
});

it('clears a bullet fiscal period when switching to another chart type', () => {
  const bullet: LinkedChartSettings = { type: 'bullet', display: 'grouped', measures: ['eps_actual'], category: 'fiscal_period', period: 'FQ3 2026' };
  expect(withRecipeType(bullet, 'bullet')).toEqual(bullet);
  const { period: _, ...remaining } = bullet;
  expect(withRecipeType(bullet, 'correlation')).toEqual({ ...remaining, type: 'correlation' });
});

it('retains compatible options while dropping old chart-specific settings', () => {
  const recipeSettings: LinkedChartSettings = { type: 'correlation', display: 'grouped', measures: [], recipe: correlation };
  expect(withRecipeType(recipeSettings, 'correlation')).toEqual(recipeSettings);
  expect(withRecipeType(recipeSettings, 'yield-curve')).toEqual({ type: 'yield-curve', display: 'grouped', measures: [] });
  const legacy: LinkedChartSettings = { type: 'column', display: 'percent', measures: ['adjusted_close'], seriesFrom: 'rows' };
  expect(withRecipeType(legacy, 'column')).toEqual(legacy);
  expect(withRecipeType(legacy, 'correlation')).toEqual({ type: 'correlation', display: 'stacked', measures: ['adjusted_close'] });
});
