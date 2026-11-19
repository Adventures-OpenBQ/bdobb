// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import type { LinkedChartSettings } from '../types';
import { requiredRecipeFields, validateRecipeOptions, withRecipeType } from './settings';
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
