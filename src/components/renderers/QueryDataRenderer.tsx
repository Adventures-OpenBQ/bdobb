// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {isRecord} from '../../lib/temporal/contracts';
import {useEffect,useState,useSyncExternalStore} from 'react';
import type {DashboardCard,TableCardState} from '../../lib/types';
import {parseQueryBinding,type QueryBinding} from '../../lib/temporal/bindings';
import {parseContract,type TemporalContext} from '../../lib/temporal/contracts';
import {tableExecutionStore} from '../../stores/tableExecutionStore';
import {useDashboardStore} from '../../stores/dashboardStore';
import {QueryLibraryDialog} from '../dialogs/QueryLibraryDialog';
import {LocalTableRenderer} from './LocalTableRenderer';
import {KNOWLEDGE_BASIS_LABELS,TEMPORAL_MODE_LABELS,basisLabel} from '../../lib/temporal/labels';

/** The receipt fields the source adapter carries on the dataset's provenance. */
export type ReceiptView={executionId:string;queryId:string;queryRevision:number;resultHash:string;knowledgeBasis:string|null;context?:TemporalContext;pins:{catalog_id:string;snapshot_id:number|string}[];environmentDigest?:string;frozenAt?:string;completeness?:string;orderContract?:string;codec?:string;parameters:Record<string,unknown>};
const short=(v:string,n=12)=>v.length>n+1?`${v.slice(0,n)}…`:v;

export function receiptView(temporal:Record<string,unknown>,parameters:unknown):ReceiptView{
 const manifest=(temporal.inputManifest??{}) as {pins?:ReceiptView['pins']};
 return {executionId:String(temporal.executionId),queryId:String(temporal.queryId),queryRevision:Number(temporal.queryRevision),resultHash:String(temporal.resultHash),knowledgeBasis:temporal.knowledgeBasis==null?null:String(temporal.knowledgeBasis),context:temporal.context as TemporalContext|undefined,pins:Array.isArray(manifest.pins)?manifest.pins:[],environmentDigest:temporal.environmentDigest as string|undefined,frozenAt:temporal.frozenAt as string|undefined,completeness:temporal.completeness as string|undefined,orderContract:temporal.orderContract as string|undefined,codec:temporal.codec as string|undefined,parameters:parameters&&typeof parameters==='object'?parameters as Record<string,unknown>:{}};
}

/** Pin = a copy of this widget bound to the retained execution. The original keeps running live. */
export async function pinExecution(card:DashboardCard,executionId:string):Promise<string|null>{
 const store=useDashboardStore.getState();const id=await store.duplicateCard(card.id);if(!id)return null;
 const target=card.queryBinding?parseQueryBinding(card.queryBinding).tableExecution:undefined;
 await store.patchCardField(id,'queryBinding',{kind:'execution',executionId,...(target?{tableExecution:target}:{})});
 await store.patchCardField(id,'title',`${card.title??'Shared query'} · pinned`);
 return id;
}

