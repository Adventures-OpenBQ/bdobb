// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// D-007: curated pivot-v1 overlays on BACKEND tables must land where
// TableRenderer reads them (card.table.pivot), not in a worker-only
// tableDefinition.analytical that a backend card never executes.
import { expect, it } from 'vitest';
import { exportCompatibleApp, importApps } from './appsJson';
import { isWorkerTableProducer } from './tableExecution/eligibility';

// Verbatim tabs from REFERENCE_CURATED "Episode 3 — Pivot examples" (sha-1978c19).
const overlay = (pivot: object) => ({ bdobb: { version: 1, profile: 'pivot-v1', pivot } });
const item = (i: string, pivot: object) => ({ i, x: 0, y: 0, w: 20, h: 10, state: { params: {} }, extensions: overlay(pivot) });
const app = { name: 'Episode 3 — Pivot examples', tabs: {
  'monthly-ohlc': { name: 'Monthly OHLC', layout: [item('openbq_demo_prices', { enabled: true, grouping: ['asset', 'date'], split: [], buckets: { date: 'month' }, aggregationFns: { open: 'first', high: 'max', low: 'min', close: 'last', volume: 'sum' } })] },
  'cross-tab': { name: 'Asset cross-tab', layout: [item('openbq_demo_prices', { enabled: true, grouping: ['date'], split: ['asset'], buckets: { date: 'month' }, aggregationFns: { volume: 'sum', close: 'mean' } })] },
  'mean-count': { name: 'Mean and Count', layout: [item('openbq_demo_prices', { enabled: true, grouping: ['asset'], split: [], measures: [{ id: 'mean', sourceFieldId: 'volume', aggregation: 'mean' }, { id: 'count', sourceFieldId: 'volume', aggregation: 'count' }] })] },
  'null-handling': { name: 'Null handling', layout: [item('openbq_demo_nulls', { enabled: true, grouping: ['asset'], split: [], measures: [{ id: 'mean', sourceFieldId: 'value', aggregation: 'mean' }, { id: 'count', sourceFieldId: 'value', aggregation: 'count' }, { id: 'sum', sourceFieldId: 'value', aggregation: 'sum' }] })] },
} };

it('D-007: curated pivot-v1 on a backend table imports as the in-thread pivot TableRenderer applies', () => {
  const dashboard = importApps([structuredClone(app)], []).dashboards[0];
  for (const [index, tab] of dashboard.tabs.entries()) {
    const card = tab.cards[0];
    const source = Object.values(app.tabs)[index].layout[0].extensions.bdobb.pivot;
    expect(isWorkerTableProducer(card)).toBe(false); // backend table: TableRenderer, never the worker
    expect(card.table?.pivot, tab.name).toEqual(source);
    expect(card.tableDefinition?.analytical, tab.name).toBeUndefined();
  }
});

it('D-007: the imported recipes pivot in-thread through pivotTable', async () => {
  const { pivotTable } = await import('./pivotTable');
  const { tableColumns } = await import('./tableColumns');
  const rows = [
    { asset: 'A', date: '2024-01-02', open: 1, high: 3, low: 1, close: 2, volume: 10, value: 1 },
    { asset: 'A', date: '2024-01-03', open: 2, high: 4, low: 2, close: 3, volume: 20, value: null },
    { asset: 'B', date: '2024-02-01', open: 5, high: 6, low: 4, close: 5, volume: 30, value: 3 },
  ];
  const columns = tableColumns(rows, undefined);
  const kinds = new Map<string, 'text' | 'date' | 'number'>([['asset', 'text'], ['date', 'date'], ...['open', 'high', 'low', 'close', 'volume', 'value'].map(f => [f, 'number'] as [string, 'number'])]);
  for (const tab of importApps([structuredClone(app)], []).dashboards[0].tabs) {
    const result = pivotTable({ rows, columns, kinds, order: columns.map(c => c.field), config: tab.cards[0].table!.pivot!, sorting: [] });
    expect(result?.ok, tab.name).toBe(true);
  }
});

it('D-007: the imported pivots survive a compatible export and re-import', () => {
  const dashboard = importApps([structuredClone(app)], []).dashboards[0];
  const exported = exportCompatibleApp(dashboard);
  if (!exported.ok) throw new Error(exported.issue.message);
  const again = importApps([exported.value], []).dashboards[0];
  expect(again.tabs.map((t) => t.cards[0].table?.pivot)).toEqual(dashboard.tabs.map((t) => t.cards[0].table?.pivot));
});
