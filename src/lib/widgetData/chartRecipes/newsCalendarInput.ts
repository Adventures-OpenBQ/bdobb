// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { WidgetDataset } from '../types';
import { savedBindingIssue } from './bindings';
import { readChartSource, readChartSourceProjection, type ChartBuildResult } from './chartSourceContracts';
import { read } from './estimateEvidence';
import { acquiredColumnOrigin } from './financialEvidence';
import { isNewsPolarity, newsInstrumentMatches, newsUtcDay, parseNewsSource, type NewsSource } from './newsEvidence';
import type { NewsCalendarOptions, RecipeRefusal } from './types';

export type NewsArticle = { timestamp: string; polarity: number | null };
export type CalendarWindow = { start: string; end: string };

const refuse = (message: string): RecipeRefusal => ({ ok: false, refused: true, message });
const projectionIssue = 'Inconsistent article presentation for the acquired news. Repair the source and chart fields.';
const unsafeMessage = {
  invalid_identity: 'The acquired news has an invalid or ambiguous article identity. Repair the source.',
  invalid_timestamp: 'The acquired news has an invalid article timestamp. Repair the source.',
  duplicate_conflict: 'The acquired news has conflicting duplicate article records. Repair the source.',
  unit_conflict: 'The acquired news has a conflicting polarity unit. Repair the source.',
} satisfies Record<keyof NewsSource['unsafe'], string>;

export function acquiredNewsWindow(source: NewsSource): CalendarWindow | null {
  let start: string | undefined;
  let end: string | undefined;
  for (const { utc_day: date } of source.coordinates) {
    if (start === undefined || date < start) start = date;
    if (end === undefined || date > end) end = date;
  }
  if (start && end) return { start, end };
  if (source.scope.start && source.scope.end) return { start: source.scope.start, end: source.scope.end };
  return null;
}

type PresentedArticle = NewsArticle & { day: string; symbols: string };

function presentation(
  dataset: WidgetDataset, options: NewsCalendarOptions, source: NewsSource, omitted: Set<string>,
): ChartBuildResult<Map<string, PresentedArticle>> {
  const { fields } = options;
  if (dataset.provenance.inputMayContainAggregates || dataset.rows.some(row => row.groupPath !== undefined))
    return refuse('Present the raw news articles before grouping, pivoting or aggregation.');

  if (dataset.rows.length || source.delivered_count) {
    const bindingIssue = savedBindingIssue(options, dataset.columns, dataset.rows);
    if (bindingIssue) return refuse(bindingIssue);
    for (const key of Object.keys(source.field_origins) as (keyof typeof fields)[]) {
      const matches = dataset.columns.filter(column => column.id === fields[key]);
      if (matches.length !== 1 || acquiredColumnOrigin(matches[0]) !== source.field_origins[key]) return refuse(projectionIssue);
    }
  }

  const coordinates = new Map(source.coordinates.map(coordinate => [coordinate.article_id, coordinate]));
  const articles = new Map<string, PresentedArticle>();
  for (const row of dataset.rows) {
    const id = read(row, fields.articleId);
    const timestamp = read(row, fields.timestamp);
    const day = newsUtcDay(timestamp);
    const symbols = read(row, fields.instrument);
    const polarity = read(row, fields.polarity);
    if (typeof id !== 'string' || typeof timestamp !== 'string' || typeof symbols !== 'string'
      || !day || !newsInstrumentMatches(symbols, source.instrument)) return refuse(projectionIssue);
    const coordinate = coordinates.get(id);
    if (!coordinate || omitted.has(id) || day !== coordinate.utc_day) return refuse(projectionIssue);

    const previous = articles.get(id);
    if (previous) {
      if (previous.timestamp !== timestamp || previous.symbols !== symbols || previous.polarity !== polarity)
        return refuse(unsafeMessage.duplicate_conflict);
      continue;
    }
    if (!(isNewsPolarity(polarity) || polarity === null) || (polarity !== null) !== coordinate.scored)
      return refuse('Presented article polarity disagrees with the acquired score classification. Repair the source and chart fields.');
    articles.set(id, { timestamp, symbols, polarity, day });
  }
  if (articles.size !== coordinates.size - omitted.size) return refuse(projectionIssue);
  return { ok: true, value: articles, notes: [] };
}

export function inspectNewsSource(dataset: WidgetDataset) {
  if (dataset.freshness && dataset.freshness.availability !== 'available')
    return { ok: false, message: dataset.freshness.error ?? 'CompanyNews is unavailable. Reload the source table.' } as const;

  const source = readChartSource(dataset.provenance, 'news', parseNewsSource);
  const projection = readChartSourceProjection(dataset.provenance, 'news');
  if (!source || !projection) return refuse('Acquire CompanyNews with verified article identity, dates and polarity evidence.');
  const issues = Object.entries(unsafeMessage).filter(([key]) => source.unsafe[key]).map(([, message]) => message);
  if (issues.length) return refuse(issues.join(' '));
  return { ok: true, value: { source, projection } } as const;
}

export function inspectNewsPresentation(dataset: WidgetDataset, options: NewsCalendarOptions) {
  const receipt = inspectNewsSource(dataset);
  if (!receipt.ok) return receipt;
  const { source, projection } = receipt.value;
  if (options.instrument !== source.instrument) return refuse(`Choose the acquired instrument ${source.instrument}.`);
  const observed = presentation(dataset, options, source, new Set(projection.omitted));
  if (!observed.ok) return observed;
  return { ok: true, value: { source, projection, articles: observed.value } } as const;
}

function priorCalendarYear(end: string): string {
  const year = Number(end.slice(0, 4));
  if (year === 1) return '0001-01-01';
  // The year preceding a leap year has no February 29.
  const date = end.endsWith('-02-29') ? '-02-28' : end.slice(4);
  return String(year - 1).padStart(4, '0') + date;
}

export function resolveNewsWindow(source: NewsSource, window: NewsCalendarOptions['window']): ChartBuildResult<CalendarWindow | null> {
  const acquired = acquiredNewsWindow(source);
  if (window.mode === 'latest-12-months') {
    const cap = acquired && priorCalendarYear(acquired.end);
    const value = acquired && cap && acquired.start < cap ? { start: cap, end: acquired.end } : acquired;
    return { ok: true, value, notes: [] };
  }
  const { start, end } = window;
  return acquired && start >= acquired.start && end <= acquired.end
    ? { ok: true, value: { start, end }, notes: [] }
    : refuse('The pinned window is outside the acquired calendar dates. Repair the window or reload its source.');
}
