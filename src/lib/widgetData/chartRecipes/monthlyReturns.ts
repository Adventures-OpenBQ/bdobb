// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout } from '../../chartShapes';
import { formatCell } from '../../format';
import { escape } from '../chartFigure';
import type { WidgetDataset } from '../types';
import { preparePrices, type PriceSeries } from './input';
import { calendarDate } from './priceEvidence';
import type { RecipeContext, RecipeOptions, RecipeResult } from './types';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthIndex(date: string) {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

function coversMonthEnd(date: string) {
  const monthEnd = new Date(0);
  monthEnd.setUTCFullYear(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0);
  return Number(date.slice(8, 10)) === monthEnd.getUTCDate();
}

export function buildMonthlyReturns(
  dataset: WidgetDataset,
  options: Extract<RecipeOptions, { kind: 'monthly-returns' }>,
  context: RecipeContext,
): RecipeResult {
  const { fields, symbol } = options;
  if (calendarDate(context.today) !== context.today)
    return { ok: false, refused: true, message: 'Provide today as a valid YYYY-MM-DD calendar date.' };
  const prepared = preparePrices(dataset, fields);
  if (!prepared.ok) return prepared;

  const { scope, notes: priceNotes } = prepared;
  const points = prepared.series.find(series => series.symbol === symbol)?.points.filter(point => point.date <= context.today) ?? [];
  if (!points.some(point => point.price !== null))
    return { ok: false, refused: true, message: [`No valid daily prices for ${symbol} in the delivered history through today.`, ...priceNotes].join(' ') };

  const endpoints = new Map<number, PriceSeries['points'][number]>();
  // The prepared points are sorted and retain dated gaps, including a missing final close.
  for (const point of points) endpoints.set(monthIndex(point.date), point);

  const firstMonth = monthIndex(scope.start);
  const lastMonth = monthIndex(scope.end);
  const currentMonth = monthIndex(context.today);
  const coveredThrough = coversMonthEnd(scope.end) ? lastMonth : lastMonth - 1;
  const firstYear = Math.floor(firstMonth / 12);
  const lastYear = Math.floor(Math.min(lastMonth, currentMonth) / 12);
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, offset) => String(firstYear + offset).padStart(4, '0'));

  let missing = 0;
  let incomplete = 0;
  let largest = 0;
  let completed = 0;
  const cells = years.map(year => months.map((month, index) => {
    const monthNumber = Number(year) * 12 + index;
    const close = endpoints.get(monthNumber);
    const prior = endpoints.get(monthNumber - 1);
    const cell = (value: number | null, detail: string) => ({
      value,
      hover: [`${month} ${year}`, close?.date ?? '—', prior?.date ?? '—', detail],
    });

    if (monthNumber === currentMonth) {
      incomplete++;
      return cell(null, 'Incomplete because this is the current month.');
    }
    if (monthNumber < firstMonth || monthNumber > lastMonth || monthNumber > currentMonth)
      return cell(null, 'Outside the displayed acquisition window.');
    if (monthNumber > coveredThrough) {
      incomplete++;
      return cell(null, 'Incomplete because the acquisition ends before month-end.');
    }
    if (close?.price == null || prior?.price == null) {
      missing++;
      if (!close) return cell(null, 'Missing month-end observation.');
      if (close.price === null) return cell(null, 'Missing or invalid price at the month-end observation.');
      return cell(null, 'Missing or invalid prior month-end price.');
    }
    const value = close.price / prior.price - 1;
    if (!Number.isFinite(value)) {
      missing++;
      return cell(null, 'Unavailable because the return is outside the numeric range.');
    }
    largest = Math.max(largest, Math.abs(value));
    completed++;
    return cell(value, formatCell(value, fields.price, context.maxDecimals, undefined, { formatterFn: 'normalizedPercent' }));
  }));

  const limit = largest || 0.01;
  const notes = [...priceNotes, `Loaded observation dates for ${symbol} are ${points[0].date} through ${points[points.length - 1].date}.`];
  if (!completed) notes.push('No completed months have a usable return.');
  if (missing) notes.push(`${missing} completed month(s) have missing or unusable returns.`);
  if (incomplete) notes.push(`${incomplete} incomplete month(s) are blank.`);
  if (Math.floor(currentMonth / 12) > lastYear)
    notes.push(`The current month (${context.today.slice(0, 7)}) is incomplete and falls outside the acquisition, which ends ${scope.end}.`);

  const revision = JSON.stringify([
    dataset.provenance.sourceWidgetId, options.kind, options.version,
    fields.date, fields.price, fields.symbol ?? null, symbol, scope.start, scope.end,
  ]);
  // Plotly also uses UIDs in CSS class names.
  const id = Array.from(symbol, char => char.codePointAt(0)!.toString(16)).join('-');
  return {
    ok: true, revision, notes,
    figure: {
      data: [{
        type: 'heatmap', uid: `monthly-returns-${id}`, name: escape(symbol),
        x: months, y: years, z: cells.map(row => row.map(cell => cell.value)),
        customdata: cells.map(row => row.map(cell => cell.hover)),
        connectgaps: false, hoverongaps: true, zmin: -limit, zmax: limit,
        colorscale: [[0, '#b54849'], [0.5, context.theme === 'dark' ? '#656970' : '#e1e5eb'], [1, '#247a62']],
        colorbar: { tickformat: `.${context.maxDecimals}%` },
        hovertemplate: '%{customdata[0]}<br>%{customdata[3]}<br>Final observation %{customdata[1]}<br>Prior month observation %{customdata[2]}<extra>%{fullData.name}</extra>',
      }],
      layout: {
        ...themedLayout(context.theme), uirevision: revision,
        title: { text: 'Completed monthly returns' },
        margin: { l: 60, r: 12, t: 44, b: 48 },
        xaxis: { type: 'category', automargin: true },
        yaxis: { type: 'category', autorange: 'reversed', automargin: true },
      },
    },
  };
}
