// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, it } from 'vitest';
import { __reset, __read } from '../test/memfs';
import { __resetJsonStoreForTests } from '../lib/jsonStore';
import { widget } from '../test/fixtures';
import { useDashboardStore } from './dashboardStore';
beforeEach(() => { __reset(); __resetJsonStoreForTests(); useDashboardStore.setState({ dashboards: [], activeId: null, activeTabId: null }); });
it('v4 commits an analytical definition durably instead of losing it on reopening', async () => {
  await useDashboardStore.getState().load();
  const id = (await useDashboardStore.getState().addCard(widget({ id: 'local_table', backendId: 'builtin' }), { file: 'data.csv' }))!;
  const dashboard = useDashboardStore.getState().activeDashboard()!;
  const definition = { table: {}, search: '', analytical: { schemaVersion: 1 as const, enabled: true, params: { promotePage: true, filters: [] }, categories: [], measures: [], formulas: [], layout: { rows: [], columns: [], values: [] }, checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: false } } };
  await useDashboardStore.getState().commitTableDefinition(dashboard.id, id, definition, { kind: 'none' });
  const saved = JSON.parse(__read(`dashboards/${dashboard.id}.json`)!);
  expect(saved.tabs[0].cards[0].tableDefinition).toEqual(definition);
});
