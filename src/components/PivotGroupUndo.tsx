// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useEffect,useState,useSyncExternalStore} from 'react';
import {useDashboardStore,type PivotGroupUndo as UndoToken} from '../stores/dashboardStore';
import {tableExecutionStore} from '../stores/tableExecutionStore';
import {tableCommitCoordinators} from '../stores/tableCommitCoordinator';
import {useTableCommit} from '../hooks/useTableCommit';
import {cardSourceIdentity} from '../lib/cardSourceIdentity';
type Entry={id:number;undo:UndoToken;dashboardId:string;widgetId:string;tabId:string;expiresAt:number;message:string};
let entry:Entry|undefined;let nextId=0;
let release=()=>{};
const listeners=new Set<()=>void>();
const notify=()=>listeners.forEach(fn=>fn());
const clear=()=>{release();release=()=>{};entry=undefined;notify();};
/** Presentation only: durable token admission remains in the existing coordinator. */
export function presentPivotGroupUndo(undo:UndoToken,dashboardId:string,widgetId:string,message:string,expected:{sourceIdentity:string;executor:unknown;input:number;sourceRevision:string}){
 clear();const state=useDashboardStore.getState();const d=state.dashboards.find(d=>d.id===dashboardId);const tab=d?.tabs.find(t=>t.cards.some(c=>c.id===widgetId));const card=tab?.cards.find(c=>c.id===widgetId);if(!tab||!card||state.viewer)return;
 const source=cardSourceIdentity(card);const executor=tableExecutionStore.readExecutor(dashboardId,widgetId);const view=tableExecutionStore.readView(dashboardId,widgetId);const input=view.requested.input,sourceRevision=JSON.stringify(view.sourceRevision);
 if(source!==expected.sourceIdentity||executor!==expected.executor||input!==expected.input||sourceRevision!==expected.sourceRevision)return;
 entry={id:++nextId,undo,dashboardId,widgetId,tabId:tab.id,expiresAt:Date.now()+8000,message};const own=entry;
 const check=()=>{const s=useDashboardStore.getState();const c=s.dashboards.find(d=>d.id===dashboardId)?.tabs.flatMap(t=>t.cards).find(c=>c.id===widgetId);const v=tableExecutionStore.readView(dashboardId,widgetId);if(entry===own&&(s.viewer||!c||cardSourceIdentity(c)!==source||tableExecutionStore.readExecutor(dashboardId,widgetId)!==executor||v.requested.input!==input||JSON.stringify(v.sourceRevision)!==sourceRevision))clear();};
 const stops=[useDashboardStore.subscribe(check),tableExecutionStore.subscribe(check)];release=()=>stops.forEach(stop=>stop());notify();
}
const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);};
export function PivotGroupUndo(){
 const current=useSyncExternalStore(subscribe,()=>entry);const activeId=useDashboardStore(s=>s.activeId),tabId=useDashboardStore(s=>s.activeTabId),viewer=useDashboardStore(s=>s.viewer);
 return current?<UndoPresentation key={current.id} entry={current} visible={!viewer&&activeId===current.dashboardId&&tabId===current.tabId}/>:null;
}
function UndoPresentation({entry:own,visible}:{entry:Entry;visible:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false),[expired,setExpired]=useState(false);
 useEffect(()=>{const timer=setTimeout(()=>{setExpired(true);if(!busy&&!error&&!done&&entry===own)clear();},Math.max(0,own.expiresAt-Date.now()));return()=>clearTimeout(timer);},[own,busy,error,done]);
 useEffect(()=>{if(!done&&!(expired&&error&&!busy))return;const timer=setTimeout(()=>{if(entry===own)clear();},4000);return()=>clearTimeout(timer);},[own,done,expired,error,busy]);
 const undo=async()=>{if(entry!==own||Date.now()>=own.expiresAt||busy)return;setBusy(true);setError('');const coordinator=tableCommitCoordinators.get(own.dashboardId,own.widgetId);const result=await coordinator.undoPivotGroupChange(coordinator.authoringBase(),own.undo);if(entry!==own)return;setBusy(false);if(result.status==='saved'){setDone(true);release();release=()=>{};}else setError(result.message+('durableUncertain' in result&&result.durableUncertain?' Saved state is uncertain.':''));};
 if(!visible)return null;
 return <div className="pivot-group-undo" role="status" aria-live="polite"><span>{busy?'Saving Undo…':done?'Group change undone.':own.message}</span>{!done&&!expired?<UndoButton entry={own} busy={busy} run={undo}/>:null}<button type="button" disabled={busy} onClick={()=>{if(entry===own)clear();}}>Dismiss</button>{error?<span role="alert">{error}</span>:null}</div>;
}

function UndoButton({entry,busy,run}:{entry:Entry;busy:boolean;run:()=>Promise<void>}){
 const commits=useTableCommit(entry.dashboardId,entry.widgetId);
 return <button type="button" aria-label="Undo group change" disabled={busy||!commits.canReplace} onClick={()=>void run()}>Undo</button>;
}
