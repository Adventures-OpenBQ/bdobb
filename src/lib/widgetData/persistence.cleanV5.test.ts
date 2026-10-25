// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, it } from 'vitest';
import { saveDashboard, loadDashboard } from '../dashboardsFile';
import { __reset } from '../../test/memfs';
import { __resetJsonStoreForTests } from '../jsonStore';
import type { Dashboard, DashboardCard } from '../types';
beforeEach(() => { __reset(); __resetJsonStoreForTests(); });
it('reopens saved Statement folds alongside the existing worker definition', async () => {
  const card = { id: 'c', widgetId: 'local_table', backendId: 'builtin', params: { file: 'cash.csv' }, layout: { x: 0, y: 0, w: 10, h: 10 }, view: 'statement', statement: { collapsed: ['Investing'] }, tableDefinition: { table: {}, search: '' } } as unknown as DashboardCard;
  const dashboard: Dashboard = { id: 'd', name: 'Cash flow', tabs: [{ id: 't', name: 'Statement', cards: [card] }] };
  await saveDashboard(dashboard);
  expect((await loadDashboard('d'))?.tabs[0].cards[0]).toMatchObject({ view: 'statement', statement: { collapsed: ['Investing'] }, tableDefinition: { table: {}, search: '' } });
});
