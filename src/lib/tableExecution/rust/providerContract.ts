// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type {TableExecutor,ProviderSession,ProviderCapabilities,ProviderCount,ProviderResultIdentity,ProviderSourceIdentity,SessionOptions,Revision,ProviderApplyRequirements} from '../types';
import {ProviderContractError,refusal} from './providerCapabilities';
import {assertUnicodeScalarGraph} from './wireCodec';
export {ProviderContractError,localCapabilities,capabilityPreflight} from './providerCapabilities';
export function validateSessionOptions(options:SessionOptions,capabilities:ProviderCapabilities):void {
 assertUnicodeScalarGraph({protocolVersion:options.protocolVersion,widgetId:options.widgetId,locale:options.locale});
 if(options.protocolVersion!==1||!capabilities.protocolVersions.includes(options.protocolVersion))throw new ProviderContractError({code:'UNSUPPORTED_PROTOCOL',message:'Unsupported provider protocol version'});
 if(!options.widgetId||!options.locale)throw new ProviderContractError({code:'INVALID_REQUEST',message:'Widget identity and explicit locale are required'});
 new Intl.Collator(options.locale);
 options.signal?.throwIfAborted();
}
/** Inspect inert requirements before cloning: malformed requests never reach publication. */
export function captureApplyRequirements(raw:unknown):ProviderApplyRequirements|undefined {
 if(raw===undefined)return undefined;
 try{assertUnicodeScalarGraph(raw);}catch(error){throw new ProviderContractError({code:'INVALID_REQUEST',message:error instanceof Error?error.message:'Invalid apply requirement'});}
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>key!=='counts')||(raw as {counts?:unknown}).counts!=='safeExact')throw new ProviderContractError({code:'INVALID_REQUEST',message:'Invalid provider apply requirements'});
 return {counts:'safeExact'};
}
/** The current renderer requires exact counts. A future SSRM renderer must handle the tagged alternatives. */
export function exactRendererCount(count:ProviderCount):number {
 if(count.kind!=='exact')throw new ProviderContractError({code:count.kind==='snapshotExpired'?'SNAPSHOT_EXPIRED':'COUNT_UNAVAILABLE',message:'The current table renderer requires an exact count'});
 if(!Number.isSafeInteger(count.value)||count.value<0)throw new ProviderContractError({code:'INVALID_REQUEST',message:'Invalid exact result count'});
 return count.value;
}
export function tableExecutorAdapter(session:ProviderSession):TableExecutor {
 const source=session.result,safeExactCountAdmission=session.capabilities.safeExactCountAdmission===true;
 const plain=<T extends object>(value:T)=>{if(session.consistency?.kind==='live'||(value as ProviderSourceIdentity).consistency?.kind==='live')refusal('snapshot consistency');const {sessionId:_sessionId,sourceSnapshotId:_snapshotId,resultId:_resultId,consistency:_consistency,...rest}=value as T&ProviderResultIdentity;return rest;};
 return {
  registerInput:async()=>refusal('sourceRebinding: open a new provider session'),
  async applyModel(definition,selection,revision,signal,reconcileMissing,previousSelectionNamespace,provenAbsentIds,runtimeParams){
   if(session.consistency?.kind==='live')refusal('snapshot consistency');
   if(!safeExactCountAdmission)throw new ProviderContractError({code:'COUNT_UNAVAILABLE',message:'Provider does not implement safe exact count admission'});
   // Explicit full arity keeps requirements ninth even when optional legacy arguments are omitted.
   const value=await source.applyModel(definition,selection,revision,signal,reconcileMissing,previousSelectionNamespace,provenAbsentIds,runtimeParams,{counts:'safeExact'});
   return {...plain(value),topLevelCount:exactRendererCount(value.topLevelCount)};
  },
  async rows(revision,request,signal){
   if(session.consistency?.kind==='live')refusal('snapshot consistency');
   const bound=session.rowBlockLimit;
   if(bound!==undefined&&(!Number.isSafeInteger(bound)||bound<1||!Number.isSafeInteger(request.limit)||request.limit<1||request.limit>100))throw new ProviderContractError({code:'INVALID_REQUEST',message:'Invalid bounded renderer row request'});
   const captured=structuredClone({revision,request});
   const read=async(offset:number,limit:number)=>{
    const value=await source.rows(captured.revision,{...captured.request,offset,limit},signal);
    plain(value);exactRendererCount(value.siblingCount);
    return value;
   };
   const value=await read(captured.request.offset,Math.min(captured.request.limit,bound??captured.request.limit));
   if(bound!==undefined){
    const rows=[...value.rows],groups=[...value.groups],total=exactRendererCount(value.siblingCount);
    const needed=Math.min(captured.request.limit,Math.max(0,total-captured.request.offset));
    while(rows.length<needed){
     if(!rows.length)throw new ProviderContractError({code:'INVALID_REQUEST',message:'Incomplete managed row block'});
     const offset=captured.request.offset+rows.length,limit=Math.min(bound,needed-rows.length),next=await read(offset,limit);
     if(next.sessionId!==value.sessionId||next.sourceSnapshotId!==value.sourceSnapshotId||next.resultId!==value.resultId||next.offset!==offset||JSON.stringify(next.groupPath)!==JSON.stringify(value.groupPath)||!sameProviderRevision(next.revision,value.revision)||exactRendererCount(next.siblingCount)!==total)throw new ProviderContractError({code:'REVISION_MISMATCH',message:'Managed row block changed during delivery'});
     if(!next.rows.length||next.rows.length>limit)throw new ProviderContractError({code:'INVALID_REQUEST',message:'Incomplete managed row block'});
     rows.push(...next.rows);groups.push(...next.groups);
    }
    if(rows.length!==needed||new Set(rows.map(row=>row.id)).size!==rows.length)throw new ProviderContractError({code:'INVALID_REQUEST',message:'Invalid managed row block'});
    value.rows=rows;value.groups=groups;
   }
   return {...plain(value),siblingCount:exactRendererCount(value.siblingCount),groups:value.groups.map(group=>({...group,childCount:exactRendererCount(group.childCount)}))};
  },
  selection:async(...args)=>plain(await source.selection(...args)),facets:async(...args)=>plain(await source.facets(...args)),totals:async(...args)=>plain(await source.totals(...args)),chartData:async(...args)=>plain(await source.chartData(...args)),
  ...(source.inspect?{inspect:async(...args:Parameters<NonNullable<TableExecutor['inspect']>>)=>plain(await source.inspect!(...args))}:{}),
  ...(source.previewDefinition?{previewDefinition:async(...args:Parameters<NonNullable<TableExecutor['previewDefinition']>>)=>plain(await source.previewDefinition!(...args))}:{}),
  ...(source.bindFormula?{bindFormula:async(...args:Parameters<NonNullable<TableExecutor['bindFormula']>>)=>plain(await source.bindFormula!(...args))}:{}),
  ...(source.memberDomain?{memberDomain:async(...args:Parameters<NonNullable<TableExecutor['memberDomain']>>)=>plain(await source.memberDomain!(...args))}:{}),
  ...(source.columnProfile?{columnProfile:async(...args:Parameters<NonNullable<TableExecutor['columnProfile']>>)=>plain(await source.columnProfile!(...args))}:{}),
  ...(source.identityWitness?{identityWitness:async(...args:Parameters<NonNullable<TableExecutor['identityWitness']>>)=>plain(await source.identityWitness!(...args))}:{}),
  async *presented(...args){if(session.consistency?.kind==='live')refusal('snapshot consistency');for await(const batch of source.presented(...args))yield plain(batch);},dispose:()=>source.dispose()
 };
}

function sameProviderRevision(a:Revision,b:Revision){return a.widgetId===b.widgetId&&a.input===b.input&&a.model===b.model&&a.output===b.output;}
