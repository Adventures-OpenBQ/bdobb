// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { LinkedWidgetDialog } from './LinkedWidgetDialog';
import { WidgetLibrary } from './WidgetLibrary';
import { useDashboardStore } from '../stores/dashboardStore';
import { useWidgetRegistryStore } from '../stores/widgetRegistryStore';
import { __reset, __failPath } from '../test/memfs';
import { __resetJsonStoreForTests } from '../lib/jsonStore';
import { card } from '../test/fixtures';

beforeEach(() => { __reset(); __resetJsonStoreForTests(); useWidgetRegistryStore.getState().seedBuiltins(); useDashboardStore.setState({ dashboards: [{ id: 'd', name: 'D', tabs: [{ id: 't', name: 'First', cards: [card({ id: 's', widgetId: 'local_table', backendId: 'builtin', title: 'Prices' })] }, { id: 'other', name: 'Second', cards: [card({ id: 'off', widgetId: 'local_table', backendId: 'builtin', title: 'Off tab' })] }] }], activeId: 'd', activeTabId: 't', viewer: false, pendingCardRemoval: null }); });
it('picker labels eligible table titles and tabs and creates into its captured tab', async () => {
  render(<LinkedWidgetDialog dashboardId="d" tabId="t" presentation="table" onClose={() => {}} />);
  expect(screen.getByRole('option', { name: 'Prices — First' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Source table'), { target: { value: 'off' } });
  act(() => useDashboardStore.setState({ activeTabId: 'other' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create linked table' }));
  await waitFor(() => expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1]?.linkedSource?.sourceWidgetId).toBe('off'));
});
it('excludes descendants that would form a cycle and permits choosing an off-tab source', async () => {
  const child = card({ id: 'child', widgetId: 'linked_table', backendId: 'builtin', linkedSource: { kind: 'widget', sourceWidgetId: 's' } });
  const grandchild = { ...child, id: 'grand', title: 'Descendant', linkedSource: { kind: 'widget' as const, sourceWidgetId: 'child' } };
  act(() => useDashboardStore.setState(s => ({ dashboards: s.dashboards.map(d => ({ ...d, tabs: d.tabs.map(t => t.id === 't' ? { ...t, cards: [...t.cards, child, grandchild] } : t) })) })));
  render(<LinkedWidgetDialog dashboardId="d" tabId="t" cardId="child" onClose={() => {}} />);
  expect(screen.queryByRole('option', { name: /Descendant/ })).toBeNull();
  fireEvent.change(screen.getByLabelText('Source table'), { target: { value: 'off' } });
  fireEvent.click(screen.getByRole('button', { name: 'Choose source' }));
  await waitFor(() => expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedSource?.sourceWidgetId).toBe('off'));
});
it('failed durable writes remain actionable in the picker', async () => {
  __failPath('dashboards/d.json');
  render(<LinkedWidgetDialog dashboardId="d" tabId="t" presentation="chart" sourceWidgetId="s" onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create linked chart' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not save'));
  expect(useDashboardStore.getState().dashboards[0].tabs[0].cards).toHaveLength(1);
});
it('add-widget flow opens the same source picker instead of adding an unconfigured card', async () => {
  render(<WidgetLibrary target={{ dashboardId: 'd', tabId: 't' }} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add Linked chart' }));
  expect(screen.getByLabelText('Source table')).toBeTruthy();
  expect(useDashboardStore.getState().dashboards[0].tabs[0].cards).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Source table'), { target: { value: 's' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create linked chart' }));
  await waitFor(() => expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1]?.linkedChart?.type).toBe('column'));
});
it('Escape closes the source picker and keeps the widget library open', async () => {
  let closed = false;
  render(<WidgetLibrary target={{ dashboardId: 'd', tabId: 't' }} onClose={() => { closed = true; }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add Linked table' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByLabelText('Source table')).toBeNull());
  expect(closed).toBe(false);
});
it('external widgets with linked built-in IDs keep the ordinary apps.json creation flow', async () => {
  act(() => useWidgetRegistryStore.setState(s => ({ widgets: [...s.widgets, { id: 'linked_table', backendId: 'external', name: 'External endpoint', description: '', type: 'table', endpoint: '/prices', params: [], category: '', subCategory: '', source: [], gridData: { w: 10, h: 8 } }] })));
  render(<WidgetLibrary target={{ dashboardId: 'd', tabId: 't' }} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add External endpoint' }));
  await waitFor(() => expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1]?.backendId).toBe('external'));
  expect(screen.queryByLabelText('Source table')).toBeNull();
});
