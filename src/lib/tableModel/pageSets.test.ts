// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { pivotValueKey } from '../pivotKeys';
import { calculateTable, compileAnalyticalModel } from './calculate';
import type { TableModelV1 } from './types';
import type { WidgetDataset } from '../widgetData/types';
const model = ():TableModelV1=>({schemaVersion:1,enabled:true,params:{promotePage:true,filters:[]},categories:[],measures:[{id:'rev',sourceFieldId:'revenue',aggregation:'sum'}],formulas:[],layout:{rows:[],columns:[],values:['rev']},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:true}});
const source = ():WidgetDataset=>({columns:[{id:'revenue',label:'Revenue',dtype:'number'}],rows:[],resultRevision:1,outputRevision:1,provenance:{sourceWidgetId:'test'},freshness:{availability:'available',stale:false},completeness:{kind:'complete',warnings:[]}});
import { validateTableModel } from './validation';
import { eligiblePool, activePage } from './facets';
import { evaluateSourceFormulas } from './formulaEvaluation';
import { resolveMemberScope, scopeErrors } from './scopes';
const key = pivotValueKey;
function fixture() {
 const raw=model();raw.categories=[{id:'scenarioCat',name:'Scenario',sourceFieldId:'scenario',transform:'native'},{id:'deskCat',name:'Desk',sourceFieldId:'desk',transform:'native'}];
 raw.layout={rows:[],columns:[],values:['rev'],page:{categoryId:'scenarioCat',memberKeys:[key('Actual'),key('Budget')]}};
 raw.formulas=[{id:'budget',name:'Budget',scope:'aggregate',expression:'',ast:{kind:'member',value:{kind:'reference',target:'measure',id:'rev'},selectors:[{categoryId:'scenarioCat',memberKey:key('Budget')}]}}];
 raw.layout.values.push('budget');const data=source();data.columns.push({id:'scenario',label:'Scenario'},{id:'desk',label:'Desk'},{id:'company',label:'Company'});data.rows=[['a','Actual',10],['b','Budget',20],['o','Other',70]].map(([id,scenario,revenue])=>({id:String(id),values:{scenario,revenue,desk:'West',company:'ACME'}}));return {raw,data};
}
it('executes authored Page union and singular formula override, empty versus absent All',()=>{
 const {raw,data}=fixture();const union=calculateTable({model:raw,source:data,table:{},search:''});expect(union.errors).toEqual([]);expect([...union.recordIds]).toEqual(['a','b']);expect(union.totals.measures.cells.get('rev')).toEqual({ok:true,value:30});expect(union.totals.formulas.cells.get('budget')).toEqual({ok:true,value:20});
 raw.layout.page={categoryId:'scenarioCat',memberKeys:[]};const empty=calculateTable({model:raw,source:data,table:{},search:''});expect([...empty.recordIds]).toEqual([]);expect(empty.paramDiagnostics).toContainEqual(expect.objectContaining({code:'PIVOT_PARAM_EMPTY'}));delete raw.layout.page;expect(calculateTable({model:raw,source:data,table:{},search:''}).totals.measures.cells.get('rev')).toEqual({ok:true,value:100});
});
it('requires plural Page structure without changing singular formula selectors or raw inspection',()=>{
 const {raw}=fixture();expect(validateTableModel(raw).model).toEqual(raw);for(const page of [{categoryId:'scenarioCat',memberKey:key('Actual')},{categoryId:'scenarioCat',memberKeys:[key('Actual')],memberKey:key('Actual')},{categoryId:'scenarioCat',memberKeys:[key('Actual'),key('Actual')]},{categoryId:'scenarioCat',memberKeys:['']}]){const invalid={...raw,layout:{...raw.layout,page}};expect(validateTableModel(invalid).model).toBeUndefined();expect(validateTableModel(invalid).raw).toBe(invalid);}raw.layout.page={categoryId:'scenarioCat',memberKeys:[]};expect(validateTableModel(raw).model).toEqual(raw);
});
it('retains complete Page set through other-category selectors and deduplicates context slices',()=>{
 const {raw,data}=fixture();data.rows.push({id:'foreign',values:{scenario:'Budget',revenue:999,desk:'West',company:'OTHER'}});const compiled=compileAnalyticalModel(raw,{columns:data.columns});const pool=eligiblePool(evaluateSourceFormulas(data.rows,compiled),{columns:data.columns});const scope={sourceRecordIds:new Set(['a','b']),categoryConstraints:new Map(),page:raw.layout.page!,contextSlices:[new Map([['deskCat',key('West')]]),new Map([['deskCat',key('West')]])],temporalContext:{companyFieldId:'company',companyIds:new Set(['ACME'])}};
 const result=resolveMemberScope(pool,scope,[{categoryId:'deskCat',memberKey:key('West')}]);expect(result.ok&&[...result.scope.sourceRecordIds]).toEqual(['a','b']);const budget=resolveMemberScope(pool,scope,[{categoryId:'scenarioCat',memberKey:key('Budget')}]);expect(budget.ok&&[...budget.scope.sourceRecordIds]).toEqual(['b']);
 const empty={...scope,page:{categoryId:'scenarioCat',memberKeys:[]}};expect(scopeErrors(pool,empty)).toEqual([]);expect(activePage(pool,empty.page).errors).toEqual([]);
});
it('executes ninth member, keeps exact delimiter keys, and keeps source-private constraints and off dormancy',()=>{
 const {raw,data}=fixture();const names=Array.from({length:10},(_,i)=>`n${i},|[]`);data.rows=names.map((scenario,i)=>({id:`n${i}`,values:{scenario,revenue:i+1,desk:'West'}}));raw.layout.page={categoryId:'scenarioCat',memberKeys:names.slice(0,9).map(key)};expect(calculateTable({model:raw,source:data,table:{},search:''}).totals.measures.cells.get('rev')).toEqual({ok:true,value:45});raw.layout.page={categoryId:'scenarioCat',memberKeys:[...names.slice(0,8),names[9]].map(key)};expect(calculateTable({model:raw,source:data,table:{},search:''}).totals.measures.cells.get('rev')).toEqual({ok:true,value:46});raw.enabled=false;expect(calculateTable({model:raw,source:data,table:{columnFilters:[{id:'revenue',value:{max:2}}]},search:''}).recordIds).toEqual(new Set(['n0','n1']));
});

