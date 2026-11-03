// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {useEffect,useMemo,useRef,useState} from 'react';
import {parseQueryBinding,type QueryBinding} from '../../lib/temporal/bindings';
import type {DatasetDescription,Tier} from '../../lib/temporal/catalog';
import {temporalErrorText,type TemporalClient} from '../../lib/temporal/client';
import type {ParameterSpec} from '../../lib/temporal/contracts';
import {buildDefinition,columnSpecs,draftValues,profileColumns,requestFields,type ExplorerColumnProfile,type ExplorerDraft,type ExplorerParam} from '../../lib/temporal/explorer';
import {createTemporalSourceAdapter} from '../../lib/temporal/sourceAdapter';
import {useSharedQueryLibraryStore} from '../../stores/sharedQueryLibraryStore';
import {ParamField} from '../dialogs/QueryLibraryDialog';
import {ContextBar} from '../renderers/QueryDataRenderer';

type Preview={rows:Record<string,unknown>[];columns:string[];executionId:string;revision:number;completeness:string;loaded:number;total?:number};
const TYPES:ParameterSpec['type'][]=['string','integer','number','boolean','date','timestamp','uuid'];
const spec=(p:ExplorerParam):ParameterSpec=>({name:p.name,type:p.type,required:false,nullable:false});
const fieldValue=(p:ExplorerParam)=>p.type==='boolean'?p.value==='true':p.value;
/**
 * Dataset and SQL modes producing one QueryDefinition. Save, Run and Open write; read-only disables them.
 * After an await, onDraft takes an updater so edits typed while the request was in flight survive.
 * A successful Run hands its first page's column profile to onProfile, for the inspector.
 */
