// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/** TEST ONLY. Deterministic backend double: complete fixture ownership, no network or production import. */
import type {WidgetDataset} from '../../widgetData/types';
import type {ExecutionProvider,ExecutionRequest,ExecutionResponse,ProviderCapabilities,ProviderCount,TableExecutor,Revision,ViewReady,RowBlock,SubsetBatch,ProviderResultExecutor,SelectionResult,FacetResult,TotalResult,ChartResult,InspectionResult,DefinitionPreview,FormulaBindResult,MemberDomainResult,IdentityWitnessResult} from '../types';
import type {RustRuntime} from './runtime';
import type {LocalWorkerExecutor,ProviderSession,ProviderResultIdentity,ProviderSourceIdentity,SessionOptions,TableDefinition,SelectionSpec} from '../types';
import {validateSessionOptions,exactRendererCount,captureApplyRequirements} from './providerContract';
import {ProviderContractError,capabilityPreflight,freezeCapabilities,localCapabilities,refusal,requireFeature} from './providerCapabilities';
export function createRemoteProviderFixture(config:{runtime:RustRuntime;sourceId:string;snapshotId:string;input:WidgetDataset;capabilities?:ProviderCapabilities;count?:ProviderCount;counts?:{topLevel?:ProviderCount;sibling?:ProviderCount;child?:ProviderCount};batchRows?:number}) {
 // Capture a complete immutable fixture before delivery. Fetched result rows never become calculation input.
 const input=structuredClone(config.input),sourceId=config.sourceId,snapshotId=config.snapshotId;
 const capabilities:ProviderCapabilities={...(config.capabilities??localCapabilities()),remoteAcquisition:true};
 let expired=false;
 const live=()=>{if(expired)throw new ProviderContractError({code:'SNAPSHOT_EXPIRED',message:'The bound source snapshot expired',sourceSnapshotId:snapshotId});};
 const provider:ExecutionProvider={async open(source,options){
  validateSessionOptions(options,capabilities);live();
  if(source.kind!=='remote')refusal('localAcquisition');
  if(!capabilities.remoteAcquisition)refusal('remoteAcquisition');
  if(source.sourceId!==sourceId||source.snapshotId!==snapshotId)throw new ProviderContractError({code:'INVALID_REQUEST',message:'Unknown fixture source snapshot'});
  const handle=config.runtime.open_session({protocolVersion:1,locale:options.locale,batchRows:config.batchRows??1});
  let closed=false,requestSequence=0,transferSequence=0;
  const call=<T extends ExecutionResponse>(revision:Revision,command:object,signal?:AbortSignal):T=>{
   live();signal?.throwIfAborted();
   if(closed)throw new ProviderContractError({code:'SESSION_DISPOSED',message:'Fixture session is disposed'});
   const response=config.runtime.dispatch(handle,{requestId:`fixture-${++requestSequence}`,revision,...command} as ExecutionRequest);
   if(!response)throw new Error('Missing fixture Rust response');
   if(response.kind==='error')throw new ProviderContractError({code:response.error.code==='REVISION_MISMATCH'?'REVISION_MISMATCH':'INVALID_REQUEST',message:response.error.message});
   return response as T;
  };
  const executor:Omit<TableExecutor,'registerInput'>={
   applyModel:async(definition,selection,revision,signal,reconcileMissing,previousSelectionNamespace,provenAbsentIds,runtimeParams)=>call<ViewReady>(revision,{kind:'applyModel',definition,selection,reconcileMissing,previousSelectionNamespace,provenAbsentIds,runtimeParams},signal),
   rows:async(revision,request,signal)=>call<RowBlock>(revision,{kind:'rows',request},signal),
   selection:async(revision,action,visibleIds,signal)=>call<SelectionResult>(revision,{kind:'selection',action,visibleIds},signal),
   facets:async(revision,categoryId,signal)=>call<FacetResult>(revision,{kind:'facets',categoryId},signal),
   totals:async(revision,signal)=>call<TotalResult>(revision,{kind:'totals'},signal),
   chartData:async(revision,fields,signal)=>call<ChartResult>(revision,{kind:'chartData',fields},signal),
   inspect:async(revision,request,signal)=>call<InspectionResult>(revision,{kind:'inspect',...request},signal),
   previewDefinition:async(revision,definition,signal)=>call<DefinitionPreview>(revision,{kind:'previewDefinition',definition},signal),
   bindFormula:async(revision,request,signal)=>call<FormulaBindResult>(revision,{kind:'bindFormula',...request},signal),
   memberDomain:async(revision,request,signal)=>call<MemberDomainResult>(revision,{kind:'memberDomain',...request},signal),
   identityWitness:async(revision,path,ids,signal)=>call<IdentityWitnessResult>(revision,{kind:'identityWitness',path,ids},signal),
   async *presented(revision,signal,ignoreSelection){
    const transferId=`fixture-transfer-${++transferSequence}`,requestId=`fixture-export-${transferSequence}`;let sequence=0;
    try{for(;;){const batch=call<SubsetBatch>(revision,sequence===0?{kind:'presented',requestId,transferId,ignoreSelection}:{kind:'nextSubset',requestId,transferId,sequence},signal);yield batch;if(batch.final)return;sequence++;}}
    finally{if(!closed&&!expired)config.runtime.dispatch(handle,{kind:'cancel',requestId:`fixture-cancel-${++requestSequence}`,targetRequestId:requestId,revision});}
   },
   dispose(){if(closed)return;closed=true;config.runtime.close_session(handle);}
  };
  try{
   // Backend authority registers ALL acquired fixture records once, before any result page is requested.
   call({widgetId:options.widgetId,input:input.resultRevision,model:0,output:0},{kind:'registerInput',input,inputRevision:input.resultRevision},options.signal);
   const session=createProviderSession(executor,options,input.resultRevision,snapshotId,capabilities,live,()=>true);
   const count=config.count,counts=config.counts;let publishedPolicy:{topLevel?:ProviderCount;sibling?:ProviderCount;child?:ProviderCount}={};
   if(!count&&!counts)return session;
   // Fault injection only: the backend can deliver rows while its total is unavailable.
   return Object.freeze({...session,result:{...session.result,
    async applyModel(...args:Parameters<ProviderResultExecutor['applyModel']>){
     // Capture count policy for this complete source snapshot/candidate before awaiting publication.
     const policy=structuredClone({topLevel:counts?.topLevel??count,sibling:counts?.sibling??count,child:counts?.child??count}),requirements=captureApplyRequirements(args[8]);
     if(requirements){
      if(capabilities.safeExactCountAdmission!==true)throw new ProviderContractError({code:'COUNT_UNAVAILABLE',message:'Fixture cannot admit safe exact counts'});
      // Unoverridden counts are guaranteed safe/exact by the complete Rust session, independent of pages.
      for(const value of Object.values(policy))if(value)exactRendererCount(value);
     }
     const [definition,selection,revision,signal,reconcileMissing,previousSelectionNamespace,provenAbsentIds,runtimeParams]=args;
     const ready=await session.result.applyModel(definition,selection,revision,signal,reconcileMissing,previousSelectionNamespace,provenAbsentIds,runtimeParams,requirements);publishedPolicy=policy;
     return {...ready,topLevelCount:structuredClone(policy.topLevel??ready.topLevelCount)};
    },
    async rows(...args:Parameters<TableExecutor['rows']>){const block=await session.result.rows(...args);return {...block,siblingCount:structuredClone(publishedPolicy.sibling??block.siblingCount),groups:block.groups.map(group=>({...group,childCount:structuredClone(publishedPolicy.child??group.childCount)}))};}
   }});
  }catch(error){executor.dispose();throw error;}
 }};
 return {provider,expire(){expired=true;}};
}
/** Local acquisition belongs to LocalWorkerExecutor; no source dataset is required by remote sessions. */
export function createLocalExecutionProvider(createExecutor:(options:SessionOptions)=>LocalWorkerExecutor,declared=localCapabilities()):ExecutionProvider {
 const capabilities=freezeCapabilities(declared);
 return {async open(source,options){
  validateSessionOptions(options,capabilities);
  if(source.kind!=='local')refusal('remoteAcquisition');
  if(!Number.isSafeInteger(source.inputRevision)||source.inputRevision<0)throw new ProviderContractError({code:'INVALID_REQUEST',message:'Invalid input revision'});
  const capturedOptions={...options},inputRevision=source.inputRevision;
  const executor=createExecutor(capturedOptions);
  try{await executor.registerInput(source.input,inputRevision,capturedOptions.signal??new AbortController().signal);}
  catch(error){executor.dispose();throw error;}
  return createProviderSession(executor,capturedOptions,inputRevision,crypto.randomUUID(),capabilities,undefined,()=>true);
 }};
}
/** Shared result decoration/preflight for the local adapter and test-only remote fixture. */
export function createProviderSession(executor:Omit<TableExecutor,'registerInput'>,options:SessionOptions,inputRevision:number,sourceSnapshotId:string,declared:ProviderCapabilities,guard:()=>void=()=>{},admitSafeExactCounts?: (candidate:{definition:TableDefinition;selection:SelectionSpec;revision:Revision;sourceSnapshotId:string})=>boolean):ProviderSession {
 const capabilities=freezeCapabilities(declared),sessionId=crypto.randomUUID(),widgetId=options.widgetId;
 let disposed=false,active:{revision:Revision;resultId:string}|undefined,applySequence=0;
 const check=(signal?:AbortSignal)=>{if(disposed)throw new ProviderContractError({code:'SESSION_DISPOSED',message:'Provider session is disposed'});signal?.throwIfAborted();guard();};
 const bound=(revision:Revision)=>{if(revision.widgetId!==widgetId||revision.input!==inputRevision)throw new ProviderContractError({code:'REVISION_MISMATCH',message:'Request does not match the bound source snapshot'});};
 const identity=(revision:Revision):ProviderResultIdentity=>{
  bound(revision);if(!active||(['widgetId','input','model','output'] as const).some(k=>active!.revision[k]!==revision[k]))throw new ProviderContractError({code:'REVISION_MISMATCH',message:'Request does not match the published result'});
  return {sessionId,sourceSnapshotId,resultId:active.resultId,consistency:{kind:'snapshot'}};
 };
 const read=async<T>(revision:Revision,signal:AbortSignal,operation:()=>Promise<T>)=>{check(signal);const id=identity(revision);const value=await operation();check(signal);if(identity(revision).resultId!==id.resultId)throw new ProviderContractError({code:'REVISION_MISMATCH',message:'Result changed while reading'});return {...value,...id};};
 const sourceRead=async<T>(revision:Revision,signal:AbortSignal,operation:()=>Promise<T>):Promise<T&ProviderSourceIdentity>=>{
  check(signal);bound(revision);const value=await operation();check(signal);
  // Authoring evaluates a candidate against source ownership, not the published result.
  return {...value,sessionId,sourceSnapshotId,consistency:{kind:'snapshot'} as const};
 };
 const exact=(value:number):ProviderCount=>({kind:'exact',value});
 const result:ProviderResultExecutor={
  async applyModel(definition,selection,revision,signal,reconcileMissing,previousSelectionNamespace,provenAbsentIds,runtimeParams,requirements){
   check(signal);bound(revision);capabilityPreflight(capabilities,definition,selection,runtimeParams);
   const admittedRequirement=captureApplyRequirements(requirements);
   const candidate=structuredClone({definition,selection,revision,reconcileMissing,previousSelectionNamespace,provenAbsentIds,runtimeParams,requirements:admittedRequirement});
   if(candidate.requirements){
    if(capabilities.safeExactCountAdmission!==true||!admitSafeExactCounts)throw new ProviderContractError({code:'COUNT_UNAVAILABLE',message:'Provider cannot guarantee safe exact counts before publication'});
    if(admitSafeExactCounts({...candidate,sourceSnapshotId})!==true)throw new ProviderContractError({code:'COUNT_UNAVAILABLE',message:'Candidate cannot guarantee safe exact counts'});
   }
   const ticket=++applySequence;
   const ready=await executor.applyModel(candidate.definition,candidate.selection,candidate.revision,signal,candidate.reconcileMissing,candidate.previousSelectionNamespace,candidate.provenAbsentIds,candidate.runtimeParams);check(signal);
   if(ticket!==applySequence)throw new ProviderContractError({code:'REVISION_MISMATCH',message:'Apply was superseded'});
   active={revision:{...ready.revision},resultId:crypto.randomUUID()};
   return {...ready,...identity(ready.revision),topLevelCount:exact(ready.topLevelCount)};
  },
  async rows(revision,request,signal){const block=await read(revision,signal,()=>executor.rows(revision,request,signal));return {...block,siblingCount:exact(block.siblingCount),groups:block.groups.map(group=>({...group,childCount:exact(group.childCount)}))};},
  async selection(revision,action,visibleIds,signal){if(!capabilities.selection)refusal('selection');return read(revision,signal,()=>executor.selection(revision,action,visibleIds,signal));},
  facets(revision,categoryId,signal){return read(revision,signal,()=>executor.facets(revision,categoryId,signal));},
  totals(revision,signal){return read(revision,signal,()=>executor.totals(revision,signal));},
  async chartData(revision,fields,signal){requireFeature(capabilities,'chart');return read(revision,signal,()=>executor.chartData(revision,fields,signal));},
  async inspect(revision,request,signal){if(!capabilities.inspection||!executor.inspect)refusal('inspection');return read(revision,signal,()=>executor.inspect!(revision,request,signal));},
  async previewDefinition(revision,definition,signal){requireFeature(capabilities,'preview');if(!executor.previewDefinition)refusal('preview');capabilityPreflight(capabilities,definition,{kind:'none'});return sourceRead(revision,signal,()=>executor.previewDefinition!(revision,definition,signal));},
  async bindFormula(revision,request,signal){requireFeature(capabilities,'bindFormula');if(!executor.bindFormula)refusal('bindFormula');capabilityPreflight(capabilities,request.definition,{kind:'none'});return sourceRead(revision,signal,()=>executor.bindFormula!(revision,request,signal));},
  async memberDomain(revision,request,signal){requireFeature(capabilities,'memberDomain');if(!executor.memberDomain)refusal('memberDomain');capabilityPreflight(capabilities,request.definition,{kind:'none'});return sourceRead(revision,signal,()=>executor.memberDomain!(revision,request,signal));},
  async identityWitness(revision,path,ids,signal){if(!capabilities.identityWitness||!executor.identityWitness)refusal('identityWitness');path.forEach(d=>capabilityPreflight(capabilities,d,{kind:'none'}));return read(revision,signal,()=>executor.identityWitness!(revision,path,ids,signal));},
  async *presented(revision,signal,ignoreSelection){
   requireFeature(capabilities,'export');check(signal);const id=identity(revision);
   const iterator=executor.presented(revision,signal,ignoreSelection)[Symbol.asyncIterator]();
   try{for(;;){check(signal);if(identity(revision).resultId!==id.resultId)throw new ProviderContractError({code:'REVISION_MISMATCH',message:'Result changed while exporting'});const next=await iterator.next();check(signal);if(next.done)return;if(identity(revision).resultId!==id.resultId)throw new ProviderContractError({code:'REVISION_MISMATCH',message:'Result changed while exporting'});yield {...next.value,...id};}}
   finally{await iterator.return?.();}
  },
  dispose(){if(disposed)return;disposed=true;active=undefined;executor.dispose();}
 };
 return Object.freeze({sessionId,protocolVersion:1 as const,sourceSnapshotId,consistency:{kind:'snapshot'} as const,capabilities,result});
}
