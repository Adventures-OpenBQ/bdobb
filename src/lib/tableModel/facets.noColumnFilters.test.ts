// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {beforeEach,expect,it,vi} from 'vitest';
import {createTable} from '@tanstack/react-table';
import {evaluateSourceFormulas} from './formulaEvaluation';
import {categoryFacets,eligiblePool} from './facets';
import {context,profit} from './evaluationTestHelpers';
import {pivotValueKey as key} from '../pivotKeys';

vi.mock('@tanstack/react-table',async importOriginal=>{
 const actual=await importOriginal<typeof import('@tanstack/react-table')>();
 return {...actual,createTable:vi.fn(actual.createTable)};
});
beforeEach(()=>{vi.mocked(createTable).mockClear();});
const categories=['scenario','region'].map(id=>({id:`${id}Cat`,name:id,sourceFieldId:id,transform:'native' as const}));
const rows=[
 {id:'a',values:{scenario:'Actual',region:'US',revenue:10,cost:4}},
 {id:'b',values:{scenario:'Budget',region:'US',revenue:20,cost:2}},
 {id:'c',values:{scenario:'Budget',region:'EU',revenue:3,cost:2}},
];
it('qualifies search/checklists and own-facet counts without constructing table row models',()=>{
 const input=evaluateSourceFormulas(rows,context([],categories));
 const before=structuredClone(input.rows);
 const constraints={columns:input.columns,search:'US',checklists:[{categoryId:'scenarioCat',memberKeys:[key('Actual')]}]};
 const pool=eligiblePool(input,constraints);
 expect(pool.rows.map(row=>row.id)).toEqual(['a']);
 expect(pool.classificationComplete).toBe(true);
 expect(pool.exclusions.get('b')).toContainEqual({kind:'checklist',definitionId:'scenarioCat'});
 expect(pool.exclusions.get('c')).toContainEqual({kind:'search'});
 expect(categoryFacets(input,constraints,'scenarioCat').map(m=>[m.label,m.count])).toEqual([['Actual',1],['Budget',1]]);
 expect(categoryFacets(input,constraints,'regionCat').map(m=>[m.label,m.count])).toEqual([['US',1]]);
 expect(input.rows).toEqual(before);
 expect(createTable).not.toHaveBeenCalled();
});
it.each([undefined,'',{}, {min:undefined,max:undefined}])('skips inactive numeric filter %j without qualifying unrelated formula errors',value=>{
 const input=evaluateSourceFormulas([{id:'bad',values:{scenario:'Actual',revenue:null,cost:1}}],context([profit],categories));
 const columns=input.columns.map(c=>c.id==='profit'?{...c,dtype:'number' as const}:c);
 const pool=eligiblePool(input,{columns,table:{columnFilters:[{id:'profit',value}]}});
 expect(pool).toMatchObject({classificationComplete:true,rows:[expect.objectContaining({id:'bad'})]});
 expect(input.errors.get('bad')?.has('profit')).toBe(true);
 expect(createTable).not.toHaveBeenCalled();
});
it.each([{}, {from:'',to:''}])('skips an inactive date filter %j',value=>{
 const input=evaluateSourceFormulas([{id:'a',values:{date:'2026-10-30'}}],context([]));
 const columns=[{id:'date',label:'Date',dtype:'date' as const}];
 expect(eligiblePool(input,{columns,table:{columnFilters:[{id:'date',value}]}}).rows.map(row=>row.id)).toEqual(['a']);
 expect(createTable).not.toHaveBeenCalled();
});
it('ignores a removed missing-field filter and keeps first-source identity deduplication',()=>{
 const input=evaluateSourceFormulas([rows[0],{id:'a',values:{scenario:'Duplicate',region:'EU',revenue:999,cost:0}},rows[1]],context([],categories));
 const pool=eligiblePool(input,{columns:input.columns,table:{columnFilters:[{id:'missing',value:undefined}]}});
 expect(pool.rows.map(row=>[row.id,row.values.region])).toEqual([['a','US'],['b','US']]);
 expect(pool.classificationComplete).toBe(true);
 expect(categoryFacets(input,{columns:input.columns},'scenarioCat').map(m=>[m.label,m.count])).toEqual([['Actual',1],['Budget',1]]);
 expect(createTable).not.toHaveBeenCalled();
});
it('retains malformed category qualification errors when only a checklist is active',()=>{
 const input=evaluateSourceFormulas([{id:'bad',values:{date:'2026-02-30'}}],context([],[{id:'year',name:'Year',sourceFieldId:'date',transform:'Y'}]));
 const pool=eligiblePool(input,{columns:input.columns,checklists:[{categoryId:'year',memberKeys:[key('2026')]}]});
 expect(pool).toMatchObject({rows:[],classificationComplete:false,qualificationErrors:[expect.objectContaining({code:'invalid-date'})]});
 expect(createTable).not.toHaveBeenCalled();
});
it('continues delegating active column filters and reporting failed formula qualification',()=>{
 const input=evaluateSourceFormulas([{id:'bad',values:{revenue:null,cost:1}},...rows],context([profit],categories));
 const pool=eligiblePool(input,{columns:input.columns,table:{columnFilters:[{id:'profit',value:{min:5}}]}});
 expect(pool.rows.map(row=>row.id)).toEqual(['a','b']);
 expect(pool.classificationComplete).toBe(false);
 expect(pool.exclusions.get('bad')).toEqual(expect.arrayContaining([expect.objectContaining({kind:'error'})]));
 expect(createTable).toHaveBeenCalledTimes(1);
});
it('preserves refusal evidence for an active missing-field filter',()=>{
 const input=evaluateSourceFormulas(rows,context([],categories));
 const pool=eligiblePool(input,{columns:input.columns,table:{columnFilters:[{id:'missing',value:'x'}]}});
 expect(pool.rows).toEqual([]);
 expect(pool.classificationComplete).toBe(false);
 expect(pool.qualificationErrors).toEqual(expect.arrayContaining([expect.objectContaining({code:'missing-reference',definitionId:'missing'})]));
 expect(createTable).toHaveBeenCalledTimes(1);
});
