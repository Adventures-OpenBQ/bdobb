// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { calculateView } from './engine';
import { createResultStore } from './resultStore';
import { validateExecutionRequest, validateExecutionResponse } from './validation';
import { input, revision } from './fixtures';
import type { RuntimeParams } from './types';
import type { TableModelV1 } from '../tableModel/types';
const A='["string","A"]',B='["string","B"]',key='pivot:filter:cat';
const model:TableModelV1={schemaVersion:1,enabled:true,params:{promotePage:true,filters:[{id:'param',categoryId:'cat',label:'Region',multiSelect:true}]},categories:[{id:'cat',name:'Region',sourceFieldId:'region',transform:'native'}],measures:[],formulas:[],layout:{rows:[],columns:[],values:[]},checklists:[{categoryId:'cat',memberKeys:[A]}],resultFilters:[],subtotals:{grandTotal:false,groups:false}};
const definition={table:{},search:'',analytical:model};
const view=(runtimeParams?:unknown,analytical=model)=>calculateView(input,{...definition,analytical},{kind:'none'},true,undefined,[],runtimeParams as never);
it('viewer All, empty, replacement and omission are distinct and preserve saved echo',()=>{
 expect(view().presentedRows.map(r=>r.id)).toEqual(['r0','r1']);
 expect(view({[key]:{source:'viewer',memberKeys:null}}).presentedRows.map(r=>r.id)).toEqual(['r0','r1','r2']);
 expect(view({[key]:{source:'viewer',memberKeys:[]}}).presentedRows).toEqual([]);
 const replaced=view({[key]:{source:'viewer',memberKeys:[B]}});expect(replaced.presentedRows.map(r=>r.id)).toEqual(['r2']);
 const ready=createResultStore(replaced,revision).ready('ready',revision);expect(ready.inspection.definition).toEqual(definition);
 expect(ready.inspection.paramMatches).toEqual([expect.objectContaining({key,matchedKeys:[B],matched:['B'],unmatched:[],matchedCount:1,unmatchedCount:0})]);
 expect(validateExecutionResponse(ready,revision,'ready')).toEqual(ready);
});
it('Page explicit All and empty retain authored selector without sentinels or multi fallback',()=>{
 const paged={...model,checklists:[],layout:{...model.layout,page:{categoryId:'cat',memberKeys: [A]}}};
 expect(view(undefined,paged).presentedRows).toHaveLength(2);
 expect(view({'pivot:page':{source:'viewer',memberKeys:null}},paged).presentedRows).toHaveLength(3);
 const empty=view({'pivot:page':{source:'viewer',memberKeys:[]}},paged);expect(empty.presentedRows).toEqual([]);expect(empty.definition.analytical).toEqual(paged);
 expect(view({'pivot:page':{source:'viewer',memberKeys:[A,B]}},paged).presentedRows).toHaveLength(3);
});
it('protocol refuses unpromoted keys and unsupported group values rather than ignoring them',()=>{
 const request={kind:'applyModel',requestId:'r',revision,definition,selection:{kind:'none'}};
 expect(()=>validateExecutionRequest({...request,runtimeParams:{'pivot:filter:missing':{source:'viewer',memberKeys:[A]}}})).toThrow();
 expect(()=>validateExecutionRequest({...request,runtimeParams:{[key]:{source:'group',groupId:'g',values:['A']}}})).toThrow();
});
it('runtime descriptor preflight refuses getters before they execute',()=>{
 let calls=0;const entry={source:'viewer'};Object.defineProperty(entry,'memberKeys',{enumerable:true,get(){calls++;return [A];}});
 expect(()=>validateExecutionRequest({kind:'applyModel',requestId:'r',revision,definition,selection:{kind:'none'},runtimeParams:{[key]:entry}})).toThrow();expect(calls).toBe(0);
});

