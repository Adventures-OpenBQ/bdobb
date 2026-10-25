// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, expect, it } from 'vitest';
import { __reset, __failPath, __read } from '../test/memfs';
import { __resetJsonStoreForTests } from '../lib/jsonStore';
import { widget } from '../test/fixtures';
import { useDashboardStore } from './dashboardStore';
import { tableExecutionStore } from './tableExecutionStore';

beforeEach(() => { __reset(); __resetJsonStoreForTests(); useDashboardStore.setState({ dashboards: [], activeId: null, activeTabId: null, viewer: false, pendingCardRemoval: null }); });
async function setup() {
  await useDashboardStore.getState().load();
  const source = (await useDashboardStore.getState().addCard(widget({ id: 'local_table', backendId: 'builtin' }), { file: 'data.csv' }))!;
  const d = useDashboardStore.getState().activeDashboard()!;
  return { source, dashboardId: d.id, tabId: d.tabs[0].id };
}
it('creates durable linked intent in the captured owner across tabs', async () => {
  const input = await setup();
  const other = await useDashboardStore.getState().addDashboard('Other');
  useDashboardStore.getState().setActive(other!);
  const id = await useDashboardStore.getState().addLinkedCard({ ...input, sourceWidgetId: input.source, presentation: 'table' });
  const d = useDashboardStore.getState().dashboards.find(d => d.id === input.dashboardId)!;
  expect(d.tabs[0].cards[1]).toMatchObject({ id, widgetId: 'linked_table', linkedSource: { kind: 'widget', sourceWidgetId: input.source } });
  expect(__read(`dashboards/${d.id}.json`)).toContain('linked_table');
  expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards).toHaveLength(0);
});
it('failed durable creation does not publish a card', async () => {
  const input = await setup(); __failPath(`dashboards/${input.dashboardId}.json`);
  await expect(useDashboardStore.getState().addLinkedCard({ ...input, sourceWidgetId: input.source, presentation: 'chart' })).rejects.toThrow();
  expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards).toHaveLength(1);
});
it('rejects foreign, chart, transposed, and cyclic sources without changing settings', async () => {
  const input = await setup(); const store = () => useDashboardStore.getState();
  expect(await store().addLinkedCard({ ...input, sourceWidgetId: 'foreign', presentation: 'table' })).toBeNull();
  const child = (await store().addLinkedCard({ ...input, sourceWidgetId: input.source, presentation: 'table' }))!;
  const grandchild = (await store().addLinkedCard({ ...input, sourceWidgetId: child, presentation: 'table' }))!;
  expect(await store().replaceLinkedSource(child, grandchild)).toBe(false);
  const chart = (await store().addLinkedCard({ ...input, sourceWidgetId: child, presentation: 'chart' }))!;
  expect(await store().replaceLinkedSource(child, chart)).toBe(false);
  await store().patchCardField(input.source, 'view', 'transposed');
  expect(await store().replaceLinkedSource(child, input.source)).toBe(false);
});
it('source deletion retains dependent intent and undo restores the same source identity', async () => {
  const input = await setup(); const store = () => useDashboardStore.getState();
  const id = (await store().addLinkedCard({ ...input, sourceWidgetId: input.source, presentation: 'table' }))!;
  await store().commitTableDefinition(input.dashboardId, id, { table: { hidden: ['value'] }, search: '42' }, { kind: 'explicit', ids: ['r0'] });
  const before = store().activeDashboard()!.tabs[0].cards[1];
  await store().removeCard(input.source);
  expect(store().activeDashboard()!.tabs[0].cards[0]).toEqual(before);
  await store().undoCardRemoval();
  expect(store().activeDashboard()!.tabs[0].cards[0].id).toBe(input.source);
  expect(store().activeDashboard()!.tabs[0].cards[1]).toEqual(before);
});
it('replacement repairs a foreign reference while retaining selection and chart mappings', async () => {
  const input = await setup(); const store = () => useDashboardStore.getState();
  const id = (await store().addLinkedCard({ ...input, sourceWidgetId: input.source, presentation: 'chart' }))!;
  useDashboardStore.setState(s => ({ dashboards: s.dashboards.map(d => ({ ...d, tabs: d.tabs.map(t => ({ ...t, cards: t.cards.map(c => c.id === id ? { ...c, linkedSource: { kind: 'widget' as const, sourceWidgetId: 'foreign' } } : c) })) })) }));
  const before = store().activeDashboard()!.tabs[0].cards[1];
  const other = await store().addDashboard('Other'); store().setActive(other!);
  expect(await store().replaceLinkedSource(id, input.source)).toBe(true);
  const after = store().dashboards.find(d => d.id === input.dashboardId)!.tabs[0].cards[1];
  expect(after).toEqual({ ...before, linkedSource: { kind: 'widget', sourceWidgetId: input.source } });
});
it('failed replacement leaves previous reference durable and visible', async () => {
  const input = await setup(); const store = () => useDashboardStore.getState();
  const second = (await store().addCard(widget({ id: 'local_table', backendId: 'builtin' }), { file: 'second.csv' }))!;
  const id = (await store().addLinkedCard({ ...input, sourceWidgetId: input.source, presentation: 'table' }))!;
  __failPath(`dashboards/${input.dashboardId}.json`);
  await expect(store().replaceLinkedSource(id, second)).rejects.toThrow();
  expect(store().activeDashboard()!.tabs[0].cards[2].linkedSource?.sourceWidgetId).toBe(input.source);
});
it('dashboard duplication remaps cross-tab linked ownership and preserves symbolic intent', async () => {
  const input = await setup(); const store = () => useDashboardStore.getState();
  const tab = (await store().addTab('Second'))!;
  const child = (await store().addLinkedCard({ ...input, tabId: tab, sourceWidgetId: input.source, presentation: 'table' }))!;
  await store().commitTableDefinition(input.dashboardId, child, { table: {}, search: 'saved' }, { kind: 'allMatching', excludedIds: ['r1'] });
  const copy = (await store().duplicateDashboard(input.dashboardId))!;
  const d = store().dashboards.find(d => d.id === copy)!;
  expect(d.tabs[1].cards[0].linkedSource?.sourceWidgetId).toBe(d.tabs[0].cards[0].id);
  expect(d.tabs[1].cards[0].tableSelection).toEqual({ kind: 'allMatching', excludedIds: ['r1'] });
  expect(d.tabs[0].cards[0].params.file).toBe('data.csv');
});
it('rejects imported cycle ancestry and permits repair to a healthy local table', async () => {
  const input = await setup(); const store = () => useDashboardStore.getState();
  const first = (await store().addLinkedCard({ ...input, sourceWidgetId: input.source, presentation: 'table' }))!;
  const second = (await store().addLinkedCard({ ...input, sourceWidgetId: first, presentation: 'table' }))!;
  useDashboardStore.setState(s => ({ dashboards: s.dashboards.map(d => ({ ...d, tabs: d.tabs.map(t => ({ ...t, cards: t.cards.map(c => c.id === first ? { ...c, linkedSource: { kind: 'widget' as const, sourceWidgetId: second } } : c) })) })) }));
  expect(await store().addLinkedCard({ ...input, sourceWidgetId: first, presentation: 'table' })).toBeNull();
  expect(await store().replaceLinkedSource(first, input.source)).toBe(true);
});
it('viewer refuses creation and source replacement', async () => {
  const input = await setup(); const store = () => useDashboardStore.getState();
  const child = (await store().addLinkedCard({ ...input, sourceWidgetId: input.source, presentation: 'table' }))!;
  useDashboardStore.setState({ viewer: true });
  expect(await store().addLinkedCard({ ...input, sourceWidgetId: input.source, presentation: 'chart' })).toBeNull();
  expect(await store().replaceLinkedSource(child, input.source)).toBe(false);
});

