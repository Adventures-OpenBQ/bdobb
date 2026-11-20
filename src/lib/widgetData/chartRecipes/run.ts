// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from '../../isRecord';
import type { WidgetDataset } from '../types';
import { savedBindingIssue } from './bindings';
import { buildBubbleRegression } from './bubbleRegression';
import { buildCorrelation } from './correlation';
import { buildDividendSteps } from './dividendSteps';
import { buildDrawdown } from './drawdown';
import { buildDualAxisOverlay } from './dualAxisOverlay';
import { buildEstimateRange } from './estimateRange';
import { buildIncomeSankey } from './incomeSankey';
import { buildMonthlyReturns } from './monthlyReturns';
import { buildNewsCalendar } from './newsCalendar';
import { buildOwnershipSnapshot } from './ownershipSnapshot';
import { calendarDate } from './priceEvidence';
import { decodeRecipeRequestOptions } from './settings';
import type { RecipeContext, RecipeRequestOptions, RecipeResult } from './types';
import { buildEtfExposure } from './etfExposure';
import { buildEtfPareto } from './etfPareto';
import { buildEtfSunburst } from './etfSunburst';
import { buildReturnDistribution } from './returnDistribution';
import { buildReturnSummary } from './returnSummary';
import { buildSmallMultiples } from './smallMultiples';
import { buildYieldCurve } from './yieldCurve';

// Column precision and app settings use a range supported by Intl.NumberFormat across our clients.
function validPrecision(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 20;
}

function hasChartInputs(dataset: unknown): boolean {
  if (!isRecord(dataset) || !Array.isArray(dataset.columns) || !Array.isArray(dataset.rows)
    || !isRecord(dataset.provenance) || typeof dataset.provenance.sourceWidgetId !== 'string'
    || !isRecord(dataset.completeness) || typeof dataset.completeness.kind !== 'string') return false;
  for (const column of dataset.columns) {
    if (!isRecord(column) || typeof column.id !== 'string'
      || (column.sourceFieldId !== undefined && typeof column.sourceFieldId !== 'string')) return false;
    if (column.format !== undefined && (!isRecord(column.format)
      || (column.format.decimalPlaces !== undefined && !validPrecision(column.format.decimalPlaces)))) return false;
  }
  for (const row of dataset.rows)
    if (!isRecord(row) || !isRecord(row.values)) return false;
  return true;
}

function hasRecipeContext(context: unknown): boolean {
  return isRecord(context) && (context.theme === 'light' || context.theme === 'dark')
    && validPrecision(context.maxDecimals)
    && typeof context.today === 'string' && calendarDate(context.today) === context.today;
}

/** Pure worker entry point. Builder errors are left to the caller's worker error handling. */
export function runRecipe(dataset: WidgetDataset, options: RecipeRequestOptions, context: RecipeContext): RecipeResult {
  const decoded = decodeRecipeRequestOptions(options);
  if (!decoded.ok) return { ok: false, refused: true, message: decoded.message };
  if (!hasChartInputs(dataset))
    return { ok: false, refused: true, message: 'Reload the source table to supply a valid chart dataset.' };
  if (!hasRecipeContext(context))
    return { ok: false, refused: true, message: 'Supply a valid chart context with theme, precision and a YYYY-MM-DD calendar date.' };
  const { viewportWidth, viewportHeight } = context;
  for (const [dimension, size] of [['width', viewportWidth], ['height', viewportHeight]] as const) {
    if (size !== undefined && (!Number.isFinite(size) || size <= 0 || size > 10_000)) {
      return { ok: false, refused: true, message: `Supply a viewport ${dimension} greater than 0 and at most 10,000.` };
    }
  }

  const recipe = decoded.options;
  if (recipe.kind === 'dual-axis-overlay') return buildDualAxisOverlay(dataset, recipe, context);
  const issue = recipe.kind === 'dividend-steps' || recipe.kind === 'news-sentiment-calendar' || recipe.kind === 'etf-sunburst'
    ? undefined : savedBindingIssue(recipe, dataset.columns, dataset.rows);
  if (issue) return { ok: false, refused: true, message: issue };
  switch (recipe.kind) {
    case 'drawdown': return buildDrawdown(dataset, recipe, context);
    case 'yield-curve': return buildYieldCurve(dataset, recipe, context);
    case 'estimate-range': return buildEstimateRange(dataset, recipe, context);
    case 'monthly-returns': return buildMonthlyReturns(dataset, recipe, context);
    case 'correlation': return buildCorrelation(dataset, recipe, context);
    case 'return-distribution': return buildReturnDistribution(dataset, recipe, context);
    case 'return-summary': return buildReturnSummary(dataset, recipe, context);
    case 'small-multiples': return buildSmallMultiples(dataset, recipe, context);
    case 'etf-pareto': return buildEtfPareto(dataset, recipe, context);
    case 'etf-sunburst': return buildEtfSunburst(dataset, recipe, context);
    case 'etf-exposure': return buildEtfExposure(dataset, recipe, context);
    case 'bubble-regression': return buildBubbleRegression(dataset, recipe, context);
    case 'dividend-steps': return buildDividendSteps(dataset, recipe, context);
    case 'income-sankey': return buildIncomeSankey(dataset, recipe, context);
    case 'ownership-snapshot': return buildOwnershipSnapshot(dataset, recipe, context);
    case 'news-sentiment-calendar': return buildNewsCalendar(dataset, recipe, context);
  }
}
