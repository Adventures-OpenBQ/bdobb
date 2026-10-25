// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {activeRuntimeKeys,validateRuntimeParams} from './runtimeParams';
import {validateExecutionResponse,validateTableModel as validateDefinition} from './validation';
import {validateTableModel} from '../tableModel/validation';
import {categoryRecipe} from '../tableModel/categories';
import {paramRow} from '../tableModel/pivotParams';
import type {ParamBinding,ParamGroup} from '../types';
import type {InspectionRequest,LocalWorkerExecutor,Revision,SelectionSpec,TableDefinition,GroupDomainSummary} from './types';

/** Admission limits for NEW group operations; existing authored intent is never normalized. */
export const PIVOT_GROUP_PROOF_LIMITS={keys:1024,textBytes:16384,payloadBytes:1048576,observed:100000,pages:1000} as const;
export type PivotGroupProofState={dashboardId:string;widgetId:string;owner:boolean;authorityToken:unknown;sourceIdentity:string;executor?:LocalWorkerExecutor;revision?:Revision;definition:TableDefinition;selection:SelectionSpec;bindings:readonly ParamBinding[];groups:readonly ParamGroup[];groupsDisabled:boolean;ready:boolean};
export type PivotGroupProofContext={dashboardId:string;widgetId:string;paramKey:string;targetGroupId?:string;selectedKeys?:readonly string[];read:()=>PivotGroupProofState;isCurrent:()=>boolean};
export type ProofMember={readonly key:string;readonly transport:string};
export type PivotGroupProofFence={readonly dashboardId:string;readonly widgetId:string;readonly paramKey:string;readonly categoryId:string;readonly categoryRecipe:string;readonly sourceFieldId:string;readonly label:string;readonly sourceIdentity:string;readonly revision:Revision;readonly definition:TableDefinition;readonly selection:SelectionSpec;readonly binding?:ParamBinding;readonly group?:ParamGroup};
export type FullPivotMatchProof={readonly fence:PivotGroupProofFence;readonly matchedKeys:readonly string[];readonly matchedMembers:readonly ProofMember[];readonly selectedMembers:readonly ProofMember[];readonly requestedKeys:readonly string[];readonly total:number;readonly matchedCount:number;readonly unmatchedCount:number};
export type PivotGroupProofResult={ok:true;proof:FullPivotMatchProof}|{ok:false;reason:string};
const authority=new WeakMap<object,{current:()=>boolean;executor:LocalWorkerExecutor;authorityToken:unknown}>();
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const bytes=(s:string)=>new TextEncoder().encode(s).length;
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
function capture(context:PivotGroupProofContext){
 const state=context.read();
 if(!context.isCurrent()||!state.owner||!state.ready||state.groupsDisabled||state.dashboardId!==context.dashboardId||state.widgetId!==context.widgetId||!state.executor?.inspect||!state.revision||state.revision.widgetId!==context.widgetId)throw new Error('Current owner and settled table are required.');
 validateDefinition(state.definition,state.selection);
 const model=validateTableModel(state.definition.analytical).model;
 const category=model?.categories.find(c=>c.id===activeRuntimeKeys(model).get(context.paramKey));
 if(!model||!category)throw new Error('The exact promoted Page or filter category is unavailable.');
 const bindings=state.bindings.filter(b=>b.paramName===context.paramKey);
 if(bindings.length>1)throw new Error('Duplicate Pivot bindings require repair.');
 const binding=bindings[0];const groupId=context.targetGroupId??binding?.groupId;
 const matches=state.groups.filter(g=>g.id===groupId);const group=matches[0];
 if(groupId&&matches.length!==1||group&&group.groupType!==category.sourceFieldId)throw new Error('Group is unavailable or incompatible.');
 if(group)validateRuntimeParams({[context.paramKey]:{source:'group',groupId:group.id,transportValue:group.value}},state.definition);
 const fence:PivotGroupProofFence={dashboardId:state.dashboardId,widgetId:state.widgetId,paramKey:context.paramKey,categoryId:category.id,categoryRecipe:categoryRecipe(category),sourceFieldId:category.sourceFieldId,label:paramRow(model).find(p=>p.key===context.paramKey)!.label,sourceIdentity:state.sourceIdentity,revision:state.revision,definition:state.definition,selection:state.selection,...(binding?{binding}:{}),...(group?{group}:{})};
 return {fence,executor:state.executor,authorityToken:state.authorityToken};
}
/** Local brand and live fence, not a serializable/naked UI array, confer retention authority. */
export function validatePivotGroupProof(proof:unknown,context:PivotGroupProofContext):proof is FullPivotMatchProof{
 if(!proof||typeof proof!=='object')return false;
 const known=authority.get(proof);if(!known||!known.current())return false;
 try{const next=capture(context);return next.executor===known.executor&&next.authorityToken===known.authorityToken&&equal((proof as FullPivotMatchProof).fence,next.fence)&&equal((proof as FullPivotMatchProof).requestedKeys,[...new Set(context.selectedKeys??[])]);}catch{return false;}
}
export async function collectPivotGroupProof(context:PivotGroupProofContext,signal:AbortSignal):Promise<PivotGroupProofResult>{
 try{
  if(signal.aborted)throw new Error('Proof collection cancelled.');
  const initial=capture(context),fence=structuredClone(initial.fence);
  validateRuntimeParams({[context.paramKey]:{source:'viewer',memberKeys:context.selectedKeys??[]}},fence.definition);
  const requested=[...new Set(context.selectedKeys??[])],wanted=new Set(requested),selectedIdentity=JSON.stringify(context.selectedKeys??[]);
  const current=()=>{try{const next=capture(context);return !signal.aborted&&JSON.stringify(context.selectedKeys??[])===selectedIdentity&&next.executor===initial.executor&&next.authorityToken===initial.authorityToken&&equal(next.fence,fence);}catch{return false;}};
  const matched=new Map<string,ProofMember>(),selected=new Map<string,ProofMember>(),seen=new Set<string>();
  let offset=0,pages=0,total:number|undefined,summary:Omit<GroupDomainSummary,'scanned'>|undefined;
  while(true){
   if(!current())throw new Error('Table, source, ownership, or group changed; collect fresh proof.');
   if(++pages>PIVOT_GROUP_PROOF_LIMITS.pages)throw new Error('Group proof traversal admission budget exceeded.');
   const request:InspectionRequest={collection:'groupDomain',paramKey:context.paramKey,categoryId:fence.categoryId,categoryRecipe:fence.categoryRecipe,...(fence.group?{groupEvidence:{groupId:fence.group.id,transportValue:fence.group.value}}:{}),offset,limit:100};
   const raw=await initial.executor.inspect!(fence.revision,request,signal);
   if(!current())throw new Error('Table, source, ownership, or group changed; collect fresh proof.');
   const id=Object.getOwnPropertyDescriptor(raw,'requestId');
   if(!id||!('value' in id)||typeof id.value!=='string')throw new Error('Inspection request identity must be plain data.');
   const response=validateExecutionResponse(raw,fence.revision,id.value);
   if(response.kind!=='inspect')throw new Error('Worker did not return inspection evidence.');
   const {rows,domain,...echo}=response;
   if(!domain||!equal([echo.collection,echo.paramKey,echo.categoryId,echo.categoryRecipe,echo.groupEvidence,echo.offset,echo.limit],[request.collection,request.paramKey,request.categoryId,request.categoryRecipe,request.groupEvidence,offset,100]))throw new Error('Inspection identity does not match the requested baseline.');
   if(!domain.classificationComplete||domain.categoryErrorCount||domain.omittedCount||domain.status!=='resolved')throw new Error('Group domain is incomplete, omitted, or refused; retention is unavailable.');
   if(response.total>PIVOT_GROUP_PROOF_LIMITS.observed||domain.matchedKeyCount>PIVOT_GROUP_PROOF_LIMITS.keys)throw new Error('Group proof admission budget exceeded; existing intent retained.');
   const {scanned,...invariant}=domain;
   if(total!==undefined&&(total!==response.total||!equal(summary,invariant)))throw new Error('Group domain counts changed across pages.');
   total=response.total;summary=invariant;
   for(const row of rows){
    if(row.kind!=='groupMember'||seen.has(row.key))throw new Error('Repeated or invalid observed identity.');
    seen.add(row.key);
    if(row.matched)matched.set(row.key,{key:row.key,transport:row.transport});
    if(wanted.has(row.key))selected.set(row.key,{key:row.key,transport:row.transport});
   }
   if(bytes(JSON.stringify([...matched.values(),...selected.values()]))>PIVOT_GROUP_PROOF_LIMITS.payloadBytes)throw new Error('Group proof retained payload admission budget exceeded.');
   if(response.nextOffset===undefined){if(offset+scanned!==total)throw new Error('Observed traversal is unfinished.');break;}
   offset=response.nextOffset;
  }
  if(matched.size!==summary!.matchedKeyCount||seen.size!==total||selected.size!==wanted.size)throw new Error('Complete exact membership could not be proved.');
  const proof=freeze<FullPivotMatchProof>({fence,matchedKeys:[...matched.keys()],matchedMembers:[...matched.values()],selectedMembers:requested.map(key=>selected.get(key)!),requestedKeys:requested,total:total!,matchedCount:matched.size,unmatchedCount:summary!.unmatchedCount});
  if(!current())throw new Error('Proof became stale before delivery.');
  authority.set(proof,{current,executor:initial.executor,authorityToken:initial.authorityToken});return {ok:true,proof};
 }catch(error){return {ok:false,reason:error instanceof Error?error.message:'Group proof could not be collected.'};}
}
