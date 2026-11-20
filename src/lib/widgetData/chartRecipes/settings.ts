// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from '../../isRecord';
import { LEGACY_LINKED_CHART_TYPES, type LinkedChartSettings } from '../types';
import { isoDate, qualifiedSymbol, utcTimestamp } from './financialEvidence';
import { observationSymbol } from './priceEvidence';
import { ownershipBarRoles } from './ownershipEvidence';
import type { DualAxisOverlayOptions, RecipeOptions, RecipeRequestOptions } from './types';

type RecipeKind = RecipeOptions['kind'];
type RecipeShape = { options: readonly string[]; required?: readonly string[]; optional?: readonly string[]; distinctBindings?: true };
const priceFields = { required: ['date', 'price'], optional: ['symbol'] };
const ownershipBarShape = { options: ['issuer', 'view'], required: [], optional: ownershipBarRoles, distinctBindings: true } as const;
const ownershipWaffleShape = { options: ['issuer', 'view'], required: ['bucket', 'share'], distinctBindings: true } as const;
const recipeShapes: Record<RecipeKind, RecipeShape> = {
  drawdown: { options: ['symbols'], ...priceFields },
  'yield-curve': { options: [], required: ['date', 'maturity', 'rate'] },
  'estimate-range': { options: ['metric'], required: ['periodEnd', 'status', 'low', 'average', 'high'], optional: ['fiscalPeriod', 'note'] },
  'monthly-returns': { options: ['symbol'], ...priceFields },
  correlation: { options: ['symbols', 'lookback', 'minOverlap'], ...priceFields },
  'return-distribution': { options: ['symbol', 'bins'], ...priceFields, distinctBindings: true },
  'ownership-snapshot': ownershipBarShape,
  'return-summary': { options: ['symbols', 'view', 'window'], ...priceFields, distinctBindings: true },
  'small-multiples': { options: ['symbols'], ...priceFields, distinctBindings: true },
  'etf-pareto': { options: [], required: ['holding', 'weight'], optional: ['label'], distinctBindings: true },
  'dual-axis-overlay': { options: ['recipe'] },
  'etf-sunburst': { options: ['fund', 'depth', 'snapshot'], required: ['holding', 'sector', 'weight'], distinctBindings: true },
  'etf-exposure': { options: ['mode'], required: ['category', 'weight'], distinctBindings: true },
  'bubble-regression': { options: ['priceDate', 'regression'],
    required: ['symbol', 'date', 'dividendYield', 'priceChange', 'marketCap', 'exchange', 'currency'],
    optional: ['name', 'sector'], distinctBindings: true },
  'dividend-steps': { options: ['instrument'], required: ['date', 'amount', 'currency'], optional: ['frequency'], distinctBindings: true },
  'income-sankey': { options: ['periodColumn'] },
  'news-sentiment-calendar': { options: ['instrument', 'window'],
    required: ['timestamp', 'articleId', 'instrument', 'polarity'], distinctBindings: true },
};

export function isRecipeType(type: unknown): type is RecipeKind {
  return typeof type === 'string' && Object.hasOwn(recipeShapes, type);
}

export function isAcquiredFinancialRecipeType(type: unknown): type is 'bubble-regression' | 'dividend-steps' | 'income-sankey' | 'news-sentiment-calendar' | 'return-summary' | 'ownership-snapshot' | 'etf-sunburst' | 'dual-axis-overlay' {
  return type === 'bubble-regression' || type === 'dividend-steps' || type === 'income-sankey' || type === 'news-sentiment-calendar' || type === 'return-summary' || type === 'ownership-snapshot' || type === 'etf-sunburst' || type === 'dual-axis-overlay';
}

export const OVERLAY_LINKED_CHART_FIELDS = ['type', 'measures', 'display', 'recipe'] as const;

export const LINKED_CHART_FIELDS = ['type', 'category', 'measures', 'display', 'seriesFrom', 'period', 'recipe'] as const;

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

function canonicalObservationSymbol(value: unknown): value is string {
  return typeof value === 'string' && observationSymbol(value) === value;
}

