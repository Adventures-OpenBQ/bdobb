// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type {CalculatedView,InspectionPage,InspectionRequest,GroupMemberInspection} from './types';
import {ExecutionProtocolError} from './validation';
import {activeRuntimeKeys,runtimePlainData,validateRuntimeParams} from './runtimeParams';
import {categoryRecipe} from '../tableModel/categories';
import {observedGroupResolution,type GroupResolution} from '../tableModel/groupResolution';
const bytes=(s:string)=>new TextEncoder().encode(s).length;
const labelPreview=(value:string)=>{let preview='';for(const c of value){if(bytes(preview+c)>256)break;preview+=c;}return preview;};
type DomainIndex={rows:(GroupMemberInspection|undefined)[];errors:number;omitted:number;resolutions:Map<string,GroupResolution>};
const indexes=new WeakMap<CalculatedView,Map<string,DomainIndex>>();
export function groupDomainPage(view:CalculatedView,request:InspectionRequest):InspectionPage{
 runtimePlainData(request);const fail=(message:string):never=>{throw new ExecutionProtocolError('INVALID_REQUEST',message);};
 if(Object.keys(request).some(k=>!['kind','requestId','revision','collection','offset','limit','paramKey','categoryId','categoryRecipe','groupEvidence'].includes(k)))fail('Unexpected domain request field');
 const analytical=view.analytical,model=analytical?.compiled.model;const category=model?.categories.find(c=>c.id===request.categoryId);
 if(!model||!analytical||!category||activeRuntimeKeys(model).get(request.paramKey??'')!==category.id||request.categoryRecipe!==categoryRecipe(category))fail('Group domain requires the exact active saved category identity');
 if(!Number.isSafeInteger(request.offset)||request.offset<0||!Number.isSafeInteger(request.limit)||request.limit<1||request.limit>100)fail('Group domain limit must be 1–100 with a nonnegative offset');
 if(request.groupEvidence)validateRuntimeParams({[request.paramKey!]:{source:'group',...request.groupEvidence}},view.definition);
 const pool=analytical!.pool;let byCategory=indexes.get(view);if(!byCategory){byCategory=new Map();indexes.set(view,byCategory);}const indexKey=category!.id;let indexData=byCategory.get(indexKey);
 if(!indexData){const observed=pool.observedMembers.get(category!.id)??new Map();let errors=0,omitted=0;for(const row of pool.universe.rows){if(!pool.universe.members.get(row.id)?.get(category!.id)?.ok)errors++;}
  const projected=[...observed.values()].map(member=>{const transport=category!.transform==='native'&&!category!.legacyBucket?String(member.value):member.label;const label=labelPreview(member.label);const row:GroupMemberInspection={kind:'groupMember',key:member.key,label,transport,labelTruncated:label!==member.label,observedCount:member.count,eligibleCount:pool.eligibleMembers.get(category!.id)?.get(member.key)?.count??0,matched:false};if(bytes(member.key)>16384||bytes(transport)>16384||bytes(JSON.stringify(row))>131072){omitted++;return undefined;}return row;});indexData={rows:projected,errors,omitted,resolutions:new Map()};byCategory.set(indexKey,indexData);
 }
 const transport=request.groupEvidence?.transportValue??'';let resolution=indexData.resolutions.get(transport);if(!resolution){resolution=observedGroupResolution(transport,model!,category!.id,pool.universe);if(indexData.resolutions.size>=8)indexData.resolutions.delete(indexData.resolutions.keys().next().value!);indexData.resolutions.set(transport,resolution);}const matched=new Set(resolution.keys);const {errors,omitted}=indexData;const projected=indexData.rows;
 const rows:GroupMemberInspection[]=[];let index=Math.min(request.offset,projected.length),budget=131072-2,scanned=0;
 while(index<projected.length&&scanned<request.limit){const projectedRow=projected[index];const row=projectedRow?{...projectedRow,matched:matched.has(projectedRow.key)}:undefined;const size=row?bytes(JSON.stringify(row))+(rows.length?1:0):0;if(row&&size>budget)break;index++;scanned++;if(row){rows.push(row);budget-=size;}}
 const truncated=index<projected.length;
 return {collection:'groupDomain',offset:request.offset,limit:request.limit,paramKey:request.paramKey,categoryId:request.categoryId,categoryRecipe:request.categoryRecipe,...(request.groupEvidence?{groupEvidence:request.groupEvidence}:{}),rows,total:projected.length,truncated,...(truncated?{nextOffset:index}:{}),domain:{classificationComplete:errors===0&&resolution.classificationComplete,categoryErrorCount:errors,omittedCount:omitted,scanned,status:resolution.status,...(resolution.reason?{reason:resolution.reason}:{}),inputCount:resolution.inputCount,matchedKeyCount:resolution.keys.length,unmatched:resolution.unmatched.slice(0,8).map(labelPreview),unmatchedCount:resolution.unmatched.length}};
}
