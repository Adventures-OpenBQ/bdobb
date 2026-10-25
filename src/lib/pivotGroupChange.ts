// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {validatePivotGroupProof,type FullPivotMatchProof,type PivotGroupProofContext,type PivotGroupProofFence} from './tableExecution/pivotGroupProof';
import {resolvePivotParams,composePivotParams} from './pivotParamGroups';
import {validateRuntimeParams} from './tableExecution/runtimeParams';
import {validateTableModel as validateDefinition} from './tableExecution/validation';
import {validateTableModel} from './tableModel/validation';
import {setFilterKeys,setPageKeys} from './tableModel/pivotParams';
import type {ParamBinding,ParamGroup,TableCardState} from './types';
import type {SelectionSpec,TableDefinition} from './tableExecution/types';
export type GroupChangeKind='create'|'link'|'push'|'edit'|'unlink';
export type PivotGroupContext={proof:FullPivotMatchProof;proofContext:PivotGroupProofContext;selectedKeys?:readonly string[];direction?:'pull'|'push';newGroup?:{id:string;name:string}};
export type PivotGroupPlan={readonly kind:GroupChangeKind;readonly dashboardId:string;readonly widgetId:string;readonly paramKey:string;readonly table:TableCardState;readonly definition:TableDefinition;readonly selection:SelectionSpec;readonly bindings:readonly ParamBinding[];readonly groupChanges:readonly {id:string;before?:ParamGroup;after?:ParamGroup}[];readonly expected:PivotGroupProofFence;readonly proof:FullPivotMatchProof;readonly summary:{operation:GroupChangeKind;groupName:string;direction?:'pull'|'push';retainedCount:number;values:readonly string[]}};
export type PivotGroupPlanResult={ok:true;plan:PivotGroupPlan}|{ok:false;reason:string};
const plans=new WeakSet<object>();
export function validatePivotGroupPlan(plan:PivotGroupPlan,context:PivotGroupProofContext):boolean{
 if(!plans.has(plan)||!validatePivotGroupProof(plan.proof,context))return false;
 const group=plan.kind==='create'?plan.groupChanges[0]?.after:undefined;
 const next=planGroupChange(plan.kind,{proof:plan.proof,proofContext:context,selectedKeys:plan.proof.requestedKeys,direction:plan.summary.direction,...(group?{newGroup:{id:group.id,name:group.name}}:{})});
 return next.ok&&JSON.stringify([next.plan.definition,next.plan.selection,next.plan.groupChanges,next.plan.bindings.filter(b=>b.paramName===plan.paramKey)])===JSON.stringify([plan.definition,plan.selection,plan.groupChanges,plan.bindings.filter(b=>b.paramName===plan.paramKey)]);
}
const bytes=(s:string)=>new TextEncoder().encode(s).length;
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
/** A guarded read-only plan. No store, runtime, persistence or acquisition side effects. */
export function planGroupChange(kind:GroupChangeKind,context:PivotGroupContext):PivotGroupPlanResult{
 try{
  if(!['create','link','push','edit','unlink'].includes(kind))throw new Error('Unsupported group operation.');
  const {proof,proofContext}=context;
  if(!validatePivotGroupProof(proof,proofContext))throw new Error('Complete current worker proof is required.');
  const state=proofContext.read(),fence=proof.fence,group=fence.group,binding=fence.binding;
  if(kind==='create'&&binding)throw new Error('Unlink the existing group before creating a new one.');
  if(kind!=='create'&&!group)throw new Error('A compatible current target group is required.');
  if(['push','edit','unlink'].includes(kind)&&binding?.groupId!==group?.id)throw new Error('The operation requires the current linked group.');
  if(context.direction!==undefined&&!['pull','push'].includes(context.direction))throw new Error('Unsupported link direction.');
  validateDefinition(fence.definition,fence.selection);
  let definition=structuredClone(fence.definition);
  const changes:{id:string;before?:ParamGroup;after?:ParamGroup}[]=[];
  let target=group;
  const direction=kind==='link'?context.direction??'pull':undefined;
  const sends=kind==='create'||kind==='push'||kind==='edit'||direction==='push';
  let values:string[]=[],retainedCount=0;
  if(sends){
   if(context.selectedKeys===undefined)throw new Error('Choose explicit values before sending; All is not an encoded group selection.');
   validateRuntimeParams({[fence.paramKey]:{source:'viewer',memberKeys:context.selectedKeys}},definition);
   const keys=[...new Set(context.selectedKeys)];
   if(JSON.stringify(keys)!==JSON.stringify(proof.requestedKeys))throw new Error('Selected values require fresh exact worker transport proof.');
   if(proof.selectedMembers.some(member=>member.transport.includes(',')||member.transport===''))throw new Error('Comma-bearing or blank values cannot be encoded unambiguously in a shared group.');
   values=[...new Set(proof.selectedMembers.map(member=>member.transport))];retainedCount=keys.length;
   const value=values.join(',');
   const id=kind==='create'?context.newGroup?.id:group!.id;
   if(!id||bytes(id)>256)throw new Error('A bounded once-generated group ID is required.');
   validateRuntimeParams({[fence.paramKey]:{source:'group',groupId:id,transportValue:value}},definition);
   if(kind==='create'){
    const name=context.newGroup?.name?.trim();
    if(!name||bytes(name)>256||(state.groups.some(g=>g.id===id)||state.bindings.some(b=>b.groupId===id)))throw new Error('A unique group ID and bounded name are required.');
    const paramName=fence.label.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    if(!paramName||bytes(paramName)>512)throw new Error('This label cannot form a bounded group parameter slug.');
    target={id,name,paramName,groupType:fence.sourceFieldId,value};changes.push({id,after:target});
   }else if(value!==group!.value){target={...group!,value};changes.push({id:group!.id,before:group,after:target});}
  }
  if(kind==='link'&&direction==='pull'){retainedCount=proof.matchedCount;values=proof.matchedMembers.map(member=>member.transport);}
  if(kind==='unlink'){
   const model=validateTableModel(definition.analytical).model;
   if(!model)throw new Error('Repair the authored model before unlinking.');
   definition={...definition,analytical:fence.paramKey==='pivot:page'?setPageKeys(model,fence.categoryId,[...proof.matchedKeys]):setFilterKeys(model,fence.categoryId,[...proof.matchedKeys])};
   retainedCount=proof.matchedCount;values=proof.matchedMembers.map(member=>member.transport);
  }
  validateDefinition(definition,fence.selection);
  const bindings=state.bindings.filter(b=>b.paramName!==fence.paramKey).map(b=>({...b}));
  if(kind!=='unlink'){
   if(bindings.some(b=>b.groupId===target!.id))throw new Error('Another control on this card already owns that group.');
   bindings.push({paramName:fence.paramKey,groupId:target!.id});
   const groups=[...state.groups];for(const change of changes){const index=groups.findIndex(g=>g.id===change.id);if(index<0)groups.push(change.after!);else groups[index]=change.after!;}
   const resolved=resolvePivotParams(validateTableModel(definition.analytical).model,bindings,groups,state.groupsDisabled);
   const admission=composePivotParams(resolved.candidates,{});
   const admitted=admission.runtime[fence.paramKey];
   if(admitted?.source!=='group'||admitted.groupId!==target!.id)throw new Error('The target group exceeds active or combined runtime admission; existing intent retained.');
  }
  // Brand lives on proof; cloning it would remove the authority used by9B admission.
  const plan=freeze<PivotGroupPlan>({kind,dashboardId:fence.dashboardId,widgetId:fence.widgetId,paramKey:fence.paramKey,table:definition.table,definition,selection:structuredClone(fence.selection),bindings,groupChanges:structuredClone(changes),expected:fence,proof,summary:{operation:kind,groupName:target!.name,...(direction?{direction}:{}),retainedCount,values}});
  if(!validatePivotGroupProof(proof,proofContext))throw new Error('Group intent changed while planning; collect fresh proof.');
  plans.add(plan);return {ok:true,plan};
 }catch(error){return {ok:false,reason:error instanceof Error?error.message:'Group change could not be planned.'};}
}
