// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { list } from '../figureHelpers';
import type { WidgetDataset } from '../types';
import { preparePrices, type PriceScope, type PriceSeries } from './input';
import type { PriceBindings } from './types';

/** Apply strict selection after the shared source and continuity checks. */
export function prepareSelectedPrices(
  dataset: WidgetDataset, fields: PriceBindings, symbols: string[],
): { ok: true; series: PriceSeries[]; scope: PriceScope; notes: string[] } | { ok: false; refused: true; message: string } {
  const prepared = preparePrices(dataset, fields);
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
