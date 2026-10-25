// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type {ExecutionProvider,ExecutionRequest,ExecutionResponse,ProviderCapabilities,ProviderResultExecutor,ProviderResultIdentity,ProviderSession,ProviderSourceIdentity,Revision,SessionOptions,SourceBinding,SubsetBatch} from '../types';
import {AGG_NAMES} from '../../types';
import {ExecutionProtocolError} from '../validation';
import {ProviderContractError,capabilityPreflight,freezeCapabilities,localCapabilities,refusal,requireFeature} from '../rust/providerCapabilities';
import {captureApplyRequirements,validateSessionOptions} from '../rust/providerContract';
import {decodeResponse,encodeRequest,presentationShape,type PresentationShape} from '../rust/protocol';
import {assertUnicodeScalarGraph} from '../rust/wireCodec';
import {createRemoteTransport,withRemoteSignal,positiveLimit,RemoteHttpError,type RemoteTransportConfig} from './transport';
/** HTTP identities wrap the core wire envelope without replacing its numeric handle. */
type RemoteIdentity={sessionId:string;sourceSnapshotId:string;resultId?:string};

export interface RemoteProviderConfig extends RemoteTransportConfig {
 /** Explicit compatibility default for remote bindings predating managed v1 metadata. */
 inputRevision?:number;
 maxWireBytes?:number;
 maxRowBlockRows?:number;
 maxExportBatches?:number;
}
type ObjectValue=Record<string,unknown>;
function object(raw:unknown):ObjectValue {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))invalid('Malformed managed table response');
 return raw as ObjectValue;
}
function invalid(message:string):never{throw new ProviderContractError({code:'INVALID_REQUEST',message});}
function inert(raw:unknown):void{try{assertUnicodeScalarGraph(raw);}catch{invalid('Unsafe managed request graph');}}
function mismatch(message='Managed result identity or revision changed'):never{throw new ProviderContractError({code:'REVISION_MISMATCH',message});}
function id(raw:unknown):string{if(typeof raw!=='string'||!raw||raw.length>4096)invalid('Invalid managed table identity');return raw;}
function negotiatedLimit(raw:unknown):number{if(!Number.isSafeInteger(raw)||(raw as number)<1)invalid('Invalid managed negotiated limit');return raw as number;}
function inputCoordinate(raw:unknown):number{if(!Number.isSafeInteger(raw)||(raw as number)<0)invalid('Explicit managed input revision is required');return raw as number;}
const sameRevision=(a:Revision,b:Revision)=>(['widgetId','input','model','output'] as const).every(k=>a[k]===b[k]);
const sameIdentity=(a:RemoteIdentity,b:RemoteIdentity)=>a.sessionId===b.sessionId&&a.sourceSnapshotId===b.sourceSnapshotId&&a.resultId===b.resultId;
function parseCapabilities(raw:unknown):ProviderCapabilities {
 const c=object(raw);
 const list=(key:string,allowed:readonly unknown[])=>{if(!Array.isArray(c[key])||(c[key] as unknown[]).some(x=>!allowed.includes(x)))invalid('Malformed managed capabilities');};
 list('protocolVersions',[1]);list('definitionVersions',[1,2]);list('aggregations',AGG_NAMES);list('formulaFunctions',[...AGG_NAMES,'IF']);
 list('features',['grouping','splits','sourceFormulas','aggregateFormulas','memberScope','runtimeParams','checklists','resultFilters','statement','preview','bindFormula','memberDomain','chart','export']);
 for(const name of ['fiscal','inspection','selection','identityWitness','remoteAcquisition'])if(typeof c[name]!=='boolean')invalid('Malformed managed capabilities');
 if(c.linkedDerivation!==undefined&&typeof c.linkedDerivation!=='boolean')invalid('Malformed managed capabilities');
 if(c.safeExactCountAdmission!==undefined&&typeof c.safeExactCountAdmission!=='boolean')invalid('Malformed managed capabilities');
 return freezeCapabilities(c as unknown as ProviderCapabilities);
}
/** A remote provider never acquires source rows or calculates locally. Expiry requires a new open. */
export function createManagedProvider(config:RemoteProviderConfig):ExecutionProvider {
 const transport=createRemoteTransport(config),wireLimit=positiveLimit(config.maxWireBytes,1024*1024),rowLimit=positiveLimit(config.maxRowBlockRows,500),batchLimit=positiveLimit(config.maxExportBatches,10_000);
 const defaultInput=config.inputRevision===undefined?undefined:inputCoordinate(config.inputRevision);
 const bind=async(opened:ObjectValue,captured:SessionOptions,initialRevision:number,derived=false):Promise<ProviderSession>=>{
  let inputRevision=initialRevision;
  const sessionId=id(opened.sessionId),sessionPath=`sessions/${encodeURIComponent(sessionId)}`;
  let snapshotId:string,capabilities:ProviderCapabilities,maxRows:number,responseWireLimit:number;
  try{
   snapshotId=id(opened.sourceSnapshotId);capabilities=parseCapabilities(opened.capabilities);
   validateSessionOptions(captured,capabilities);if(!capabilities.remoteAcquisition)refusal('remoteAcquisition');
   const limits=object(opened.limits);maxRows=Math.min(rowLimit,negotiatedLimit(limits.max_row_block_rows));
   responseWireLimit=negotiatedLimit(limits.max_export_batch_bytes);negotiatedLimit(opened.expiresInSeconds);
  }catch(error){void transport.json('DELETE',sessionPath).catch(()=>{});throw error;}
  let disposed=false,expired=false,active:{revision:Revision;id:ProviderResultIdentity;shape:PresentationShape}|undefined;
  const lifetime=new AbortController(),exports=new Set<()=>Promise<void>>();
  let requestSequence=0,applySequence=0,modelHigh=-1,outputHigh=-1,inputHigh=inputRevision;
  const check=(signal?:AbortSignal)=>{
   if(disposed)throw new ProviderContractError({code:'SESSION_DISPOSED',message:'Provider session is disposed'});
   signal?.throwIfAborted();
   if(expired)throw new ProviderContractError({code:'SNAPSHOT_EXPIRED',message:'Managed session expired; open a new session',sourceSnapshotId:snapshotId});
  };
  const http=async(method:'GET'|'POST'|'DELETE',path:string,body:unknown,signal?:AbortSignal)=>{
   try{return await transport.json(method,path,body,signal);}
   catch(error){if(error instanceof RemoteHttpError){if(error.status===410){expired=true;throw new ProviderContractError({code:'SNAPSHOT_EXPIRED',message:'Managed session expired; open a new session',sourceSnapshotId:snapshotId});}if(error.status===409)mismatch();}throw error;}
  };
  const boundSource=(r:Revision)=>{inert(r);if(r.widgetId!==captured.widgetId||r.input!==inputRevision)mismatch('Request does not match managed source revision');};
  const identity=(r:Revision):ProviderResultIdentity=>{boundSource(r);if(!active||!sameRevision(active.revision,r))mismatch('Request does not match published managed result');return {...active.id};};
  const request=(revision:Revision,command:object):ExecutionRequest=>{inert(revision);inert(command);return structuredClone({requestId:`managed-${++requestSequence}`,revision:{...revision},...command}) as ExecutionRequest;};
  const envelope=(q:ExecutionRequest,identity:RemoteIdentity,refresh?:{inputRevision:number})=>{
   const wire=encodeRequest(q,captured.locale,1);
   if(new TextEncoder().encode(wire).byteLength>wireLimit)invalid('Managed table wire byte limit exceeded');
   return {...identity,wire,...(refresh?{refresh}:{})};
  };
  const decode=(raw:unknown,q:ExecutionRequest,expected:RemoteIdentity,shape:PresentationShape,apply=false,refresh=false)=>{
   const reply=object(raw),returned:RemoteIdentity={sessionId:id(reply.sessionId),sourceSnapshotId:id(reply.sourceSnapshotId),...(reply.resultId===undefined?{}:{resultId:id(reply.resultId)})};
   if(returned.sessionId!==expected.sessionId||(!refresh&&returned.sourceSnapshotId!==expected.sourceSnapshotId)||(!apply&&returned.resultId!==expected.resultId))mismatch();
   if(typeof reply.wire!=='string')invalid('Missing managed response wire');
   if(new TextEncoder().encode(reply.wire).byteLength>responseWireLimit)invalid('Managed table response wire byte limit exceeded');
   let value:ExecutionResponse|undefined;
   try{value=decodeResponse(reply.wire,q,1,shape);}
   catch(error){if(error instanceof Error&&error.message==='Unsupported Rust result count')throw new ProviderContractError({code:'COUNT_UNAVAILABLE',message:'Managed provider did not return safe exact counts'});if(error instanceof ExecutionProtocolError&&error.descriptor.code==='REVISION_MISMATCH')mismatch();invalid('Malformed managed response wire');}
   if(!value)invalid('Missing managed execution response');
   if(value.kind==='error')throw new ExecutionProtocolError(value.error.code,value.error.message);
   if(apply&&!returned.resultId)invalid('Missing managed result identity');
   if(apply&&returned.resultId===expected.resultId)mismatch('New apply recycled a managed result identity');
   if(refresh&&returned.sourceSnapshotId===expected.sourceSnapshotId)mismatch('Refresh did not publish a new source snapshot');
   const kind=q.kind==='applyModel'?'viewReady':q.kind==='presented'||q.kind==='nextSubset'?'subset':q.kind;
   if(value.kind!==kind)invalid('Managed response operation mismatch');
   return {...value,...returned,consistency:{kind:'snapshot'} as const};
  };
  const execute=async(q:ExecutionRequest,expected:RemoteIdentity,signal:AbortSignal,shape:PresentationShape,refresh?:{inputRevision:number})=>{
   check(signal);const body=envelope(q,expected,refresh);
   const abort=()=>{void transport.json('POST',`${sessionPath}/cancel`,{targetRequestId:q.requestId}).catch(()=>{});};
   signal.addEventListener('abort',abort,{once:true});
   try{const value=await withRemoteSignal(signal,lifetime.signal,combined=>http('POST',`${sessionPath}/commands`,body,combined));check(signal);return decode(value,q,expected,shape,q.kind==='applyModel',!!refresh);}
   finally{signal.removeEventListener('abort',abort);}
  };
  const read=async(revision:Revision,command:object,signal:AbortSignal)=>{
   check(signal);const expected=identity(revision),q=request(revision,command),shape=active!.shape;
   const value=await execute(q,expected,signal,shape);
   if(!sameIdentity(identity(q.revision),expected))mismatch();
   return value;
  };
  const sourceRead=async(revision:Revision,command:object,signal:AbortSignal)=>{
   check(signal);boundSource(revision);const expected:RemoteIdentity={sessionId,sourceSnapshotId:snapshotId,...(active?{resultId:active.id.resultId}:{})};
   const value=await execute(request(revision,command),expected,signal,active?.shape??'raw');
   if(snapshotId!==expected.sourceSnapshotId)mismatch();
   // Authoring has source ownership even when a publication exists.
   const {resultId:_resultId,...sourceValue}=value;return sourceValue as ExecutionResponse&ProviderSourceIdentity;
  };
  const result:ProviderResultExecutor={
   async applyModel(definition,selection,revision,signal,reconcileMissing,previousSelectionNamespace,provenAbsentIds,runtimeParams,requirements){
    check(signal);inert(revision);if(derived&&revision.input!==inputRevision)invalid('Derived source is immutable; derive a new child from its parent');if(revision.widgetId!==captured.widgetId||revision.input<inputHigh)mismatch();
    capabilityPreflight(capabilities,definition,selection,runtimeParams);
    if(captureApplyRequirements(requirements)&&capabilities.safeExactCountAdmission!==true)throw new ProviderContractError({code:'COUNT_UNAVAILABLE',message:'Managed provider cannot admit safe exact counts'});
    if(revision.model<=modelHigh||revision.output<=outputHigh)mismatch('Apply requires newer model and output revisions');
    const q=request(revision,{kind:'applyModel',definition,selection,reconcileMissing,previousSelectionNamespace,provenAbsentIds,runtimeParams});
    const expected:RemoteIdentity={sessionId,sourceSnapshotId:snapshotId,...(active?{resultId:active.id.resultId}:{})},refresh=q.revision.input>inputRevision?{inputRevision:q.revision.input}:undefined;
    // Encode and validate before consuming this attempt's revisions.
    envelope(q,expected,refresh);modelHigh=q.revision.model;outputHigh=q.revision.output;inputHigh=q.revision.input;const ticket=++applySequence;
    const value=await execute(q,expected,signal,presentationShape(definition),refresh);
    if(ticket!==applySequence)mismatch('Managed apply was superseded');
    if(value.kind!=='viewReady')invalid('Expected managed view');
    snapshotId=value.sourceSnapshotId;inputRevision=value.revision.input;
    active={revision:{...value.revision},id:{sessionId,sourceSnapshotId:snapshotId,resultId:value.resultId!},shape:presentationShape((q as Extract<ExecutionRequest,{kind:'applyModel'}>).definition)};
    return {...value,resultId:value.resultId!,topLevelCount:{kind:'exact',value:value.topLevelCount}};
   },
   async rows(revision,request,signal){
    inert(request);request=structuredClone(request);
    if(request.limit>maxRows)invalid('Managed row block limit exceeded');
    const value=await read(revision,{kind:'rows',request},signal);if(value.kind!=='rows')invalid('Expected managed rows');
    if(value.rows.length>request.limit||value.offset!==request.offset||JSON.stringify(value.groupPath)!==JSON.stringify(request.groupPath))invalid('Managed row block does not match request');
    return {...value,resultId:value.resultId!,siblingCount:{kind:'exact',value:value.siblingCount},groups:value.groups.map(g=>({...g,childCount:{kind:'exact' as const,value:g.childCount}}))};
   },
   async selection(revision,action,visibleIds,signal){if(!capabilities.selection)refusal('selection');return await read(revision,{kind:'selection',action,visibleIds},signal) as Awaited<ReturnType<ProviderResultExecutor['selection']>>;},
   async facets(revision,categoryId,signal){return await read(revision,{kind:'facets',categoryId},signal) as Awaited<ReturnType<ProviderResultExecutor['facets']>>;},
   async totals(revision,signal){return await read(revision,{kind:'totals'},signal) as Awaited<ReturnType<ProviderResultExecutor['totals']>>;},
   async chartData(revision,fields,signal){requireFeature(capabilities,'chart');return await read(revision,{kind:'chartData',fields},signal) as Awaited<ReturnType<ProviderResultExecutor['chartData']>>;},
   async inspect(revision,query,signal){inert(query);if(!capabilities.inspection)refusal('inspection');return await read(revision,{...query,kind:'inspect'},signal) as Awaited<ReturnType<NonNullable<ProviderResultExecutor['inspect']>>>;},
   async identityWitness(revision,path,ids,signal){if(!capabilities.identityWitness)refusal('identityWitness');path.forEach(d=>capabilityPreflight(capabilities,d,{kind:'none'}));return await read(revision,{kind:'identityWitness',path,ids},signal) as Awaited<ReturnType<NonNullable<ProviderResultExecutor['identityWitness']>>>;},
   async previewDefinition(revision,definition,signal){requireFeature(capabilities,'preview');capabilityPreflight(capabilities,definition,{kind:'none'});return await sourceRead(revision,{kind:'previewDefinition',definition},signal) as Awaited<ReturnType<NonNullable<ProviderResultExecutor['previewDefinition']>>>;},
   async bindFormula(revision,query,signal){inert(query);requireFeature(capabilities,'bindFormula');capabilityPreflight(capabilities,query.definition,{kind:'none'});return await sourceRead(revision,{...query,kind:'bindFormula'},signal) as Awaited<ReturnType<NonNullable<ProviderResultExecutor['bindFormula']>>>;},
   async memberDomain(revision,query,signal){inert(query);requireFeature(capabilities,'memberDomain');capabilityPreflight(capabilities,query.definition,{kind:'none'});return await sourceRead(revision,{...query,kind:'memberDomain'},signal) as Awaited<ReturnType<NonNullable<ProviderResultExecutor['memberDomain']>>>;},
   async *presented(revision,signal,ignoreSelection){
    requireFeature(capabilities,'export');check(signal);const pinned=identity(revision),shape=active!.shape;
    const q=request(revision,{kind:'presented',transferId:crypto.randomUUID(),ignoreSelection}) as Extract<ExecutionRequest,{kind:'presented'}>;
    let exportId:string|undefined,closing:Promise<void>|undefined;
    const close=():Promise<void>=>{if(!exportId)return Promise.resolve();return closing??=transport.json('DELETE',`exports/${encodeURIComponent(exportId)}`).then(()=>{},()=>{});};
    const abort=()=>{void close();void transport.json('POST',`${sessionPath}/cancel`,{targetRequestId:q.requestId}).catch(()=>{});};
    signal.addEventListener('abort',abort,{once:true});exports.add(close);
    try{
     const initial=object(await withRemoteSignal(signal,lifetime.signal,combined=>http('POST',`${sessionPath}/exports`,envelope(q,pinned),combined)));
     exportId=id(initial.exportId);check(signal);let raw=initial.batch;
     for(let sequence=0;;sequence++){
      check(signal);if(sequence>=batchLimit)invalid('Managed export batch limit exceeded');
      const pull:ExecutionRequest=sequence===0?q:{kind:'nextSubset',requestId:q.requestId,revision:q.revision,transferId:q.transferId,sequence};
      if(sequence>0)raw=await withRemoteSignal(signal,lifetime.signal,combined=>http('GET',`exports/${encodeURIComponent(exportId!)}/batches?sequence=${sequence}`,undefined,combined));
      check(signal);const value=decode(raw,pull,pinned,shape);
      if(value.kind!=='subset')invalid('Expected managed subset');
      if(value.sequence!==sequence||value.transferId!==q.transferId)invalid('Managed export sequence or transfer mismatch');
      if(value.rows.length>maxRows)invalid('Managed export row batch limit exceeded');
      yield value as SubsetBatch&ProviderResultIdentity;
      if(value.final)return;
     }
    }finally{signal.removeEventListener('abort',abort);exports.delete(close);await close();}
   },
   dispose(){if(disposed)return;disposed=true;active=undefined;lifetime.abort(new ProviderContractError({code:'SESSION_DISPOSED',message:'Provider session is disposed'}));for(const close of exports)void close();void transport.json('DELETE',sessionPath).catch(()=>{});}
  };
  const deriveLinked:ProviderSession['deriveLinked']=capabilities.linkedDerivation?async(revision,options)=>{
   check(options.signal);const childOptions={...options};validateSessionOptions(childOptions,capabilities);
   const childInput=inputCoordinate(childOptions.inputRevision),pinned=identity(revision),requestId=`derive-${++requestSequence}`;
   const body={parent:pinned,revision:{...revision},requestId,protocolVersion:1,widgetId:childOptions.widgetId,locale:childOptions.locale,inputRevision:childInput};
   return withRemoteSignal(childOptions.signal??new AbortController().signal,lifetime.signal,async combined=>{
    const abort=()=>{void transport.json('POST',`${sessionPath}/cancel`,{targetRequestId:requestId}).catch(()=>{});};
    combined.addEventListener('abort',abort,{once:true});
    let child:ProviderSession|undefined;
    try{
     const raw=object(await http('POST',`${sessionPath}/derive`,body,combined));
     if(raw.sessionId===pinned.sessionId)mismatch('Derived child recycled its parent session');
     child=await bind(raw,childOptions,childInput,true);
     if(child.sourceSnapshotId===pinned.sourceSnapshotId)mismatch('Derived child recycled its parent snapshot');
     check(combined);return child;
    }catch(error){abort();child?.result.dispose();throw error;}
    finally{combined.removeEventListener('abort',abort);}
   });
  }:undefined;
  return Object.freeze({sessionId,rowBlockLimit:maxRows,protocolVersion:1 as const,get sourceSnapshotId(){return snapshotId;},consistency:{kind:'snapshot'} as const,capabilities,result,...(deriveLinked?{deriveLinked}:{})});
 };
 return {async open(source:SourceBinding,options:SessionOptions):Promise<ProviderSession>{
  inert(source);
  if(source.kind!=='remote')refusal('managedAcquisition');
  const sourceId=id(source.sourceId),captured={...options};
  validateSessionOptions(captured,localCapabilities());
  if(source.managed!==undefined&&source.managed.version!==1)invalid('Unsupported managed source metadata version');
  const inputRevision=inputCoordinate(source.managed===undefined?defaultInput:source.managed.inputRevision);
  const opened=object(await transport.json('POST','sessions',{sourceId,protocolVersion:1,widgetId:captured.widgetId,locale:captured.locale,inputRevision},captured.signal));
  return bind(opened,captured,inputRevision);
 }};
}
