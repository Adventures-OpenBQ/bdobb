// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { NewsSource } from '../../lib/widgetData/chartRecipes/newsEvidence';
import { newsReceipt } from './newsEvidence';

export type CalendarArticle = {
  url: string; date: string; symbols: string; polarity: number | null;
};

export function calendarArticle(id: string, date: string, polarity: number | null, symbols = 'AAPL.US'): CalendarArticle {
  return { url: 'https://example.com/' + id, date, symbols, polarity };
}

export const calendarOptions = {
  version: 1, kind: 'news-sentiment-calendar', instrument: 'AAPL.US', window: { mode: 'latest-12-months' },
  fields: { timestamp: 'date', articleId: 'url', instrument: 'symbols', polarity: 'polarity' },
} as const;

export const calendarContext = { theme: 'light', today: '2026-11-19', maxDecimals: 2 } as const;

// Fixture dates are specified independently of the production UTC decoder and aggregation.
export function calendarSnapshot(
  entries: readonly (readonly [CalendarArticle, string])[],
  overrides: Partial<NewsSource> = {},
) {
  const rows = entries.map(([article]) => article);
  const receipt: NewsSource = {
    ...newsReceipt, retrieved_at: '2026-11-20T03:00:00Z', raw_count: rows.length, normalized_count: rows.length,
    delivered_count: rows.length, diagnostics: rows.some(({ polarity }) => polarity === null) ? ['unscored'] : [],
    unsafe: { invalid_timestamp: false, invalid_identity: false, duplicate_conflict: false, unit_conflict: false },
    coordinates: entries.map(([{ url, polarity }, day]) => ({ article_id: url, utc_day: day, scored: polarity !== null })),
    ...overrides,
  };
  return { rows, completeness: receipt.scope.kind, chart_sources: { version: 1, receipts: [receipt] } };
}