import { validateRuntimeParams, validateParamMatches, RUNTIME_PARAM_LIMITS } from './runtimeParams';
it('enforces exact UTF-8, cardinality and serialized overlay budgets without narrowing declared capacity',()=>{
 const entry={source:'viewer' as const,memberKeys:['x']};
 expect(Object.keys(validateRuntimeParams(Object.fromEntries(Array.from({length:64},(_,i)=>['k'+i,entry]))))).toHaveLength(64);
 expect(()=>validateRuntimeParams(Object.fromEntries(Array.from({length:65},(_,i)=>['k'+i,entry])))).toThrow();
 expect(validateRuntimeParams({['é'.repeat(256)]:entry})).toBeDefined();expect(()=>validateRuntimeParams({['é'.repeat(256)+'x']:entry})).toThrow();
 expect(validateRuntimeParams({k:{source:'viewer',memberKeys:['é'.repeat(8192)]}})).toBeDefined();expect(()=>validateRuntimeParams({k:{source:'viewer',memberKeys:['é'.repeat(8192)+'x']}})).toThrow();
 expect(validateRuntimeParams({k:{source:'viewer',memberKeys:Array(1024).fill('x')}})).toBeDefined();expect(()=>validateRuntimeParams({k:{source:'viewer',memberKeys:Array(1025).fill('x')}})).toThrow();
 const capacity=Object.fromEntries(Array.from({length:64},(_,i)=>['k'+i,{source:'viewer',memberKeys:Array(1024).fill('x')} ]));expect(validateRuntimeParams(capacity)).toEqual(capacity);
 const payload={k:{source:'viewer',memberKeys:[...Array(63).fill('x'.repeat(16384)),'x']}};
 const room=RUNTIME_PARAM_LIMITS.payloadBytes-new TextEncoder().encode(JSON.stringify(payload)).length;payload.k.memberKeys[63]+='x'.repeat(room);
 expect(new TextEncoder().encode(JSON.stringify(payload))).toHaveLength(RUNTIME_PARAM_LIMITS.payloadBytes);expect(validateRuntimeParams(payload)).toEqual(payload);payload.k.memberKeys[63]+='x';expect(()=>validateRuntimeParams(payload)).toThrow(/byte limit/);
});
it('rejects sparse/cyclic/prototype/symbol/extra-field intent before evaluating it',()=>{
 const sparse=Array(2);sparse[1]='x';const cycle:Record<string,unknown>={};cycle.self=cycle;
 for(const raw of [{k:{source:'viewer',memberKeys:sparse}},cycle,Object.create({k:{source:'viewer',memberKeys:[A]}}),{[Symbol('k')]:{}},{k:{source:'viewer',memberKeys:[A],extra:true}}])expect(()=>validateRuntimeParams(raw)).toThrow();
 let calls=0;const raw={kind:'applyModel',requestId:'r',revision,definition,selection:{kind:'none'}};Object.defineProperty(raw,'runtimeParams',{enumerable:true,get(){calls++;return {};}});expect(()=>validateExecutionRequest(raw)).toThrow();expect(calls).toBe(0);
});
it('preserves long valid authored category keys and rejects stale/dormant Page keys and raw overlays',()=>{
 const long='é'.repeat(128);const analytical={...model,categories:[{...model.categories[0],id:long}],params:{promotePage:true,filters:[{...model.params.filters[0],categoryId:long}]},checklists:[]};
 expect(validateRuntimeParams({['pivot:filter:'+long]:{source:'viewer',memberKeys:null}},{...definition,analytical})).toBeDefined();
 expect(()=>validateRuntimeParams({'pivot:page':{source:'viewer',memberKeys:null}},definition)).toThrow();
 expect(()=>validateRuntimeParams({'pivot:page':{source:'viewer',memberKeys:null}},{...definition,analytical:{...model,enabled:false,layout:{...model.layout,page:{categoryId:'cat',memberKeys: [A]}}}})).toThrow();
 expect(()=>validateRuntimeParams({[key]:{source:'viewer',memberKeys:null}},{table:{},search:''})).toThrow();
});
it('bounded metadata retains whole keys with honest counts and distinguishes absent from source exclusion',()=>{
 const absent=view({[key]:{source:'viewer',memberKeys:['["string","Missing"]']}});expect(absent.paramMatches?.[0]).toMatchObject({unmatched:['["string","Missing"]'],unmatchedCount:1,matchedCount:0});
 const filtered=calculateView(input,{...definition,table:{columnFilters:[{id:'revenue',value:{min:1000}}]}},{kind:'none'},true,undefined,[],{[key]:{source:'viewer',memberKeys:[A]}});expect(filtered.paramMatches?.[0]).toMatchObject({matchedKeys:[A],matchedCount:1,unmatchedCount:0,excludedCount:1});
 const many=view({[key]:{source:'viewer',memberKeys:Array.from({length:10},(_,i)=>JSON.stringify(['string','Missing'+i]))}});expect(many.paramMatches?.[0]).toMatchObject({unmatchedCount:10,totalCount:10,truncated:true});expect(many.paramMatches?.[0].unmatched).toHaveLength(8);validateParamMatches(many.paramMatches);
 const invalid=structuredClone(many.paramMatches!);invalid[0].truncated=false;expect(()=>validateParamMatches(invalid)).toThrow();invalid[0].truncated=true;invalid[0].unmatched.push('extra');expect(()=>validateParamMatches(invalid)).toThrow();
});
it('runtime Page empty reports honest empty intention and response accessors never execute',()=>{
 const paged={...model,checklists:[],layout:{...model.layout,page:{categoryId:'cat',memberKeys: [A]}}};const empty=view({'pivot:page':{source:'viewer',memberKeys:[]}},paged);
 expect(empty.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({key:'pivot:page',code:'PIVOT_PARAM_EMPTY'})]));
 const ready=createResultStore(view({[key]:{source:'viewer',memberKeys:null}}),revision).ready('ready',revision);let calls=0;Object.defineProperty(ready.inspection.paramMatches![0],'matchedKeys',{enumerable:true,get(){calls++;return [A,B];}});
 expect(()=>validateExecutionResponse(ready,revision,'ready')).toThrow();expect(calls).toBe(0);
});
import { pivotOffModel, pivotOffData, pivotOffDefinition } from './testContract';
it('off overlays preserve private source formulas/errors, table/search constraints and authored report dormancy',()=>{
 const analytical=structuredClone(pivotOffModel);const category=analytical.checklists[0].categoryId;analytical.params.filters=[{id:'p',categoryId:category,label:'Scenario',multiSelect:true}];
 const definition={...pivotOffDefinition,analytical};const result=calculateView(pivotOffData,definition,{kind:'none'},true,undefined,[],{['pivot:filter:'+category]:{source:'viewer',memberKeys:null}});
 expect(result.presentedRows.map(r=>r.id)).toEqual(['keep','checklist-excluded']);expect(result.presentedRows[0].values.sourceComputed).toBe(15);expect(result.presentedRows[0].cellErrors?.sourceError.code).toBe('division-by-zero');expect(result.columns.map(c=>c.id)).not.toContain('secret');expect(result.groups).toEqual([]);expect(result.totals.empty).toBe(true);expect(result.definition).toEqual(definition);
 const empty=calculateView(pivotOffData,definition,{kind:'none'},true,undefined,[],{['pivot:filter:'+category]:{source:'viewer',memberKeys:[]}});expect(empty.presentedRows).toEqual([]);expect(empty.definition.analytical).toEqual(analytical);
});
it('bounds group IDs before rejecting unsupported groups and exact output preview bytes',()=>{
 expect(validateRuntimeParams({k:{source:'group',groupId:'é'.repeat(128),transportValue:'A'}})).toBeDefined();expect(()=>validateRuntimeParams({k:{source:'group',groupId:'é'.repeat(128)+'x',transportValue:'A'}})).toThrow(/Invalid group/);
 const match={key,matchedKeys:[] as string[],matched:[] as string[],unmatched:[...Array(7).fill('x'.repeat(16384)),'x'],matchedCount:0,unmatchedCount:8,excludedCount:0,totalCount:8,classificationComplete:true,truncated:false};const size=()=>new TextEncoder().encode(JSON.stringify([match.matchedKeys,match.matched,match.unmatched])).length;match.unmatched[7]+='x'.repeat(RUNTIME_PARAM_LIMITS.previewBytes-size());expect(size()).toBe(RUNTIME_PARAM_LIMITS.previewBytes);validateParamMatches([match]);match.unmatched[7]+='x';expect(()=>validateParamMatches([match])).toThrow(/preview/);
});
it('runtime-bearing envelope accessors cannot mutate the overlay during protocol cloning',()=>{
 let calls=0;const request={kind:'applyModel',requestId:'r',revision,definition,runtimeParams:{[key]:{source:'viewer',memberKeys:[A]}}};Object.defineProperty(request,'selection',{enumerable:true,get(){calls++;return {kind:'none'};}});expect(()=>validateExecutionRequest(request)).toThrow();expect(calls).toBe(0);
});
it.each(['Y','FY'] as const)('unobserved %s Page keys remain unknown when acquired membership fails, including source-excluded rows',transform=>{
 const paged:TableModelV1={...model,checklists:[],categories:[{id:'cat',name:'Period',sourceFieldId:'region',transform}],layout:{...model.layout,page:{categoryId:'cat',memberKeys: [A]}}};
 const missing='["string","2099"]';const dataset=structuredClone(input);dataset.rows[0].values.region='invalid-date';
 const result=calculateView(dataset,{...definition,analytical:paged,table:{columnFilters:[{id:'revenue',value:{min:1000}}]}},{kind:'none'},true,undefined,[],{'pivot:page':{source:'viewer',memberKeys:[missing]}});
 expect(result.paramMatches?.[0]).toMatchObject({key:'pivot:page',classificationComplete:false,unmatchedCount:0,unmatched:[],totalCount:1,truncated:true});
 validateParamMatches(result.paramMatches);
});
it('group execution matches every typed collision before source qualification and retains saved definition',()=>{
 const dataset=structuredClone(input);dataset.rows[0].values.region=1;dataset.rows[1].values.region='1';dataset.rows[2].values.region='other';
 const group={source:'group' as const,groupId:'g',transportValue:'1,absent'};const result=calculateView(dataset,definition,{kind:'none'},true,undefined,[],{[key]:group});
 expect(result.presentedRows.map(r=>r.id)).toEqual(['r0','r1']);expect(result.definition).toEqual(definition);expect(result.paramMatches?.[0]).toMatchObject({matchedCount:2,unmatchedCount:1,unmatched:['absent'],inputCount:2,source:'group',status:'resolved'});validateParamMatches(result.paramMatches);
 const excluded=calculateView(dataset,{...definition,table:{columnFilters:[{id:'revenue',value:{min:1000}}]}},{kind:'none'},true,undefined,[],{[key]:group});expect(excluded.presentedRows).toEqual([]);expect(excluded.paramMatches?.[0]).toMatchObject({matchedCount:2,excludedCount:2,unmatchedCount:1});
});
it('group matching preserves bool/string, blank/null and all observed hits beyond preview eight',()=>{
 const dataset=structuredClone(input);dataset.rows=[true,'true',null,'null','','(blank)',...Array.from({length:12},(_,i)=>'many'+i)].map((region,i)=>({id:'g'+i,values:{region,revenue:i}}));
 const result=calculateView(dataset,definition,{kind:'none'},true,undefined,[],{[key]:{source:'group',groupId:'g',transportValue:'true,null,(blank),'+Array.from({length:12},(_,i)=>'many'+i).join(',')}});
 expect(result.presentedRows).toHaveLength(18); // Existing blank identity folds null and empty, while literal '(blank)' remains distinct.
expect(result.paramMatches?.[0]).toMatchObject({matchedCount:17,unmatchedCount:0,inputCount:15,truncated:true});expect(result.paramMatches?.[0].matchedKeys).toHaveLength(8);validateParamMatches(result.paramMatches);
});
it('comma ambiguity and partial fiscal domain refuse visibly and keep authored filter baseline',()=>{
 const dataset=structuredClone(input);dataset.rows[0].values.region='ACME, Inc';dataset.rows[1].values.region='ACME';dataset.rows[2].values.region=' Inc';
 const authored={...model,checklists:[{categoryId:'cat',memberKeys:['["string","ACME"]']}]};
 const result=calculateView(dataset,{...definition,analytical:authored},{kind:'none'},true,undefined,[],{[key]:{source:'group',groupId:'g',transportValue:'ACME, Inc'}});
 expect(result.presentedRows.map(r=>r.id)).toEqual(['r1']);expect(result.paramMatches?.[0]).toMatchObject({status:'refused',reason:'ambiguous',matchedCount:0});expect(result.diagnostics.some(d=>d.code==='PIVOT_PARAM_REFUSED')).toBe(true);validateParamMatches(result.paramMatches);
 const fiscal={...model,checklists:[],categories:[{id:'cat',name:'Fiscal',sourceFieldId:'date',transform:'FY' as const,fiscalBinding:{companyFieldId:'region'}}]};
 const partial=calculateView(input,{...definition,analytical:fiscal},{kind:'none'},true,undefined,[],{[key]:{source:'group',groupId:'g',transportValue:'FY2026,FY2027'}});expect(partial.paramMatches?.[0]).toMatchObject({classificationComplete:false,status:'refused',reason:'partial',unmatchedCount:0});
});
it('fiscal labels preserve shared fiscal identities across companies and source constraints',()=>{
 const dataset=structuredClone(input);dataset.rows[2].values.date='2026-01-01';dataset.provenance.metadata={fiscalContext:{companies:{A:{yearEndMonth:6,source:'file'},B:{yearEndMonth:12,source:'file'}}}};
 const fiscal={...model,checklists:[],categories:[{id:'cat',name:'Fiscal',sourceFieldId:'date',transform:'FY' as const,fiscalBinding:{companyFieldId:'region'}}]};
 const result=calculateView(dataset,{...definition,analytical:fiscal,table:{columnFilters:[{id:'revenue',value:{max:30}}]}},{kind:'none'},true,undefined,[],{[key]:{source:'group',groupId:'g',transportValue:'FY2026'}});
 expect(result.presentedRows.map(r=>r.id)).toEqual(['r0','r1']);expect(result.paramMatches?.[0]).toMatchObject({matchedCount:1,excludedCount:0,inputCount:1,unmatchedCount:0});expect(result.analytical?.warnings.some(w=>w.code==='fiscal-alignment')).toBe(true);validateParamMatches(result.paramMatches);
});
it('group transport is required, bounded, descriptor-safe and empty unmatched tokens remain honest',()=>{
 expect(()=>validateRuntimeParams({[key]:{source:'group',groupId:'g'}})).toThrow();expect(validateRuntimeParams({[key]:{source:'group',groupId:'g',transportValue:'x'.repeat(16384)}})).toBeDefined();expect(()=>validateRuntimeParams({[key]:{source:'group',groupId:'g',transportValue:'x'.repeat(16385)}})).toThrow();expect(()=>validateRuntimeParams({[key]:{source:'group',groupId:'g',transportValue:Array(1025).fill('x').join(',')}})).toThrow();
 let calls=0;const entry={source:'group',groupId:'g'};Object.defineProperty(entry,'transportValue',{enumerable:true,get(){calls++;return 'A';}});expect(()=>validateRuntimeParams({[key]:entry})).toThrow();expect(calls).toBe(0);
 const result=view({[key]:{source:'group',groupId:'g',transportValue:'A,'}});expect(result.paramMatches?.[0]).toMatchObject({matchedCount:1,unmatched:[''],unmatchedCount:1});validateParamMatches(result.paramMatches);
});
it('group execution retains oversized observed identities while bounded preview omits whole keys',()=>{
 const value='x'.repeat(16384);const dataset=structuredClone(input);dataset.rows[0].values.region=value;const result=calculateView(dataset,definition,{kind:'none'},true,undefined,[],{[key]:{source:'group',groupId:'g',transportValue:value}});
 expect(result.presentedRows.map(r=>r.id)).toEqual(['r0']);expect(result.paramMatches?.[0]).toMatchObject({matchedCount:1,matchedKeys:[],matched:[],truncated:true});validateParamMatches(result.paramMatches);
});
it('single-select group executes all typed hits through grouped aggregates and totals',()=>{
 const dataset=structuredClone(input);dataset.rows[0].values.region=1;dataset.rows[1].values.region='1';const analytical={...model,enabled:true,params:{...model.params,filters:[{...model.params.filters[0],multiSelect:false}]},measures:[{id:'sum',sourceFieldId:'revenue',aggregation:'sum' as const}],layout:{rows:['cat'],columns:[],values:['sum']},subtotals:{grandTotal:true,groups:true}};
 const result=calculateView(dataset,{...definition,analytical},{kind:'none'},true,undefined,[],{[key]:{source:'group',groupId:'g',transportValue:'1'}});expect(result.presentedRows.map(r=>r.values.sum)).toEqual([10,20]);expect(result.totals.values.sum).toBe(30);expect(result.paramMatches?.[0]).toMatchObject({matchedCount:2,inputCount:1});
});

