// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useTableCommit } from './useTableCommit';
import { tableCommitCoordinators } from '../stores/tableCommitCoordinator';
import { useDashboardStore } from '../stores/dashboardStore';
import type { Dashboard } from '../lib/types';

it('a header subscriber follows the live coordinator when the table unmounts and remounts', async () => {
  const card = { id: 'c', backendId: 'b', widgetId: 'w', params: {}, layout: { x: 0, y: 0, w: 1, h: 1 } };
  useDashboardStore.setState({ viewer: false, dashboards: [{ id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [card] }] } as unknown as Dashboard], activeId: 'd', activeTabId: 't' });
  const header = renderHook(() => useTableCommit('d', 'c'));
  const first = renderHook(() => useTableCommit('d', 'c', true));
  first.unmount(); // view -> Transposed
  await act(async () => { await Promise.resolve(); });
  const second = renderHook(() => useTableCommit('d', 'c', true)); // back to Table
  header.rerender();
  expect(second.result.current.coordinator).toBe(tableCommitCoordinators.get('d', 'c'));
  expect(header.result.current.coordinator).toBe(second.result.current.coordinator);
  second.unmount(); header.unmount();
});
