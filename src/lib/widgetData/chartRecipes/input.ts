// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from '../../isRecord';
import type { WidgetDataset } from '../types';
import { acquiredWindow, calendarDate, dailyScope, observationSymbol, priceIdentityFields, priceDimensionIssue, symbolList, type PriceScope } from './priceEvidence';
import { acceptsBinding, adjustedPriceRole } from './bindings';
import { requiredRecipeFields } from './settings';
import type { PriceBindings, RecipeOptions } from './types';

export type { PriceScope } from './priceEvidence';
export type PriceSeries = { symbol: string; points: { date: string; price: number | null }[] };
type PreparedPrices = { ok: true; scope: PriceScope; series: PriceSeries[]; notes: string[] }
  | { ok: false; message: string; refused: true };
const refuse = (message: string) => ({ ok: false, message, refused: true }) as const;

function sourceIssue(dataset: WidgetDataset, fields: string[], history: boolean): string | null {
  const columns = new Map(dataset.columns.map(c => [c.id, c]));
  const missing = fields.find(id => !columns.has(id));
  if (missing !== undefined) return `Present the required field "${missing}" or repair the chart binding.`;
  if (dataset.provenance.inputMayContainAggregates || dataset.rows.some(row => row.groupPath !== undefined)
    || fields.some(id => {
      const c = columns.get(id)!;
      return c.aggregation || c.splitPath?.length || c.measureId || c.analytical?.scope === 'aggregate';
    })) return 'Choose raw observations before grouping, pivoting or aggregation.';
  if (history) {
    const { kind } = dataset.completeness;
    if (kind !== 'bounded' && kind !== 'complete') return `The source must be fully loaded. Acquisition is ${kind}.`;
    if (kind === 'bounded' && !acquiredWindow(dataset.provenance)) return 'Document the start and end dates of the bounded acquisition.';
  }
  return null;
}

function priceIssue(dataset: WidgetDataset, fields: PriceBindings): string | null {
  const bindings = Object.values(fields).filter((id): id is string => id !== undefined);
  if (new Set(bindings).size !== bindings.length) return 'Use distinct date, adjusted-price and symbol fields.';
  const issue = sourceIssue(dataset, bindings, true);
  if (issue) return issue;
  if (!dailyScope(dataset.provenance)) return 'Choose a source with documented daily interval and acquisition dates.';
  const price = dataset.columns.find(c => c.id === fields.price)!;
  if (!acceptsBinding(adjustedPriceRole, price, dataset.rows)) return 'Choose a raw adjusted-price observation.';
  const metadata = dataset.provenance.metadata;
  if (typeof metadata?.priceDimensionIssue === 'string') return metadata.priceDimensionIssue;
  const verifiedIdentities = metadata?.priceSymbolFields;
  if (('kind' in dataset && dataset.kind === 'chartData' || dataset.provenance.presentation)
    && (metadata?.priceDimensionsChecked !== true || !Array.isArray(verifiedIdentities) || !isRecord(metadata.acquiredPriceUnits)))
    return 'The projected source cannot verify price units and instrument identity. Use a documented daily snapshot.';
  const identities = Array.isArray(verifiedIdentities) ? verifiedIdentities : priceIdentityFields(dataset.columns.map(c => c.id));
  if (fields.symbol && identities.length && !identities.includes(fields.symbol)) return 'Bind the source symbol field to preserve instrument identity.';
  if (!fields.symbol && symbolList(dataset.provenance)?.length !== 1) return 'Bind a symbol field or use an acquisition with one unambiguous symbol.';
  return priceDimensionIssue(dataset, fields.price) ?? null;
}

/** Curves have observation dates and tenors. Reported-quarter ranges have fiscal identity. */
export function recipeEligibility(dataset: WidgetDataset, options: RecipeOptions): string | null {
  if ('fields' in options && 'price' in options.fields) return priceIssue(dataset, options.fields);
  return sourceIssue(dataset, requiredRecipeFields(options), options.kind === 'yield-curve');
}

