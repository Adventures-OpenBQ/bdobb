// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { PivotFilterParam, TableModelV1 } from './types';
export type PivotParamView = { key: string; categoryId: string; label: string; multiSelect: boolean; memberKeys: string[] | null; source: 'page' | 'filter' };
/** Reserved keys identify execution controls; authored IDs remain independent. */
export function paramRow(model: TableModelV1): PivotParamView[] {
 const page=model.layout.page;
 return [
  ...(page&&model.params.promotePage?[{key:'pivot:page',categoryId:page.categoryId,label:model.categories.find(c=>c.id===page.categoryId)?.name??page.categoryId,multiSelect:false,memberKeys:[...page.memberKeys],source:'page' as const}]:[]),
  ...model.params.filters.map(p=>({key:`pivot:filter:${p.categoryId}`,categoryId:p.categoryId,label:p.label,multiSelect:p.multiSelect,memberKeys:model.checklists.find(c=>c.categoryId===p.categoryId)?.memberKeys??null,source:'filter' as const})),
 ];
}
export function setFilterKeys(model:TableModelV1,categoryId:string,keys:string[]|null):TableModelV1 {
 const first=model.checklists.findIndex(c=>c.categoryId===categoryId);
 const checklists=model.checklists.filter(c=>c.categoryId!==categoryId);
 if(keys!==null)checklists.splice(first<0?checklists.length:first,0,{categoryId,memberKeys:[...keys]});
 return {...model,checklists};
}
export function setPageKeys(model:TableModelV1,categoryId:string,keys:string[]):TableModelV1 {
 return model.layout.page?.categoryId===categoryId?{...model,layout:{...model.layout,page:{categoryId,memberKeys:[...new Set(keys)]}}}:model;
}
export function promote(model:TableModelV1,categoryId:string,opts:Omit<PivotFilterParam,'categoryId'>):TableModelV1 {
 const existing=model.params.filters.find(p=>p.categoryId===categoryId);
 const filter={...opts,categoryId,id:existing?.id??opts.id};
 return {...model,params:{...model.params,filters:existing?model.params.filters.map(p=>p.categoryId===categoryId?filter:p):[...model.params.filters,filter]}};
}
export function demote(model:TableModelV1,categoryId:string):TableModelV1 {
 return {...model,params:{...model.params,filters:model.params.filters.filter(p=>p.categoryId!==categoryId)}};
}

export type ParamDiagnostic = { code:'PIVOT_PARAM_REFUSED'|'PIVOT_PARAM_UNMATCHED'|'PIVOT_PARAM_EXCLUDED'|'PIVOT_PARAM_EMPTY'; key:string; memberKeys:string[]; unmatchedCount:number; truncated:boolean; message:string; severity:'warning' };
/** A UI label only; typed membership still uses the complete original key. */
export function memberLabel(key:string):string {
 try {const value:unknown=JSON.parse(key);if(Array.isArray(value)&&value.length===2)return String(value[1]??'(Blank)');}catch { /* Unrecognized saved keys remain visible. */ }
 return key;
}
