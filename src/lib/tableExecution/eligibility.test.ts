// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, expect, it } from 'vitest';
import { isBackendTable } from './eligibility';
import { useWidgetRegistryStore } from '../../stores/widgetRegistryStore';
import type { DashboardCard } from '../types';

const card: DashboardCard = { id: 'c', widgetId: 'w', backendId: 'b', params: {}, layout: { x: 0, y: 0, w: 1, h: 1 } };
const realFind = useWidgetRegistryStore.getState().find;
afterEach(() => useWidgetRegistryStore.setState({ find: realFind, widgets: [] }));

it('is a backend table only for a discovered table widget, and a throwing lookup is not one', () => {
  useWidgetRegistryStore.setState({ widgets: [{ id: 'w', backendId: 'b', type: 'table', name: 'W', endpoint: '', params: [] } as never] });
  expect(isBackendTable(card)).toBe(true);
  expect(isBackendTable({ ...card, linkedSource: { kind: 'widget', sourceWidgetId: 'x' } })).toBe(false);
  useWidgetRegistryStore.setState({ find: () => { throw new Error('lookup failed'); } });
  expect(isBackendTable(card)).toBe(false);
});