/** A row count can disprove continuity; only the acquisition contract can establish completeness. */
function omittedPoints(dataset: WidgetDataset, fields: PriceBindings): [string, string][] | null {
  const count = dataset.completeness.acquiredRowCount;
  if (count === dataset.rows.length) return [];
  const projected = 'kind' in dataset && dataset.kind === 'chartData' || dataset.provenance.presentation || dataset.provenance.lineage?.length;
  if (count === undefined && !projected) return [];
  const evidence = dataset.provenance.metadata?.priceOmissions;
  if (count === undefined || count < dataset.rows.length || !isRecord(evidence)
    || evidence.acquired !== count || evidence.delivered !== dataset.rows.length || evidence.dateField !== fields.date
    || !Array.isArray(evidence.symbolFields) || (fields.symbol ? !evidence.symbolFields.includes(fields.symbol) : evidence.symbolFields.length !== 0)
    || !Array.isArray(evidence.points)
    || evidence.points.length > count - dataset.rows.length) return null;
  const points: [string, string][] = [];
  for (const point of evidence.points) {
    if (!Array.isArray(point) || point.length !== 2 || typeof point[0] !== 'string' || !point[0]) return null;
    const date = calendarDate(point[1]);
    if (!date) return null;
    points.push([point[0], date]);
  }
  return points;
}

export function preparePrices(dataset: WidgetDataset, fields: PriceBindings): PreparedPrices {
  const issue = priceIssue(dataset, fields);
  if (issue) return refuse(issue);
  const scope = dailyScope(dataset.provenance)!;
  const omitted = omittedPoints(dataset, fields);
  if (!omitted) return refuse('The source omits observations without sufficient continuity evidence. Use the fully loaded, unfiltered source.');
  const symbols = symbolList(dataset.provenance);
  const allowed = symbols && new Set(symbols);
  const prices = new Map<string, Map<string, number | null>>();
  const conflicts = new Set<string>();
  let duplicates = 0;
  for (const { values, cellErrors } of dataset.rows) {
    const symbol = observationSymbol(fields.symbol ? values[fields.symbol] : symbols?.[0]);
    if (!symbol) return refuse('Each price observation needs one identified symbol.');
    if (allowed && !allowed.has(symbol)) return refuse('Source and observation symbols disagree.');
    const date = calendarDate(values[fields.date]);
    if (!date || date < scope.start || date > scope.end) return refuse('Repair missing, invalid or out-of-window trading dates.');
    const rawPrice = values[fields.price];
    const price = !cellErrors?.[fields.price] && typeof rawPrice === 'number' && Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;
    let daily = prices.get(symbol);
    if (!daily) { daily = new Map(); prices.set(symbol, daily); }
    if (!daily.has(date)) daily.set(date, price);
    else if (daily.get(date) !== price) conflicts.add(symbol);
    else duplicates++;
  }
  for (const [symbol, date] of omitted) {
    if (!prices.has(symbol) || date < scope.start || date > scope.end) return refuse('Repair inconsistent omitted-observation evidence.');
    prices.get(symbol)!.set(date, null);
  }
  const notes: string[] = [];
  if (duplicates) notes.push(`Collapsed ${duplicates} identical duplicate price observation(s).`);
  if (omitted.length) notes.push(`Preserved gaps for ${omitted.length} excluded price observation(s).`);
  if (conflicts.size) notes.push(`Conflicting duplicate prices excluded ${conflicts.size} symbol(s): ${[...conflicts].slice(0, 10).join(', ')}.`);
  const series: PriceSeries[] = [];
  let gaps = 0;
  for (const [symbol, daily] of prices) {
    if (conflicts.has(symbol)) continue;
    const points = Array.from(daily, ([date, price]) => ({ date, price })).sort((a, b) => a.date.localeCompare(b.date));
    gaps += points.filter(point => point.price === null).length;
    series.push({ symbol, points });
  }
  if (gaps) notes.push(`${gaps} price gap(s) in the delivered series.`);
  if (!series.some(item => item.points.some(point => point.price !== null)))
    return refuse(['No valid daily prices remain.', ...notes].join(' '));
  series.sort((a, b) => a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);
  return { ok: true, series, notes, scope };
}
