// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useDashboardStore } from '../../src/stores/dashboardStore';

declare global {
  interface Window {
    deliverPivotGroupValue: (dashboardId: string, groupId: string, value: string) => void;
  }
}

// A shared update arrives in the viewer's existing store without an authoring write.
window.deliverPivotGroupValue = (dashboardId, groupId, value) => {
  useDashboardStore.setState(state => ({
    dashboards: state.dashboards.map(dashboard => dashboard.id === dashboardId
      ? { ...dashboard, groups: dashboard.groups?.map(group => group.id === groupId ? { ...group, value } : group) }
      : dashboard),
  }));
};
