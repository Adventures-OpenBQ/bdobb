// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {Fragment,useEffect,useRef,useState} from 'react';
import type {Coverage,DatasetDescription,Tier} from '../../lib/temporal/catalog';
import {temporalErrorText,type TemporalClient} from '../../lib/temporal/client';
import type {ResultColumn} from '../../lib/temporal/contracts';
import type {ExplorerColumnProfile} from '../../lib/temporal/explorer';
import {basisLabel} from '../../lib/temporal/labels';

const paramSummary=(p:Record<string,unknown>)=>Array.isArray(p.names)?p.names.join(', '):p.status==='CAPABILITY_UNAVAILABLE'?'Unavailable for this dataset':Object.keys(p).join(', ');
const knowledge=(c:Record<string,unknown>)=>Array.isArray(c.knowledge_bases)&&c.knowledge_bases.length?c.knowledge_bases.map(k=>basisLabel(String(k))).join(', '):'None registered';
const count=(n:number)=>n.toLocaleString('en-US');
const NA='—';
/** The Run preview's column profile, or the observed columns and a note before a Run. Never a zero for an unprofiled column. */
function ColumnProfile({observed,profile}:{observed:ResultColumn[]|null|undefined;profile?:ExplorerColumnProfile}){
 const [selected,setSelected]=useState('');
 const fields=profile?.fields??[],current=fields.some(f=>f.id===selected)?selected:fields[0]?.id;
 return <section className="bd-temporal-profile" aria-label="Column profile"><h4 className="bd-temporal-eyebrow">Column profile</h4>
  <p className="bd-temporal-profile-note bd-muted">{profile?`Exact over this preview page · ${count(profile.rowsProfiled)} rows profiled · completeness ${profile.completeness}. Not the accepted cache.`:'Not profiled. Run a saved revision to profile this page.'}</p>
  {profile?fields.map(f=>{const ranged=f.kind==='number'||f.kind==='date',range=(v:string|number|null)=>ranged?v===null?'None':String(v):NA;return <div key={f.id} className="bd-temporal-column" aria-current={f.id===current?'true':undefined}>
   <button type="button" onClick={()=>setSelected(f.id)}><code>{f.id}</code>{' '}<span className="bd-muted">{f.type}</span></button>
   {f.id===current?<dl className="bd-temporal-facts">
    <dt>Expectation</dt><dd>{f.expectation??NA}</dd><dt>Kind</dt><dd>{f.kind}</dd>
    <dt>Present</dt><dd>{count(f.count)}</dd><dt>Missing</dt><dd>{count(f.missing)}</dd>
    <dt>Distinct</dt><dd>{f.distinctCapped?'1,000+':count(f.distinct)}</dd>
    <dt>Min</dt><dd>{range(f.min)}</dd><dt>Max</dt><dd>{range(f.max)}</dd>
    <dt>Samples</dt><dd>{f.samples.length?<span className="bd-temporal-samples">{f.samples.map((v,i)=><span key={i} className="bd-badge bd-temporal-sample">{String(v)}</span>)}</span>:'None'}</dd>
    <dt>Period</dt><dd>{f.periodicity??NA}</dd><dt>Cell errors</dt><dd>{count(f.cellErrors)}</dd>
   </dl>:null}
  </div>;}):observed?<ul className="bd-temporal-list">{observed.map(c=><li key={c.name}><code>{c.name}</code> <span className="bd-muted">{c.type}</span></li>)}</ul>:null}
 </section>;
}
/** Schema (describe) and Coverage (cache/coverage). Completeness is shown exactly as TemporalDB returns it. */
export function TemporalInspector({client,datasetId,tier,description,error,profile}:{client:TemporalClient;datasetId:string;tier:Tier;description?:DatasetDescription;error:string;profile?:ExplorerColumnProfile}){
 const [tab,setTab]=useState<'schema'|'coverage'>('schema'),[field,setField]=useState<'symbol'|'series_id'>('symbol'),[value,setValue]=useState('');
 const [coverage,setCoverage]=useState<Coverage>(),[identities,setIdentities]=useState<Record<string,unknown>[]>([]),[coverageError,setCoverageError]=useState(''),[busy,setBusy]=useState(false);
 // `request` drops a page whose dataset, tier or newer load superseded it; `filters` is what produced the shown pages, so Load more continues it.
 const request=useRef(0),[filters,setFilters]=useState<Record<string,string>>();
 useEffect(()=>{request.current++;setCoverage(undefined);setIdentities([]);setCoverageError('');setBusy(false);},[datasetId,tier]);
 const load=async(cursor?:string)=>{
  const n=++request.current,filter=value.trim(),next=cursor?filters:filter?{[field]:filter}:undefined;
  setBusy(true);setCoverageError('');
  try{const page=await client.coverage({dataset_id:datasetId,tier,...(next?{filters:next}:{}),...(cursor?{cursor}:{}),limit:50});if(n!==request.current)return;setFilters(next);setCoverage(page);setIdentities(list=>cursor?[...list,...page.identities]:page.identities);}
  catch(e){if(n===request.current)setCoverageError(temporalErrorText(e));}finally{if(n===request.current)setBusy(false);}
 };
 if(!datasetId)return <p className="bd-muted">Choose a dataset and tier in the catalog.</p>;
 return <div className="bd-temporal-inspector">
  <div role="tablist" aria-label="Inspector views" className="bd-temporal-row">{(['schema','coverage'] as const).map(t=><button key={t} role="tab" type="button" className="bd-button bd-button--ghost" aria-selected={tab===t} onClick={()=>setTab(t)}>{t==='schema'?'Schema':'Coverage'}</button>)}</div>
  {tab==='schema'?<div role="tabpanel" aria-label="Schema">
   {error?<><p className="bd-notice bd-notice--error" role="alert">{error}</p><ColumnProfile observed={null} profile={profile}/></>:!description?<p className="bd-muted" role="status">Describing {datasetId}…</p>:<>
    <h4 className="bd-temporal-eyebrow">Parameters</h4><p><code>{paramSummary(description.parameters)}</code></p>
    <h4 className="bd-temporal-eyebrow">Observed schema</h4><p className="bd-muted">{String(description.observed_schema_basis.status)}{description.observed_schema_basis.reason?` · ${String(description.observed_schema_basis.reason)}`:''}</p>
    {description.schema_complete===false?<span className="bd-badge bd-temporal-schema-flag">Schema not complete</span>:null}
    <ColumnProfile observed={description.observed_schema} profile={profile}/>
    <h4 className="bd-temporal-eyebrow">Declared schema</h4><p className="bd-muted">{description.declared_schema_basis}</p>
    <h4 className="bd-temporal-eyebrow">Temporal axes</h4><p>{description.temporal_axes.join(', ')}</p>
    <h4 className="bd-temporal-eyebrow">Knowledge bases</h4><p>{knowledge(description.capabilities)}</p>
   </>}
  </div>:<div role="tabpanel" aria-label="Coverage">
   <form className="bd-temporal-row" onSubmit={e=>{e.preventDefault();void load();}}>
    <select className="bd-input" aria-label="Coverage filter" value={field} onChange={e=>setField(e.target.value as 'symbol'|'series_id')}><option value="symbol">symbol</option><option value="series_id">series_id</option></select>
    <input className="bd-input" aria-label="Filter value" placeholder="Optional" maxLength={128} value={value} onChange={e=>setValue(e.target.value)}/>
    <button className="bd-button" type="submit" disabled={busy}>Load coverage</button>
   </form>
   {coverageError?<p className="bd-notice bd-notice--error" role="alert">{coverageError}</p>:null}
   {coverage?<>
    <p>Completeness: <strong>{coverage.completeness.status}</strong></p>
    {tier==='gold'||coverage.identity_detail.status!=='available'?<p className="bd-notice" role="status">Gold has no identity coverage: {coverage.identity_detail.basis}</p>:<p className="bd-muted">{coverage.identity_detail.basis}</p>}
    <ul className="bd-temporal-list">{identities.map((x,i)=><li key={String(x.capture_id??i)}><code>{JSON.stringify(x.request??x)}</code></li>)}</ul>
    <dl className="bd-temporal-clock">{Object.entries(coverage.clock_basis).map(([k,v])=><Fragment key={k}><dt>{k}</dt><dd>{v??'unknown'}</dd></Fragment>)}</dl>
    {coverage.next_cursor?<button className="bd-button" type="button" disabled={busy} onClick={()=>void load(coverage.next_cursor!)}>Load more</button>:null}
   </>:null}
  </div>}
 </div>;
}
