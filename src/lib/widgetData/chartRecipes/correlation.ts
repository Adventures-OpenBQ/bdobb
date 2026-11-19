// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout } from '../../chartShapes';
import { formatCell } from '../../format';
import { escape, list } from '../chartFigure';
import type { WidgetDataset } from '../types';
import { preparePrices, type PriceSeries } from './input';
import { calendarDate, observationSymbol, symbolList } from './priceEvidence';
import { decodeRecipeOptions } from './settings';
import type { PriceBindings, RecipeContext, RecipeOptions, RecipeResult } from './types';

type Returns = Map<string, number>;
type MatchedReturn = [number, number];
type Cell = { value: number | null; count: number; first: string; last: string; detail: string };

function commonEndDate(dataset: WidgetDataset, fields: PriceBindings, selected: string[]) {
  const latest = new Map(selected.map(symbol => [symbol, '']));
  const single = fields.symbol ? undefined : symbolList(dataset.provenance)?.[0];
  // Preparation has verified these rows and inserted separate null points for documented omissions.
  // An omitted date can break a return but cannot extend the delivered-date cutoff.
  for (const { values } of dataset.rows) {
    const symbol = fields.symbol ? observationSymbol(values[fields.symbol]) : single;
    if (symbol === undefined || !latest.has(symbol)) continue;
    const date = calendarDate(values[fields.date])!;
    if (date > latest.get(symbol)!) latest.set(symbol, date);
  }
  return [...latest.values()].sort()[0];
}

function dailyReturns({ points }: PriceSeries, end: string): Returns {
  const returns: Returns = new Map();
  let previous: number | null = null;
  for (const { date, price } of points) {
    if (date > end) break;
    if (price !== null && previous !== null) {
      const value = price / previous - 1;
      if (Number.isFinite(value)) returns.set(date, value);
    }
    previous = price;
  }
  return returns;
}

function pearson(pairs: MatchedReturn[]): number | null {
  const [originX, originY] = pairs[0];
  let scaleX = 0;
  let scaleY = 0;
  for (const [x, y] of pairs) {
    scaleX = Math.max(scaleX, Math.abs(x - originX));
    scaleY = Math.max(scaleY, Math.abs(y - originY));
  }
  if (scaleX === 0 || scaleY === 0) return null;

  // Shift first to preserve small differences, then scale before taking centered products.
  let sumX = 0;
  let sumY = 0;
  for (const [x, y] of pairs) {
    sumX += (x - originX) / scaleX;
    sumY += (y - originY) / scaleY;
  }
  const meanX = sumX / pairs.length;
  const meanY = sumY / pairs.length;
  let squareX = 0;
  let squareY = 0;
  let cross = 0;
  for (const [x, y] of pairs) {
    const dx = (x - originX) / scaleX - meanX;
    const dy = (y - originY) / scaleY - meanY;
    squareX += dx * dx;
    squareY += dy * dy;
    cross += dx * dy;
  }
  const r = cross / Math.sqrt(squareX * squareY);
  return Number.isFinite(r) ? Math.max(-1, Math.min(1, r)) : null;
}

function pairCell(
  x: Returns, y: Returns, dates: string[], minOverlap: number, maxDecimals: number,
): Cell {
  const pairs: MatchedReturn[] = [];
  let first = '';
  let last = '';
  for (const date of dates) {
    const left = x.get(date), right = y.get(date);
    if (left === undefined || right === undefined) continue;
    first ||= date;
    last = date;
    pairs.push([left, right]);
  }
  const count = pairs.length;
  const r = count >= minOverlap ? pearson(pairs) : null;
  const value = r !== null && x === y ? 1 : r;
  const detail = value !== null
    ? `r = ${formatCell(value, 'correlation', maxDecimals, undefined, { abbreviate: false })}`
    : count < minOverlap
      ? `Unavailable. At least ${minOverlap} matched returns are required.`
      : 'Unavailable. A paired series is constant or the correlation is nonfinite.';
  return { value, count, first: first || '—', last: last || '—', detail };
}

