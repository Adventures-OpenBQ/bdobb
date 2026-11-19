// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout } from '../../chartShapes';
import { formatCell } from '../../format';
import { color, escape } from '../chartFigure';
import type { DatasetColumn, DatasetRow, WidgetDataset } from '../types';
import { recipeEligibility } from './input';
import { acquiredWindow, calendarDate, observationSymbol } from './priceEvidence';
import { requiredRecipeFields } from './settings';
import type { RecipeContext, RecipeOptions, RecipeResult } from './types';

type Options = Extract<RecipeOptions, { kind: 'estimate-range' }>;
type Range = [low: number, average: number, high: number];
type Quarter = {
  date: string;
  fiscalKey: string | undefined;
  label: string;
  range: Range | null;
  issue: string | undefined;
  providerNote: string | undefined;
};

const refuse = (message: string): RecipeResult => ({ ok: false, refused: true, message });
const columnNames = (column: DatasetColumn) => [column.id, column.sourceFieldId ?? ''].map(name => name.toLowerCase());
const hasName = (column: DatasetColumn, ...names: string[]) => columnNames(column).some(name => names.includes(name));
const read = (row: DatasetRow, field: string | undefined): unknown =>
  field !== undefined && !Object.hasOwn(row.cellErrors ?? {}, field) && Object.hasOwn(row.values, field)
    ? row.values[field] : undefined;
const text = (value: unknown) => typeof value === 'string' ? value.trim() || undefined : undefined;

/** Request dimension evidence only from columns that the linked table presents. */
export function estimateRangeIdentityFields(columns: readonly DatasetColumn[]): string[] {
  return columns.filter(column => hasName(column, 'symbol', 'ticker', 'currency', 'unit')).map(column => column.id);
}

function namedValues(record: Record<string, unknown> | undefined, ...names: string[]) {
  return Object.entries(record ?? {}).filter(([name]) => names.includes(name.toLowerCase())).map(([, value]) => value);
}

function instrument(dataset: WidgetDataset) {
  const { columns, rows, provenance } = dataset;
  const symbols = new Set<string | undefined>();
  const fields = columns.filter(column => hasName(column, 'symbol', 'ticker'));
  for (const record of [provenance.parameters, provenance.receipt])
    for (const value of namedValues(record, 'symbol', 'ticker')) symbols.add(observationSymbol(value)?.toUpperCase());
  for (const column of fields)
    for (const row of rows) symbols.add(observationSymbol(read(row, column.id))?.toUpperCase());
  if (symbols.size > 1 || symbols.has(undefined)) return { issue: 'Choose one instrument with consistent symbol evidence.' };
  const [symbol] = symbols;
  if (symbol === undefined && (('kind' in dataset && dataset.kind === 'chartData') || provenance.presentation))
    return { issue: 'Present a single symbol or use a source acquired for a single symbol.' };
  return { symbol };
}

function unitValues(dataset: WidgetDataset, bound: DatasetColumn[], dimension: 'currency' | 'unit') {
  const { provenance, rows, columns } = dataset;
  const values = [
    ...namedValues(provenance.receipt, dimension),
    ...namedValues(provenance.parameters, dimension),
    ...bound.flatMap(column => namedValues(column.metadata, dimension)),
    ...columns.filter(column => hasName(column, dimension)).flatMap(column => rows.map(row => read(row, column.id))),
  ];
  return new Set(values.filter(value => value != null).map(value => text(value)?.toLowerCase()));
}

/** Preserve the provider label and compare the identity across supported fiscal label spellings. */
function fiscalKey(label: string | undefined) {
  if (!label) return undefined;
  const provider = /^FQ([1-4])\s+(\d{4})$/i.exec(label);
  if (provider) return `${provider[2]}-Q${provider[1]}`;
  return /^(?:FY\s*)?(\d{4}-Q[1-4])$/i.exec(label)?.[1].toUpperCase();
}

