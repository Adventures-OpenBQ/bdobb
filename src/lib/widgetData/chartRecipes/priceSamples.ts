// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { list } from '../figureHelpers';
import type { ChartBuildResult } from './chartSourceContracts';
import { isoDate, qualifiedSymbol } from './financialEvidence';
import { documentedDailySnapshotMessage, hasDocumentedDailySnapshot, priceBasisFields, priceDateFields, priceIdentityFields } from './priceEvidence';
import type { WidgetDataset } from '../types';
import { observedReturnScope, prepareLiveReturnPrices, preparePrices, type PriceScope, type PriceSeries } from './input';
import type { PriceBindings } from './types';

/** Apply strict selection after the shared source and continuity checks. */
export function prepareSelectedPrices(
  dataset: WidgetDataset, fields: PriceBindings, symbols: readonly string[],
): ReturnType<typeof preparePrices> {
  return selectPrices(preparePrices(dataset, fields), symbols);
}

function selectPrices(prepared: ReturnType<typeof preparePrices>, symbols: readonly string[]): ReturnType<typeof preparePrices> {
  if (!prepared.ok) return prepared;

  const bySymbol = new Map(prepared.series.map(series => [series.symbol, series]));
  const missing = symbols.filter(symbol => !bySymbol.has(symbol));
  if (missing.length) return { ok: false, refused: true, message: [
    `No usable delivered daily price series for the selected symbol(s) ${list(missing)}.`, ...prepared.notes,
  ].join(' ') };
  return { ...prepared, series: symbols.map(symbol => bySymbol.get(symbol)!) };
}

/** Prepared points are ordered and use null for known gaps, including evidenced omissions. */
export function dailyReturnSamples(
  series: PriceSeries,
): { samples: { date: string; value: number }[]; excludedNonfinite: number; gapCount: number } {
  const samples: { date: string; value: number }[] = [];
  let excludedNonfinite = 0;
  let gapCount = 0;
  let previous: number | null = null;
  for (const { date, price } of series.points) {
    if (price === null) gapCount++;
    else if (previous !== null) {
      const value = price / previous - 1;
      if (Number.isFinite(value)) samples.push({ date, value });
      else excludedNonfinite++;
    }
    previous = price;
  }
  return { samples, excludedNonfinite, gapCount };
}

export type ReturnSummaryWindow = { mode: 'own' } | { mode: 'common'; start: string; end: string };
type ReturnSummarySeries = ReturnType<typeof dailyReturnSamples> & {
  symbol: string;
  start: string;
  end: string;
  excludedOpportunities: number;
};
type ReturnSummarySamples = {
  scope: PriceScope;
  adjustmentBasis: 'adjusted-price';
  commonWindow: { start: string; end: string } | null;
  series: ReturnSummarySeries[];
};

function localSnapshotIssue(dataset: WidgetDataset, fields: PriceBindings): string | undefined {
  if (!hasDocumentedDailySnapshot(dataset.provenance)) return documentedDailySnapshotMessage;
  if (!priceBasisFields(dataset.columns).includes(fields.price)) {
    return 'Choose a source-documented adjusted-price field.';
  }
  if (!priceDateFields(dataset.columns).includes(fields.date)) {
    return 'Bind the acquired trading-date field.';
  }
  if (fields.symbol && !priceIdentityFields(dataset.columns).includes(fields.symbol)) {
    return 'Bind the acquired field that identifies each qualified listing.';
  }
  const { acquiredRowCount, totalRowCount, totalRowCountKind, kind } = dataset.completeness;
  if (acquiredRowCount === undefined || !Number.isSafeInteger(acquiredRowCount) || acquiredRowCount < dataset.rows.length
    || (totalRowCountKind === 'exact' && (typeof totalRowCount !== 'number' || !Number.isSafeInteger(totalRowCount)
      || totalRowCount < acquiredRowCount || (kind === 'complete' && totalRowCount !== acquiredRowCount)))) {
    return 'The source row counts do not prove continuity. Reload the fully acquired price history.';
  }
}

/** Both presentations consume the same bounded, listing-specific daily samples. */
export function admitReturnSummary(
  dataset: WidgetDataset, fields: PriceBindings, symbols: readonly string[], window: ReturnSummaryWindow,
): ChartBuildResult<ReturnSummarySamples> {
  const refuse = (message: string) => ({ ok: false, refused: true, message }) as const;
  if (!symbols.length || symbols.length > 12 || new Set(symbols).size !== symbols.length || !symbols.every(qualifiedSymbol)) {
    return refuse('Choose 1 to 12 distinct qualified listings from the acquired price history.');
  }
  const live = prepareLiveReturnPrices(dataset, fields);
  if (!live) {
    const issue = localSnapshotIssue(dataset, fields);
    if (issue) return refuse(issue);
  }
  const prepared = selectPrices(live ?? preparePrices(dataset, fields), symbols);
  if (!prepared.ok) return prepared;
  const { scope, notes } = prepared;
  if (window.mode === 'common' && (!isoDate(window.start) || !isoDate(window.end) || window.start > window.end
    || window.start < scope.start || window.end > scope.end)) {
    return refuse('Choose an inclusive common window within the acquired daily date bounds.');
  }

  const overlapStart = prepared.series.map(series => series.points[0].date).sort().at(-1);
  const overlapEnd = prepared.series.map(series => series.points.at(-1)!.date).sort()[0];
  const commonWindow = overlapStart && overlapStart <= overlapEnd ? { start: overlapStart, end: overlapEnd } : null;
  if (window.mode === 'common' && (!commonWindow || window.end < commonWindow.start || window.start > commonWindow.end)) {
    return refuse('The selected histories have no overlap in this common window. Choose a wider window or different listings.');
  }

  const series: ReturnSummarySeries[] = [];
  for (const source of prepared.series) {
    const points = window.mode === 'common'
      ? source.points.filter(point => point.date >= window.start && point.date <= window.end)
      : source.points;
    const result = dailyReturnSamples({ symbol: source.symbol, points });
    const { samples } = result;
    if (samples.length < 5) {
      const kind = live ? 'observed quote-to-quote' : 'daily';
      return refuse(`At least 5 finite ${kind} returns are required for ${source.symbol}. Found ${samples.length}. Choose a wider window or a different listing.${live ? ` ${observedReturnScope}` : ''}`);
    }
    series.push({
      ...result, symbol: source.symbol, start: samples[0].date, end: samples[samples.length - 1].date,
      excludedOpportunities: points.length - 1 - samples.length,
    });
  }
  return { ok: true, value: { scope, adjustmentBasis: 'adjusted-price', commonWindow, series }, notes };
}
