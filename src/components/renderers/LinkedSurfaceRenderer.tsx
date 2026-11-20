// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useMemo} from "react";
import {decodeV3CardExtension} from "../../lib/appsExtensionsV3";
import type {SurfaceDataset} from "../../lib/linkedSurface";
import {UNRESOLVED_BACKEND_ID} from "../../lib/appsJson";
import {buildLinkedSurface} from "../../lib/linkedSurface";
import {logError} from "../../lib/logger";
import type {DashboardCard,LinkedChartSettings} from "../../lib/types";
import {useDashboardStore} from "../../stores/dashboardStore";
import {linkedSourceKey,useLinkedSourcesStore} from "../../stores/linkedSourcesStore";
import {useSettingsStore} from "../../stores/settingsStore";
import {useWidgetRegistryStore} from "../../stores/widgetRegistryStore";
import {ChartRenderer} from "./ChartRenderer";
const EMPTY_COLUMNS:SurfaceDataset["columns"]=[];
const DEFAULTS:LinkedChartSettings={type:"surface",display:"grouped",measures:[]};
export function LinkedSurfaceRenderer({dashboardId,card,viewer=false}:{dashboardId:string;card:DashboardCard;viewer?:boolean}){
 const dashboard=useDashboardStore(s=>s.dashboards.find(d=>d.id===dashboardId));
 const patch=useDashboardStore(s=>s.patchCardField);
 const registry=useWidgetRegistryStore(s=>s.widgets);
 const theme=useSettingsStore(s=>s.settings.theme);
 const sourceId=card.linkedSource?.sourceWidgetId;
 const publication=useLinkedSourcesStore(s=>sourceId?s.sources.get(linkedSourceKey(dashboardId,sourceId))?.publication:undefined);
 const cards=dashboard?.tabs.flatMap(t=>t.cards)??[];
 const sources=cards.filter(c=>c.widgetId!=="linked_chart" && registry.some(w=>w.id===c.widgetId && (w.backendId===c.backendId || c.backendId===UNRESOLVED_BACKEND_ID) && w.type==="table"));
 const source=sources.find(c=>c.id===sourceId);
 const decoded=useMemo(()=>card.linkedChart===undefined?{ok:true as const,value:undefined}:decodeV3CardExtension({schemaVersion:1,profile:"v3",linkedChart:card.linkedChart},"$.linkedChart"),[card.linkedChart]);
 const settings=decoded.ok?(decoded.value?.linkedChart??DEFAULTS):DEFAULTS;
 const settingsError=decoded.ok?undefined:`Invalid chart settings: ${decoded.issue.message}`;
 const columns=source?(publication?.data?.columns??EMPTY_COLUMNS):EMPTY_COLUMNS;
 const sourceAvailable=source!==undefined;
 const selectable=useMemo(()=>columns.filter(c=>c.dtype==="number" && c.id!==settings.category && c.chartDataType!=="excluded"),[columns,settings.category]);
 const unavailable=useMemo(()=>settings.measures.filter(id=>!selectable.some(c=>c.id===id)),[settings.measures,selectable]);
 const result=useMemo(()=>!settingsError && !unavailable.length && sourceAvailable && publication?.status==="ready" && publication.data?buildLinkedSurface(publication.data,settings,theme):undefined,[settingsError,unavailable,sourceAvailable,publication,settings,theme]);
 const save=(next:LinkedChartSettings)=>{void patch(card.id,"linkedChart",next).catch(e=>logError(`failed to save linked surface settings: ${e}`));};
 let message:string|undefined;
 if(!sourceId)message="Choose a source table.";
 else if(!source)message="Source unavailable. Choose another table.";
 else if(!publication || publication.status==="loading")message="Loading source…";
 else if(publication.status==="error")message=`Source error: ${publication.error??"Request failed"}`;
 else if(publication.status!=="ready")message=publication.status==="incomplete"?"Complete the source table's parameters.":"Waiting for source table…";
 else if(settingsError)message=settingsError;
 else if(!publication.data)message="Source data unavailable.";
 else if(unavailable.length)message="Selected measures are unavailable or non-numeric. Remove them or reset chart fields.";
 else if(result && !result.ok)message=result.message;
 const selectedUnavailable=sourceId && !source;
 return <div className="linked-surface">
  <div className="linked-surface-controls">
   <label>Source table<select aria-label="Source table" disabled={viewer} value={sourceId??""} onChange={e=>{void patch(card.id,"linkedSource",e.target.value?{kind:"widget",sourceWidgetId:e.target.value}:null).catch(err=>logError(`failed to save linked source: ${err}`));}}>
    <option value="">Choose source</option>
    {selectedUnavailable?<option value={sourceId}>Unavailable source</option>:null}
    {sources.map((c,i)=><option key={c.id} value={c.id}>{i+1} · {c.title??registry.find(w=>w.id===c.widgetId)?.name??c.widgetId}</option>)}
   </select></label>
   <label>Category<select aria-label="Surface category" disabled={viewer || !columns.length} value={settings.category??""} onChange={e=>save({...settings,category:e.target.value||undefined})}>
    <option value="">Choose category</option>
    {settings.category && !columns.some(c=>c.id===settings.category)?<option value={settings.category}>Unavailable: {settings.category}</option>:null}
    {columns.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
   </select></label>
   <fieldset disabled={viewer}><legend>Measures</legend>{selectable.map(c=><label key={c.id}><input type="checkbox" checked={settings.measures.includes(c.id)} disabled={!settings.measures.includes(c.id) && settings.measures.length>=64} onChange={e=>save({...settings,measures:e.target.checked?[...settings.measures,c.id]:settings.measures.filter(m=>m!==c.id)})}/>{c.label}</label>)}
    {unavailable.map(id=><label key={id}><input type="checkbox" checked aria-label={`${publication?.status==="ready"?"Unavailable":"Selected"}: ${id}`} onChange={()=>save({...settings,measures:settings.measures.filter(m=>m!==id)})}/>{publication?.status==="ready"?"Unavailable":"Selected"}: {id}</label>)}
   </fieldset>
   <button type="button" disabled={viewer} onClick={()=>{
    const category=columns.find(c=>c.chartDataType==="category")?.id??columns.find(c=>c.id.toLowerCase()==="strike")?.id??columns[0]?.id;
    const hinted=columns.filter(c=>c.chartDataType==="series" && c.dtype==="number" && c.id!==category).map(c=>c.id);
    const measures=hinted.length?hinted:columns.filter(c=>c.dtype==="number" && c.id!==category && c.chartDataType!=="excluded").map(c=>c.id);
    save({type:"surface",display:"grouped",category,measures:measures.length<=64?measures:[]});
   }}>Reset chart fields</button>
  </div>
  {publication?.stale?<p className="card-notice" role="status">Source has unrun edits or stale data.</p>:null}
  {message?<p className="empty-state" role="status">{message}</p>:result?.ok?<ChartRenderer data={result.figure} uirevision={`${sourceId}:${publication?.queryKey}:${result.revision}`}/>:null}
 </div>;
}