function band(row: DatasetRow, fields: Options['fields']): Pick<Quarter, 'range' | 'issue'> {
  const status = read(row, fields.status);
  if (status === 'withheld') return { range: null, issue: 'Estimate range withheld.' };
  if (status === 'no_estimate') return { range: null, issue: 'No estimate range was supplied.' };
  if (status !== 'ok') return { range: null, issue: 'Estimate range unavailable because the provider status is missing or unrecognized.' };
  const [low, average, high] = [fields.low, fields.average, fields.high].map(field => read(row, field));
  if (typeof low !== 'number' || typeof average !== 'number' || typeof high !== 'number'
    || ![low, average, high].every(Number.isFinite)) {
    return { range: null, issue: 'Estimate range needs finite low, average and high values.' };
  }
  if (low > average || average > high)
    return { range: null, issue: 'Estimate range must satisfy low ≤ average ≤ high.' };
  return { range: [low, average, high], issue: undefined };
}

function periodName(quarter: Quarter) {
  return quarter.fiscalKey ? `${quarter.label} (${quarter.date})` : quarter.date;
}

function noteStatus(quarter: Quarter, notes: string[]) {
  const name = periodName(quarter);
  if (!quarter.fiscalKey) notes.push(`${name} — Fiscal quarter unavailable. The label is its period end.`);
  if (quarter.issue || quarter.providerNote)
    notes.push(`${name} — ${[quarter.issue, quarter.providerNote].filter(Boolean).join(' ')}`);
}

function collectQuarters(rows: DatasetRow[], fields: Options['fields'], notes: string[]) {
  const byDate = new Map<string, Quarter>();
  const datesByFiscal = new Map<string, Set<string>>();
  const conflicts = new Set<string>();
  for (const row of rows) {
    const date = calendarDate(read(row, fields.periodEnd));
    const fiscal = text(read(row, fields.fiscalPeriod));
    if (!date) {
      notes.push(`${fiscal ?? 'Reported-quarter row'} has no valid period end.`);
      continue;
    }
    if (fiscal && /^(?:FY\s*)?\d{4}$|\b(?:annual|yearly|ttm|ltm)\b/i.test(fiscal)) {
      notes.push(`${fiscal} (${date}) is an annual or non-quarter period and was omitted.`);
      continue;
    }
    const key = fiscalKey(fiscal);
    const quarter: Quarter = {
      date, fiscalKey: key, label: key ? fiscal! : date,
      ...band(row, fields), providerNote: text(read(row, fields.note)),
    };
    if (key) {
      const dates = datesByFiscal.get(key) ?? new Set<string>();
      dates.add(date);
      datesByFiscal.set(key, dates);
    }
    const prior = byDate.get(date);
    if (!prior) byDate.set(date, quarter);
    // Duplicate identity is evaluated against the selected metric and its guard.
    else if (prior.fiscalKey === key && prior.issue === quarter.issue && prior.providerNote === quarter.providerNote
      && String(prior.range) === String(quarter.range)) {
      notes.push(`Collapsed an identical duplicate estimate period for ${periodName(prior)}.`);
    } else {
      conflicts.add(date);
      noteStatus(quarter, notes);
    }
  }
  for (const date of [...conflicts].sort())
    notes.push(`Conflicting estimate rows for ${periodName(byDate.get(date)!)} were omitted.`);
  for (const [key, dates] of datesByFiscal) {
    if (dates.size < 2) continue;
    notes.push(`Conflicting period ends for fiscal quarter ${key} (${[...dates].sort().join(', ')}) were omitted.`);
    for (const date of dates) conflicts.add(date);
  }
  const quarters = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const quarter of quarters) noteStatus(quarter, notes);
  return quarters.filter(quarter => !conflicts.has(quarter.date));
}

