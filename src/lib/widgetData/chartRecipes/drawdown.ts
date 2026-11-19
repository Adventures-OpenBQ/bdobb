// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout } from '../../chartShapes';
import { formatCell } from '../../format';
import { color, escape, list } from '../chartFigure';
import type { WidgetDataset } from '../types';
import { preparePrices } from './input';
import type { RecipeContext, RecipeOptions, RecipeResult } from './types';

// Plotly's tozeroy fill joins disconnected segments. Close each run at zero
// and separate the polygons so toself keeps the same gaps as the line.
function fillRuns(dates: string[], values: (number | null)[]) {
  const x: (string | null)[] = [];
  const y: (number | null)[] = [];
  values.forEach((value, index) => {
    if (value === null) return;
    const date = dates[index];
    if (values[index - 1] == null) {
      if (x.length) { x.push(null); y.push(null); }
      x.push(date);
      y.push(0);
    }
    x.push(date);
    y.push(value);
    if (values[index + 1] == null) {
      x.push(date);
      y.push(0);
    }
  });
  return { x, y };
}

export function buildDrawdown(
  dataset: WidgetDataset,
  options: Extract<RecipeOptions, { kind: 'drawdown' }>,
  context: RecipeContext,
): RecipeResult {
  const { fields, symbols } = options;
  const prepared = preparePrices(dataset, fields);
  if (!prepared.ok) return prepared;

  const selected = new Set(symbols);
  const series = prepared.series.filter(({ symbol, points }) => selected.has(symbol) && points.some(point => point.price !== null));
  const plotted = new Set(series.map(({ symbol }) => symbol));
  const unavailable = symbols.filter(symbol => !plotted.has(symbol));
  const notes = [...prepared.notes];
  if (unavailable.length)
    notes.push(`Omitted ${unavailable.length} selected symbol(s) (${list(unavailable)}) with no valid daily prices in the delivered history.`);
  if (!series.length) return { ok: false, refused: true, message: notes.join(' ') };

  let first = series[0].points[0].date;
  let last = first;
  const data = series.flatMap(({ symbol, points }) => {
    const dates = points.map(point => point.date);
    if (dates[0] < first) first = dates[0];
    if (dates[dates.length - 1] > last) last = dates[dates.length - 1];
    let peak = 0;
    const drawdowns = points.map(({ price }) => {
      if (price === null) return null;
      peak = Math.max(peak, price);
      return price / peak - 1;
    });
    const hasGaps = drawdowns.includes(null);
    const line = {
      type: 'scatter', mode: 'lines+markers', name: escape(symbol), legendgroup: symbol,
      x: dates, y: drawdowns, fill: hasGaps ? 'none' : 'tozeroy', connectgaps: false,
      line: { color: color(symbol) },
      text: drawdowns.map(value => formatCell(value, fields.price, context.maxDecimals, undefined, { formatterFn: 'normalizedPercent' })),
      hovertemplate: '%{x|%Y-%m-%d}<br>%{text}<extra>%{fullData.name}</extra>',
    };
    if (!hasGaps) return [line];
    const fill = {
      type: 'scatter', mode: 'none', fill: 'toself', connectgaps: false, fillcolor: line.line.color, opacity: 0.5,
      legendgroup: symbol, showlegend: false, hoverinfo: 'skip',
      ...fillRuns(dates, drawdowns),
    };
    return [fill, line];
  });

  notes.push(`Plotted date span: ${first} to ${last}.`);
  const revision = JSON.stringify([
    dataset.provenance.sourceWidgetId, options.kind, options.version,
    fields.date, fields.price, fields.symbol ?? null, [...symbols].sort(), prepared.scope.start, prepared.scope.end,
  ]);
  return {
    ok: true, revision, notes,
    figure: {
      data,
      layout: {
        ...themedLayout(context.theme), uirevision: revision, showlegend: true,
        title: { text: 'Drawdown from peak in loaded history' },
        margin: { l: 68, r: 12, t: 44, b: 58 },
        legend: { groupclick: 'togglegroup' },
        xaxis: { type: 'date' },
        yaxis: { tickformat: `.${context.maxDecimals}%`, rangemode: 'tozero' },
      },
    },
  };
}
