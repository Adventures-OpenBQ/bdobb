// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { dispatchDrawer } from '../../../stores/pivotDrawerStore';
import { useDrawer } from './PivotDrawer';
export function PivotFooterStrip({dashboardId,widgetId,summary,tableHidden}:{dashboardId:string;widgetId:string;summary:string;tableHidden:boolean}) {
 const state=useDrawer(dashboardId,widgetId);
 return <button type="button" className="pivot-footer-strip" onClick={()=>dispatchDrawer(dashboardId,widgetId,{kind:!state.open?'toggle':tableHidden?'showTable':'outside'})}><span className="pivot-footer-summary">{summary}</span><span className="pivot-footer-action">{tableHidden?'Show table ▾':state.open?'Close':'Edit'}</span></button>;
}
