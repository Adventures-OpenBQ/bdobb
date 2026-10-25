// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {reservedPivotName} from './paramGroups';
import {activeRuntimeKeys,validateRuntimeParams,type RuntimeParams,type RuntimeParam} from './tableExecution/runtimeParams';
import type {ParamBinding,ParamGroup} from './types';
import type {TableModelV1} from './tableModel/types';

/** Private store candidates are individually bounded; they are not a runtime transport snapshot. */
export type PivotGroupCandidate={key:string;entry:Extract<RuntimeParam,{source:'group'}>};
export function resolvePivotParams(model:TableModelV1|undefined,bindings:ParamBinding[]|undefined,groups:ParamGroup[]|undefined,disabled=false){
 const candidates=new Map<string,PivotGroupCandidate>();const diagnostics:{key:string;message:string}[]=[];const active=model?activeRuntimeKeys(model):new Map<string,string>();
 for(const binding of bindings??[]){if(!reservedPivotName(binding.paramName))continue;const key=binding.paramName;const refuse=(message:string)=>{if(diagnostics.length<64)diagnostics.push({key:key.slice(0,128),message});};
  const category=model?.categories.find(c=>c.id===active.get(key));const group=groups?.find(g=>g.id===binding.groupId);
  if(disabled){refuse('Grouping is disabled');continue;}if(!category){refuse(key==='pivot:page'?'Page is not active, promoted, or available':'Filter is not promoted or unavailable');continue;}if(!group){refuse('Group is unavailable');continue;}if(group.groupType!==category.sourceFieldId){refuse('Group type is incompatible with this source field');continue;}
  const entry={source:'group' as const,groupId:group.id,transportValue:group.value};
  if(candidates.size>=64&&!candidates.has(key)){refuse('Group filter refused: active group candidate limit exceeded. Authored selection retained.');continue;}
  try{validateRuntimeParams({[key]:entry});candidates.set(key,{key,entry});}catch{refuse('Group filter refused: runtime transport budget or shape exceeded. Authored selection retained.');}
 }
 return {candidates:[...candidates.values()],diagnostics};
}

/** Viewer intention has first claim on the channel; persisted group growth may never invalidate it. */
export function composePivotParams(groups:readonly PivotGroupCandidate[],viewer:RuntimeParams){
 let runtime=validateRuntimeParams(viewer);const diagnostics:{key:string;message:string}[]=[];
 for(const {key,entry} of groups){
  if(Object.hasOwn(viewer,key))continue;
  try{runtime=validateRuntimeParams({...runtime,[key]:entry});}
  catch{if(diagnostics.length<64)diagnostics.push({key:key.slice(0,128),message:'Group filter refused: combined runtime envelope exceeds its budget. Authored selection retained.'});}
 }
 return {runtime,diagnostics};
}
