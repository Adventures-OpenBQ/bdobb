// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { calendarArticle, calendarContext, calendarOptions, calendarSnapshot } from '../../../test/fixtures/newsCalendar';
import { newsReceipt } from '../../../test/fixtures/newsEvidence';
import { datasetFromBytes } from '../../localTableData';
import { chartPresentationProvenance, projectChartSources } from './chartSourceContracts';
import { aggregateNewsDays, buildNewsCalendar } from './newsCalendar';
import { runRecipe } from './run';
import type { NewsCalendarOptions } from './types';

const article = calendarArticle;
const load = (snapshot: ReturnType<typeof calendarSnapshot>) => datasetFromBytes(
  'calendar.json', new TextEncoder().encode(JSON.stringify(snapshot)), 'company-news', 1,
);
const pinned = (start: string, end: string): NewsCalendarOptions => ({
  ...calendarOptions, window: { mode: 'pinned', start, end },
});

it('known_result', async () => {
  const dataset = await load(calendarSnapshot([
    [article('negative', '2026-11-19T00:00:00Z', -1), '2026-11-19'],
    [article('positive', '2026-11-19T04:00:00Z', 1), '2026-11-19'],
    [article('unscored', '2026-11-19T23:59:00Z', null), '2026-11-19'],
  ]));
  const built = aggregateNewsDays(dataset, calendarOptions);
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  const { days } = built.value;
  expect(days['2026-11-19']).toMatchObject({ mean: 0, scored: 2, delivered: 3 });
  const rendered = runRecipe(dataset, calendarOptions, calendarContext);
  expect(rendered).toMatchObject({
    ok: true, daySummaries: [{ date: '2026-11-19', mean: 0, scored: 2, delivered: 3 }],
    figure: { data: expect.arrayContaining([expect.objectContaining({ type: 'heatmap', zmin: -1, zmax: 1 })]) },
  });
});

it('zero_missing_and_scope', async () => {
  const dataset = await load(calendarSnapshot([
    [article('neutral', '2026-11-15T04:00:00Z', 0), '2026-11-15'],
    [article('only-null', '2026-11-17T04:00:00Z', null), '2026-11-17'],
  ], { scope: { kind: 'sample', start: '2026-11-01', end: '2026-11-30', limit: 25, offset: 50 } }));
  const built = aggregateNewsDays(dataset, calendarOptions);
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  const { days } = built.value;
  expect(days['2026-11-15']).toMatchObject({ mean: 0, scored: 1, delivered: 1 });
  expect(days['2026-11-16']).toMatchObject({ mean: null, scored: 0, delivered: 0 });
  expect(days['2026-11-17']).toMatchObject({ mean: null, scored: 0, delivered: 1 });
  expect(built.notes.join(' ')).toMatch(/limit 25.*offset 50/i);
  expect(built.notes.join(' ')).toContain('2026-11-20T03:00:00Z');
  expect(built.notes.join(' ')).toMatch(/2026-11-01.*2026-11-30/);
  expect(built.notes.join(' ')).toMatch(/2 delivered articles.*1 scored/i);

  const result = buildNewsCalendar(dataset, calendarOptions, calendarContext);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const traces = result.figure.data as { z: (number | null)[][]; text: (string | null)[][] }[];
  const cells = traces.flatMap(({ z, text }) => z.flatMap((row, y) => row.flatMap((v, x) => v === null ? [] : [[v, text[y][x]]])));
  expect(cells).toHaveLength(3);
  expect(cells).toContainEqual([0, expect.stringMatching(/2026-11-15.*Mean polarity.*0/)]); // scored neutral
  expect(cells).toContainEqual([1, expect.stringMatching(/2026-11-16.*No delivered articles/i)]);
  expect(cells).toContainEqual([1, expect.stringMatching(/2026-11-17.*No scored articles/i)]);
});

it.each(['invalid_identity', 'invalid_timestamp', 'duplicate_conflict', 'unit_conflict'] as const)('hidden_unsafe_fact %s', async fact => {
  const dataset = await load(calendarSnapshot([
    [article('shown', '2026-11-19T00:00:00Z', 1), '2026-11-19'],
    [article('hidden', '2026-11-19T04:00:00Z', -1), '2026-11-19'],
  ], {
    raw_count: fact === 'unit_conflict' ? 2 : 3, diagnostics: [fact],
    unsafe: { invalid_timestamp: false, invalid_identity: false, duplicate_conflict: false, unit_conflict: false, [fact]: true },
  }));
  dataset.rows.pop();
  dataset.provenance = projectChartSources(chartPresentationProvenance(dataset.provenance, true), dataset.columns, dataset.rows);
  const reason = { invalid_identity: /article identit/i, invalid_timestamp: /timestamp/i, duplicate_conflict: /conflicting duplicate/i,
    unit_conflict: /polarity unit/i };
  expect(runRecipe(dataset, calendarOptions, calendarContext)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(reason[fact]),
  });
});