function ReceiptDrawer({receipt,binding,card,onClose,readOnly}:{receipt:ReceiptView;binding:QueryBinding;card:DashboardCard;onClose:()=>void;readOnly:boolean}){
 const [note,setNote]=useState('');
 const raw=binding.kind==='query'?binding.params:{};
 const ctx=receipt.context;
 const copy=async()=>{try{await navigator.clipboard.writeText(receipt.executionId);setNote('Execution ID copied');}catch{setNote('Copy unavailable; select the ID to copy it');}};
 return <aside className="query-receipt-drawer" role="region" aria-label="Execution receipt details">
  <header className="query-receipt-drawer-head"><h3>Execution receipt</h3><button className="bd-button bd-button--ghost" aria-label="Close receipt" onClick={onClose}>Close</button></header>
  <dl className="query-receipt-fields">
   <dt>Execution</dt><dd><code className="query-receipt-id" title={receipt.executionId}>{receipt.executionId}</code></dd>
   <dt>Query</dt><dd><code title={receipt.queryId}>{short(receipt.queryId,8)}</code> · revision {receipt.queryRevision}</dd>
   <dt>Result hash</dt><dd><code title={receipt.resultHash}>{short(receipt.resultHash,16)}</code></dd>
   {receipt.frozenAt?<><dt>Frozen at</dt><dd>{receipt.frozenAt}</dd></>:null}
   <dt>Context</dt><dd>{ctx?TEMPORAL_MODE_LABELS[ctx.mode]??ctx.mode:'—'}{ctx?.known_at?` · known at ${ctx.known_at}`:''}{ctx?.effective_at?` · effective ${ctx.effective_at}`:''}{ctx?.date_range?` · ${ctx.date_range.start} – ${ctx.date_range.end}`:''} · {basisLabel(receipt.knowledgeBasis)}</dd>
   <dt>Parameters</dt><dd>{Object.keys(receipt.parameters).length?<ul className="query-receipt-params">{Object.entries(receipt.parameters).map(([k,v])=>{const typed=raw[k];const expr=typeof typed==='string'&&typed!==v?typed:null;return <li key={k}><span className="query-receipt-param-name">{k}</span> <code>{JSON.stringify(v)}</code>{expr?<span className="bd-muted"> from {expr}</span>:null}</li>;})}</ul>:'None'}</dd>
   <dt>Pinned inputs</dt><dd>{receipt.pins.length?<ul className="query-receipt-params">{receipt.pins.map(p=><li key={`${p.catalog_id}:${p.snapshot_id}`}><code>{p.catalog_id}</code> @ snapshot {String(p.snapshot_id)}</li>)}</ul>:'None'}</dd>
   {receipt.environmentDigest?<><dt>Environment</dt><dd><code title={receipt.environmentDigest}>{short(receipt.environmentDigest,16)}</code></dd></>:null}
   <dt>Result</dt><dd>{[receipt.completeness,receipt.orderContract,receipt.codec].filter(Boolean).join(' · ')}</dd>
  </dl>
  <div className="bd-actions"><button className="bd-button" onClick={()=>void copy()}>Copy execution ID</button>{binding.kind==='query'?<button className="bd-button bd-button--primary" disabled={readOnly} title="Adds a copy of this widget that always reads this exact retained execution" onClick={()=>void pinExecution(card,receipt.executionId).then(id=>setNote(id?'Pinned copy added to this tab':'Could not pin this execution'))}>Pin this execution</button>:null}</div>
  {note?<p className="bd-notice" role="status">{note}</p>:null}
 </aside>;
}

