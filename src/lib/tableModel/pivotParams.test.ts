// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { migratePivot } from './migration';
import { compileAnalyticalModel } from './calculate';
import { validateTableModel } from './validation';
import { paramRow, setFilterKeys, setPageKeys, promote, demote } from './pivotParams';
const categoryId = 'category:["sector","native"]';
const base = () => ({...migratePivot({enabled:true,grouping:['sector'],split:[]}), params:{promotePage:true,filters:[]}});
const opts = {id:'filter-sector',label:'Sector',multiSelect:true};
describe('authored pivot parameters',()=>{
 it('requires explicit bounded metadata and retains original invalid intent',()=>{
  const raw:Record<string,unknown> = base(); delete raw.params;
  const checked=validateTableModel(raw); expect(checked.model).toBeUndefined(); expect(checked.raw).toBe(raw);
  expect(checked.diagnostics).toContainEqual(expect.objectContaining({path:'params'}));
  for(const params of [null,{promotePage:1,filters:[]},{promotePage:true,filters:[{...opts,categoryId:'unknown'}]},{promotePage:true,filters:[{...opts,categoryId,label:'x'.repeat(257)}]},{promotePage:true,filters:[{...opts,categoryId},{...opts,categoryId}]}]) {
   const invalid={...base(),params}; expect(validateTableModel(invalid).model).toBeUndefined(); expect(validateTableModel(invalid).raw).toBe(invalid);
  }
  let calls=0;const params=Object.defineProperty({},'filters',{get(){calls++;return [];}});
  expect(validateTableModel({...base(),params}).model).toBeUndefined();expect(calls).toBe(0);
 });
 it('places the derived Page first and preserves opt-out and authored selections through compilation',()=>{
  const model=promote({...base(),layout:{rows:[],columns:[],values:[],page:{categoryId,memberKeys: ['typed-page']}}},categoryId,opts);
  expect(paramRow(model).map(p=>p.key)).toEqual(['pivot:page',`pivot:filter:${categoryId}`]);
  const compiled=compileAnalyticalModel(model).model;expect(compiled.params).toEqual(model.params);
  expect(paramRow({...model,params:{...model.params,promotePage:false}}).map(p=>p.key)).toEqual([`pivot:filter:${categoryId}`]);
  expect(migratePivot({enabled:false,grouping:[],split:[]}).params).toEqual({promotePage:true,filters:[]});
 });
 it('keeps one checklist and distinguishes All, explicit empty and omission without mutating inputs',()=>{
  const model=base(); const selected=setFilterKeys(model,categoryId,['a','b']);
  expect(model.checklists).toEqual([]);expect(selected.checklists).toEqual([{categoryId,memberKeys:['a','b']}]);
  expect(setFilterKeys(selected,categoryId,[]).checklists).toEqual([{categoryId,memberKeys:[]}]);
  expect(setFilterKeys(selected,categoryId,null).checklists).toEqual([]);
  const other={categoryId:'raw-unrelated',memberKeys:['retain']};
  expect(setFilterKeys({...selected,checklists:[other,...selected.checklists]},categoryId,['c']).checklists).toEqual([other,{categoryId,memberKeys:['c']}]);
 });
 it('promotion is idempotent and demotion/single presentation never discard saved multi values',()=>{
  const saved=setFilterKeys(base(),categoryId,['a','b']);const model=promote(saved,categoryId,opts);
  const single=promote(model,categoryId,{...opts,id:'new-ignored',multiSelect:false});
  expect(single.params.filters).toEqual([{...opts,categoryId,multiSelect:false}]);expect(single.checklists).toEqual(saved.checklists);
  expect(promote(model,categoryId,opts)).toEqual(model);
  expect(demote(model,categoryId).checklists).toEqual(saved.checklists);expect(demote(model,categoryId).params.filters).toEqual([]);
  expect(setPageKeys({...model,layout:{...model.layout,page:{categoryId,memberKeys: ['old']}}},categoryId,['new']).layout.page).toEqual({categoryId,memberKeys:['new']});
 });
});
