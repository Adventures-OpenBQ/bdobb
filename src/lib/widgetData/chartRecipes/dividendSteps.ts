// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout } from '../../chartShapes';
import { color, escape, list } from '../figureHelpers';
import type { DatasetRow, WidgetDataset } from '../types';
import { savedBindingIssue } from './bindings';
import { read, text } from './estimateEvidence';
import { acquiredColumnOrigin, isoDate, readFinancialEvidence } from './financialEvidence';
import { admitDividendWindow, duplicateDividendDate } from './financialAdmission';
import { decodeRecipeOptions } from './settings';
import type { RecipeContext, RecipeOptions, RecipeRefusal, RecipeResult } from './types';

const refuse = (message: string): RecipeRefusal => ({ ok: false, refused: true, message });
const continuityIssue = 'Dividend event continuity is unverified. Use the fully loaded, unfiltered event source.';
const title = 'Last reported split-adjusted<br>dividend per share';
const plotLimit = Number.MAX_VALUE * 1e-4;

type DividendPoint = { date: string; amount: number; distribution: string };

function observedAxis(points: DividendPoint[], currency: string) {
  let min = Infinity, max = 0;
  for (const { amount } of points) {
    min = Math.min(min, amount);
    max = Math.max(max, amount);
  }
  if (max >= plotLimit) return;
  if (min !== max) {
    const slope = 10_000 / (max - min);
    // Plotly maps y to slope * y + offset. A very narrow span at a large offset can lose whole pixels to cancellation.
    if (!Number.isFinite(slope) || Number.EPSILON * slope * max >= 1) return;
  }
  const pad = min * .05;
  const range = min === max && (min - 1 === min || max + 1 === max)
    ? [min - pad, Math.min(plotLimit, max + pad)] : undefined;
  return {
    type: 'linear', title: { text: `${currency} per share` }, automargin: true,
    autorangeoptions: { clipmax: plotLimit },
    ...(range ? { range } : {}),
  };
}