const MODES:TemporalContext['mode'][]=['current_corrected','known_at','effective_on','snapshot'];
/** A temporal context editor. The query widget applies and re-executes; the explorer only sets its draft. */
export function ContextBar({context:c,readOnly,onApply,submitLabel='Apply and run'}:{context:TemporalContext;readOnly:boolean;onApply:(context:TemporalContext)=>Promise<void>|void;submitLabel?:string}){
 const [mode,setMode]=useState(c.mode),[knownAt,setKnownAt]=useState(c.known_at??''),[basis,setBasis]=useState(c.knowledge_basis??''),[effectiveAt,setEffectiveAt]=useState(c.effective_at??''),[error,setError]=useState('');
 useEffect(()=>{setMode(c.mode);setKnownAt(c.known_at??'');setBasis(c.knowledge_basis??'');setEffectiveAt(c.effective_at??'');setError('');},[c.mode,c.known_at,c.knowledge_basis,c.effective_at]);
 const draft=():TemporalContext=>{const next:Record<string,unknown>={mode};if(basis)next.knowledge_basis=basis;if(mode==='known_at')next.known_at=knownAt.trim();if(mode==='effective_on'){if(c.date_range&&!effectiveAt.trim())next.date_range=c.date_range;else next.effective_at=effectiveAt.trim();}return parseContract('TemporalContext',next);};
 const dirty=mode!==c.mode||knownAt!==(c.known_at??'')||basis!==(c.knowledge_basis??'')||effectiveAt!==(c.effective_at??'');
 return <form className="query-context-bar" aria-label="Temporal context" onSubmit={e=>{e.preventDefault();setError('');let next:TemporalContext;try{next=draft();}catch{setError(mode==='known_at'?'Known at needs a date or ISO timestamp and a knowledge basis.':mode==='effective_on'?'Effective on needs a date or ISO timestamp.':'Invalid temporal context.');return;}void onApply(next);}}>
  <label>Mode<select className="bd-input" aria-label="Temporal mode" disabled={readOnly} value={mode} onChange={e=>setMode(e.target.value as TemporalContext['mode'])}>{MODES.map(m=><option key={m} value={m}>{TEMPORAL_MODE_LABELS[m]}</option>)}</select></label>
  {mode==='known_at'?<label>Known at<input className="bd-input" aria-label="Known at" placeholder="2026-10-15 or 2026-10-15T16:00:00-04:00" disabled={readOnly} value={knownAt} onChange={e=>setKnownAt(e.target.value)}/></label>:null}
  {mode==='effective_on'?<label>Effective at<input className="bd-input" aria-label="Effective at" placeholder={c.date_range?`${c.date_range.start} – ${c.date_range.end}`:'2026-10-15'} disabled={readOnly} value={effectiveAt} onChange={e=>setEffectiveAt(e.target.value)}/></label>:null}
  <label>Basis<select className="bd-input" aria-label="Knowledge basis" disabled={readOnly} value={basis} onChange={e=>setBasis(e.target.value)}><option value="">Unspecified</option>{Object.entries(KNOWLEDGE_BASIS_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
  <button className="bd-button" type="submit" disabled={readOnly||!dirty}>{submitLabel}</button>
  {error?<span className="query-context-error" role="alert">{error}</span>:null}
 </form>;
}

export function QueryDataRenderer({dashboardId,card,filterRow,onStateChange,readOnly=false}:{dashboardId:string;card:DashboardCard;filterRow:boolean;onStateChange?:(state:Partial<TableCardState>)=>void;readOnly?:boolean}){
 const [library,setLibrary]=useState(false),[drawer,setDrawer]=useState(false);const view=useSyncExternalStore(tableExecutionStore.subscribe,()=>tableExecutionStore.readView(dashboardId,card.id));
 let error:string|undefined;try{if(card.queryBinding)parseQueryBinding(card.queryBinding);}catch(e){error=e instanceof Error?e.message:'Invalid query binding';}
 useEffect(()=>{if(card.queryBinding&&!error)tableExecutionStore.ensureTable(dashboardId,card.id);},[dashboardId,card.id,card.queryBinding,error]);
 const ref=view.ready?.completeness;
 const [receipt,setReceipt]=useState<ReceiptView>();
 const ready=!!view.ready;
 useEffect(()=>{let active=true;setReceipt(undefined);if(view.active&&ready){const attested=tableExecutionStore.readTemporalSourceReceipt?.(dashboardId,card.id);if(isRecord(attested)){setReceipt(receiptView(attested,attested.parameters));return()=>{active=false;};}const executor=tableExecutionStore.readExecutor(dashboardId,card.id);if(executor)void executor.chartData(view.active,[],new AbortController().signal).then(data=>{const r=data.provenance.receipt?.temporal;if(active&&r)setReceipt(receiptView(r as Record<string,unknown>,data.provenance.parameters));}).catch(()=>{});}return()=>{active=false;};},[dashboardId,card.id,view.active,ready]);
 const paging=tableExecutionStore.readTemporalPaging?.(dashboardId,card.id);
 const pagingBusy=!!paging?.busy||view.status==='pending'||view.status==='updating';
 const binding=card.queryBinding;const pinned=binding?.kind==='execution';
 const bindingLabel=!binding?'':binding.kind==='execution'?'Pinned execution':binding.revisionPolicy==='latest'?'Following latest (opt in)':`Fixed revision ${binding.revision}`;
 const rows=ref?.acquiredRowCount??0;
 const ctx=receipt?.context;
 return <div className="query-data-renderer">
  <div className="query-data-bar">
   {binding&&!error?<div className="query-receipt" role="status" aria-label="Execution receipt">{view.stale?<span className="bd-badge query-receipt-stale">Stale result</span>:null}<span className="bd-badge">{bindingLabel}</span>{receipt?<><span className="bd-badge">Resolved revision {receipt.queryRevision}</span>{pinned&&ctx?<span className="bd-badge">{TEMPORAL_MODE_LABELS[ctx.mode]??ctx.mode}{ctx.known_at?` ${ctx.known_at}`:''}</span>:null}<span className="bd-badge">{basisLabel(receipt.knowledgeBasis)}</span></>:null}{ref?<span className={`bd-badge${ref.kind==='complete'?'':' query-receipt-partial'}`}>{ref.kind} · {rows} {card.queryBinding?.tableExecution?'source':'loaded'} {rows===1?'row':'rows'}</span>:null}{receipt?<button type="button" className="bd-badge query-receipt-toggle" aria-expanded={drawer} aria-controls={`query-receipt-${card.id}`} onClick={()=>setDrawer(d=>!d)}>Receipt {short(receipt.executionId,8)}</button>:null}</div>:<span className="bd-muted">No shared query bound</span>}
   <div className="bd-actions"><button className="bd-button" disabled={readOnly} onClick={()=>setLibrary(true)}>Open query library</button>{binding?<button className="bd-button" title={pinned?'Reads the same retained execution again':'Starts a new execution'} onClick={()=>tableExecutionStore.refresh(dashboardId,card.id)}>{pinned?'Reload execution':'Refresh query'}</button>:null}</div>
  </div>
  {paging?<div className="query-data-bar" role="group" aria-label="Temporal result paging"><span role="status" aria-label="Temporal result page">Page {paging.pageNumber} · rows {paging.loadedRows?paging.offset+1:0}–{paging.offset+paging.loadedRows} of {paging.countQuality==='lower_bound'?'at least ':''}{paging.totalCount}{pagingBusy?' · loading':''}{view.stale?' · previous result shown':''}</span><div className="bd-actions"><button className="bd-button" aria-label="Previous result page" disabled={pagingBusy||!paging.hasPrevious} onClick={()=>void tableExecutionStore.previousTemporalPage(dashboardId,card.id)}>Previous</button><button className="bd-button" aria-label="Next result page" disabled={pagingBusy||!paging.hasNext} onClick={()=>void tableExecutionStore.nextTemporalPage(dashboardId,card.id)}>Next</button></div>{paging.error?<span className="bd-notice bd-notice--error" role="alert">{paging.error}</span>:null}</div>:null}
  {binding?.kind==='query'&&!error?<ContextBar context={binding.context} readOnly={readOnly} onApply={context=>useDashboardStore.getState().patchCardField(card.id,'queryBinding',{...binding,context})}/>:null}
  {drawer&&receipt&&binding?<div id={`query-receipt-${card.id}`}><ReceiptDrawer receipt={receipt} binding={binding} card={card} readOnly={readOnly} onClose={()=>setDrawer(false)}/></div>:null}
  {error?<p className="bd-notice bd-notice--error" role="alert">{error}</p>:null}
  {binding&&!error?<LocalTableRenderer executionIdentity={{dashboardId,widgetId:card.id}} file="" label={card.title??'Shared query'} refreshKey={0} state={card.table} onStateChange={onStateChange} filterRow={filterRow}/>:null}
  {library?<QueryLibraryDialog backendId={card.backendId} readOnly={readOnly} currentTable={{definition:card.tableDefinition,queryId:binding?.kind==='query'?binding.queryId:undefined}} onClose={()=>setLibrary(false)} onBind={(next,layout)=>useDashboardStore.getState().bindQueryCard(card.id,next,layout)}/>:null}
 </div>;
}
