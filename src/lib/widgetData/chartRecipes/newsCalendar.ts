// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout } from '../../chartShapes';
import { escape } from '../figureHelpers';
import type { WidgetDataset } from '../types';
import { doubleUnitExponent, roundedRatio, scaledInteger } from './binary64';
import type { ChartBuildResult } from './chartSourceContracts';
import { inspectNewsPresentation, resolveNewsWindow, type CalendarWindow, type NewsArticle } from './newsCalendarInput';
import { isNewsPolarity } from './newsEvidence';
import { decodeRecipeOptions } from './settings';
import type { NewsCalendarOptions, RecipeContext, RecipeOptions, RecipeRefusal, RecipeResult } from './types';

export type NewsCalendarDay = {
  date: string; mean: number | null; delivered: number; scored: number; articles: NewsArticle[];
};
export type NewsCalendarData = (CalendarWindow | { start: null; end: null }) & { days: Record<string, NewsCalendarDay> };

const refuse = (message: string): RecipeRefusal => ({ ok: false, refused: true, message });
const geometryIssue = 'Narrow the calendar window or widen the chart to keep every displayed day visible.';
const dayMs = 86_400_000;
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const margin = { l: 40, r: 64, t: 40, b: 32, autoexpand: false };
const supportedWidth = 10_000;
const defaultWidth = 900;
// Plotly rounds cell edges to raster pixels and subtracts the one-pixel gap.
const hasRoomForWeeks = (weeks: number, width: number) => width - margin.l - margin.r >= 2 * weeks;
function dayGeometry({ start, end }: CalendarWindow) {
  const first = Date.parse(start);
  const mondayOffset = (new Date(first).getUTCDay() + 6) % 7;
  const length = (Date.parse(end) - first) / dayMs + 1;
  return { first, mondayOffset, length, weeks: Math.ceil((mondayOffset + length) / 7) };
}

function summarize(date: string, articles: NewsArticle[], scoreBits: DataView): NewsCalendarDay | undefined {
  let total = 0n;
  let scored = 0;
  for (const { polarity } of articles) {
    if (polarity === null) continue;
    scored++;
    total += scaledInteger(polarity, scoreBits);
  }
  // Retain the exact binary64 sum through division to round the mean only once.
  const mean = scored > 0 ? roundedRatio(total, BigInt(scored), doubleUnitExponent) : null;
  if (mean !== null && (!isNewsPolarity(mean) || (mean === 0 && total !== 0n))) return;
  return { date, mean, scored, delivered: articles.length, articles };
}

export function aggregateNewsDays(dataset: WidgetDataset, options: NewsCalendarOptions): ChartBuildResult<NewsCalendarData> {
  const decoded = decodeRecipeOptions(options, 'news-sentiment-calendar');
  if (!decoded.ok) return refuse(decoded.message);
  const presented = inspectNewsPresentation(dataset, options);
  if (!presented.ok) return presented;
  const { source, projection, articles } = presented.value;
  const resolved = resolveNewsWindow(source, options.window);
  if (!resolved.ok) return resolved;
  const window = resolved.value;

  const days: Record<string, NewsCalendarDay> = {};
  let delivered = 0;
  let scored = 0;
  if (window) {
    const { first, length, weeks } = dayGeometry(window);
    if (!hasRoomForWeeks(weeks, supportedWidth)) return refuse(geometryIssue);
    const grouped = new Map<string, NewsArticle[]>();
    for (const { day, timestamp, polarity } of articles.values()) {
      if (day < window.start || day > window.end) continue;
      if (!grouped.has(day)) grouped.set(day, []);
      grouped.get(day)!.push({ timestamp, polarity });
    }
    const scoreBits = new DataView(new ArrayBuffer(8));
    for (let i = 0; i < length; i++) {
      const date = new Date(first + i * dayMs).toISOString().slice(0, 10);
      const day = summarize(date, grouped.get(date) ?? [], scoreBits);
      if (!day) return refuse(`The mean for ${date} cannot be represented at chart polarity precision.`);
      days[date] = day;
      delivered += day.delivered;
      scored += day.scored;
    }
  }

  const { scope } = source;
  const notes = [
    `${delivered} delivered articles · ${scored} scored in this calendar view.`,
    `${source.instrument} · Delivered news sentiment · Retrieved ${source.retrieved_at}.`,
  ];
  if (scope.start || scope.end)
    notes.push(`Acquired query dates ${scope.start ?? 'open start'} to ${scope.end ?? 'open end'} UTC.`);
  if (scope.limit !== null)
    notes.push(`Acquired page limit ${scope.limit}, offset ${scope.offset} · ${source.delivered_count} articles delivered by this page.`);
  else notes.push(`Acquired ${scope.kind} scope · ${source.delivered_count} articles delivered.`);
  if (projection.filtered) notes.push('The source view has active filters or selection.');
  if (projection.omitted.length) notes.push(`${projection.omitted.length} acquired articles excluded from the presented source view.`);
  if (source.raw_count !== source.normalized_count)
    notes.push(`Source normalization kept ${source.normalized_count} of ${source.raw_count} raw articles.`);
  if (source.diagnostics.includes('exact_duplicate')) notes.push('Identical acquired article duplicates were collapsed.');
  if (source.diagnostics.includes('missing_title')) notes.push('The acquisition included articles without titles.');
  if (source.diagnostics.includes('unscored')) notes.push('The acquisition included articles without valid polarity.');
  if (window) notes.push(`Calendar dates ${window.start} to ${window.end} UTC, inclusive.`);
  if (!source.delivered_count) notes.push('The acquired result supplied no articles.');
  return { ok: true, value: { ...(window ?? { start: null, end: null }), days }, notes };
}

