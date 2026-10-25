// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { inspectionPage, inspectionCounts } from './inspection';
import { calculateView } from './engine';
import { input } from './fixtures';
import type { TableModelV1 } from '../tableModel/types';
const model: TableModelV1 = { schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true, categories: [], measures: [{ id: 'sum', sourceFieldId: 'revenue', aggregation: 'sum' }], formulas: [{ id: 'margin', name: 'Margin', scope: 'aggregate', expression: 'Revenue / 2', ast: { kind: 'binary', operator: '/', left: { kind: 'reference', target: 'measure', id: 'sum' }, right: { kind: 'literal', value: 2 } } }], layout: { rows: [], columns: [], values: ['margin'] }, checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: false } };
it('projects bound references and configured operators with explicit pagination, no private maps', () => {
 const view = calculateView(input, { table: {}, search: '', analytical: model }, { kind: 'none' });
 const first = inspectionPage(view, Object.assign({ collection: 'definitions' as const, offset: 0, limit: 1 },{recordIds:['private']}));
 expect(JSON.stringify(first)).not.toContain('recordIds');
 expect(first).toMatchObject({ total: 2, nextOffset: 1, truncated: true });
 const formula = inspectionPage(view, { collection: 'definitions', offset: 1, limit: 1 });
 expect(formula.rows).toEqual([{ kind: 'formula', id: 'margin', name: 'Margin', referenceIds: ['sum'], referenceCount: 1, truncatedReferences: false, resolvedOperators: ['sum'] }]);
 expect(JSON.stringify(formula)).not.toMatch(/sourceRecordIds|sourceDependencies|formulaCells/);
 expect(inspectionCounts(view)).toEqual({ definitions: 2, warnings: 0, periodBounds: 0 });
});
it('pages every company bound and retains warning/category relation and fiscal context', () => {
 const view = calculateView(input, { table: {}, search: '', analytical: model }, { kind: 'none' });
 view.analytical!.warnings = [{ code: 'fiscal-alignment', message: 'Different FY2026 spans', categoryId: 'fy', periods: [{companyKey:'A',start:'2025-01-01',end:'2025-12-31',source:'provider'}, {companyKey:'B',start:'2025-07-01',end:'2026-06-30',source:'mapping'}] }];
 view.analytical!.compiled.model.categories.push({id:'fy',name:'Fiscal year',sourceFieldId:'date',transform:'FY'});
 Object.assign(view.analytical!.warnings[0].periods![0],{recordIds:['private']});
 const first = inspectionPage(view,{collection:'periodBounds',offset:0,limit:1});
 expect(JSON.stringify(first)).not.toContain('recordIds');
 expect(first).toMatchObject({total:2,nextOffset:1,truncated:true, rows:[{kind:'periodBounds',warningId:'warning:0',categoryId:'fy',companyKey:'A',period:'FY',context:'Different FY2026 spans'}]});
 expect(inspectionPage(view,{collection:'periodBounds',offset:1,limit:1})).toMatchObject({total:2,truncated:false,rows:[{companyKey:'B'}]});
 expect(inspectionPage(view,{collection:'warnings',offset:0,limit:1}).rows).toEqual([{kind:'warning',id:'warning:0',code:'fiscal-alignment',message:'Different FY2026 spans',categoryId:'fy',periodCount:2}]);
});
it('rejects unbounded page reads', () => {
 const view = calculateView(input,{table:{},search:''},{kind:'none'});
 for (const limit of [0,101]) expect(() => inspectionPage(view,{collection:'definitions',offset:0,limit})).toThrow();
});