it('chart mapping saves before publishing, captures ownership and rejects failed writes', async () => {
  const input = await setup(); const store = () => useDashboardStore.getState();
  const id = (await store().addLinkedCard({ ...input, sourceWidgetId: input.source, presentation: 'chart' }))!;
  const settings = { type: 'line' as const, category: 'region', measures: ['revenue', 'cost'], display: 'grouped' as const };
  const other = (await store().addDashboard('Other'))!; store().setActive(other);
  expect(await store().commitLinkedChartSettings(input.dashboardId, id, settings)).toBe(true);
  const owner = () => store().dashboards.find(d => d.id === input.dashboardId)!;
  expect(owner().tabs[0].cards[1].linkedChart).toEqual(settings);
  expect(__read(`dashboards/${input.dashboardId}.json`)).toContain('revenue');
  __failPath(`dashboards/${input.dashboardId}.json`);
  await expect(store().commitLinkedChartSettings(input.dashboardId, id, { ...settings, type: 'bar' })).rejects.toThrow();
  expect(owner().tabs[0].cards[1].linkedChart).toEqual(settings);
  useDashboardStore.setState({ viewer: true });
  expect(await store().commitLinkedChartSettings(input.dashboardId, id, settings)).toBe(false);
});
it('copying a linked card to another dashboard drops its source binding; a same-dashboard copy keeps it', async () => {
  const input = await setup(); const store = () => useDashboardStore.getState();
  const table = (await store().addLinkedCard({ ...input, sourceWidgetId: input.source, presentation: 'table' }))!;
  const chart = (await store().addLinkedCard({ ...input, sourceWidgetId: input.source, presentation: 'chart' }))!;
  const same = (await store().duplicateCard(table))!;
  expect(store().dashboards.find(d => d.id === input.dashboardId)!.tabs[0].cards.find(c => c.id === same)!.linkedSource).toEqual({ kind: 'widget', sourceWidgetId: input.source });
  const otherId = (await store().addDashboard('Other'))!; store().setActive(otherId);
  const other = (await store().addCard(widget({ id: 'local_table', backendId: 'builtin' }), { file: 'b.csv' }))!;
  const tabId = store().dashboards.find(d => d.id === otherId)!.tabs[0].id;
  const tableCopy = (await store().copyCardTo(table, otherId, tabId))!;
  const chartCopy = (await store().copyCardTo(chart, otherId, tabId))!;
  const target = store().dashboards.find(d => d.id === otherId)!;
  for (const id of [tableCopy, chartCopy]) {
    const copy = target.tabs[0].cards.find(c => c.id === id)!;
    expect(copy.linkedSource).toBeUndefined();
    expect(copy.linkedChart).toBeUndefined();
  }
  expect(__read(`dashboards/${otherId}.json`)).not.toContain(input.source);
  tableExecutionStore.syncDashboard(target);
  expect(tableExecutionStore.readView(otherId, other).status).not.toBe('blocked');
});