export function buildEstimateRange(dataset: WidgetDataset, options: Options, context: RecipeContext): RecipeResult {
  const { fields, metric } = options;
  const issue = recipeEligibility(dataset, options);
  if (issue) return refuse(issue);
  if (new Set([fields.periodEnd, fields.status, fields.low, fields.average, fields.high]).size !== 5)
    return refuse('Choose distinct period end, status, low, average and high fields.');

  const columns = new Map(dataset.columns.map(column => [column.id, column]));
  const rawIds = [...requiredRecipeFields(options), ...estimateRangeIdentityFields(dataset.columns)];
  if (rawIds.some(id => columns.get(id)?.analytical))
    return refuse('Use raw guarded estimate fields without analytical transformations.');
  const metricName = metric === 'eps' ? 'EPS' : 'Revenue';
  const valueFields = [fields.low, fields.average, fields.high];
  const bound = valueFields.map(id => columns.get(id)!);
  const canonicalFields = [`${metric}_low`, `${metric}_avg`, `${metric}_high`];
  for (const [index, column] of bound.entries()) {
    if (columnNames(column).some(name => /^(?:eps|revenue)_(?:low|avg|average|high|actual|consensus|analysts|growth.*)$/.test(name)
      && name.replace(/_average$/, '_avg') !== canonicalFields[index]))
      return refuse(`Choose matching low, average and high bindings for ${metricName}.`);
  }

  const identity = instrument(dataset);
  if (identity.issue) return refuse(identity.issue);
  const currency = unitValues(dataset, bound, 'currency');
  const unit = unitValues(dataset, bound, 'unit');
  if ([currency, unit].some(values => values.size > 1 || values.has(undefined)))
    return refuse('Choose estimate ranges with consistent currency and units.');

  const notes: string[] = [];
  const quarters = collectQuarters(dataset.rows, fields, notes);
  const endpoints: { x: (number | null)[]; y: (string | null)[]; customdata: (string[] | null)[] } = {
    x: [], y: [], customdata: [],
  };
  const averages: { x: number[]; y: string[]; customdata: string[][] } = { x: [], y: [], customdata: [] };
  for (const quarter of quarters) {
    const { range } = quarter;
    if (!range) continue;
    const [low, average, high] = range;
    const hover = (index: number, point: string) => [
      escape(quarter.label), quarter.date, point,
      formatCell(range[index], valueFields[index], context.maxDecimals, undefined, bound[index].format),
    ];
    if (endpoints.x.length) {
      endpoints.x.push(null);
      endpoints.y.push(null);
      endpoints.customdata.push(null);
    }
    endpoints.x.push(low, high);
    endpoints.y.push(quarter.date, quarter.date);
    endpoints.customdata.push(hover(0, 'Low'), hover(2, 'High'));
    averages.x.push(average);
    averages.y.push(quarter.date);
    averages.customdata.push(hover(1, 'Average'));
  }
  if (!averages.x.length) return refuse([`No valid ${metricName} estimate ranges remain.`, ...notes].join(' '));

  const dates = quarters.map(quarter => quarter.date);
  const window = acquiredWindow(dataset.provenance);
  const revision = JSON.stringify([
    dataset.provenance.sourceWidgetId, options.kind, options.version, metric,
    fields.periodEnd, fields.fiscalPeriod, fields.status, fields.note, ...valueFields,
    identity.symbol, [...currency][0], [...unit][0], window?.start, window?.end,
  ]);
  const hovertemplate = '%{customdata[0]}<br>Period end %{customdata[1]}<br>%{customdata[2]} %{customdata[3]}<extra></extra>';
  return {
    ok: true, revision, notes,
    figure: {
      data: [
        {
          uid: 'estimate-range-endpoints', type: 'scatter', mode: 'lines+markers', name: 'Low–high',
          ...endpoints, connectgaps: false, line: { color: color('estimate-range-endpoints') }, hovertemplate,
        },
        {
          uid: 'estimate-range-average', type: 'scatter', mode: 'markers', name: 'Average',
          ...averages, marker: { color: color('estimate-range-average'), symbol: 'diamond', size: 9 }, hovertemplate,
        },
      ],
      layout: {
        ...themedLayout(context.theme), uirevision: revision, showlegend: true,
        title: { text: `${metricName} estimate ranges for reported quarters` },
        margin: { l: 100, r: 12, t: 44, b: 58 },
        xaxis: { type: 'linear', title: { text: metricName }, automargin: true },
        yaxis: {
          type: 'category', categoryorder: 'array', categoryarray: dates, autorange: 'reversed',
          autorangeoptions: { include: [dates[0], dates[dates.length - 1]] },
          tickmode: 'array', tickvals: dates, ticktext: quarters.map(quarter => escape(quarter.label)), automargin: true,
        },
      },
    },
  };
}
