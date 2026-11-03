// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {useEffect,useMemo,useState} from 'react';
import {TIERS,type CatalogDataset,type Tier} from '../../lib/temporal/catalog';
import {temporalErrorText,type TemporalClient} from '../../lib/temporal/client';

/** cache/datasets, paged with Load more and grouped by source. Search covers the loaded pages only. */
export function TemporalCatalog({client,datasetId,tier,onSelect,onAddSource}:{client:TemporalClient;datasetId:string;tier:Tier;onSelect:(datasetId:string,tier:Tier)=>void;onAddSource?:(datasetId:string)=>void}){
 const [datasets,setDatasets]=useState<CatalogDataset[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState('');
 const load=async(after?:string)=>{setBusy(true);setError('');try{const page=await client.datasets({...(after?{cursor:after}:{}),limit:50});setDatasets(d=>after?[...d,...page.datasets]:page.datasets);setCursor(page.next_cursor);}catch(e){setError(temporalErrorText(e));}finally{setBusy(false);}};
 // eslint-disable-next-line react-hooks/exhaustive-deps -- one first page per client
 useEffect(()=>{void load();},[client]);
 const groups=useMemo(()=>{const term=search.trim().toLowerCase();const out=new Map<string,CatalogDataset[]>();for(const d of datasets)if(d.dataset_id.toLowerCase().includes(term))out.set(d.source,[...(out.get(d.source)??[]),d]);return [...out];},[datasets,search]);
 return <div className="bd-temporal-catalog">
  <input className="bd-input" type="search" aria-label="Search datasets" placeholder="Search loaded datasets…" value={search} onChange={e=>setSearch(e.target.value)}/>
  {error?<p className="bd-notice bd-notice--error" role="alert">{error}</p>:null}
  {groups.map(([source,items])=><section key={source} aria-label={`Source ${source}`}><h4 className="bd-temporal-eyebrow">{source}</h4>
   {items.map(d=><article key={d.dataset_id} aria-label={d.dataset_id} className={`bd-temporal-dataset${d.dataset_id===datasetId?' bd-temporal-dataset--selected':''}`}>
    <div className="bd-temporal-row"><code>{d.dataset_id.slice(d.source.length+1)}</code>{d.accepted_cached?<span className="bd-badge bd-badge--accent">Cached</span>:<span className="bd-badge">Not cached</span>}</div>
    <div className="bd-temporal-row" role="group" aria-label={`${d.dataset_id} tiers`}>{TIERS.map(t=><button key={t} type="button" className="bd-badge bd-temporal-tier" data-tier={t} aria-pressed={d.dataset_id===datasetId&&t===tier} data-available={d.available_tiers.includes(t)||undefined} title={d.available_tiers.includes(t)?`${t}: accepted data`:`${t}: nothing accepted yet`} onClick={()=>onSelect(d.dataset_id,t)}>{t}</button>)}</div>
    {onAddSource?<button type="button" className="bd-button bd-button--ghost" onClick={()=>onAddSource(d.dataset_id)}>Add as source</button>:null}
   </article>)}
  </section>)}
  {cursor?<button type="button" className="bd-button" disabled={busy} onClick={()=>void load(cursor)}>Load more</button>:null}
  {busy?<p className="bd-muted" role="status">Loading datasets…</p>:null}
 </div>;
}