it('empty Page supplies no error scope even for unknown source identities and global qualification failures',()=>{
 const {raw,data}=fixture();const compiled=compileAnalyticalModel(raw,{columns:data.columns});const pool=eligiblePool(evaluateSourceFormulas(data.rows,compiled),{columns:data.columns,table:{columnFilters:[{id:'missing',value:'X'}]}});expect(pool.qualificationErrors.length).toBeGreaterThan(0);expect(scopeErrors(pool,{sourceRecordIds:new Set(['unknown']),categoryConstraints:new Map(),page:{categoryId:'scenarioCat',memberKeys:[]},temporalContext:{}})).toEqual([]);
});
it('viewer All keeps authored category and None keeps an explicit empty effective Page',async()=>{
 const {effectiveRuntimeModel}=await import('../tableExecution/runtimeParams');const {raw}=fixture();const saved=structuredClone(raw);const all=effectiveRuntimeModel(raw,{'pivot:page':{source:'viewer',memberKeys:null}});expect(all.model.layout.page).toBeUndefined();expect(raw).toEqual(saved);const none=effectiveRuntimeModel(raw,{'pivot:page':{source:'viewer',memberKeys:[]}});expect(none.model.layout.page).toEqual({categoryId:'scenarioCat',memberKeys:[]});expect(raw).toEqual(saved);
});
it('accepts authored keys beyond runtime transport limits and preserves invalid singular raw intent through compilation',()=>{
 const {raw}=fixture();raw.layout.page={categoryId:'scenarioCat',memberKeys:[...Array.from({length:1025},(_,i)=>key(`k${i}`)),key('é'.repeat(8193))]};expect(validateTableModel(raw).model).toEqual(raw);expect(compileAnalyticalModel(raw).model.layout.page).toEqual(raw.layout.page);const invalid={...raw,layout:{...raw.layout,page:{categoryId:'scenarioCat',memberKey:key('Actual')}}};const compiled=compileAnalyticalModel(invalid);expect(compiled.validation.raw).toBe(invalid);expect(compiled.validation.diagnostics).toContainEqual(expect.objectContaining({path:'layout.page'}));expect(compiled.model.layout.page).toBeUndefined();
});
it('cannot claim an unobserved Page key absent when excluded acquired temporal membership is unknown',()=>{
 const {raw,data}=fixture();raw.categories=[{id:'yearCat',name:'Year',sourceFieldId:'date',transform:'Y'}];raw.formulas=[];raw.layout={rows:[],columns:[],values:['rev'],page:{categoryId:'yearCat',memberKeys:[key('2027')]}};data.columns.push({id:'date',label:'Date',dtype:'dateString'});data.rows=[{id:'valid',values:{date:'2026-01-01',revenue:10}},{id:'excludedUnknown',values:{date:'bad',revenue:999}}];const compiled=compileAnalyticalModel(raw,{columns:data.columns});const pool=eligiblePool(evaluateSourceFormulas(data.rows,compiled),{columns:data.columns,table:{columnFilters:[{id:'revenue',value:{max:100}}]}});const page=activePage(pool,raw.layout.page);expect(page.classificationComplete).toBe(false);expect(page.errors.some(error=>error.code==='missing-member')).toBe(false);expect(page.errors).toContainEqual(expect.objectContaining({code:'invalid-date',recordIds:['excludedUnknown']}));const calculated=calculateTable({model:raw,source:data,table:{columnFilters:[{id:'revenue',value:{max:100}}]},search:''});expect(calculated.paramDiagnostics.some(d=>d.code==='PIVOT_PARAM_UNMATCHED')).toBe(false);
});
