// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { validateTableModel } from '../tableModel/validation';
import { paramRow, setFilterKeys } from '../tableModel/pivotParams';
import type { TableModelV1 } from '../tableModel/types';
import type { TableDefinition } from './types';
import { ExecutionProtocolError } from './validation';
export type RuntimeParam = {source:'viewer';memberKeys:string[]|null}|{source:'group';groupId:string;transportValue:string};
export type RuntimeParams = Record<string,RuntimeParam>;
export type ParamMatch = {key:string;matchedKeys:string[];matched:string[];unmatched:string[];matchedCount:number;unmatchedCount:number;excludedCount:number;totalCount:number;classificationComplete:boolean;truncated:boolean;source?:'group';groupId?:string;inputCount?:number;status?:'resolved'|'refused';reason?:'ambiguous'|'partial'|'budget'};
export const RUNTIME_PARAM_LIMITS={entries:64,values:1024,keyBytes:512,idBytes:256,valueBytes:16384,payloadBytes:1048576,previewKeys:8,labelBytes:256,previewBytes:131072,matchBytes:262144} as const;
const bytes=(s:string)=>new TextEncoder().encode(s).length;
function reject(message:string):never {throw new ExecutionProtocolError('INVALID_REQUEST',message);}
/** Descriptor-first: structuredClone otherwise executes accessors before validation. */
export function runtimePlainData(raw:unknown):void {
 const ancestors=new Set<object>();let nodes=200000;
 const visit=(v:unknown,depth:number):void=>{
  if(--nodes<0||depth>8)reject('Runtime parameter graph exceeds limit');
  if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)return;
  if(typeof v==='string'){if(bytes(v)>RUNTIME_PARAM_LIMITS.valueBytes)reject('Runtime value exceeds UTF-8 limit');return;}
  if(typeof v!=='object')reject('Runtime parameters require plain data');
  const object=v as object,proto=Object.getPrototypeOf(object),array=Array.isArray(object);
  if(ancestors.has(object)||(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null))reject('Unsafe runtime parameter graph');
  ancestors.add(object);const keys=Reflect.ownKeys(object);
  if(array){const length=Object.getOwnPropertyDescriptor(object,'length')?.value;if(!Number.isSafeInteger(length)||length>1024||keys.length!==length+1)reject('Runtime arrays must be bounded and dense');for(let i=0;i<length;i++)if(!Object.hasOwn(object,i))reject('Runtime arrays must be dense');}
  else if(keys.length>64)reject('Runtime object exceeds entry limit');
  for(const key of keys){if(typeof key!=='string'||bytes(key)>512)reject('Invalid runtime key');const descriptor=Object.getOwnPropertyDescriptor(object,key)!;if(!('value' in descriptor))reject('Runtime accessors are unsupported');if(array&&key==='length')continue;visit(descriptor.value,depth+1);}
  ancestors.delete(object);
 };
 visit(raw,0);if(bytes(JSON.stringify(raw))>RUNTIME_PARAM_LIMITS.payloadBytes)reject('Runtime payload exceeds byte limit');
}
export function activeRuntimeKeys(model:TableModelV1):Map<string,string>{return new Map(paramRow(model).filter(p=>p.source!=='page'||model.enabled).map(p=>[p.key,p.categoryId]));}
export function validateRuntimeParams(raw:unknown,definition?:TableDefinition):RuntimeParams {
 if(raw===undefined)return {};
 runtimePlainData(raw);if(raw===null||Array.isArray(raw)||typeof raw!=='object')reject('Expected runtime parameter map');
 const map=raw as Record<string,unknown>;
 const model=definition===undefined?undefined:validateTableModel(definition.analytical).model;
 if(Object.keys(map).length&&definition!==undefined&&!model)reject('Runtime parameters require a valid analytical model');
 const active=model?activeRuntimeKeys(model):undefined;
 for(const [key,value]of Object.entries(map)){
  if(!key.length||bytes(key)>512||active&&!active.has(key))reject('Unknown or dormant promoted runtime key');
  if(!value||typeof value!=='object'||Array.isArray(value))reject('Expected runtime entry');
  const entry=value as Record<string,unknown>;
  if(entry.source==='group'){
   if(Object.keys(entry).some(k=>!['source','groupId','transportValue'].includes(k))||typeof entry.groupId!=='string'||!entry.groupId.length||bytes(entry.groupId)>256)reject('Invalid group runtime entry');
   if(typeof entry.transportValue!=='string'||bytes(entry.transportValue)>16384||entry.transportValue!==''&&entry.transportValue.split(',').length>1024)reject('Invalid group transport value');
   continue;
  }
  if(entry.source!=='viewer'||Object.keys(entry).some(k=>!['source','memberKeys'].includes(k))||!Object.hasOwn(entry,'memberKeys'))reject('Invalid viewer runtime entry');
  if(entry.memberKeys!==null)values(entry.memberKeys);
 }
 return structuredClone(raw) as RuntimeParams;
}
function values(raw:unknown,allowEmpty=false):void {if(!Array.isArray(raw)||raw.length>1024||raw.some(v=>typeof v!=='string'||!allowEmpty&&!v.length||bytes(v)>16384))reject('Invalid bounded runtime values');}
export function effectiveRuntimeModel(model:TableModelV1,runtime:RuntimeParams):{model:TableModelV1}{
 let effective=model;
 for(const [key,entry]of Object.entries(runtime)){
  if(entry.source!=='viewer')reject('Group runtime parameters are unsupported');
  const category=activeRuntimeKeys(model).get(key);if(!category)reject('Unknown or dormant promoted runtime key');
  if(key==='pivot:page'){
   if(entry.memberKeys===null){const layout={...effective.layout};delete layout.page;effective={...effective,layout};}
   else {effective={...effective,layout:{...effective.layout,page:{...effective.layout.page!,memberKeys:[...new Set(entry.memberKeys)]}}};}
  }else effective=setFilterKeys(effective,category,entry.memberKeys);
 }
 return {model:effective};
}
export function runtimeMatches(runtime:RuntimeParams,model:TableModelV1,pool:import('../tableModel/facets').EligiblePool,groups:Record<string,import('../tableModel/groupResolution').GroupResolution>={}):ParamMatch[]{
 let budget:number=RUNTIME_PARAM_LIMITS.previewBytes-Object.keys(runtime).length*8;
 return Object.entries(runtime).map(([key,entry])=>{
  const category=activeRuntimeKeys(model).get(key)!;const observed=pool.observedMembers.get(category);const eligible=pool.eligibleMembers.get(category);
  // Absence needs membership evidence from every acquired row, even rows source constraints exclude.
  const classificationComplete=pool.classificationComplete&&pool.universe.categories.has(category)&&pool.universe.rows.every(row=>pool.universe.members.get(row.id)?.get(category)?.ok===true);
  const group=groups[key];
  const keys=entry.source==='viewer'?(entry.memberKeys??[...(observed?.keys()??[])]):(group?.keys??[]);
  const matchedKeys:string[]=[],matched:string[]=[],unmatched:string[]=[];let matchedCount=0,unmatchedCount=0,excludedCount=0,truncated=false;
  for(const value of keys){
   const member=observed?.get(value);
   if(member){matchedCount++;if(!eligible?.has(value))excludedCount++;const label=truncateLabel(member.label);const size=bytes(JSON.stringify([value,label]))+2;if(bytes(value)<=RUNTIME_PARAM_LIMITS.valueBytes&&matchedKeys.length<8&&size<=budget){matchedKeys.push(value);matched.push(label);budget-=size;if(label!==member.label)truncated=true;}else truncated=true;}
   else if(classificationComplete){unmatchedCount++;const size=bytes(JSON.stringify(value))+1;if(unmatched.length<8&&size<=budget){unmatched.push(value);budget-=size;}else truncated=true;}
  }
  if(group)for(const value of group.unmatched){unmatchedCount++;const size=bytes(JSON.stringify(value))+1;if(unmatched.length<8&&size<=budget){unmatched.push(value);budget-=size;}else truncated=true;}
  return {key,matchedKeys,matched,unmatched,matchedCount,unmatchedCount,excludedCount,totalCount:keys.length+(group?.unmatched.length??0),classificationComplete,truncated:truncated||!classificationComplete,...(entry.source==='group'?{source:'group' as const,groupId:entry.groupId,inputCount:group?.inputCount??0,status:group?.status??'refused',...(group?.reason?{reason:group.reason}:{})}:{})};
 });
}
function truncateLabel(value:string):string {let result='';for(const char of value){if(bytes(result+char)>256)break;result+=char;}return result;}
export function validateParamMatches(raw:unknown):void {
 runtimePlainData(raw);if(!Array.isArray(raw)||raw.length>64||bytes(JSON.stringify(raw))>RUNTIME_PARAM_LIMITS.matchBytes)reject('Invalid bounded runtime matches');
 let previews=0;
 for(const m of raw){
  if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).some(k=>!['key','matchedKeys','matched','unmatched','matchedCount','unmatchedCount','excludedCount','totalCount','classificationComplete','truncated','source','groupId','inputCount','status','reason'].includes(k)))reject('Invalid runtime match fields');
  if(typeof m.key!=='string'||!m.key.length||bytes(m.key)>512||typeof m.truncated!=='boolean'||typeof m.classificationComplete!=='boolean')reject('Invalid runtime match metadata');
  for(const field of ['matchedKeys','unmatched']){values(m[field],field==='unmatched'&&m.source==='group');if(m[field].length>8)reject('Match preview exceeds key limit');}
  if(!Array.isArray(m.matched)||m.matched.length>8||m.matched.some((label:unknown)=>typeof label!=='string'))reject('Invalid runtime match labels');
  if(m.matched.some((label:string)=>bytes(label)>256)||m.matched.length!==m.matchedKeys.length)reject('Invalid runtime match labels');
  for(const field of ['matchedCount','unmatchedCount','excludedCount','totalCount'])if(!Number.isSafeInteger(m[field])||m[field]<0)reject('Invalid runtime match count');
  if(m.matchedCount<m.matchedKeys.length||m.unmatchedCount<m.unmatched.length||m.excludedCount>m.matchedCount||m.matchedCount+m.unmatchedCount>m.totalCount||m.classificationComplete&&m.matchedCount+m.unmatchedCount!==m.totalCount||!m.truncated&&(m.matchedCount!==m.matchedKeys.length||m.unmatchedCount!==m.unmatched.length))reject('Inconsistent runtime match counts');
  if(m.source!==undefined&&(m.source!=='group'||typeof m.groupId!=='string'||!m.groupId.length||bytes(m.groupId)>256||!Number.isSafeInteger(m.inputCount)||m.inputCount<0||m.inputCount>1024||!['resolved','refused'].includes(m.status)||m.reason!==undefined&&!['ambiguous','partial','budget'].includes(m.reason)))reject('Invalid group match metadata');
  if(m.source===undefined&&['groupId','inputCount','status','reason'].some(field=>Object.hasOwn(m,field))||m.source==='group'&&(m.status==='refused'&&!m.reason||m.status==='resolved'&&m.reason!==undefined))reject('Inconsistent group match status');
  previews+=bytes(JSON.stringify([m.matchedKeys,m.matched,m.unmatched]));
 }
 // Array punctuation is part of the response budget; allow bounded envelope overhead.
 if(previews>RUNTIME_PARAM_LIMITS.previewBytes)reject('Runtime match previews exceed byte limit');
}