it('retains observed split-field identities for chart bindings through checklist Page and runtime filters',()=>{
 const source={...input,columns:[...input.columns,{id:'page_company',label:'Page company',dtype:'text' as const}],rows:[{id:'amd',values:{region:'AMD',page_company:'AMD',team:'2024',revenue:100}},{id:'avgo',values:{region:'AVGO',page_company:'AVGO',team:'2024',revenue:200}}]};
 const report:TableModelV1={...model,checklists:[],categories:[...model.categories,{id:'year',name:'Year',sourceFieldId:'team',transform:'native'},{id:'pagecat',name:'Page company',sourceFieldId:'page_company',transform:'native'}],measures:[{id:'sales',sourceFieldId:'revenue',aggregation:'sum'}],layout:{rows:['year'],columns:['cat'],values:['sales']}};
 const amd='["string","AMD"]';
 const variants: [TableModelV1, RuntimeParams | undefined][] = [[{...report,checklists:[{categoryId:'cat',memberKeys:[amd]}]},undefined],[{...report,layout:{...report.layout,page:{categoryId:'pagecat',memberKeys:[amd]}}},undefined],[report,{[key]:{source:'viewer' as const,memberKeys:[amd]}}]];
 for(const [local,runtime] of variants){
  const calculated=calculateView(source,{table:{},search:'',analytical:local},{kind:'none'},true,undefined,[],runtime);
  const ready=createResultStore(calculated,revision).ready('ready',revision);
  expect(ready.columns.filter(c=>c.measureId==='sales').map(c=>c.splitPath?.[0].value)).toEqual(['AMD']);
  expect(ready.chartColumns?.filter(c=>c.measureId==='sales').map(c=>c.splitPath?.[0].value)).toEqual(['AMD','AVGO']);
  expect(validateExecutionResponse(ready,revision,'ready')).toEqual(ready);
  expect(calculated.presentedRows[0].values[ready.columns.find(c=>c.measureId==='sales')!.id]).toBe(100);
 }
});
