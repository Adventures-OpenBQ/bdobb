// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { PivotIcon } from '../../PivotIcon';
import { useDrawer } from './PivotDrawer';
import { dispatchDrawer } from '../../../stores/pivotDrawerStore';
import { useSyncExternalStore } from 'react';
import { tableExecutionStore } from '../../../stores/tableExecutionStore';
import { validateTableModel } from '../../../lib/tableModel/validation';
export function PivotToggle({dashboardId,widgetId}:{dashboardId:string;widgetId:string}) {
 const state=useDrawer(dashboardId,widgetId);const view=useSyncExternalStore(tableExecutionStore.subscribe,()=>tableExecutionStore.readView(dashboardId,widgetId));
 const model=validateTableModel(view.definition.analytical).model;
 return <button type="button" className="card-action pivot-toggle" aria-label="Pivot" title="Pivot · Icon by Matt Garbarino, Noun Project · CC BY 3.0 (cropped and recoloured)" aria-expanded={state.open} data-pivot={(model ? model.enabled : (view.definition.analytical === undefined && view.definition.table.pivot?.enabled)) ? 'on' : 'off'} data-dashboard={dashboardId} data-widget={widgetId} onClick={()=>dispatchDrawer(dashboardId,widgetId,{kind:'toggle'})}><PivotIcon/></button>;
}
