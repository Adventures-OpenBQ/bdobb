// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from '../../isRecord';
import type { WidgetDataset } from '../types';
import { acquiredWindow, dailyScope, indexPriceObservations, priceIdentityFields, priceDimensionIssue, readPriceOmissions, symbolList, type PriceCoordinate, type PriceScope } from './priceEvidence';
import { acceptsBinding, adjustedPriceRole } from './bindings';
import { readChartSourceProjection } from './chartSourceContracts';
import { readLiveDailyPriceSource } from './dailyPriceEvidence';
import { acquiredColumnOrigin } from './financialEvidence';
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
  const identities = Array.isArray(verifiedIdentities) ? verifiedIdentities : priceIdentityFields(dataset.columns);
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
  if (count === undefined || count < dataset.rows.length) return null;
  const evidence = readPriceOmissions(dataset.provenance, count, dataset.rows.length);
  if (!evidence || evidence.dateField !== fields.date
    || (fields.symbol && !evidence.symbolFields.includes(fields.symbol))) return null;
  return evidence.points;
}

export function preparePrices(dataset: WidgetDataset, fields: PriceBindings): PreparedPrices {
  const issue = priceIssue(dataset, fields);
  if (issue) return refuse(issue);
  const scope = dailyScope(dataset.provenance)!;
  const omitted = omittedPoints(dataset, fields);
  if (!omitted) return refuse('The source omits observations without sufficient continuity evidence. Use the fully loaded, unfiltered source.');
  const symbols = symbolList(dataset.provenance);
  const indexed = indexPriceObservations(dataset.rows, fields, scope, symbols);
  if (typeof indexed === 'string') return refuse(indexed);
  const acquiredConflicts = dataset.provenance.metadata?.priceDuplicateConflicts;
  if (Array.isArray(acquiredConflicts)) {
    for (const conflict of acquiredConflicts) {
      if (Array.isArray(conflict) && conflict.length === 3 && conflict[0] === fields.date && conflict[1] === fields.price
        && typeof conflict[2] === 'string') indexed.conflicts.add(conflict[2]);
    }
  }
  const notes = omitted.length ? [`Preserved gaps for ${omitted.length} excluded price observation(s).`] : [];
  return finishPrices(scope, indexed, omitted, notes);
}

/** Live evidence establishes an acquired window for return summaries alone. */
export function prepareLiveReturnPrices(dataset: WidgetDataset, fields: PriceBindings): PreparedPrices | undefined {
  const live = readLiveDailyPriceSource(dataset);
  if (!live) return;
  const { receipt, scope, symbols, rawOmissions } = live;
  if (!dataset.rows.length) return refuse('No valid daily prices remain.');
  const origin = (id: string) => acquiredColumnOrigin(dataset.columns.find(c => c.id === id));
  if (origin(fields.date) !== receipt.date_field) return refuse('Bind the acquired trading-date field.');
  if (origin(fields.price) !== receipt.price_field) return refuse('Choose the source-documented adjusted-price field.');
  if ((fields.symbol === undefined ? null : origin(fields.symbol)) !== receipt.symbol_field) {
    return refuse(receipt.symbol_field ? 'Bind the acquired field that identifies each qualified listing.'
      : 'Use the single listing identified by the acquired source.');
  }

  // The source reader has reconciled this projection against the acquired coordinate ledger.
  const tableOmissions = readChartSourceProjection(dataset.provenance, 'daily-price')!.omitted
    .map((id): PriceCoordinate => JSON.parse(id));
  const indexed = indexPriceObservations(dataset.rows, fields, scope, symbols);
  if (typeof indexed === 'string') return refuse(indexed);
  const notes = ['Observed quote-to-quote returns; exchange-session completeness unknown.'];
  if (rawOmissions.length) notes.push(`Preserved ${rawOmissions.length} price gap(s) from provider omissions.`);
  if (tableOmissions.length) notes.push(`Preserved ${tableOmissions.length} price gap(s) from table filtering.`);
  return finishPrices(scope, indexed, [...rawOmissions, ...tableOmissions], notes);
}

function finishPrices(
  scope: PriceScope, { prices, conflicts, duplicates }: Exclude<ReturnType<typeof indexPriceObservations>, string>,
  omitted: PriceCoordinate[], sourceNotes: string[],
): PreparedPrices {
  for (const [symbol, date] of omitted) prices.get(symbol)?.set(date, null);
  const notes: string[] = [];
  if (duplicates) notes.push(`Collapsed ${duplicates} identical duplicate price observation(s).`);
  notes.push(...sourceNotes);
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