function distinctSymbols(value: unknown, maximum = Infinity, isSymbol = nonblankString): boolean {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1 || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) return false;
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const item = Object.getOwnPropertyDescriptor(value, i);
    if (!item?.enumerable || !('value' in item) || !isSymbol(item.value) || seen.has(item.value)) return false;
    seen.add(item.value);
  }
  return true;
}

type RecipeInvalid = { ok: false; message: string };
type RecipeOptionsResult<T = RecipeOptions> = { ok: true; options: T } | RecipeInvalid;
const invalid = (message: string): RecipeInvalid => ({ ok: false, message });

function decodeRecipeShape(value: unknown, chartType: string, shape: RecipeShape): RecipeOptionsResult<Record<string, unknown>> {
  if (!declarativeRecord(value) || !Object.hasOwn(value, 'version') || value.version !== 1)
    return invalid('Supply plain version 1 recipe options.');
  if (!Object.hasOwn(value, 'kind') || chartType !== value.kind)
    return invalid('Recipe kind must match the linked chart type.');

  const allowed = ['version', 'kind', ...(shape.required ? ['fields'] : []), ...shape.options];
  const extra = Object.keys(value).find(key => !allowed.includes(key));
  if (extra !== undefined) return invalid(`Remove unsupported recipe option "${extra}".`);

  const { required } = shape;
  if (required) {
    const fields = Object.hasOwn(value, 'fields') ? value.fields : undefined;
    if (!declarativeRecord(fields)) return invalid('Supply recipe field bindings as a plain object.');
    const optional = shape.optional ?? [];
    const extraBinding = Object.keys(fields).find(key => !required.includes(key) && !optional.includes(key));
    if (extraBinding !== undefined) return invalid(`Remove unsupported recipe binding "${extraBinding}".`);
    for (const name of required) {
      if (!Object.hasOwn(fields, name) || !nonblankString(fields[name]))
        return invalid(`Choose a nonempty field ID for the "${name}" recipe binding.`);
    }
    for (const name of optional) {
      if (Object.hasOwn(fields, name) && fields[name] !== undefined && !nonblankString(fields[name]))
        return invalid(`Choose a nonempty field ID for the "${name}" recipe binding or omit it.`);
    }
    if (shape.distinctBindings) {
      const bound = Object.values(fields).filter(id => id !== undefined);
      if (new Set(bound).size !== bound.length) return invalid('Choose distinct fields for the recipe bindings.');
    }
  }

  if (shape.options.some(key => !Object.hasOwn(value, key)))
    return invalid(`Supply the required ${chartType} recipe options (${shape.options.join(', ')}).`);
  return { ok: true, options: value };
}