import { validateExecutionRequest, validateExecutionResponse } from './validation';
import { revision } from './fixtures';
import { createResultStore } from './resultStore';
it('validates inspector envelopes, budgets and private-field rejection', () => {
 const request = {kind:'inspect',requestId:'i',revision,collection:'definitions',offset:0,limit:1};
 expect(validateExecutionRequest(request)).toEqual(request);
 for(const patch of [{limit:101},{offset:-1},{collection:'records'}]) expect(()=>validateExecutionRequest({...request,...patch})).toThrow();
 const store=createResultStore(calculateView(input,{table:{},search:'',analytical:model},{kind:'none'}),revision);
 const response=store.inspect('i',revision,{collection:'definitions',offset:0,limit:1});
 expect(validateExecutionResponse(response,revision,'i')).toEqual(response);
 expect(()=>validateExecutionResponse({...response,rows:[{...response.rows[0],sourceRecordIds:['private']}]},revision,'i')).toThrow();
 expect(()=>validateExecutionResponse({...response,pool:{records:['private']}},revision,'i')).toThrow();
 expect(()=>store.inspect('i',{...revision,output:revision.output+1},{collection:'warnings',offset:0,limit:1})).toThrow();
});
it('caps definition references explicitly while resolving nested formula operators',()=>{
 const view=calculateView(input,{table:{},search:'',analytical:model},{kind:'none'});
 const ids=Array.from({length:105},(_,i)=>`field${i}`);
 view.analytical!.compiled.model.formulas.push({id:'large',name:'Large',scope:'aggregate',expression:'SUM(...)',ast:{kind:'call',function:'sum',args:ids.map(id=>({kind:'reference',target:'field',id}))}});
 const page=inspectionPage(view,{collection:'definitions',offset:2,limit:1});
 expect(page.rows[0]).toMatchObject({referenceCount:105,truncatedReferences:true,resolvedOperators:['sum']});
 expect('referenceIds' in page.rows[0] && page.rows[0].referenceIds).toHaveLength(100);
 const response={...page,kind:'inspect',requestId:'i',revision,completeness:input.completeness,diagnostics:[]};
 expect(validateExecutionResponse(response,revision,'i')).toEqual(response);
 for(const patch of [{rows:[{...page.rows[0],referenceCount:0}]},{nextOffset:99},{rows:[{kind:'periodBounds',warningId:'w',companyKey:'A',start:'',end:'',source:'',period:'FY',context:''}]}])
   expect(()=>validateExecutionResponse({...response,...patch},revision,'i')).toThrow();
});
it('inspects long valid dependency chains without using the JavaScript call stack',()=>{
 const view=calculateView(input,{table:{},search:'',analytical:model},{kind:'none'});
 view.analytical!.compiled.model.formulas=Array.from({length:30000},(_,i)=>({id:`f${i}`,name:`F${i}`,scope:'aggregate' as const,expression:'bound',ast:{kind:'reference' as const,target:i===29999?'measure' as const:'formula' as const,id:i===29999?'sum':`f${i+1}`}}));
 expect(inspectionPage(view,{collection:'definitions',offset:1,limit:1}).rows[0]).toMatchObject({referenceIds:['f1'],resolvedOperators:['sum']});
});
it('reads one source formula by stable ID with worker-derived filter kind and validates bounded selectors',()=>{
 const formula={id:'inverse',name:'Inverse',scope:'source' as const,expression:'1 / revenue',ast:{kind:'binary' as const,operator:'/' as const,left:{kind:'literal' as const,value:1},right:{kind:'reference' as const,target:'field' as const,id:'revenue'}}};
 const view=calculateView(input,{table:{},search:'',analytical:{...model,formulas:[formula,...model.formulas]}},{kind:'none'});
 const request={collection:'definitions' as const,definitionId:'inverse',offset:0,limit:1};
 const page=inspectionPage(view,request);
 expect(page).toMatchObject({definitionId:'inverse',total:1,truncated:false,rows:[{id:'inverse',scope:'source',sourceFilterKind:'number'}]});
 const envelope={...request,kind:'inspect',requestId:'i',revision};expect(validateExecutionRequest(envelope)).toEqual(envelope);
 for(const patch of [{definitionId:''},{definitionId:7},{definitionId:'x'.repeat(16385)},{collection:'warnings'}])expect(()=>validateExecutionRequest({...envelope,...patch})).toThrow();
 expect(inspectionPage(view,{...request,definitionId:'missing'})).toMatchObject({total:0,rows:[]});
 const response={...page,kind:'inspect',requestId:'i',revision,completeness:input.completeness,diagnostics:[]};expect(validateExecutionResponse(response,revision,'i')).toEqual(response);
 expect(()=>validateExecutionResponse({...response,rows:[{...page.rows[0],sourceFilterKind:'records'}]},revision,'i')).toThrow();
});
it('source formula filter kind remains unknown for all-error outputs',()=>{
 const view=calculateView(input,{table:{},search:'',analytical:{...model,formulas:[{id:'broken-source',name:'Broken source',scope:'source',expression:'1/0',ast:{kind:'binary',operator:'/',left:{kind:'literal',value:1},right:{kind:'literal',value:0}}}]}},{kind:'none'});
 expect(inspectionPage(view,{collection:'definitions',definitionId:'broken-source',offset:0,limit:1}).rows[0]).toMatchObject({sourceFilterKind:'none'});
});
