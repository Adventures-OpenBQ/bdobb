// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type {PivotMeasure} from '../../types';
import type {DatasetColumn,DatasetRow} from '../../widgetData/types';
import type {ExecutionProvider,ProviderCapabilities,ProviderCount,ProviderResultExecutor,ProviderResultIdentity,ProviderRowBlock,Revision,TableDefinition} from '../types';
import {ProviderContractError,capabilityPreflight,freezeCapabilities,refusal} from '../rust/providerCapabilities';
import {captureApplyRequirements,validateSessionOptions} from '../rust/providerContract';
import {assertUnicodeScalarGraph} from '../rust/wireCodec';
import {createRemoteTransport,withRemoteSignal,positiveLimit} from './transport';
import type {OpenbbAggregation,OpenbbSsrmConfig,OpenbbSsrmRequest} from './openbbTypes';
export type {OpenbbSsrmConfig} from './openbbTypes';
const LIVE=Object.freeze({kind:'live',rowIdentity:'ephemeral'} as const);
const AGGREGATIONS:Record<OpenbbAggregation,string>={sum:'sum',min:'min',max:'max',mean:'avg',count:'count'};
export const LIVE_PAGE_WARNING='Live server pages may change between requests; row identities are page-local.';
const WARNINGS=[LIVE_PAGE_WARNING];
// An OBBject's warnings ([{category,message}] or strings) as text, e.g. a provider's record cap.
const backendWarnings=(value:unknown):string[]=>Array.isArray(value)?value.flatMap(w=>{const m=typeof w==='string'?w:(w as {message?:unknown}|null)?.message;return typeof m==='string'&&m!==''?[m]:[];}):[];
function invalid(message:string):never{throw new ProviderContractError({code:'INVALID_REQUEST',message});}
function mismatch(message:string):never{throw new ProviderContractError({code:'REVISION_MISMATCH',message});}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))invalid('Malformed OpenBB SSRM object');return value as Record<string,unknown>;}
function inert(value:unknown):void{try{assertUnicodeScalarGraph(value);}catch{invalid('Unsafe OpenBB SSRM request');}}
function field(value:unknown):string{if(typeof value!=='string'||!value||value.length>4096)invalid('Invalid OpenBB SSRM field');return value;}
function coordinate(value:unknown):number{if(!Number.isSafeInteger(value)||(value as number)<0)invalid('Invalid OpenBB SSRM coordinate');return value as number;}
const sameRevision=(a:Revision,b:Revision)=>(['widgetId','input','model','output'] as const).every(k=>a[k]===b[k]);
const signature=(keys:string[])=>JSON.stringify([...keys].sort());
function count(raw:unknown):ProviderCount{
 if(raw===undefined||raw===null||raw===-1)return {kind:'unknown'};
 if(typeof raw==='object'){
  const tagged=object(raw);
  if(tagged.kind==='unknown')return {kind:'unknown'};
  if(tagged.kind==='exact'||tagged.kind==='estimated')return {kind:tagged.kind,value:coordinate(tagged.value)};
  invalid('Invalid OpenBB SSRM count');
 }
 return {kind:'exact',value:coordinate(raw)};
}
function columns(raw:readonly DatasetColumn[]|undefined,limit:number):DatasetColumn[]|undefined{
 if(raw===undefined)return undefined;inert(raw);
 if(!Array.isArray(raw)||raw.length>limit)invalid('OpenBB SSRM column limit exceeded');
 const ids=new Set<string>();
 for(const col of raw){const id=field(col.id);if(ids.has(id)||typeof col.label!=='string')invalid('Invalid OpenBB SSRM columns');ids.add(id);}
 return structuredClone(raw) as DatasetColumn[];
}
function inferColumns(rows:Record<string,unknown>[]):DatasetColumn[]{
 return Object.keys(rows[0]??{}).map(id=>{
  const value=rows.map(row=>row[id]).find(v=>v!==null&&v!==undefined);
  const dtype:DatasetColumn['dtype']=typeof value==='number'?'number':typeof value==='boolean'?'boolean':typeof value==='string'?'text':undefined;
  return {id,label:id,...(dtype?{dtype}:{})};
 });
}
/** Fixed configuration and bounded authenticated transport; no loaded-page calculator or full fetch. */
export function createOpenbbSsrmProvider(rawConfig:OpenbbSsrmConfig):ExecutionProvider{
 const config={...rawConfig,params:structuredClone(rawConfig.params??{}),capabilities:structuredClone(rawConfig.capabilities??{})};
 const inputRevision=coordinate(config.inputRevision),maxRows=positiveLimit(config.maxRowBlockRows,500),pageSize=positiveLimit(config.pageSize,Math.min(100,maxRows)),maxColumns=positiveLimit(config.maxColumns,256),maxPaths=positiveLimit(config.maxGroupPaths,10_000);
 if(pageSize>maxRows)invalid('OpenBB SSRM page size exceeds row limit');
 const initialColumns=columns(config.columns,maxColumns),pivotColumns=columns(config.capabilities.pivot?.columns,maxColumns);
 const base=new URL(config.baseUrl),endpoint=config.endpoint.replace(/^\/(?!\/)/,'');
 let decoded:string;try{decoded=decodeURIComponent(endpoint);}catch{invalid('Invalid OpenBB SSRM endpoint');}
 if(!endpoint||decoded.startsWith('/')||decoded.includes('\\')||decoded.split('/').some(part=>part==='..'||part==='.')||/[?#:]/.test(decoded))invalid('Invalid OpenBB SSRM endpoint');
 const url=new URL(`${base.toString().replace(/\/+$/,'')}/${endpoint}`);
 if(url.origin!==base.origin)invalid('Invalid OpenBB SSRM endpoint');
 for(const [key,value] of Object.entries(config.params)){if(typeof value!=='string')invalid('Invalid OpenBB SSRM parameter');if(value!=='')url.searchParams.set(key,value);}
 if(new TextEncoder().encode(url.toString()).byteLength>positiveLimit(config.maxRequestBytes,2*1024*1024))invalid('OpenBB SSRM request byte limit exceeded');
 const path=url.pathname.slice(base.pathname.replace(/\/+$/,'').length+1)+url.search;
 // The largest OpenBQ datasets take up to ~60 s on a cold first read; managed tables keep the transport's 30 s.
 const transport=createRemoteTransport({...config,timeoutMs:config.timeoutMs??120_000,relayDetail:true});
 const declared=config.capabilities;
 const aggregations=[...(declared.aggregations??[])];
 if(aggregations.some(a=>!Object.hasOwn(AGGREGATIONS,a)))invalid('Unsupported OpenBB SSRM aggregation declaration');
 const filtering=[...(declared.filtering??['text','number'])] as ('text'|'number')[];
 if(filtering.some(f=>f!=='text'&&f!=='number'))invalid('Invalid OpenBB SSRM filter declaration');
 const capabilities:ProviderCapabilities=freezeCapabilities({protocolVersions:[1],definitionVersions:[1],aggregations,formulaFunctions:[],fiscal:false,inspection:false,selection:false,identityWitness:false,remoteAcquisition:true,safeExactCountAdmission:false,sorting:declared.sorting??true,filtering:Object.freeze(filtering),features:[...(declared.grouping?['grouping' as const]:[]),...(pivotColumns?['splits' as const]:[])]});
 return {async open(source,options){
  inert(source);validateSessionOptions(options,capabilities);if(source.kind!=='remote'||source.managed)refusal('standard OpenBB acquisition');
  const widgetId=options.widgetId,sessionId=crypto.randomUUID(),sourceSnapshotId=crypto.randomUUID();
  // This legacy field is a scope token ONLY. LIVE metadata explicitly denies snapshot evidence.
  const identity=(resultId:string):ProviderResultIdentity=>({sessionId,sourceSnapshotId,resultId,consistency:LIVE});
  const lifetime=new AbortController();let disposed=false,sequence=0,applySequence=0,modelHigh=-1,outputHigh=-1;
  let sourceColumns=initialColumns;
  type Published={revision:Revision;id:string;query:OpenbbSsrmRequest;columns:DatasetColumn[];inputColumns:DatasetColumn[];schemas:Map<number,string>;paths:Map<string,{keys:string[];path:string[]}>;keysToPath:Map<string,string[]>;first?:{query:OpenbbSsrmRequest;page:Awaited<ReturnType<typeof readPage>>}};
  let active:Published|undefined;
  const check=(signal?:AbortSignal)=>{if(disposed)throw new ProviderContractError({code:'SESSION_DISPOSED',message:'Provider session is disposed'});signal?.throwIfAborted();};
  const bound=(r:Revision)=>{inert(r);coordinate(r.input);coordinate(r.model);coordinate(r.output);if(r.widgetId!==widgetId||r.input!==inputRevision)mismatch('Request does not match OpenBB source scope');};
  const published=(r:Revision)=>{bound(r);if(!active||!sameRevision(active.revision,r))mismatch('Request does not match OpenBB model publication');return active;};
  const context=(r:Revision,id:string,backend:string[]=[])=>({requestId:`openbb-${++sequence}`,revision:{...r},...identity(id),consistency:LIVE,completeness:{kind:'paged' as const,warnings:[...WARNINGS,...backend]},diagnostics:[]});
  const readPage=async(query:OpenbbSsrmRequest,signal:AbortSignal)=>{
   check(signal);const reply=object(await withRemoteSignal(signal,lifetime.signal,combined=>transport.json('POST',path,query,combined)));check(signal);
   if(!Array.isArray(reply.rowData))invalid('Missing OpenBB SSRM rowData');
   if(reply.rowData.length>query.endRow-query.startRow)invalid('OpenBB SSRM response row limit exceeded');
   const rows=reply.rowData.map(object),rowCount=count(reply.rowCount);
   const groupField=query.rowGroupCols[query.groupKeys.length]?.field,groupKeys=new Set<string>();
   if(groupField)for(const row of rows){const value=row[groupField];if(typeof value!=='string'&&!(typeof value==='number'&&Number.isFinite(value)))invalid('Unrepresentable OpenBB group key');const key=String(value);if(groupKeys.has(key))invalid('Duplicate OpenBB group key');groupKeys.add(key);}
   let schema:string|undefined;
   for(const row of rows){
    const keys=Object.keys(row);if(keys.length>maxColumns)invalid('OpenBB SSRM response column limit exceeded');keys.forEach(field);inert(row);
    const current=signature(keys);if(schema!==undefined&&schema!==current)mismatch('OpenBB SSRM row schema changed');schema=current;
   }
   if(rowCount.kind==='exact'&&rows.length&&rowCount.value<query.startRow+rows.length)invalid('OpenBB SSRM count contradicts rows');
   return {rows,rowCount,schema,warnings:backendWarnings(reply.warnings)};
  };
  // applyModel already read page 0 of this exact query; the first identical rows() call reuses it once (a later page 0 is fetched fresh).
  const takeFirst=async(state:Published,query:OpenbbSsrmRequest,signal:AbortSignal)=>{
   const saved=state.first;state.first=undefined;
   return saved&&JSON.stringify(saved.query)===JSON.stringify(query)?saved.page:readPage(query,signal);
  };
  const buildQuery=(definition:TableDefinition,available=sourceColumns):OpenbbSsrmRequest=>{
   if(definition.analytical!==undefined)refusal('analytical definitions');
   if(definition.search)refusal('global search');
   const table=definition.table,pivot=table.pivot?.enabled?table.pivot:undefined;
   if(pivot?.buckets&&Object.values(pivot.buckets).some(b=>b!=='native'))refusal('date bucketing');
   const known=(id:string)=>{field(id);if(available&&!available.some(c=>c.id===id))invalid('Unknown OpenBB SSRM field');return id;};
   const sorting=table.sorting??[];if(sorting.length&&!capabilities.sorting)refusal('sorting');
   if(sorting.length>maxColumns||(table.columnFilters?.length??0)>maxColumns)invalid('OpenBB SSRM request column limit exceeded');
   const filterModel:Record<string,unknown>=Object.create(null);
   for(const f of table.columnFilters??[]){
    const id=known(f.id),value=f.value,dtype=available?.find(c=>c.id===id)?.dtype;
    if(dtype==='date'||dtype==='dateString'||dtype==='boolean'||dtype==='object')refusal(`filter:${dtype}`);
    if(typeof value==='string'){
     if(!filtering.includes('text')||dtype==='number')refusal('filter:text');
     filterModel[id]={filterType:'text',type:'contains',filter:value};
    }else{
     if(!filtering.includes('number')||dtype==='text')refusal('filter:number');
     const range=object(value),keys=Object.keys(range);if(!keys.length||keys.some(k=>k!=='min'&&k!=='max'))refusal('filter shape');
     const {min,max}=range;if([min,max].some(v=>v!==undefined&&(typeof v!=='number'||!Number.isFinite(v))))invalid('Invalid numeric filter');
     if(min!==undefined&&max!==undefined){if((min as number)>(max as number))invalid('Invalid numeric filter range');filterModel[id]={filterType:'number',type:'inRange',filter:min,filterTo:max};}
     else if(min!==undefined)filterModel[id]={filterType:'number',type:'greaterThanOrEqual',filter:min};
     else if(max!==undefined)filterModel[id]={filterType:'number',type:'lessThanOrEqual',filter:max};
     else invalid('Empty numeric filter');
    }
   }
   const grouping=pivot?.grouping??[],splits=pivot?.split??[];
   if(grouping.length+splits.length>maxColumns)invalid('OpenBB SSRM request column limit exceeded');
   const measures:PivotMeasure[]=pivot?.measures??Object.entries(pivot?.aggregationFns??{}).map(([id,aggregation])=>({id,sourceFieldId:id,aggregation}));
   if(measures.length>maxColumns)invalid('OpenBB SSRM request column limit exceeded');
   const used=new Set<string>();
   const valueCols=measures.map(m=>{
    if(used.has(m.sourceFieldId)||m.customLabel||m.id!==m.sourceFieldId)refusal('independent measure aliases');used.add(m.sourceFieldId);
    if(!m.aggregation||!aggregations.includes(m.aggregation as OpenbbAggregation))refusal(`aggregation:${m.aggregation??'default'}`);
    return {id:known(m.sourceFieldId),field:m.sourceFieldId,aggFunc:AGGREGATIONS[m.aggregation as OpenbbAggregation]};
   });
   if(valueCols.some(v=>grouping.includes(v.field)))refusal('group and value field aliases');
   if(grouping.length&&sorting.some(s=>!valueCols.some(v=>v.field===s.id)))refusal('grouped sorting by non-measure fields');
   if(valueCols.length&&!grouping.length&&!splits.length)refusal('ungrouped aggregation');
   if(splits.length&&!pivotColumns)refusal('splits');
   if(splits.length&&grouping.length>1)refusal('nested pivot groups');
   return {startRow:0,endRow:pageSize,sortModel:sorting.map(s=>({colId:known(s.id),sort:s.desc?'desc':'asc'})),filterModel,rowGroupCols:grouping.map(id=>({id:known(id),field:id})),groupKeys:[],valueCols,pivotCols:splits.map(id=>({id:known(id),field:id})),pivotMode:splits.length>0};
  };
  const expectedSchema=(state:Published,depth:number)=>{
   if(state.query.pivotMode)return signature(pivotColumns!.map(c=>c.id));
   if(depth<state.query.rowGroupCols.length)return signature([state.query.rowGroupCols[depth].field,...(state.query.valueCols.length?state.query.valueCols.map(c=>c.field):['count'])]);
   return signature(state.inputColumns.map(c=>c.id));
  };
  const verifyTypes=(state:Published,depth:number,rows:Record<string,unknown>[])=>{
   const typed=state.query.pivotMode?state.columns:state.inputColumns;
   for(const row of rows)for(const col of typed){
    const value=row[col.id];if(value===null||value===undefined)continue;
    const aggregate=depth<state.query.rowGroupCols.length&&state.query.valueCols.some(c=>c.field===col.id);
    // An ordinary number/text/boolean column takes any scalar and a value of another type shows as text: OpenBB's widget
    // generator declares bool fields as text, and od serves mixed columns (numbers and "n/a"). Aggregates stay strict numbers.
    const scalar=typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value));
    if(aggregate?typeof value!=='number'||!Number.isFinite(value):(col.dtype==='number'||col.dtype==='text'||col.dtype==='boolean')&&!scalar)mismatch('OpenBB SSRM value type changed');
   }
  };
  const verifySchema=(state:Published,depth:number,schema:string|undefined)=>{
   const expected=state.schemas.get(depth)??expectedSchema(state,depth);
   if(schema!==undefined&&expected!==undefined&&schema!==expected)mismatch('OpenBB SSRM schema changed; reopen the provider');
  };
  const result:ProviderResultExecutor={
   async applyModel(definition,selection,revision,signal,reconcileMissing,previousSelectionNamespace,provenAbsentIds,runtimeParams,requirements){
    check(signal);bound(revision);capabilityPreflight(capabilities,definition,selection,runtimeParams);
    if(captureApplyRequirements(requirements))throw new ProviderContractError({code:'COUNT_UNAVAILABLE',message:'Live OpenBB SSRM cannot guarantee snapshot-bound exact counts'});
    if(reconcileMissing||previousSelectionNamespace||provenAbsentIds?.length)refusal('selection reconciliation');
    const candidate=structuredClone({definition,revision});
    let query=buildQuery(candidate.definition);
    if(candidate.revision.model<=modelHigh||candidate.revision.output<=outputHigh)mismatch('Apply requires newer model and output revisions');
    modelHigh=candidate.revision.model;outputHigh=candidate.revision.output;const ticket=++applySequence;
    let inputColumns=sourceColumns;
    if(!inputColumns&&(query.rowGroupCols.length||query.pivotMode)){
     const discovery=await readPage(buildQuery({table:{},search:''}),signal);if(ticket!==applySequence)mismatch('OpenBB apply was superseded');
     inputColumns=inferColumns(discovery.rows);if(!inputColumns.length)refusal('grouping without a discoverable input schema');
     query=buildQuery(candidate.definition,inputColumns);
    }
    const page=await readPage(query,signal);if(ticket!==applySequence)mismatch('OpenBB apply was superseded');
    const discovered=inferColumns(page.rows);
    const next:Published={revision:candidate.revision,id:crypto.randomUUID(),query,columns:query.pivotMode?pivotColumns!:inputColumns??discovered,inputColumns:inputColumns??discovered,schemas:new Map(),paths:new Map(),keysToPath:new Map(),first:{query,page}};
    verifySchema(next,0,page.schema);verifyTypes(next,0,page.rows);if(page.schema!==undefined)next.schemas.set(0,page.schema);
    // A grouped page describes only its current level; it cannot discover the input schema.
    if(query.rowGroupCols.length&&!query.valueCols.length&&!next.columns.some(c=>c.id==='count'))next.columns=[...next.columns,{id:'count',label:'Count',dtype:'number'}];
    if(next.columns.length>maxColumns)invalid('OpenBB SSRM output column limit exceeded');
    if(!sourceColumns&&next.inputColumns.length)sourceColumns=next.inputColumns;
    active=next;
    return {...context(candidate.revision,next.id,page.warnings),kind:'viewReady',columns:structuredClone(next.columns),topLevelCount:page.rowCount,inspection:{inputColumns:structuredClone(sourceColumns??[]),inputPeriodicity:{},definition:candidate.definition,aggregations:{}}};
   },
   async rows(revision,request,signal):Promise<ProviderRowBlock>{
    check(signal);inert(request);const r=structuredClone(revision),q=structuredClone(request),state=published(r);
    coordinate(q.offset);positiveLimit(q.limit,1);if(q.limit>maxRows||!Number.isSafeInteger(q.offset+q.limit))invalid('OpenBB SSRM row request limit exceeded');
    if(!Array.isArray(q.groupPath)||q.groupPath.length>state.query.rowGroupCols.length)invalid('Invalid OpenBB group path');
    const parent=q.groupPath.length?state.paths.get(q.groupPath.at(-1)!):undefined;
    if(q.groupPath.length&&(!parent||signature(parent.path)!==signature(q.groupPath)||parent.path.some((p,i)=>p!==q.groupPath[i])))invalid('Unknown OpenBB group path');
    const query={...state.query,startRow:q.offset,endRow:q.offset+q.limit,groupKeys:parent?.keys??[]},page=await takeFirst(state,query,signal);
    if(published(r)!==state)mismatch('OpenBB result changed while reading');
    const depth=q.groupPath.length;verifySchema(state,depth,page.schema);
    verifyTypes(state,depth,page.rows);
    const groupField=state.query.pivotMode?undefined:state.query.rowGroupCols[depth]?.field,groups:ProviderRowBlock['groups']=[];
    const additions:{key:string;path:string[];keys:string[]}[]=[],seen=new Set<string>();
    const rows:DatasetRow[]=page.rows.map(values=>{
     let id:string=crypto.randomUUID();
     if(groupField){
      const value=values[groupField];if(typeof value!=='string'&&!(typeof value==='number'&&Number.isFinite(value)))invalid('Unrepresentable OpenBB group key');
      const keys=[...query.groupKeys,String(value)],key=JSON.stringify(keys);
      if(seen.has(key))invalid('Duplicate OpenBB group key');seen.add(key);
      const path=state.keysToPath.get(key)??[...q.groupPath,crypto.randomUUID()];id=path.at(-1)!;
      additions.push({key,path,keys});groups.push({rowId:id,path:[...path],childCount:{kind:'unknown'}});
     }
     return {id,values};
    });
    if(state.keysToPath.size+additions.filter(a=>!state.keysToPath.has(a.key)).length>maxPaths)invalid('OpenBB group path limit exceeded');
    for(const item of additions){state.keysToPath.set(item.key,item.path);state.paths.set(item.path.at(-1)!,{path:item.path,keys:item.keys});}
    if(page.schema!==undefined)state.schemas.set(depth,page.schema);
    return {...context(r,state.id,page.warnings),kind:'rows',rows,groups,offset:q.offset,groupPath:q.groupPath,siblingCount:page.rowCount};
   },
   async selection(){refusal('selection');},async facets(){refusal('facets');},async totals(){refusal('totals');},async chartData(){refusal('chart');},
   async previewDefinition(){refusal('preview');},async bindFormula(){refusal('bindFormula');},async memberDomain(){refusal('memberDomain');},async columnProfile(){refusal('columnProfile');},async inspect(){refusal('inspection');},async identityWitness(){refusal('identityWitness');},
   async *presented(){yield refusal('export');},
   dispose(){if(disposed)return;disposed=true;active=undefined;lifetime.abort(new ProviderContractError({code:'SESSION_DISPOSED',message:'Provider session is disposed'}));}
  };
  return Object.freeze({sessionId,protocolVersion:1 as const,sourceSnapshotId,consistency:LIVE,capabilities,result});
 }};
}
