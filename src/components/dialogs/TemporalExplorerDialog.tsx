// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {useEffect,useMemo,useState} from 'react';
import {useModalDialog} from '../../hooks/useModalDialog';
import type {QueryBinding} from '../../lib/temporal/bindings';
import {TIERS,type DatasetDescription,type Tier} from '../../lib/temporal/catalog';
import {createTemporalClient,temporalErrorText} from '../../lib/temporal/client';
import {parseDraft,sourceAlias,type ExplorerColumnProfile,type ExplorerDraft} from '../../lib/temporal/explorer';
import type {DashboardCard} from '../../lib/types';
import {useBackendsStore} from '../../stores/backendsStore';
import {ownerOfCard,useDashboardStore} from '../../stores/dashboardStore';
import {useWidgetRegistryStore} from '../../stores/widgetRegistryStore';
import {TemporalCatalog} from '../temporal/TemporalCatalog';
import {TemporalInspector} from '../temporal/TemporalInspector';
import {TemporalQueryBuilder} from '../temporal/TemporalQueryBuilder';
import {DialogShell} from './DialogShell';

/** The explorer in three panes (layout ported from the bdobb-v2 Data Workbench). Only TemporalDB adapters. */
export function TemporalExplorerDialog({card,readOnly,onClose}:{card:DashboardCard;readOnly:boolean;onClose:()=>void}){
 const dialogRef=useModalDialog(onClose);
 const backend=useBackendsStore(s=>s.backends.find(b=>b.id===card.backendId));const service=useBackendsStore(s=>s.services[card.backendId]);const status=useBackendsStore(s=>s.statuses[card.backendId]);
 const discovering=!!backend&&(status??'unknown')==='unknown';
 const client=useMemo(()=>backend&&service==='TemporalDB'?createTemporalClient(backend):null,[backend,service]);
 const [datasetId,setDatasetId]=useState(card.params.dataset_id??'');
 const [tier,setTier]=useState<Tier>(TIERS.includes(card.params.tier as Tier)?card.params.tier as Tier:'silver');
 const [draft,setDraft]=useState<ExplorerDraft>(()=>parseDraft(card.params.draft));
 const [description,setDescription]=useState<DatasetDescription>(),[describeError,setDescribeError]=useState('');
 // The last Run's page profile; a new dataset selection or builder mode makes it stale.
 const [profile,setProfile]=useState<ExplorerColumnProfile>();
 useEffect(()=>setProfile(undefined),[datasetId,tier,draft.mode]);
 useEffect(()=>{
  setDescription(undefined);setDescribeError('');if(!client||!datasetId)return;
  const abort=new AbortController();
  client.describe({dataset_id:datasetId,tier},abort.signal).then(d=>{if(!abort.signal.aborted)setDescription(d);},e=>{if(!abort.signal.aborted)setDescribeError(temporalErrorText(e));});
  return()=>abort.abort();
 },[client,datasetId,tier]);
 // The card keeps the selection and draft, so a saved dashboard reopens where it was left. Read-only keeps nothing.
 useEffect(()=>{
  if(readOnly)return;
  const cardParams={dataset_id:datasetId,tier,draft:JSON.stringify(draft)};
  if(JSON.stringify(cardParams)===JSON.stringify(card.params))return;
  const timer=setTimeout(()=>void useDashboardStore.getState().applyCardParams(card.id,{cardParams,groupEdits:[]}),400);
  return()=>clearTimeout(timer);
 },[readOnly,card.id,card.params,datasetId,tier,draft]);
 const openWidget=async(binding:QueryBinding)=>{
  const widget=useWidgetRegistryStore.getState().widgets.find(w=>w.backendId===card.backendId&&w.type==='query_data');
  if(!widget)throw new Error('This TemporalDB serves no query widget');
  // Beside the explorer card, wherever it lives: the active dashboard may be another one.
  const store=useDashboardStore.getState();const owner=ownerOfCard(store,card.id);const tab=owner?.tabs.find(t=>t.cards.some(c=>c.id===card.id));
  if(!owner||!tab)throw new Error('The explorer card is no longer on a dashboard');
  const id=await store.addCardTo(owner.id,tab.id,widget);if(!id)throw new Error('Could not add the query widget');
  await store.bindQueryCard(id,binding);
 };
 return <DialogShell dialogRef={dialogRef} modifier="bd-dialog--temporal-explorer" ariaLabel="TemporalDB explorer" title="TemporalDB explorer" eyebrow="TemporalDB" subtitle={backend?.name??'Source unavailable'} onClose={onClose} footerActions={<button className="bd-button" type="button" onClick={onClose}>Done</button>}>
  {!client?<p className={discovering?"bd-notice":"bd-notice bd-notice--error"} role={discovering?"status":"alert"}>{discovering?"Waiting for backend discovery or startup credentials…":"TemporalDB source unavailable. Reconnect the original service."}</p>:<div className="bd-temporal-explorer">
   <section className="bd-temporal-pane" aria-label="Catalog"><h3 className="bd-temporal-eyebrow">Catalog</h3>
    <TemporalCatalog client={client} datasetId={datasetId} tier={tier} onSelect={(id,t)=>{setDatasetId(id);setTier(t);}} onAddSource={draft.mode==='sql'?id=>setDraft(d=>({...d,sources:{...d.sources,[sourceAlias(id,d.sources)]:id}})):undefined}/></section>
   <section className="bd-temporal-pane" aria-label="Builder"><h3 className="bd-temporal-eyebrow">Builder</h3>
    <TemporalQueryBuilder client={client} datasetId={datasetId} tier={tier} description={description} draft={draft} onDraft={setDraft} readOnly={readOnly} onOpenWidget={openWidget} onProfile={setProfile}/></section>
   <section className="bd-temporal-pane" aria-label="Inspector"><h3 className="bd-temporal-eyebrow">Inspector</h3>
    <TemporalInspector client={client} datasetId={datasetId} tier={tier} description={description} error={describeError} profile={profile}/></section>
  </div>}
 </DialogShell>;
}