/** The same closed schema supplies repair messages on import and at runtime. */
export function decodeRecipeOptions(candidate: unknown, chartType: string): RecipeOptionsResult {
  if (!isRecipeType(chartType)) return invalid('Recipe options require a financial recipe chart type.');
  if (chartType === 'dual-axis-overlay') return decodeDualAxisOverlayOptions(candidate);
  const shape = chartType === 'ownership-snapshot' && isRecord(candidate) && Object.getOwnPropertyDescriptor(candidate, 'view')?.value === 'waffle'
    ? ownershipWaffleShape : recipeShapes[chartType];
  const decoded = decodeRecipeShape(candidate, chartType, shape);
  if (!decoded.ok) return decoded;
  const { options: value } = decoded;
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
    case 'return-distribution': {
      if (!canonicalObservationSymbol(value.symbol)) return invalid('Select one source symbol for return distribution.');
      const { bins } = value;
      if (typeof bins !== 'number' || !Number.isInteger(bins) || bins < 5 || bins > 100)
        return invalid('Set return distribution bins to an integer between 5 and 100.');
      break;
    }
    case 'ownership-snapshot':
      if (!qualifiedSymbol(value.issuer)) return invalid('Select one fully qualified acquired issuer.');
      if (value.view !== 'bars' && value.view !== 'waffle') return invalid('Choose ownership bars or waffle.');
      break;
    case 'return-summary': {
      if (!distinctSymbols(value.symbols, 12, qualifiedSymbol)) return invalid('Select 1 to 12 distinct qualified return listings.');
      if (value.view !== 'box' && value.view !== 'violin') return invalid('Choose box or violin for return summaries.');
      const window = value.window;
      if (declarativeRecord(window) && Object.hasOwn(window, 'mode')) {
        if (window.mode === 'own' && Object.keys(window).length === 1) break;
        if (window.mode === 'common' && Object.keys(window).length === 3
          && Object.hasOwn(window, 'start') && Object.hasOwn(window, 'end')
          && isoDate(window.start) && isoDate(window.end) && window.start <= window.end) break;
      }
      return invalid('Choose separate listing windows or enter ordered YYYY-MM-DD common bounds.');
    }
    case 'small-multiples':
      if (!distinctSymbols(value.symbols, 12, canonicalObservationSymbol))
        return invalid('Select 1 to 12 distinct source symbols for small multiples.');
      break;
    case 'bubble-regression':
      if (value.priceDate !== 'latest' && !isoDate(value.priceDate)) return invalid('Choose latest or a YYYY-MM-DD price-data date.');
      if (typeof value.regression !== 'boolean') return invalid('Choose whether to show regression.');
      break;
    case 'dividend-steps':
      if (!qualifiedSymbol(value.instrument)) return invalid('Select one fully qualified dividend instrument.');
      break;
    case 'news-sentiment-calendar': {
      if (!qualifiedSymbol(value.instrument)) return invalid('Select one fully qualified news instrument.');
      const window = value.window;
      if (declarativeRecord(window) && Object.hasOwn(window, 'mode')) {
        if (window.mode === 'latest-12-months' && Object.keys(window).length === 1) break;
        if (window.mode === 'pinned' && Object.keys(window).length === 3
          && Object.hasOwn(window, 'start') && Object.hasOwn(window, 'end')
          && isoDate(window.start) && isoDate(window.end) && window.start <= window.end) break;
      }
      return invalid('Choose the latest news window or enter ordered YYYY-MM-DD pinned bounds.');
    }
    case 'income-sankey':
      if (!nonblankString(value.periodColumn)) return invalid('Choose one presented income statement period column.');
      break;
    case 'etf-sunburst':
      if (!qualifiedSymbol(value.fund)) return invalid('Select one fully qualified acquired fund.');
      if (value.depth !== 1 && value.depth !== 2) return invalid('Choose sectors or sectors and holdings.');
      if (value.snapshot !== 'latest' && !isoDate(value.snapshot) && !utcTimestamp(value.snapshot))
        return invalid('Choose latest or a valid acquired ETF snapshot coordinate.');
      break;
    case 'etf-exposure':
      if (value.mode !== 'sector' && value.mode !== 'region') return invalid('Choose sector or region for ETF exposure.');
      break;
  }
  return { ok: true, options: value as RecipeOptions };
}

const overlayDates = ['availableAt', 'targetStart', 'targetEnd'] as const;
const overlayFields = ['series', 'date', 'value'] as const;

export function decodeDualAxisOverlayOptions(value: unknown): RecipeOptionsResult<DualAxisOverlayOptions> {
  const recipe = isRecord(value) && Object.getOwnPropertyDescriptor(value, 'recipe')?.value;
  if (recipe !== 'price-eps' && recipe !== 'cpi-ten-year')
    return invalid('Choose adjusted price and reported diluted EPS or CPI and ten-year Treasury yield.');
  const shape: RecipeShape = {
    options: ['recipe'], distinctBindings: true,
    ...(recipe === 'price-eps' ? { required: [...overlayFields, ...overlayDates] } : { required: overlayFields, optional: overlayDates }),
  };
  const decoded = decodeRecipeShape(value, 'dual-axis-overlay', shape);
  return decoded.ok ? { ok: true, options: decoded.options as DualAxisOverlayOptions } : decoded;
}

export function decodeRecipeRequestOptions(value: unknown): RecipeOptionsResult<RecipeRequestOptions> {
  const kind: unknown = isRecord(value) ? Object.getOwnPropertyDescriptor(value, 'kind')?.value : undefined;
  return decodeRecipeOptions(value, typeof kind === 'string' ? kind : '');
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
  if (options.kind === 'income-sankey') return [options.periodColumn];
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
