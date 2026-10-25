// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef } from 'react';
import type { Dashboard } from '../lib/types';
import { useDashboardStore } from '../stores/dashboardStore';
import { useWidgetRegistryStore } from '../stores/widgetRegistryStore';
import { tableExecutionStore, type TableExecutionStore } from '../stores/tableExecutionStore';
/** Dashboard ownership survives tab changes and React's synchronous StrictMode replay. */
export function TableExecutionRuntime({ dashboard, store = tableExecutionStore }: {
  dashboard?: Dashboard;
  store?: TableExecutionStore;
}) {
  const active = useDashboardStore(s => s.dashboards.find(d => d.id === s.activeId));
  const epoch = useDashboardStore(s => s.refreshEpoch);
  // Discovery decides which backend cards are tables, so it resyncs too.
  const widgets = useWidgetRegistryStore(s => s.widgets);
  const current = dashboard ?? active;
  const latest = useRef(current);
  latest.current = current;
  useEffect(() => {
    if (latest.current)
      return store.acquireDashboard(latest.current);
  }, [current?.id, store]);
  useEffect(() => {
    if (current)
      store.syncDashboard(current);
  }, [current, store, widgets]);
  const previousEpoch = useRef(epoch);
  useEffect(() => {
    if (epoch !== previousEpoch.current && current)
      store.refreshDashboard(current.id);
    previousEpoch.current = epoch;
  }, [epoch, current, store]);
  return null;
}
