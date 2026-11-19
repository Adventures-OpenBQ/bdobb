// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout } from '../../chartShapes';
import { color, escape } from '../figureHelpers';
import type { WidgetDataset } from '../types';
import type { PriceSeries } from './input';
import { calendarDate, observationSymbol, symbolList } from './priceEvidence';
import { prepareSelectedPrices } from './priceSamples';
import { decodeRecipeOptions } from './settings';
import type { PriceBindings, RecipeContext, RecipeOptions, RecipeResult } from './types';
import { smallMultiplesGrid } from './viewport';
export { smallMultiplesGrid } from './viewport';

const BASE = 100;
// Plotly clamps linear axis ranges to FP_SAFE and may drop an extreme at the limit.
const MAX_DISPLAYABLE_INDEX = Number.MAX_VALUE * 1e-4;

function commonEndDate(dataset: WidgetDataset, fields: PriceBindings, symbols: string[]): string {
  const latest = new Map(symbols.map(symbol => [symbol, '']));
  const single = fields.symbol ? undefined : symbolList(dataset.provenance)?.[0];
  // Preparation has validated these rows. The cutoff uses delivered dates, including
  // rows with null prices. Separately evidenced omissions break the corresponding paths.
  for (const { values } of dataset.rows) {
    const symbol = fields.symbol ? observationSymbol(values[fields.symbol]) : single;
    if (symbol === undefined || !latest.has(symbol)) continue;
    const date = calendarDate(values[fields.date])!;
    if (date > latest.get(symbol)!) latest.set(symbol, date);
  }
  return [...latest.values()].sort()[0];
}

function commonBaselineDate(series: PriceSeries[], end: string): string | undefined {
  const counts = new Map<string, number>();
  for (const { points } of series) {
    for (const { date, price } of points) {
      if (date > end) break;
      if (price !== null) counts.set(date, (counts.get(date) ?? 0) + 1);
    }
  }
  return series[0].points.find(({ date }) => counts.get(date) === series.length)?.date;
}

export function buildSmallMultiples(
  dataset: WidgetDataset,
  options: Extract<RecipeOptions, { kind: 'small-multiples' }>,
  context: RecipeContext,
): RecipeResult {
  const decoded = decodeRecipeOptions(options, 'small-multiples');
  if (!decoded.ok) return { ok: false, refused: true, message: decoded.message };

  const { fields, symbols } = options;
  const prepared = prepareSelectedPrices(dataset, fields, symbols);
  if (!prepared.ok) return prepared;

  const { series, scope } = prepared;
  const notes = [...prepared.notes];
  const refuse = (message: string) => ({ ok: false, refused: true, message: [message, ...notes].join(' ') }) as const;
  const end = commonEndDate(dataset, fields, symbols);
  const baseline = commonBaselineDate(series, end);
  if (baseline === undefined) return refuse(`No shared baseline date has a positive adjusted price for every selected symbol through ${end}.`);

  notes.push(`Shared baseline ${BASE} on ${baseline}. All panels end on ${end}.`);
  notes.push(`Acquisition window ${scope.start} to ${scope.end}.${baseline > scope.start || end < scope.end
    ? ' Dates outside the shared interval are excluded.' : ''}`);
  notes.push('Unreported provider gaps cannot always be distinguished from market holidays.');

  const data = [];
  let low = BASE, high = BASE;
  for (const [index, { symbol, points }] of series.entries()) {
    const interval = points.filter(({ date }) => date >= baseline && date <= end);
    const basePrice = interval[0].price!;
    if (!interval.some(({ price }, i) => i > 0 && price !== null))
      return refuse(`A later positive price is required for ${symbol} inside the shared interval.`);

    const y: (number | null)[] = [];
    for (const { date, price } of interval) {
      if (price === null) {
        y.push(null);
        continue;
      }
      const numerator = price * BASE;
      const value = price === basePrice ? BASE
        : Number.isFinite(numerator) ? numerator / basePrice : price / basePrice * BASE;
      if (!Number.isFinite(value)) return refuse(`A nonfinite index was calculated for ${symbol} on ${date}.`);
      if (value === 0 || value >= MAX_DISPLAYABLE_INDEX)
        return refuse(`The index for ${symbol} on ${date} is outside the displayable linear range.`);
      low = Math.min(low, value);
      high = Math.max(high, value);
      y.push(value);
    }

    const suffix = index === 0 ? '' : String(index + 1);
    const id = Array.from(symbol, char => char.codePointAt(0)!.toString(16)).join('-');
    data.push({
      type: 'scatter', mode: 'lines+markers', uid: `small-multiples-${id}`, name: escape(symbol),
      xaxis: `x${suffix}`, yaxis: `y${suffix}`, x: interval.map(({ date }) => date), y, connectgaps: false,
      line: { color: color(symbol) },
      hovertemplate: '%{x|%Y-%m-%d}<br>Index %{y}<extra>%{fullData.name}</extra>',
    });
  }

  const revision = JSON.stringify([
    dataset.provenance.sourceWidgetId, options.kind, options.version, fields.date, fields.price,
    fields.symbol ?? null, symbols, scope.start, scope.end,
  ]);
  const { columns, rows, height } = smallMultiplesGrid(context.viewportWidth ?? 900, series.length);
  const range = low === high ? [BASE - 1, BASE + 1] : [low, high];
  const layout: Record<string, unknown> = {
    ...themedLayout(context.theme), uirevision: revision, height, showlegend: false,
    title: { text: 'Adjusted prices indexed to 100' }, margin: { l: 60, r: 12, t: 40, b: 20 },
    grid: { rows, columns, pattern: 'independent' },
    annotations: data.map(trace => ({
      text: trace.name, xref: `${trace.xaxis} domain`, yref: `${trace.yaxis} domain`,
      x: 0.5, y: 1, yanchor: 'bottom', showarrow: false,
    })),
  };
  data.forEach((trace, index) => {
    const suffix = index === 0 ? '' : String(index + 1);
    layout[`xaxis${suffix}`] = {
      type: 'date', range: [baseline, end], anchor: trace.yaxis, automargin: true,
      ...(index > 0 ? { matches: 'x' } : {}),
    };
    layout[`yaxis${suffix}`] = {
      type: 'linear', range: [...range], anchor: trace.xaxis, automargin: true,
      ...(index > 0 ? { matches: 'y' } : {}),
    };
  });
  return { ok: true, figure: { data, layout }, revision, notes };
}