export function buildCorrelation(
  dataset: WidgetDataset,
  options: Extract<RecipeOptions, { kind: 'correlation' }>,
  context: RecipeContext,
): RecipeResult {
  const decoded = decodeRecipeOptions(options, 'correlation');
  if (!decoded.ok) return { ok: false, refused: true, message: decoded.message };
  const { fields, lookback, minOverlap } = options;
  const prepared = preparePrices(dataset, fields);
  if (!prepared.ok) return prepared;

  const { scope } = prepared;
  const symbols = [...options.symbols].sort();
  const bySymbol = new Map(prepared.series.map(series => [series.symbol, series]));
  const missing = symbols.filter(symbol => !bySymbol.has(symbol));
  if (missing.length) return { ok: false, refused: true, message: [
    `Selected symbols ${list(missing)} need usable delivered daily series to establish the shared end date.`,
    ...prepared.notes,
  ].join(' ') };

  const end = commonEndDate(dataset, fields, symbols);
  const returns = symbols.map(symbol => dailyReturns(bySymbol.get(symbol)!, end));
  const union = new Set<string>();
  for (const series of returns) for (const date of series.keys()) union.add(date);
  const dates = [...union].sort().slice(-lookback);

  const cells = symbols.map(() => new Array<Cell>(symbols.length));
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i; j < symbols.length; j++) {
      const cell = pairCell(returns[i], returns[j], dates, minOverlap, context.maxDecimals);
      cells[i][j] = cells[j][i] = cell;
    }
  }

  const notes = [
    ...prepared.notes,
    `Using ${dates.length} of ${lookback} return-date positions through the common cutoff ${end}.`,
    'Unreported provider gaps cannot always be distinguished from market holidays.',
    'Pairwise correlations may not form a positive-semidefinite covariance matrix.',
  ];
  const revision = JSON.stringify([
    dataset.provenance.sourceWidgetId, options.kind, options.version, fields.date, fields.price,
    fields.symbol ?? null, symbols, lookback, minOverlap, scope.start, scope.end,
  ]);
  const labels = symbols.map(escape);
  // Use safe category keys for Plotly's object-backed category map and CSS class names.
  const positions = symbols.map(symbol => `symbol-${Array.from(symbol, char => char.codePointAt(0)!.toString(16)).join('-')}`);
  const axis = {
    type: 'category', categoryorder: 'array', categoryarray: positions, automargin: true,
    tickmode: 'array', tickvals: positions, ticktext: labels,
  };
  return {
    ok: true, revision, notes,
    figure: {
      data: [{
        type: 'heatmap', uid: `correlation-${positions.join('--')}`,
        x: positions, y: positions, z: cells.map(row => row.map(cell => cell.value)),
        customdata: cells.map((row, i) => row.map((cell, j) =>
          [labels[i], labels[j], cell.count, cell.first, cell.last, cell.detail])),
        connectgaps: false, hoverongaps: true, zmin: -1, zmax: 1,
        colorscale: [[0, '#b54849'], [0.5, context.theme === 'dark' ? '#656970' : '#e1e5eb'], [1, '#247a62']],
        colorbar: { tickvals: [-1, -0.5, 0, 0.5, 1] },
        hovertemplate: '%{customdata[0]} / %{customdata[1]}<br>%{customdata[5]}<br>N = %{customdata[2]}<br>Paired return dates %{customdata[3]} to %{customdata[4]}<extra></extra>',
      }],
      layout: {
        ...themedLayout(context.theme), uirevision: revision,
        title: { text: 'Daily return correlation' },
        margin: { l: 60, r: 12, t: 44, b: 48 },
        xaxis: axis,
        yaxis: { ...axis, autorange: 'reversed' },
      },
    },
  };
}
