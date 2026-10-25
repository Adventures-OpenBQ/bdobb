// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest';
import {resolvePivotParams} from './pivotParamGroups';
import {pivotOffModel} from './tableExecution/testContract';
it('requires active compatible filter binding and refuses absent dormant Page',()=>{
 const model=structuredClone(pivotOffModel);const cat=model.categories[0];model.params.filters=[{id:'p',categoryId:cat.id,label:'Filter',multiSelect:false}];const group={id:'g',name:'G',paramName:'symbol',groupType:cat.sourceFieldId,value:'ACME, Inc'};const binding={groupId:'g',paramName:'pivot:filter:'+cat.id};
 expect(resolvePivotParams(model,[binding],[group],false).candidates).toEqual([{key:binding.paramName,entry:{source:'group',groupId:'g',transportValue:'ACME, Inc'}}]);
 expect(resolvePivotParams(model,[binding],[group],true).candidates).toEqual([]);expect(resolvePivotParams(model,[binding],[{...group,groupType:'wrong'}],false).candidates).toEqual([]);
 expect(resolvePivotParams(model,[{...binding,paramName:'pivot:page'}],[group],false).diagnostics[0].message).toMatch(/Page is not active/);
});
it('persisted invalid entries and aggregate group envelope refuse with bounded diagnostics, not protocol relaxation',()=>{
 const model=structuredClone(pivotOffModel);const cat=model.categories[0];model.params.filters=[{id:'p',categoryId:cat.id,label:'Filter',multiSelect:false}];const key='pivot:filter:'+cat.id;const group={id:'g'.repeat(257),name:'G',paramName:'symbol',groupType:cat.sourceFieldId,value:'A'};
 const refused=resolvePivotParams(model,[{groupId:group.id,paramName:key}],[group],false);expect(refused.candidates).toEqual([]);expect(refused.diagnostics).toHaveLength(1);expect(refused.diagnostics[0].message.length).toBeLessThan(128);
 const unknown=resolvePivotParams(model,Array.from({length:100},()=>({groupId:'g',paramName:'pivot:'+ 'x'.repeat(20000)})),[],false);expect(unknown.diagnostics).toHaveLength(64);expect(unknown.diagnostics.every(d=>d.key.length<=128&&d.message.length<128)).toBe(true);
});