export function buildDividendSteps(dataset: WidgetDataset, options: RecipeOptions, context: RecipeContext): RecipeResult {
  if (options.kind !== 'dividend-steps') return refuse('Choose the dividend steps recipe.');
  const decoded = decodeRecipeOptions(options, 'dividend-steps');
  if (!decoded.ok) return refuse(decoded.message);
  if (dataset.freshness && dataset.freshness.availability !== 'available')
    return { ok: false, message: dataset.freshness.error ?? 'The dividend acquisition is unavailable. Reload the source table.' };

  const evidence = readFinancialEvidence(dataset.provenance);
  if (evidence?.kind !== 'dividends') return refuse('Reload an opted-in dividend source with verified acquisition evidence.');
  const instrument = evidence.qualified_symbol;
  if (options.instrument !== instrument) return refuse(`Choose the acquired instrument ${instrument}.`);
  const admission = admitDividendWindow(evidence);
  if (!admission.ok) return admission;
  const { coverage, start, end, currency } = admission;
  if (dataset.provenance.inputMayContainAggregates || dataset.rows.some(row => row.groupPath !== undefined))
    return refuse('Present the raw dividend events before grouping, pivoting or aggregation.');

  const { fields } = options;
  const revision = JSON.stringify([dataset.provenance.sourceWidgetId, options.kind, options.version, instrument,
    fields.date, fields.amount, fields.currency, fields.frequency, start, end, currency, evidence.amount_basis]);
  const layout = {
    ...themedLayout(context.theme), title: { text: title, font: { size: 15 } }, uirevision: revision, showlegend: false,
    margin: { l: 64, r: 20, t: 64, b: 54 },
    xaxis: { type: 'date', title: { text: 'Ex-dividend date' }, automargin: true },
  };
  const notes = [
    `${instrument} · ${currency ? currency + ' payment currency · ' : ''}Split-adjusted to current-share terms. Retrieved ${evidence.retrieved_at}.`,
    `Verified acquired window ${coverage.start} to ${coverage.end} inclusive.`,
  ];
  if (start !== coverage.start || end !== coverage.end) notes.push(`Requested event window ${start} to ${end} inclusive.`);

  if (evidence.raw_count === 0) {
    if (dataset.rows.length) return refuse(continuityIssue);
    notes.push(`No dividend events were supplied for ${instrument} in the covered interval ${start} to ${end} inclusive.`);
    return { ok: true, revision, notes, figure: { data: [], layout } };
  }

  // Normalization can deliver no columns while the receipt still accounts for dated events.
  if (dataset.rows.length || evidence.delivered_count > 0) {
    const bindingIssue = savedBindingIssue(options, dataset.columns, dataset.rows);
    if (bindingIssue) return refuse(bindingIssue);
  }
  const acquiredDates = new Set(evidence.event_dates);
  const omitted = new Set(evidence.omitted_event_dates);
  const invalid = new Set(evidence.invalid_amount_dates);
  const symbolFields = dataset.columns.filter(column => acquiredColumnOrigin(column) === 'symbol').map(column => column.id);
  const byDate = new Map<string, DatasetRow>();
  for (const row of dataset.rows) {
    const date = read(row, fields.date);
    if (!isoDate(date)) return refuse('A presented record has a missing or invalid ex-dividend date. Repair the source.');
    if (date < start || date > end) return refuse('A presented dividend date falls outside the acquired window. Repair the source.');
    if (!acquiredDates.has(date) || omitted.has(date)) return refuse(continuityIssue);
    if (byDate.has(date)) return refuse(duplicateDividendDate);
    if (symbolFields.some(field => {
      const value = read(row, field);
      return value != null && value !== instrument;
    })) return refuse('A presented record conflicts with the acquired dividend instrument. Repair the source.');
    if (read(row, fields.currency) !== currency)
      return refuse('A presented record conflicts with the acquired payment currency. Repair the source.');
    byDate.set(date, row);
  }
  if (byDate.size > evidence.delivered_count) return refuse(continuityIssue);

  const markers: DividendPoint[] = [];
  const steps: { x: (string | null)[]; y: (number | null)[] } = { x: [], y: [] };
  let prior: DividendPoint | undefined;
  let futureCount = 0, invalidCount = 0, omittedCount = 0;
  for (const date of [...acquiredDates].sort()) {
    const row = byDate.get(date);
    if (!row && !invalid.has(date) && !omitted.has(date)) return refuse(continuityIssue);
    if (date > context.today) {
      futureCount++;
      continue;
    }
    const amount = row && read(row, fields.amount);
    let point: DividendPoint | undefined;
    if (invalid.has(date)) invalidCount++;
    else if (!row) omittedCount++;
    else if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) invalidCount++;
    else {
      point = { date, amount, distribution: text(read(row, fields.frequency)) ?? 'Unknown' };
      markers.push(point);
    }

    if (prior) {
      // A gap has a known ex-date but no y-value. End the preceding run at that date with its last valid amount.
      if (steps.x.at(-1) !== prior.date) {
        if (steps.x.length) { steps.x.push(null); steps.y.push(null); }
        steps.x.push(prior.date);
        steps.y.push(prior.amount);
      }
      steps.x.push(date);
      steps.y.push(point?.amount ?? prior.amount);
    }
    prior = point;
  }

  const counts = `${evidence.raw_count} acquired events, ${evidence.delivered_count} delivered, ${markers.length} usable historical, ${invalidCount} invalid amount, ${omittedCount} filtered or omitted, ${futureCount} scheduled/future.`;
  if (!markers.length) return refuse([`No usable historical dividends were presented for ${instrument}.`, counts, ...notes].join(' '));
  const yaxis = observedAxis(markers, currency);
  if (!yaxis) return refuse('The dividend amounts exceed the range or precision Plotly can display safely.');
  notes.push(`Observed ex-dividend dates ${markers[0].date} to ${markers.at(-1)!.date}.`, counts);
  if (dataset.provenance.metadata?.financialSourceFiltered) notes.push('A presentation filter is active.');
  notes.push(`Distribution types ${list([...new Set(markers.map(point => point.distribution))])}.`);
  if (!steps.x.length && markers.length === 1) notes.push('One usable historical event gives a marker with no step interval.');
  const seriesColor = color('dividend-steps');
  const data = [
    ...(steps.x.length ? [{
      uid: 'dividend-held-level', type: 'scatter', mode: 'lines', ...steps,
      connectgaps: false, line: { shape: 'hv', color: seriesColor }, hoverinfo: 'skip',
    }] : []),
    {
      uid: 'dividend-event', type: 'scatter', mode: 'markers', name: instrument,
      x: markers.map(point => point.date), y: markers.map(point => point.amount),
      customdata: markers.map(point => [point.date, String(point.amount), escape(point.distribution)]),
      marker: { color: seriesColor, size: 8 },
      hovertemplate: `${instrument}<br>Ex-date %{customdata[0]}<br>Split-adjusted %{customdata[1]} ${currency} per share<br>Distribution %{customdata[2]}<extra></extra>`,
    },
  ];
  return { ok: true, revision, notes, figure: { data, layout: { ...layout, yaxis } } };
}
