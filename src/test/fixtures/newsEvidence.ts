// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { NewsSource } from '../../lib/widgetData/chartRecipes/newsEvidence';

export const newsRows = [
  { url: 'https://example.com/neutral', date: '2024-03-01T00:45:00+01:00', symbols: 'AAPL.US,MSFT.US',
    polarity: 0, title: 'keep this', body: 'synthetic one' },
  { url: 'https://example.com/unscored', date: '2024-03-01T04:00:00Z', symbols: 'AAPL.US',
    polarity: null, title: 'hide this', body: 'synthetic two' },
  { url: 'https://example.com/scored', date: '2024-03-01T15:00:00Z', symbols: 'AAPL.US',
    polarity: 0.7654321, title: 'hide this too', body: 'synthetic body of hidden article' },
];
export const newsReceipt = {
  version: 1,
  kind: 'news',
  retrieved_at: '2024-03-02T12:00:00Z',
  raw_count: 4,
  normalized_count: 3,
  delivered_count: 3,
  diagnostics: ['invalid_identity', 'invalid_timestamp', 'duplicate_conflict', 'unscored'],
  unsafe: { invalid_identity: true, invalid_timestamp: true, duplicate_conflict: true, unit_conflict: false },
  field_origins: { timestamp: 'date', articleId: 'url', instrument: 'symbols', polarity: 'polarity' },
  instrument: 'AAPL.US',
  polarity_unit: 'polarity[-1,1]',
  scope: { kind: 'sample', start: null, end: null, limit: 50, offset: 0 },
  coordinates: [
    { article_id: 'https://example.com/neutral', utc_day: '2024-02-29', scored: true },
    { article_id: 'https://example.com/unscored', utc_day: '2024-03-01', scored: false },
    { article_id: 'https://example.com/scored', utc_day: '2024-03-01', scored: true },
  ],
} satisfies NewsSource;
export const newsEnvelope = { version: 1, receipts: [newsReceipt] };
export const newsResponse = { results: newsRows, extra: { results_metadata: { chart_sources: newsEnvelope } } };
export const newsSnapshot = { rows: newsRows, completeness: 'sample', chart_sources: newsEnvelope };
