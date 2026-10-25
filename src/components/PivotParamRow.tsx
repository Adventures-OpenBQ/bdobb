import {PivotGroupLink} from './PivotGroupLink';
import {GroupInspectionButton} from './LinkedGroupInspector';
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { memberLabel, paramRow, setFilterKeys, setPageKeys, type PivotParamView } from '../lib/tableModel/pivotParams';
import {categoryAuthoringRecipe} from '../lib/tableModel/categoryAuthoringRecipe';
import { validateTableModel } from '../lib/tableModel/validation';
import type { FacetResult, Revision } from '../lib/tableExecution/types';
import type { ModelEdit } from '../stores/tableCommitCoordinator';
import { useDashboardStore } from '../stores/dashboardStore';
import { activeRuntimeKeys } from '../lib/tableExecution/runtimeParams';
import { tableExecutionStore } from '../stores/tableExecutionStore';
import { useTableCommit } from '../hooks/useTableCommit';
import { useTableMetadata } from '../hooks/useTableMetadata';

type Props = {param:PivotParamView;members?:FacetResult['members'];readonly:boolean;pending?:boolean;error?:string;onEditModel:(edit:ModelEdit)=>Promise<boolean>;onPublish?:(keys:string[]|null)=>Promise<boolean>;onReset?:()=>Promise<boolean>;session?:boolean;groupBaseline?:string;groupSummary?:string;groupDisplay?:{summary:string;state:string}};
export function PivotParamControl({param,members,readonly,pending,error,onEditModel,onPublish,onReset,session,groupBaseline,groupSummary,groupDisplay}:Props) {
 const id=useId();const trigger=useRef<HTMLButtonElement>(null);const popup=useRef<HTMLDivElement>(null);
 const [open,setOpen]=useState(false);const [newSelection,setNewSelection]=useState(false);const [draft,setDraft]=useState<string[]>([]);const [failure,setFailure]=useState('');
 const draftVersion=useRef(0);const submission=useRef(0);const openedVersion=useRef(0);const openedAll=useRef(false);
 const changeDraft=(next:string[])=>{draftVersion.current++;setDraft(next);};
 const [position,setPosition]=useState({left:0,top:0});
 const memberKeys=new Set(members?.map(m=>m.key));const labelCounts=new Map<string,number>();for(const m of members??[]){const label=m.label||'(Blank)';labelCounts.set(label,(labelCounts.get(label)??0)+1);}
 const keys=param.memberKeys;const text=keys===null?'All':keys.length?keys.map(memberLabel).join(', '):'None';
 const setMode=param.source==='page'||param.multiSelect;
 const multi=!!groupBaseline||setMode||(keys?.length??0)>1;
 const disabled=readonly||pending||!members;
 const close=()=>{setOpen(false);trigger.current?.focus();};
 useEffect(()=>{
  if(!open)return;
  const outside=(e:PointerEvent)=>{if(!popup.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))setOpen(false);};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);trigger.current?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true);
  popup.current?.querySelector<HTMLElement>('button,input')?.focus();
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);};
 },[open]);
 useEffect(()=>{if(readonly)setOpen(false);},[readonly]);
 const publish=async(value:string[]|null)=>{
  const version=draftVersion.current;const attempt=++submission.current;
  let saved=false;try {saved=onPublish?await onPublish(value):await onEditModel({apply:current=>param.source==='page'?(current.params.promotePage&&current.layout.page?.categoryId===param.categoryId?value===null?(()=>{const layout={...current.layout};delete layout.page;return {...current,layout};})():setPageKeys(current,param.categoryId,value):current):setFilterKeys(current,param.categoryId,value),replaceKey:`param-value:${param.key}`});}catch(error){if(attempt===submission.current)setFailure(error instanceof Error?error.message:'Could not change parameter.');return;}
  if(attempt!==submission.current)return;
  if(saved){setFailure('');if(version===draftVersion.current)close();}else setFailure('Could not save parameter. Your selection has been retained.');
 };
 const reset=async()=>{const attempt=++submission.current;try{if(await onReset?.()){if(attempt===submission.current){setFailure('');close();}}else if(attempt===submission.current)setFailure('Could not reset parameter. Your selection has been retained.');}catch(error){if(attempt===submission.current)setFailure(error instanceof Error?error.message:'Could not reset parameter.');}};
 const options=[...((param.source==='filter'||onPublish)?[{label:'All',keys:null},{label:'None',keys:[]}]:[]),...(members??[]).map(m=>({label:m.label||'(Blank)',keys:[m.key]})),...(keys??[]).filter(k=>!memberKeys.has(k)).map(k=>({label:`${memberLabel(k)} (unavailable)`,keys:[k]}))];
 const value=options.findIndex(o=>JSON.stringify(o.keys)===JSON.stringify(keys));
 return <div className="param-field" data-pivot-param={param.key}>
  <span className="param-label" title={param.label}>{param.label}</span><span className="param-source">{param.source==='page'?'page':'filter'}</span>
  {groupBaseline&&!onPublish?<span className={`param-multi${groupDisplay?' param-linked':''}`} title={groupBaseline}>{groupDisplay?<><span className="param-linked-value">{groupDisplay.summary}</span><span className="param-linked-state">{groupDisplay.state}</span><span className="param-linked-disclosure" aria-hidden="true">▾</span></>:groupSummary}</span>:multi?<button ref={trigger} type="button" className={`param-multi${groupDisplay?' param-linked':''}`} aria-label={groupBaseline?`${param.label} linked baseline: ${groupSummary}`:`${param.label}: ${text}`} title={groupBaseline??text} aria-expanded={open} disabled={groupBaseline?readonly||pending:disabled} onClick={()=>{
   const r=trigger.current!.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(r.left,window.innerWidth-256)),top:Math.max(8,Math.min(r.bottom+4,window.innerHeight-328))});setNewSelection(false);changeDraft(groupBaseline?[]:keys??members!.map(m=>m.key));openedVersion.current=draftVersion.current;openedAll.current=keys===null;setOpen(!open);
  }}>{groupBaseline&&groupDisplay?<><span className="param-linked-value">{groupDisplay.summary}</span><span className="param-linked-state">{groupDisplay.state}</span><span className="param-linked-disclosure" aria-hidden="true">▾</span></>:groupBaseline?groupSummary:text}</button>:<select id={id} aria-label={param.label} disabled={disabled} value={value<0?'':String(value)} onChange={e=>void publish(options[Number(e.target.value)].keys)}>
   {value<0?<option value="">{text}</option>:null}{options.map((o,i)=><option key={i} value={i}>{o.label}</option>)}
  </select>}
  {onPublish&&!groupBaseline&&!members&&!readonly&&!pending?<button type="button" className="param-reset" onClick={()=>void publish(null)}>Use All {param.label} values</button>:null}
  {session&&onReset?<button type="button" className="param-reset" aria-label={`Reset ${param.label} session value`} disabled={readonly} onClick={()=>void reset()}>Reset</button>:null}
  {error||failure?<span role="alert">{failure||error}</span>:null}
  {open?createPortal(<div ref={popup} className="param-pop" role="dialog" aria-label={`${param.label} values`} style={position}>
   <div className="row"><strong>{param.label}</strong><button type="button" aria-label="Close parameter values" onClick={close}>×</button></div>
   {!groupBaseline?<div className="row"><button type="button" disabled={disabled} onClick={()=>void publish(null)}>All</button><button type="button" disabled={disabled} onClick={()=>void publish([])}>{param.source==='page'?'None':'Clear'}</button></div>:null}
   {groupBaseline?<><p className="pivot-group-summary" title={groupBaseline}>Linked baseline · {groupSummary}</p><div className="row param-session-actions"><button type="button" disabled={readonly||pending} onClick={()=>void publish(null)} aria-label={`Use All ${param.label} values`}>All</button><button type="button" disabled={readonly||pending} onClick={()=>void publish([])} aria-label={`Use None ${param.label} values`}>None</button><button type="button" disabled={disabled} onClick={()=>{changeDraft([]);openedVersion.current=draftVersion.current;setNewSelection(true);}} aria-label={`Choose new ${param.label} session values`}>New selection</button></div><p>Changes apply only to this viewer session. New selections do not preselect linked baseline values.</p></>:null}
   {!groupBaseline||newSelection?<div className="opts">{[...(members??[]),...(keys??[]).filter(k=>!memberKeys.has(k)).map(key=>({key,label:`${memberLabel(key)} (unavailable)`}))].map(m=><label key={m.key} title={m.key}><input type={setMode?'checkbox':'radio'} name={id} disabled={disabled} checked={setMode&&draft.includes(m.key)} onChange={e=>{
    if(!setMode){changeDraft([m.key]);void publish([m.key]);}else changeDraft(e.target.checked?[...draft,m.key]:draft.filter(k=>k!==m.key));
   }}/>{m.label||'(Blank)'}{(labelCounts.get(m.label||'(Blank)')??0)>1?` · ${'value' in m?m.value===null?'blank':typeof m.value:'unavailable'}`:''}</label>)}</div>:null}
   {setMode&&(!groupBaseline||newSelection)?<button type="button" disabled={disabled||(!!groupBaseline&&openedVersion.current===draftVersion.current)} onClick={()=>void publish(openedAll.current&&openedVersion.current===draftVersion.current?null:draft)}>Apply</button>:null}{failure?<p role="alert">{failure}</p>:null}
  </div>,document.body):null}
 </div>;
}
function ParamField({dashboardId,widgetId,revision,param,readonly,onEditModel,onPublish,onReset,session,executionPending,groupBaseline,groupSummary,groupDisplay}:{dashboardId:string;widgetId:string;revision?:Revision;param:PivotParamView;readonly:boolean;onEditModel:Props['onEditModel'];onPublish?:Props['onPublish'];onReset?:Props['onReset'];session?:boolean;executionPending?:boolean;groupBaseline?:string;groupSummary?:string;groupDisplay?:{summary:string;state:string}}) {
 const metadata=useTableMetadata(dashboardId,widgetId,revision);
 const {requestFacet}=metadata;
 useEffect(()=>{requestFacet(param.categoryId);},[requestFacet,param.categoryId]);
 return <><PivotParamControl param={param} members={metadata.facet?.categoryId===param.categoryId?metadata.facet.members:undefined} pending={executionPending||metadata.pending} error={metadata.error} readonly={readonly} onEditModel={onEditModel} onPublish={onPublish} onReset={onReset} session={session} groupBaseline={groupBaseline} groupSummary={groupSummary} groupDisplay={groupDisplay}/><PivotGroupLink dashboardId={dashboardId} widgetId={widgetId} param={param} members={metadata.facet?.categoryId===param.categoryId?metadata.facet.members:undefined}/><GroupInspectionButton dashboardId={dashboardId} widgetId={widgetId} paramKey={param.key}/>{metadata.error?<button type="button" onClick={()=>requestFacet(param.categoryId)}>Retry {param.label} values</button>:null}</>;
}
/** Header subscribes; RuntimeTable remains the sole coordinator owner. */
export function PivotParamRow({dashboardId,widgetId,raw,viewer:viewerHint,ordinary}:{dashboardId:string;widgetId:string;raw:unknown;viewer:boolean;ordinary?:ReactNode}) {
 const view=useSyncExternalStore(tableExecutionStore.subscribe,()=>tableExecutionStore.readView(dashboardId,widgetId));
 const runtime=useSyncExternalStore(tableExecutionStore.subscribe,()=>tableExecutionStore.readRuntimeParams(dashboardId,widgetId));
 const candidates=useSyncExternalStore(tableExecutionStore.subscribe,()=>tableExecutionStore.readGroupCandidates(dashboardId,widgetId));
 const dashboard=useDashboardStore(s=>s.dashboards.find(d=>d.id===dashboardId));
 const viewer=useDashboardStore(s=>s.viewer);
 void viewerHint; // Presentation hints cannot grant authority.
 const commits=useTableCommit(dashboardId,widgetId);
 const model=validateTableModel(view.definition.analytical??raw).model;
 const params=model?paramRow(model):[];
 const identity=(m:typeof model,p:PivotParamView)=>{return JSON.stringify([dashboardId,widgetId,p.key,p.categoryId,p.source==='filter'?m?.params.filters.find(f=>f.categoryId===p.categoryId)?.id:m?.params.promotePage,m?categoryAuthoringRecipe(m,p.categoryId):undefined]);};
 const sourceIdentity=()=>{const card=useDashboardStore.getState().dashboards.find(d=>d.id===dashboardId)?.tabs.flatMap(t=>t.cards).find(c=>c.id===widgetId);return JSON.stringify(card&&[card.widgetId,card.backendId,card.params,card.linkedSource]);};
 const source=sourceIdentity();
 const field=(param:PivotParamView)=>{
  const token=identity(model,param);const entry=runtime[param.key];const active=!!model&&activeRuntimeKeys(model).has(param.key);
  const current=()=>{const latest=validateTableModel(tableExecutionStore.readView(dashboardId,widgetId).definition.analytical).model;const p=latest&&paramRow(latest).find(p=>p.key===param.key);if(baseline&&JSON.stringify(tableExecutionStore.readGroupCandidates(dashboardId,widgetId).find(c=>c.key===param.key)?.entry)!==JSON.stringify(candidate?.entry))throw new Error('Parameter context changed; reopen the control.');if(useDashboardStore.getState().viewer!==viewer||sourceIdentity()!==source||!p||identity(latest,p)!==token)throw new Error('Parameter context changed; reopen the control.');return latest!;};
  const publish=viewer?async(keys:string[]|null)=>{current();tableExecutionStore.setViewerParam(dashboardId,widgetId,param.key,keys);return true;}:undefined;
  const reset=viewer?async()=>{current();tableExecutionStore.resetViewerParams(dashboardId,widgetId,param.key);return true;}:undefined;
  const edit=async(edit:ModelEdit)=>{current();return commits.editModel(edit);};
  const candidate=candidates.find(c=>c.key===param.key);
  const match=view.ready?.inspection.paramMatches?.find(m=>m.key===param.key&&m.source==='group'&&m.groupId===candidate?.entry.groupId);
  const group=dashboard?.groups?.find(g=>g.id===candidate?.entry.groupId);
  const baseline=candidate&&!(viewer&&entry?.source==='viewer')?`Linked baseline · ${group?.name??candidate.entry.groupId} · ${candidate.entry.transportValue} · ${view.stale?'pending':match?`${match.matchedCount} matched · ${match.status==='refused'?'refused · authored selection retained':match.status??'resolved'}`:'status unavailable'}`:undefined;
  const summary=candidate?`${candidate.entry.transportValue.slice(0,64)||'Empty'}${candidate.entry.transportValue.length>64?'…':''} · ${view.stale?'pending':match?`${match.matchedCount} matched · ${match.status??'resolved'}${match.matched.length?` · ${match.matched.join(', ')}${match.matchedCount>match.matched.length?' (preview)':''}`:''}`:'status unavailable'}`:undefined;
  const displayed=viewer&&entry?.source==='viewer'?{...param,memberKeys:entry.memberKeys}:param;
  const groupDisplay=candidate&&baseline?{summary:!view.stale&&match?.matched.length?`${match.matched.join(', ')}${match.matchedCount>match.matched.length?' …':''}`:candidate.entry.transportValue.slice(0,64)||'Empty',state:view.stale?'pending':match?`${match.matchedCount} matched · ${match.status??'resolved'}`:'status unavailable'}:undefined;
  return <ParamField key={JSON.stringify([token,source,viewer,baseline?candidate?.entry:undefined])} dashboardId={dashboardId} widgetId={widgetId} revision={view.active} param={displayed} readonly={viewer?!active:!commits.canEnqueue} onEditModel={edit} onPublish={publish} onReset={reset} session={viewer&&entry?.source==='viewer'} groupBaseline={baseline} groupSummary={summary} groupDisplay={groupDisplay} executionPending={view.stale||!view.active}/>;
 };
 if(!params.length&&!ordinary)return null;
 return <div className="card-params">{params.filter(p=>p.source==='page').map(field)}{ordinary}{params.filter(p=>p.source==='filter').map(field)}{viewer&&params.length?<span className="param-readonly">Changes apply only to this viewer session.</span>:null}{commits.error?<span role="alert">{commits.error}</span>:null}</div>;
}
