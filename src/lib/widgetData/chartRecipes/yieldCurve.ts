// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout } from '../../chartShapes';
import { formatCell } from '../../format';
import { color, list } from '../figureHelpers';
import type { DatasetProvenance, WidgetDataset } from '../types';
import { recipeEligibility } from './input';
import { acquiredWindow, calendarDate } from './priceEvidence';
import type { RecipeContext, RecipeOptions, RecipeResult } from './types';

const tenorMonths = new Map([
  ['month_1', 1], ['month_2', 2], ['month_3', 3], ['month_6', 6],
  ['year_1', 12], ['year_2', 24], ['year_3', 36], ['year_5', 60],
  ['year_7', 84], ['year_10', 120], ['year_20', 240], ['year_30', 360],
]);

function requestedDates(provenance: DatasetProvenance): string[] {
  const parameter = provenance.parameters?.date;
  const receipt = provenance.receipt?.date;
  const parse = (value: unknown) => typeof value === 'string'
    ? [...new Set(value.split(',').map(date => date.trim()))].sort() : [];
  const dates = parse(parameter ?? receipt);
  if (parameter != null && receipt != null && JSON.stringify(dates) !== JSON.stringify(parse(receipt))) return [];
  return dates.every(date => calendarDate(date) === date) ? dates : [];
}

export function buildYieldCurve(
  dataset: WidgetDataset,
  options: Extract<RecipeOptions, { kind: 'yield-curve' }>,
  context: RecipeContext,
): RecipeResult {
  const { fields } = options;
  const issue = recipeEligibility(dataset, options);
  if (issue) return { ok: false, refused: true, message: issue };
  if (new Set(Object.values(fields)).size !== 3)
    return { ok: false, refused: true, message: 'Use distinct observation date, maturity and normalized-rate fields.' };

  const curves = new Map<string, Map<number, number | null>>();
  const conflicts = new Set<string>();
  let unknownTenors = 0, invalidDates = 0, duplicates = 0;
  for (const { values, cellErrors } of dataset.rows) {
    const date = cellErrors?.[fields.date] ? null : calendarDate(values[fields.date]);
    if (!date) { invalidDates++; continue; }
    let curve = curves.get(date);
    if (!curve) { curve = new Map(); curves.set(date, curve); }
    const maturity = values[fields.maturity];
    const months = !cellErrors?.[fields.maturity] && typeof maturity === 'string' ? tenorMonths.get(maturity) : undefined;
    if (months === undefined) { unknownTenors++; continue; }
    const raw = values[fields.rate];
    const rate = !cellErrors?.[fields.rate] && typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    if (!curve.has(months)) curve.set(months, rate);
    else if (curve.get(months) !== rate) conflicts.add(date);
    else duplicates++;
  }

  const observed = [...curves.keys()].sort();
  const withoutRates = observed.filter(date => !conflicts.has(date) && ![...curves.get(date)!.values()].some(rate => rate !== null));
  const omitted = new Set([...conflicts, ...withoutRates]);
  const dates = observed.filter(date => !omitted.has(date));
  const notes: string[] = [];
  if (unknownTenors) notes.push(`Omitted ${unknownTenors} unknown maturity observation(s).`);
  if (invalidDates) notes.push(`Omitted ${invalidDates} row(s) with no valid observation date.`);
  if (duplicates) notes.push(`Collapsed ${duplicates} identical duplicate yield observation(s).`);
  if (conflicts.size) notes.push(`Conflicting duplicate yields excluded ${conflicts.size} curve(s): ${list([...conflicts].sort())}.`);
  if (withoutRates.length) notes.push(`Omitted ${withoutRates.length} curve(s) with no valid rates: ${list(withoutRates)}.`);
  if (!dates.length) return { ok: false, refused: true, message: ['No valid yield curves remain.', ...notes].join(' ') };

  const grid = [...new Set(dates.flatMap(date => [...curves.get(date)!.keys()]))].sort((a, b) => a - b);
  const labels = grid.map(months => months < 12 ? `${months}M` : `${months / 12}Y`);
  // Keep both endpoints. Closely spaced short tenors still have their own marker and hover label.
  const span = grid[grid.length - 1] - grid[0];
  const minSpacing = span / 7;
  const tickvals = [grid[0]];
  for (const months of grid.slice(1, -1)) {
    if (months - tickvals[tickvals.length - 1] >= minSpacing && grid[grid.length - 1] - months >= minSpacing)
      tickvals.push(months);
  }
  if (grid.length > 1) tickvals.push(grid[grid.length - 1]);
  const precision = dataset.columns.find(column => column.id === fields.rate)?.format?.decimalPlaces ?? context.maxDecimals;
  let gaps = 0;
  const data = dates.map(date => {
    const curve = curves.get(date)!;
    const rates = grid.map(months => curve.get(months) ?? null);
    gaps += rates.filter(rate => rate === null).length;
    return {
      uid: `yield-curve-${date}`, type: 'scatter', mode: 'lines+markers', name: date,
      x: grid, y: rates, connectgaps: false,
      line: { color: color(date) },
      text: rates.map((rate, index) => `${labels[index]}: ${formatCell(rate, fields.rate, precision, undefined, { formatterFn: 'normalizedPercent' })}`),
      hovertemplate: '%{text}<extra>%{fullData.name}</extra>',
    };
  });
  if (gaps) notes.push(`Preserved ${gaps} missing tenor slot(s) as gaps.`);
  notes.push(`Plotted observation dates: ${list(dates)}.`);

  const requests = requestedDates(dataset.provenance);
  // A request can resolve to a date for which the provider emits no rows.
  if (requests.length) notes.push(`Requested as-of dates: ${list(requests)}.`);

  const window = acquiredWindow(dataset.provenance);
  const revision = JSON.stringify([
    dataset.provenance.sourceWidgetId, options.kind, options.version, fields.date, fields.maturity, fields.rate,
    requests, window?.start, window?.end,
  ]);
  return {
    ok: true, revision, notes,
    figure: {
      data,
      layout: {
        ...themedLayout(context.theme), uirevision: revision, showlegend: true,
        title: { text: 'Yield curve by observation date' },
        margin: { l: 68, r: 12, t: 44, b: 58 },
        xaxis: { title: { text: 'Maturity' }, type: 'linear', tickmode: 'array', tickvals, ticktext: tickvals.map(months => labels[grid.indexOf(months)]), automargin: true },
        yaxis: { tickformat: `.${precision}%`, title: { text: 'Yield' } },
      },
    },
  };
}
