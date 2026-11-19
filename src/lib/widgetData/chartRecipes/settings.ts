// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from '../../isRecord';
import { LEGACY_LINKED_CHART_TYPES, type LinkedChartSettings } from '../types';
import type { RecipeOptions } from './types';

type RecipeKind = RecipeOptions['kind'];
type RecipeShape = { options: readonly string[]; required: readonly string[]; optional?: readonly string[] };
const priceFields = { required: ['date', 'price'], optional: ['symbol'] };
const recipeShapes: Record<RecipeKind, RecipeShape> = {
  drawdown: { options: ['symbols'], ...priceFields },
  'yield-curve': { options: [], required: ['date', 'maturity', 'rate'] },
  'estimate-range': { options: ['metric'], required: ['periodEnd', 'status', 'low', 'average', 'high'], optional: ['fiscalPeriod', 'note'] },
  'monthly-returns': { options: ['symbol'], ...priceFields },
  correlation: { options: ['symbols', 'lookback', 'minOverlap'], ...priceFields },
};

export function isRecipeType(type: unknown): type is RecipeKind {
  return typeof type === 'string' && Object.hasOwn(recipeShapes, type);
}

export function isLegacyLinkedChartType(type: unknown): boolean {
  return LEGACY_LINKED_CHART_TYPES.some(legacy => legacy === type);
}

function declarativeRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && descriptor?.enumerable && 'value' in descriptor;
  });
}

function nonblankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function distinctSymbols(value: unknown, maximum = Infinity): boolean {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1 || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) return false;
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const item = Object.getOwnPropertyDescriptor(value, i);
    if (!item?.enumerable || !('value' in item) || !nonblankString(item.value) || seen.has(item.value)) return false;
    seen.add(item.value);
  }
  return true;
}

type RecipeOptionsResult = { ok: true; options: RecipeOptions } | { ok: false; message: string };
const invalid = (message: string): RecipeOptionsResult => ({ ok: false, message });

/** The same closed schema supplies repair messages on import and at runtime. */
export function decodeRecipeOptions(value: unknown, chartType: string): RecipeOptionsResult {
  if (!isRecipeType(chartType)) return invalid('Recipe options require a financial recipe chart type.');
  if (!declarativeRecord(value) || !Object.hasOwn(value, 'version') || value.version !== 1)
    return invalid('Supply plain version 1 recipe options.');
  if (!Object.hasOwn(value, 'kind') || chartType !== value.kind)
    return invalid('Recipe kind must match the linked chart type.');

  const shape = recipeShapes[chartType];
  const allowed = ['version', 'kind', 'fields', ...shape.options];
  const extra = Object.keys(value).find(key => !allowed.includes(key));
  if (extra !== undefined) return invalid(`Remove unsupported recipe option "${extra}".`);

  const fields = Object.hasOwn(value, 'fields') ? value.fields : undefined;
  if (!declarativeRecord(fields)) return invalid('Supply recipe field bindings as a plain object.');
  const optional = shape.optional ?? [];
  const extraBinding = Object.keys(fields).find(key => !shape.required.includes(key) && !optional.includes(key));
  if (extraBinding !== undefined) return invalid(`Remove unsupported recipe binding "${extraBinding}".`);
  for (const name of shape.required) {
    if (!Object.hasOwn(fields, name) || !nonblankString(fields[name]))
      return invalid(`Choose a nonempty field ID for the "${name}" recipe binding.`);
  }
  for (const name of optional) {
    if (Object.hasOwn(fields, name) && fields[name] !== undefined && !nonblankString(fields[name]))
      return invalid(`Choose a nonempty field ID for the "${name}" recipe binding or omit it.`);
  }

  if (shape.options.some(key => !Object.hasOwn(value, key)))
    return invalid(`Supply the required ${chartType} recipe options (${shape.options.join(', ')}).`);
  switch (chartType) {
    case 'drawdown':
      if (!distinctSymbols(value.symbols)) return invalid('Select one or more distinct symbols for drawdown.');
      break;
    case 'estimate-range':
      if (value.metric !== 'eps' && value.metric !== 'revenue') return invalid('Choose eps or revenue as the estimate-range metric.');
      break;
    case 'monthly-returns':
      if (!nonblankString(value.symbol)) return invalid('Select one symbol for monthly returns.');
      break;
    case 'correlation': {
      if (!distinctSymbols(value.symbols, 25)) return invalid('Select 1 to 25 distinct symbols for correlation.');
      const { lookback, minOverlap } = value;
      if (typeof lookback !== 'number' || !Number.isSafeInteger(lookback) || lookback < 3)
        return invalid('Set correlation lookback to a safe integer of at least 3.');
      if (typeof minOverlap !== 'number' || !Number.isSafeInteger(minOverlap) || minOverlap < 3 || minOverlap > lookback)
        return invalid('Set correlation minOverlap to an integer between 3 and lookback.');
      break;
    }
  }
  return { ok: true, options: value as RecipeOptions };
}

/** A null result represents legacy settings with no recipe declaration. */
export function decodeLinkedChartRecipe(settings: object, chartType: string): RecipeOptionsResult | null {
  const descriptor = Object.getOwnPropertyDescriptor(settings, 'recipe');
  if (descriptor && (!descriptor.enumerable || !('value' in descriptor)))
    return invalid('Declare recipe options as enumerable JSON data.');
  const value: unknown = descriptor?.value;
  return isRecipeType(chartType) || value !== undefined ? decodeRecipeOptions(value, chartType) : null;
}

export function validateRecipeOptions(value: unknown, chartType: string): RecipeOptions | null {
  const result = decodeRecipeOptions(value, chartType);
  return result.ok ? result.options : null;
}

export function requiredRecipeFields(options: RecipeOptions): string[] {
  const fields: (string | undefined)[] = Object.values(options.fields);
  return [...new Set(fields.filter((field): field is string => field !== undefined))];
}

/** New recipe controls provide valid options before saving a type change. */
export function withRecipeType(settings: LinkedChartSettings, type: LinkedChartSettings['type']): LinkedChartSettings {
  const next: LinkedChartSettings = { ...settings, type };
  if (type === 'bullet') next.display = 'grouped';
  else if (next.display === 'percent' && type !== 'column' && type !== 'bar') next.display = 'stacked';
  if (type !== 'bullet' || settings.type !== 'bullet') delete next.period;
  if (type !== 'column' && type !== 'bar' && type !== 'line') delete next.seriesFrom;
  if (type !== settings.type || !validateRecipeOptions(settings.recipe, type)) delete next.recipe;
  return next;
}