it('numerical_limits', async () => {
  const small = 1e-30;
  const dataset = await load(calendarSnapshot([
    [article('low', '0001-01-01T10:00:00Z', -1), '0001-01-01'],
    [article('tiny', '9999-01-01T10:00:00Z', small), '9999-01-01'],
    [article('a', '9999-01-01T11:00:00Z', 1), '9999-01-01'],
    [article('b', '9999-01-01T12:00:00Z', -1), '9999-01-01'],
    [article('high', '9999-12-31T10:00:00Z', 1), '9999-12-31'],
  ]));
  expect(aggregateNewsDays(dataset, calendarOptions)).toMatchObject({
    ok: true, value: { start: '9998-12-31', end: '9999-12-31', days: {
      '9999-01-01': { mean: small / 3, scored: 3, delivered: 3 }, '9999-12-31': { mean: 1 },
    } },
  });
  expect(aggregateNewsDays(dataset, pinned('0001-01-01', '0001-01-01'))).toMatchObject({
    ok: true, value: { days: { '0001-01-01': { mean: -1 } } },
  });
  expect(buildNewsCalendar(dataset, pinned('0001-01-01', '9999-12-31'), calendarContext))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/narrow.*window/i) });
  expect(buildNewsCalendar(dataset, pinned('9998-12-31', '9999-12-31'), { ...calendarContext, viewportWidth: 150 }))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/narrow.*window/i) });
  dataset.rows[1].values.polarity = Infinity;
  expect(buildNewsCalendar(dataset, calendarOptions, calendarContext)).toMatchObject({ ok: false, refused: true });
});

it('keeps a third-scale residual after two larger opposite scores cancel', async () => {
  const date = '2026-11-19';
  const small = 2 ** -120;
  const dataset = await load(calendarSnapshot([1, 2 ** -60, small, -(2 ** -60), -1].map((polarity, index) =>
    [article(String(index), date + 'T00:00:00Z', polarity), date] as const)));
  expect(aggregateNewsDays(dataset, calendarOptions)).toMatchObject({
    ok: true, value: { days: { [date]: { mean: small / 5 } } },
  });
});

it('refuses an unrepresentable nonzero mean in place of displaying a neutral cell', async () => {
  const dataset = await load(calendarSnapshot([
    [article('subnormal', '2026-11-19T01:00:00Z', Number.MIN_VALUE), '2026-11-19'],
    [article('neutral', '2026-11-19T02:00:00Z', 0), '2026-11-19'],
  ]));
  expect(aggregateNewsDays(dataset, calendarOptions)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/mean.*precision/i),
  });
});

it('deduplicates an identical multitag article and refuses a conflicting presented duplicate', async () => {
  const dataset = await load(calendarSnapshot([
    [article('multitag', '2026-11-19T00:00:00Z', .75, 'MSFT.US,AAPL.US,AAPL.US'), '2026-11-19'],
  ], { raw_count: 2, diagnostics: ['exact_duplicate'] }));
  const row = dataset.rows[0];
  dataset.rows.push({ ...row, id: 'same-article-other-page' });
  expect(aggregateNewsDays(dataset, calendarOptions)).toMatchObject({ ok: true, value: { days: {
    '2026-11-19': { mean: .75, delivered: 1, scored: 1 },
  } } });
  expect(aggregateNewsDays(dataset, { ...calendarOptions, instrument: 'MSFT.US' })).toMatchObject({ ok: false, refused: true });
  dataset.rows[1] = { ...row, values: { ...row.values, polarity: -.75 } };
  expect(aggregateNewsDays(dataset, calendarOptions)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/conflicting duplicate/i),
  });
});

it('groups original timestamps across UTC midnight and clamps the leap-day default by calendar year', async () => {
  const timestamp = '2024-03-01T00:30:00+01:00';
  const dataset = await load(calendarSnapshot([
    [article('older', '2023-02-27T10:00:00Z', 1), '2023-02-27'],
    [article('year-end', '2024-01-01T00:00:00+00:01', -.2), '2023-12-31'],
    [article('right', '2024-01-01T00:15:00Z', .2), '2024-01-01'],
    [article('leap', timestamp, .25), '2024-02-29'],
  ]));
  expect(aggregateNewsDays(dataset, calendarOptions)).toMatchObject({
    ok: true, value: { start: '2023-02-28', end: '2024-02-29', days: {
      '2023-12-31': { mean: -.2 }, '2024-01-01': { mean: .2 }, '2024-02-29': { mean: .25 },
    } },
  });
  const result = buildNewsCalendar(dataset, pinned('2024-02-29', '2024-02-29'), calendarContext);
  expect(result).toMatchObject({ ok: true, daySummaries: [{
    date: '2024-02-29', mean: .25, delivered: 1, scored: 1, articles: [{ timestamp, polarity: .25 }],
  }] });
  expect(JSON.stringify(result)).toContain(timestamp);
});

