// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useSyncExternalStore } from 'react';
import { tableCommitCoordinators, type ModelEdit, type RepairContext } from '../stores/tableCommitCoordinator';
import type { TableModelV1 } from '../lib/tableModel/types';

/** RuntimeTable owns the lifetime; conditional header/panel consumers only subscribe. */
export function useTableCommit(dashboardId: string, widgetId: string, owner = false) {
  // Follows the registry: a header outliving its table must pick up the instance the remounted table creates.
  const coordinator = useSyncExternalStore(tableCommitCoordinators.subscribe, () => tableCommitCoordinators.get(dashboardId, widgetId));
  const snapshot = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot);
  useEffect(() => owner ? coordinator.retain() : undefined, [coordinator, owner]);
  const base = coordinator.authoringBase();
  return {
    coordinator, base, ...snapshot,
    groupProofContext: coordinator.groupProofContext.bind(coordinator, base),
    commitPivotGroupChange: coordinator.commitPivotGroupChange.bind(coordinator, base),
    undoPivotGroupChange: coordinator.undoPivotGroupChange.bind(coordinator, base),
    editModel: async (edit: ModelEdit) => (await coordinator.editModel(base, edit)).status === 'saved',
    commitModel: async (model: TableModelV1, repair?: RepairContext) => (await coordinator.replaceModel(base, model, repair)).status === 'saved',
  };
}