export function TemporalQueryBuilder({client,datasetId,tier,description,draft,onDraft,readOnly,onOpenWidget,onProfile}:{client:TemporalClient;datasetId:string;tier:Tier;description?:DatasetDescription;draft:ExplorerDraft;onDraft:(next:ExplorerDraft|((d:ExplorerDraft)=>ExplorerDraft))=>void;readOnly:boolean;onOpenWidget:(binding:QueryBinding)=>Promise<void>;onProfile?:(profile:ExplorerColumnProfile|undefined)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[preview,setPreview]=useState<Preview>(),[latest,setLatest]=useState(false),[uncheckable,setUncheckable]=useState(false);
 const built=useMemo(()=>buildDefinition(draft,datasetId),[draft,datasetId]);
 const fields=description&&description.dataset_id===datasetId?requestFields(description):undefined;
 const observed=description?.observed_schema,observedSpecs=observed?columnSpecs(observed):[];
 // Dataset mode takes the described dataset's request fields, keeping values typed under the same names.
 useEffect(()=>{
  if(draft.mode!=='dataset'||fields===undefined)return;
  const next=(fields??[]).map(f=>({...f,value:draft.params.find(p=>p.name===f.name)?.value??''}));
  if(JSON.stringify(next)!==JSON.stringify(draft.params))onDraft({...draft,params:next});
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-derive only when the description or mode changes
 },[description,datasetId,draft.mode]);
 // A Run answers the selection and mode it started under; a change since drops its preview and profile.
 const runScope=useRef(0);
 useEffect(()=>{runScope.current++;setPreview(undefined);},[datasetId,tier,draft.mode]);
 const act=async(work:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await work();}catch(e){setError(temporalErrorText(e));}finally{setBusy(false);}};
 const definition=()=>{if(!built.ok)throw new Error(built.error);return built.definition;};
 const binding=(policy:'fixed'|'latest'):QueryBinding=>{const typed=draftValues(draft);if(!typed.ok)throw new Error(typed.error);return parseQueryBinding({kind:'query',queryId:draft.queryId,revisionPolicy:policy,...(policy==='fixed'?{revision:draft.revision}:{}),params:typed.values,context:draft.context});};
 const setParam=(i:number,patch:Partial<ExplorerParam>)=>onDraft({...draft,params:draft.params.map((p,j)=>j===i?{...p,...patch}:p)});
 const saved=!!draft.queryId&&!!draft.revision;
 const run=()=>act(async()=>{
  const scope=runScope.current;
  const result=await createTemporalSourceAdapter(client,binding('fixed')).acquire(new AbortController().signal);
  if(scope!==runScope.current)return;
  if(result.kind!=='dataset')throw new Error('Unexpected TemporalDB result');
  const {dataset}=result;const receipt=(dataset.provenance.receipt?.temporal??{}) as {executionId?:string;queryRevision?:number;completeness?:string};
  const columns=dataset.columns.map(c=>({name:c.id,type:String(c.metadata?.arrowType),nullable:c.metadata?.nullable===true}));
  onProfile?.(profileColumns(columns,dataset.rows.map(r=>r.values as Record<string,unknown>),receipt.completeness??'unknown'));
  setPreview({rows:dataset.rows.slice(0,20).map(r=>r.values as Record<string,unknown>),columns:dataset.columns.map(c=>c.id),executionId:String(receipt.executionId),revision:Number(receipt.queryRevision),completeness:dataset.completeness.kind,loaded:dataset.completeness.acquiredRowCount??dataset.rows.length,total:dataset.completeness.totalRowCount});
  // SQL's schema expectation comes from a successful Run; [] means a result type TemporalDB cannot check, so say so instead of setting it.
  if(draft.mode==='sql'&&!draft.columns.length){const specs=columnSpecs(columns);setUncheckable(!specs.length);if(specs.length)onDraft(d=>d.mode==='sql'&&!d.columns.length?{...d,columns:specs}:d);}
 });
 return <div className="bd-temporal-builder">
  <div role="radiogroup" aria-label="Builder mode" className="bd-temporal-row">{(['dataset','sql'] as const).map(m=><label key={m}><input type="radio" name="bd-temporal-mode" checked={draft.mode===m} onChange={()=>{setUncheckable(false);onDraft({...draft,mode:m,params:[],columns:[]});}}/>{m==='dataset'?'Dataset':'SQL'}</label>)}</div>
  <label>Title<input className="bd-input" aria-label="Query title" maxLength={256} value={draft.title} onChange={e=>onDraft({...draft,title:e.target.value})}/></label>
  <label>Description<input className="bd-input" aria-label="Query description" maxLength={2000} value={draft.description} onChange={e=>onDraft({...draft,description:e.target.value})}/></label>
  {draft.mode==='dataset'?<>
   <p className="bd-muted">{datasetId?<><code>{datasetId}</code> · {tier}</>:'Choose a dataset in the catalog.'}</p>
   {fields===null?<p className="bd-notice" role="status">This dataset publishes no request fields; use SQL mode to filter it.</p>:null}
   {draft.params.length?<div className="bd-query-params" role="group" aria-label="Request fields">{draft.params.map((p,i)=><ParamField key={p.name} spec={spec(p)} value={fieldValue(p)} onChange={v=>setParam(i,{value:String(v)})}/>)}</div>:null}
   <label><input type="checkbox" disabled={!observedSpecs.length} checked={draft.columns.length>0} onChange={e=>onDraft({...draft,columns:e.target.checked?observedSpecs:[]})}/>Expect the observed schema{!observed?' (none observed yet)':observedSpecs.length?` (${observedSpecs.length} columns)`:' (types TemporalDB cannot check)'}</label>
  </>:<>
   <fieldset><legend>Sources</legend>{Object.keys(draft.sources).length?Object.entries(draft.sources).map(([alias,id])=><div key={alias} className="bd-temporal-row">
    <input className="bd-input" aria-label={`Alias for ${id}`} defaultValue={alias} onBlur={e=>{const next=e.target.value.trim();if(!next||next===alias||Object.hasOwn(draft.sources,next))return;onDraft({...draft,sources:Object.fromEntries(Object.entries(draft.sources).map(([a,v])=>a===alias?[next,v]:[a,v]))});}}/>
    <code>{id}</code><button type="button" className="bd-button bd-button--ghost" aria-label={`Remove ${alias}`} onClick={()=>onDraft({...draft,sources:Object.fromEntries(Object.entries(draft.sources).filter(([a])=>a!==alias))})}>Remove</button>
   </div>):<p className="bd-muted">Add sources from the catalog.</p>}</fieldset>
   <label>SQL<textarea className="bd-input bd-temporal-sql" aria-label="SQL" rows={8} spellCheck={false} value={draft.sql} onChange={e=>onDraft({...draft,sql:e.target.value})}/></label>
   <p className="bd-muted">Aliases: {Object.keys(draft.sources).join(', ')||'none'} · parameters are written <code>$name</code></p>
   <fieldset><legend>Parameters</legend>{draft.params.map((p,i)=><div key={i} className="bd-temporal-row">
    <input className="bd-input" aria-label={`Parameter ${i+1} name`} value={p.name} onChange={e=>setParam(i,{name:e.target.value})}/>
    <select className="bd-input" aria-label={`Parameter ${i+1} type`} value={p.type} onChange={e=>setParam(i,{type:e.target.value as ParameterSpec['type'],value:''})}>{TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select>
    {p.name?<ParamField spec={spec(p)} value={fieldValue(p)} onChange={v=>setParam(i,{value:String(v)})}/>:null}
    <button type="button" className="bd-button bd-button--ghost" aria-label={`Remove parameter ${i+1}`} onClick={()=>onDraft({...draft,params:draft.params.filter((_,j)=>j!==i)})}>Remove</button>
   </div>)}<button type="button" className="bd-button" onClick={()=>onDraft({...draft,params:[...draft.params,{name:'',type:'string',value:''}]})}>Add parameter</button></fieldset>
   <div className="bd-temporal-row"><label>Max rows<input className="bd-input" type="number" aria-label="Max rows" min={1} max={10000} value={draft.maxRows} onChange={e=>onDraft({...draft,maxRows:Number(e.target.value)})}/></label><label>Timeout (seconds)<input className="bd-input" type="number" aria-label="Timeout seconds" min={1} max={30} value={draft.timeoutSeconds} onChange={e=>onDraft({...draft,timeoutSeconds:Number(e.target.value)})}/></label></div>
   <p className="bd-muted">Schema expectation: {draft.columns.length?draft.columns.map(c=>`${c.name} ${c.type}`).join(', '):uncheckable?'none: the result has types TemporalDB cannot check':'taken from the first successful Run'}{draft.columns.length?<> · <button type="button" className="bd-button bd-button--ghost" onClick={()=>onDraft({...draft,columns:[]})}>Clear</button></>:null}</p>
  </>}
  <ContextBar context={draft.context} readOnly={readOnly} submitLabel="Apply context" onApply={context=>onDraft({...draft,context})}/>
  <pre className="bd-temporal-json" aria-label="Generated definition">{built.ok?JSON.stringify(built.definition,null,2):built.error}</pre>
  <div className="bd-actions">
   <button type="button" className="bd-button" disabled={busy} onClick={()=>void act(async()=>{await client.validate(definition());setNotice('Valid. TemporalDB accepted this definition; nothing was saved or run.');})}>Validate</button>
   <button type="button" className="bd-button bd-button--primary" disabled={busy||readOnly} onClick={()=>void act(async()=>{const q=await useSharedQueryLibraryStore.getState().save(client,definition(),saved?draft.revision:undefined);onDraft(d=>({...d,queryId:q.query_id,revision:q.revision}));setNotice(`Saved ${q.title} as revision ${q.revision}.`);})}>Save to library</button>
   <button type="button" className="bd-button" disabled={busy||readOnly||!saved} title={saved?undefined:'Save first: Run executes the saved revision'} onClick={()=>void run()}>Run</button>
   <label><input type="checkbox" checked={latest} onChange={e=>setLatest(e.target.checked)}/>Follow latest revision</label>
   <button type="button" className="bd-button" disabled={busy||readOnly||!saved} onClick={()=>void act(async()=>{await onOpenWidget(binding(latest?'latest':'fixed'));setNotice('Query widget added to this tab.');})}>Open as query widget</button>
  </div>
  {error?<p className="bd-notice bd-notice--error" role="alert">{error}</p>:null}{notice?<p className="bd-notice" role="status">{notice}</p>:null}
  {preview?<section aria-label="Run preview" className="bd-temporal-pane">
   <div className="query-receipt" role="status" aria-label="Execution receipt"><span className="bd-badge">Revision {preview.revision}</span><span className={`bd-badge${preview.completeness==='complete'?'':' query-receipt-partial'}`}>{preview.completeness} · {preview.loaded} loaded {preview.loaded===1?'row':'rows'}{preview.total!==undefined?` of ${preview.total}`:''}</span><span className="bd-badge" title={preview.executionId}>Receipt {preview.executionId.slice(0,8)}</span></div>
   <p className="bd-muted">Column profile of this page is in the inspector.</p>
   <div className="bd-temporal-table"><table><thead><tr>{preview.columns.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{preview.rows.map((r,i)=><tr key={i}>{preview.columns.map(c=><td key={c}>{r[c]==null?'':String(r[c])}</td>)}</tr>)}</tbody></table></div>
  </section>:null}
 </div>;
}
