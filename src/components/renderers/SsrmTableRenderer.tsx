// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {BackendConfig,DashboardCard,WidgetDef,TableCardState} from '../../lib/types';
import type {ProviderCount,ProviderRowBlock,ProviderSession,ProviderViewReady,TableDefinition} from '../../lib/tableExecution/types';
import {wireParams,type WireContext} from '../../lib/params';
import {createOpenbbTableProvider} from '../../lib/tableExecution/rust/providerFactory';
import {useDashboardStore} from '../../stores/dashboardStore';
import {tableExecutionStore} from '../../stores/tableExecutionStore';
import {LocalTableRenderer} from './LocalTableRenderer';
import {ManagedSourceForm} from './ManagedSourceForm';
import {tableColumns} from '../../lib/tableColumns';
import {SourceFilterPanel} from './TableFilterRow';
import {PivotPanel} from './PivotPanel';
import {PivotToggle} from './pivot-drawer/PivotToggle';
import {EMPTY_PIVOT} from '../../lib/pivotConfig';
import type {FieldKind} from '../../lib/pivotTable';
import {createSourceClient} from '../../lib/tableExecution/remote/sourceClient';
import {LIVE_PAGE_WARNING} from '../../lib/tableExecution/remote/openbbSsrm';
type Props={card:DashboardCard;widget:WidgetDef;backend?:BackendConfig;dashboardId:string;params:Record<string,string>;refreshKey:number;context?:WireContext;readonly?:boolean;held?:boolean;filterRow?:boolean;autosizeKey?:number;onStateChange?:(patch:Partial<TableCardState>)=>void};
export function SsrmTableRenderer(props:Props){
 if(!props.backend)return <p role="alert">Table connection unavailable.</p>;
 if(props.widget.provider==='managed-native')return props.widget.protocolVersion===1?<ManagedTable {...props} backend={props.backend}/>:<p role="alert">Unsupported managed table protocol.</p>;
 if(props.widget.provider)return <p role="alert">Unsupported table provider.</p>;
 return <LiveTable {...props} backend={props.backend}/>;
}
function ManagedTable({card,backend,dashboardId,refreshKey,context,readonly,filterRow,onStateChange,autosizeKey}:Props&{backend:BackendConfig}){
 const [rebind,setRebind]=useState(false),[error,setError]=useState<string>();
 const view=useSyncExternalStore(tableExecutionStore.subscribe,()=>tableExecutionStore.readView(dashboardId,card.id));
 const capabilities=tableExecutionStore.readCapabilities(dashboardId,card.id);
 const save=async(source:NonNullable<DashboardCard['managedSource']>)=>{await useDashboardStore.getState().patchCardField(card.id,'managedSource',source);setRebind(false);};
 if(!card.managedSource||rebind)return readonly?<p>Source unavailable; an editor can re-upload or rebind it.</p>:<ManagedSourceForm backend={backend} context={context} onSave={save}/>;
 return <div className="table-with-pivot">
  <div className="pivot-strip"><span>Server snapshot</span>{capabilities?.features.includes('grouping')?<PivotToggle dashboardId={dashboardId} widgetId={card.id}/>:null}
   <button type="button" onClick={()=>tableExecutionStore.reopen(dashboardId,card.id)}>Reopen table</button>
   {!readonly?<><button type="button" onClick={()=>setRebind(true)}>{view.error?'Re-upload or rebind source':'Change source'}</button><button type="button" onClick={()=>{void createSourceClient(backend).deleteSource(card.managedSource!.sourceId).then(()=>useDashboardStore.getState().clearManagedSource(card.id,card.backendId,card.managedSource!.sourceId)).catch(e=>setError(e.message));}}>Delete server source</button></>:null}
  </div>{error?<p role="alert">{error}</p>:null}
  <LocalTableRenderer file="" label={card.title??card.widgetId} executionIdentity={{dashboardId,widgetId:card.id}} refreshKey={refreshKey} state={card.table} autosizeKey={autosizeKey} filterRow={filterRow} onStateChange={onStateChange??(()=>{})}/>
 </div>;
}
const PAGE=100;
const NO_FILTERS:NonNullable<TableCardState['columnFilters']>=[];
const countLabel=(count:ProviderCount)=>count.kind==='exact'?`${count.value.toLocaleString()} rows`:count.kind==='estimated'?`About ${count.value.toLocaleString()} rows` :count.kind==='snapshotExpired'?'Result expired':'Total unknown';
type Delivery={session:ProviderSession;ready:ProviderViewReady;block:ProviderRowBlock;labels:string[]};
function LiveTable({card,widget,backend,dashboardId,params,refreshKey,context,readonly,held}:Props&{backend:BackendConfig}){
 const [delivery,setDelivery]=useState<Delivery>(),[pending,setPending]=useState(false),[error,setError]=useState<string>(),[reopen,setReopen]=useState(0),[pivotOpen,setPivotOpen]=useState(false);
 const [definition,setDefinition]=useState<TableDefinition>(()=>card.tableDefinition??{table:card.table??{},search:''});
 const generation=useRef(0),read=useRef<AbortController|null>(null),active=useRef<ProviderSession|null>(null);
 const saved=JSON.stringify([card.tableDefinition,card.table]);
 useEffect(()=>{const [model,table]=JSON.parse(saved) as [TableDefinition|null,TableCardState|null];setDefinition(model??{table:table??{},search:''});},[saved]);
 // Keyed on what goes on the wire, not the raw context: a calendar that lands
 // without changing the request must not reopen the session (a second POST).
 const identity=JSON.stringify([backend,widget,wireParams(widget,params,context),card.id,refreshKey,reopen,definition,!!held]);
 useEffect(()=>{
  const [connection,descriptor,,widgetId,,,candidate]=JSON.parse(identity) as [BackendConfig,WidgetDef,unknown,string,number,number,TableDefinition];
  const c=new AbortController(),version=++generation.current;read.current?.abort();setPending(true);setError(undefined);
  // Trading/fiscal lookups still in flight: the wire params are not final yet.
  if(held)return;
  // This render's params and context are the ones the identity was built from.
  const resolved=params,wireContext=context;
  void (async()=>{
  const provider=createOpenbbTableProvider(connection,descriptor,resolved,{inputRevision:1,pageSize:PAGE,maxRowBlockRows:PAGE,capabilities:descriptor.ssrm,
   columns:descriptor.table?.columns?.map(c=>({id:c.field,label:c.headerName??c.field,...(c.cellDataType?{dtype:c.cellDataType}:{})}))},wireContext);
   const session=await provider.open({kind:'remote',sourceId:`${descriptor.backendId}:${descriptor.id}`,snapshotId:''},{protocolVersion:1,widgetId,locale:new Intl.Collator().resolvedOptions().locale,signal:c.signal});
   if(c.signal.aborted){session.result.dispose();return;}active.current=session;
   const revision={widgetId,input:1,model:1,output:1};
   const ready=await session.result.applyModel(candidate,{kind:'none'},revision,c.signal);
   const block=await session.result.rows(revision,{groupPath:[],offset:0,limit:PAGE},c.signal);
   if(version===generation.current&&!c.signal.aborted)setDelivery({session,ready,block,labels:[]});
  })().catch(e=>{if(!c.signal.aborted&&version===generation.current)setError(e.message);}).finally(()=>{if(!c.signal.aborted&&version===generation.current)setPending(false);});
  return()=>{c.abort();read.current?.abort();active.current?.result.dispose();active.current=null;};
 // eslint-disable-next-line react-hooks/exhaustive-deps -- identity covers params, context and held
 },[identity]);
 async function page(path:string[],offset:number,labels:string[]){
  if(!delivery||pending||active.current!==delivery.session)return;
  read.current?.abort();const c=new AbortController();read.current=c;const version=generation.current;setPending(true);setError(undefined);
  try{const block=await delivery.session.result.rows(delivery.ready.revision,{groupPath:path,offset,limit:PAGE},c.signal);if(!c.signal.aborted&&version===generation.current)setDelivery({...delivery,block,labels});}
  catch(e){if(!c.signal.aborted&&version===generation.current)setError(e instanceof Error?e.message:'Could not load rows');}
  finally{if(!c.signal.aborted&&version===generation.current)setPending(false);}
 }
 async function patch(value:Partial<TableCardState>){
  const next={...definition,table:{...definition.table,...value}};
  try{if(!readonly&&!await useDashboardStore.getState().commitTableDefinition(dashboardId,card.id,next,{kind:'none'}))throw new Error('Table changed before saving; reopen and try again');setDefinition(next);}
  catch(e){setError(e instanceof Error?e.message:'Could not save table');}
 }
 const block=delivery?.block,ready=delivery?.ready,capabilities=delivery?.session.capabilities;
 const columns=ready?.inspection.inputColumns??[];
 const pivot=definition.table.pivot??EMPTY_PIVOT;
 const kinds=new Map(columns.map(c=>[c.id,(c.dtype==='number'?'number':c.dtype==='date'?'date':c.dtype==='boolean'?'boolean':'text') as FieldKind]));
 const sorting=definition.table.sorting??[];
 return <div className="table-with-pivot">
  <div className="pivot-strip"><span>LIVE · paged · row identity may change</span><button type="button" onClick={()=>setReopen(x=>x+1)}>Reopen table</button>{(capabilities?.features.includes('grouping')||capabilities?.features.includes('splits'))&&!readonly?<button type="button" aria-expanded={pivotOpen} onClick={()=>setPivotOpen(x=>!x)}>Pivot</button>:null}</div>
  {/* What the backend warned about this result (OBBject warnings), e.g. a record cap: otherwise the pages look whole. */}
  {(block??ready)?.completeness.warnings.filter(w=>w!==LIVE_PAGE_WARNING).map((w,i)=><p className="card-notice" role="status" key={i}>{w}</p>)}
  {error?<p role="alert">{error}</p>:null}{pending?<p role="status">Loading table…</p>:null}
  {ready&&capabilities?.filtering?.length?<SourceFilterPanel columns={columns.filter(c=>(c.dtype==='text'||c.dtype==='number')&&capabilities.filtering?.includes(c.dtype))} formulas={[]} filters={definition.table.columnFilters??NO_FILTERS} readonly={!!readonly} busy={pending} onChange={(id,value)=>{void patch({columnFilters:[...(definition.table.columnFilters??[]).filter(f=>f.id!==id),...(value===undefined||value===''?[]:[{id,value}])]});}}/>:null}
  {pivotOpen&&capabilities?<PivotPanel columns={tableColumns([], {columns:columns.map(c=>({field:c.id,headerName:c.label}))})} order={definition.table.columnOrder??columns.map(c=>c.id)} hidden={[]} kinds={kinds} rows={[]} config={pivot} capabilities={capabilities} onChange={value=>{void patch(value);}} onClose={()=>setPivotOpen(false)}/>:null}
  {block&&ready?<>
   <nav aria-label="Group path"><button type="button" disabled={pending||!block.groupPath.length} onClick={()=>void page([],0,[])}>All rows</button>{delivery.labels.map((label,i)=><button type="button" key={i} disabled={pending} onClick={()=>void page(block.groupPath.slice(0,i+1),0,delivery.labels.slice(0,i+1))}>{label}</button>)}</nav>
   <div className="table-scroll"><table className="widget-table" aria-label="Server table"><thead><tr>{ready.columns.map(c=>{const sorted=sorting.find(s=>s.id===c.id);return <th key={c.id} aria-sort={sorted?.desc?'descending':sorted?'ascending':'none'}><button type="button" disabled={pending||capabilities?.sorting===false||!!pivot.enabled&&!!pivot.grouping.length&&!pivot.aggregationFns?.[c.id]} onClick={()=>void patch({sorting:[{id:c.id,desc:!sorting.find(s=>s.id===c.id)?.desc}]})}>{c.label}{sorted?(sorted.desc?' ▼':' ▲'):''}</button></th>;})}</tr></thead><tbody>{block.rows.map(row=><tr key={row.id}>{ready.columns.map((column,index)=>{const group=block.groups.find(g=>g.rowId===row.id);return <td key={column.id}>{index===0&&group?<button type="button" aria-label={`Open group ${String(row.values[pivot.grouping[block.groupPath.length]]??'')}`} disabled={pending} onClick={()=>void page(group.path,0,[...delivery.labels,String(row.values[pivot.grouping[block.groupPath.length]]??'Group')])}>▸</button>:null}{String(row.values[column.id]??'')}</td>;})}</tr>)}</tbody></table></div>
   <nav aria-label="Table pages"><span>{countLabel(block.siblingCount)} · {block.rows.length?`${block.offset+1}–${block.offset+block.rows.length}`:'No rows in this page'}</span><button type="button" disabled={pending||block.offset===0} onClick={()=>void page(block.groupPath,Math.max(0,block.offset-PAGE),delivery.labels)}>Previous page</button><button type="button" disabled={pending||block.siblingCount.kind==='exact'&&block.offset+PAGE>=block.siblingCount.value||!Number.isSafeInteger(block.offset+2*PAGE)} onClick={()=>void page(block.groupPath,block.offset+PAGE,delivery.labels)}>Next page</button></nav>
  </>:null}
 </div>;
}