function hoverText({ date, mean, delivered, scored, articles }: NewsCalendarDay): string {
  const sentiment = mean !== null ? `Mean polarity: ${escape(mean)}`
    : delivered ? 'No scored articles delivered' : 'No delivered articles in this view';
  const preview = articles.slice(0, 3).map(({ timestamp, polarity }) =>
    `${escape(timestamp)} · ${polarity === null ? 'Unscored' : escape(polarity)}`);
  if (articles.length > preview.length) preview.push(`+${articles.length - preview.length} more in day details`);
  return [`<b>${escape(date)} UTC</b>`, sentiment, `Delivered: ${delivered} · Scored: ${scored}`, ...preview].join('<br>');
}

type CalendarRaster = { z: (number | null)[][]; text: (string | null)[][] };
function raster(weeks: number): CalendarRaster {
  return {
    z: weekdays.map(() => Array.from({ length: weeks }, () => null)),
    text: weekdays.map(() => Array.from({ length: weeks }, () => null)),
  };
}

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function buildNewsCalendar(dataset: WidgetDataset, options: RecipeOptions, context: RecipeContext): RecipeResult {
  if (options.kind !== 'news-sentiment-calendar') return refuse('Choose the news sentiment calendar recipe.');
  const result = aggregateNewsDays(dataset, options);
  if (!result.ok) return result;
  const { value, notes } = result;
  const revision = JSON.stringify([dataset.provenance.sourceWidgetId, options.kind, options.version, options.instrument,
    options.fields.timestamp, options.fields.articleId, options.fields.instrument, options.fields.polarity,
    options.window.mode, ...(options.window.mode === 'pinned' ? [options.window.start, options.window.end] : [])]);
  const frame = {
    ...themedLayout(context.theme), title: { text: 'Delivered news sentiment', font: { size: 15 } }, uirevision: revision,
    margin, showlegend: false, hovermode: 'closest',
    hoverlabel: { bgcolor: context.theme === 'dark' ? '#202937' : '#ffffff',
      font: { color: context.theme === 'dark' ? '#f1f5f9' : '#152034' } },
  };
  const daySummaries = Object.values(value.days);
  if (value.start === null) return { ok: true, revision, notes, daySummaries, figure: { data: [], layout: frame } };

  const { mondayOffset, weeks } = dayGeometry(value);
  const width = context.viewportWidth ?? defaultWidth;
  if (!hasRoomForWeeks(weeks, width)) return refuse(geometryIssue);
  const weekWidth = (width - margin.l - margin.r) / weeks;
  const scored = raster(weeks);
  const unscored = raster(weeks);
  const missing = raster(weeks);
  const monthTicks: { week: number; label: string }[] = [];
  let lastMonth = '';
  for (let dayIndex = 0; dayIndex < daySummaries.length; dayIndex++) {
    const day = daySummaries[dayIndex];
    const position = mondayOffset + dayIndex;
    const week = Math.floor(position / 7);
    const weekday = position % 7;
    const cells = day.mean !== null ? scored : day.delivered ? unscored : missing;
    cells.z[weekday][week] = day.mean ?? 1;
    cells.text[weekday][week] = hoverText(day);
    const month = day.date.slice(0, 7);
    const priorTick = monthTicks.at(-1);
    if (month !== lastMonth && (!priorTick || (week - priorTick.week) * weekWidth >= 60))
      monthTicks.push({ week, label: `${monthNames[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}` });
    lastMonth = month;
  }

  const hover = {
    type: 'heatmap', x0: 0, dx: 1, y0: 0, dy: 1, zsmooth: false, xgap: 1, ygap: 1,
    hoverongaps: false, hovertemplate: '%{text}<extra></extra>', connectgaps: false, zauto: false,
  };
  const mask = (cells: CalendarRaster, color: string) => ({
    ...hover, ...cells, zmin: 0, zmax: 1, colorscale: [[0, color], [1, color]], showscale: false,
  });
  const dark = context.theme === 'dark';
  const data = [
    mask(missing, dark ? '#344055' : '#d8dee8'),
    mask(unscored, dark ? '#78869c' : '#758297'),
    {
      ...hover, ...scored, zmin: -1, zmax: 1, colorscale: [[0, '#a23955'], [0.5, '#fff3cf'], [1, '#167862']],
      showscale: true, colorbar: { title: { text: 'Polarity', side: 'top' }, tickmode: 'array', tickvals: [-1, 0, 1],
        thickness: 10, x: 1.005, xpad: 3, ypad: 4 },
    },
  ];
  const axis = { type: 'linear', tickmode: 'array', showgrid: false, zeroline: false };
  return {
    ok: true, revision, notes, daySummaries,
    figure: { data, layout: {
      ...frame,
      xaxis: { ...axis, range: [-.5, weeks - .5], minallowed: -.5, maxallowed: weeks - .5, tickangle: 0, tickvals: monthTicks.map(({ week }) => week),
        ticktext: monthTicks.map(({ label }) => escape(label)) },
      yaxis: { ...axis, range: [6.5, -.5], minallowed: -.5, maxallowed: 6.5, tickvals: weekdays.map((_, i) => i), ticktext: weekdays },
    } },
  };
}