it('refuses a pinned window after acquiring a different date interval and keeps follow-latest revision stable', async () => {
  const first = await load(calendarSnapshot([
    [article('old', '2026-11-15T10:00:00Z', -1), '2026-11-15'],
    [article('current', '2026-11-17T10:00:00Z', 1), '2026-11-17'],
  ]));
  const next = await load(calendarSnapshot([
    [article('new', '2026-11-18T10:00:00Z', 1), '2026-11-18'],
  ]));
  const options = pinned('2026-11-16', '2026-11-17');
  expect(runRecipe(first, options, calendarContext)).toMatchObject({ ok: true });
  expect(runRecipe(next, options, calendarContext)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/pinned window.*acquired.*repair/i),
  });
  const previous = runRecipe(first, calendarOptions, calendarContext);
  const refreshed = runRecipe(next, calendarOptions, { ...calendarContext, viewportWidth: 280 });
  expect(previous.ok && refreshed.ok && previous.revision === refreshed.revision).toBe(true);
});

it('reads acquired aliases and counts presented articles only, even for a fully omitted acquired day', async () => {
  const dataset = await load(calendarSnapshot([
    [article('shown', '2026-11-15T04:00:00Z', 0), '2026-11-15'],
    [article('hidden-same-day', '2026-11-15T09:00:00Z', 1), '2026-11-15'],
    [article('hidden-day', '2026-11-17T04:00:00Z', -1), '2026-11-17'],
  ]));
  const unfiltered = structuredClone(dataset);
  dataset.columns = dataset.columns.map(column => ({ ...column, sourceFieldId: column.id, id: 'alias-' + column.id }));
  dataset.rows = dataset.rows.slice(0, 1).map(row => ({
    ...row, values: Object.fromEntries(Object.entries(row.values).map(([key, value]) => ['alias-' + key, value])),
  }));
  dataset.provenance = projectChartSources(chartPresentationProvenance(dataset.provenance, true), dataset.columns, dataset.rows);
  const options: NewsCalendarOptions = { ...calendarOptions, fields: {
    timestamp: 'alias-date', articleId: 'alias-url', instrument: 'alias-symbols', polarity: 'alias-polarity',
  } };
  const result = runRecipe(dataset, options, calendarContext);
  expect(result).toMatchObject({ ok: true, daySummaries: [
    { date: '2026-11-15', mean: 0, scored: 1, delivered: 1, articles: [{ polarity: 0 }] },
    { date: '2026-11-16', mean: null, scored: 0, delivered: 0, articles: [] },
    { date: '2026-11-17', mean: null, scored: 0, delivered: 0, articles: [] },
  ] });
  expect(JSON.stringify(result)).not.toMatch(/hidden-same-day|hidden-day|2026-11-17T04/);
  expect(result.ok && result.notes.join(' ')).toMatch(/filter.*2.*excluded/i);
  expect(aggregateNewsDays({ ...dataset, provenance: unfiltered.provenance }, options))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/inconsistent.*presentation/i) });
  const allOmitted = { ...dataset, rows: [] };
  allOmitted.provenance = projectChartSources(dataset.provenance, dataset.columns, []);
  expect(aggregateNewsDays(allOmitted, options)).toMatchObject({
    ok: true, value: { days: { '2026-11-15': { delivered: 0, scored: 0, mean: null } } },
  });
  expect(aggregateNewsDays({ ...allOmitted, columns: [] }, options)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/repair.*fields/i),
  });
  const counterfeit = { ...options, fields: { ...options.fields, polarity: 'alias-date', timestamp: 'alias-polarity' } };
  expect(runRecipe(dataset, counterfeit, calendarContext)).toMatchObject({ ok: false, refused: true });
});

it('discloses a successful empty page with and without acquired dates, preserving source errors', async () => {
  const empty = await load(calendarSnapshot([], {
    scope: { kind: 'sample', start: '2024-02-28', end: '2024-03-01', limit: 50, offset: 0 },
  }));
  const calendar = runRecipe(empty, calendarOptions, calendarContext);
  expect(calendar).toMatchObject({ ok: true, daySummaries: [
    { date: '2024-02-28', mean: null, scored: 0, delivered: 0 },
    { date: '2024-02-29', mean: null, scored: 0, delivered: 0 },
    { date: '2024-03-01', mean: null, scored: 0, delivered: 0 },
  ] });
  expect(calendar.ok && calendar.notes.join(' ')).toMatch(/0 delivered articles/i);
  const open = await load(calendarSnapshot([]));
  expect(runRecipe(open, calendarOptions, calendarContext)).toMatchObject({ ok: true, figure: { data: [] }, daySummaries: [] });
  expect(runRecipe(open, pinned('2024-02-28', '2024-03-01'), calendarContext)).toMatchObject({ ok: false, refused: true });

  open.freshness = { availability: 'error', stale: false, error: 'CompanyNews access denied.' };
  expect(runRecipe(open, calendarOptions, calendarContext)).toEqual({ ok: false, message: 'CompanyNews access denied.' });
  const missing = structuredClone(empty);
  delete missing.provenance.metadata?.chartSources;
  expect(runRecipe(missing, calendarOptions, calendarContext)).toMatchObject({ ok: false, refused: true });
  const invalid = structuredClone(empty);
  invalid.provenance.metadata = { chartSources: { news: newsReceipt } };
  expect(runRecipe(invalid, calendarOptions, calendarContext)).toMatchObject({ ok: false, refused: true });
});
