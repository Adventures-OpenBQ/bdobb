// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { TableModelV1 } from '../../../lib/tableModel/types';
import type { DatasetColumn } from '../../../lib/widgetData/types';
import type { InspectionRequest, InspectionResult } from '../../../lib/tableExecution/types';
import type { ModelEdit } from '../../../stores/tableCommitCoordinator';
import { dataIds, moveValue } from '../../../lib/tableModel/layoutValues';
import { measureEligibility } from '../table-model/measureEligibility';
import { AGGREGATION_NAMES, duplicateMeasure, measureLabel, updateMeasureAggregation } from '../../../lib/tableModel/measures';
import { RowContextMenu, type MenuItem } from '../../RowContextMenu';
type List='available'|'rows'|'columns'|'values';
type Pill={id:string;name:string;tag:string;kind:'category'|'field'|'measure'|'formula';scope?:'source'|'aggregate'};
const DRAG='application/x-bdobb-report-pill';
export function ArrangePanel({model,columns,readonly,onCommitModel,onEditModel,sourceInspection,onRequestSourceInspection}:{model:TableModelV1;columns:readonly DatasetColumn[];readonly:boolean;onCommitModel:(next:TableModelV1)=>Promise<boolean>;onEditModel?:(edit:ModelEdit)=>Promise<boolean>;sourceInspection?:InspectionResult;onRequestSourceInspection?:(request:InspectionRequest)=>void}) {
 const [menu,setMenu]=useState<{pill:Pill;list:List;x:number;y:number;trigger:HTMLElement}|null>(null);const [error,setError]=useState('');
 const label=(id:string)=>columns.find(c=>c.id===id)?.label??model.formulas.find(f=>f.id===id)?.name??id;
 const categories:Pill[]=model.categories.map(c=>({id:c.id,name:c.name,tag:c.legacyBucket??(c.transform==='native'?columns.find(field=>field.id===c.sourceFieldId)?.dtype??'category':({Y:'Year',Q:'Quarter',M:'Month',FY:'Fiscal year',FQ:'Fiscal quarter'})[c.transform]),kind:'category'}));
 const formulaPills:Pill[]=model.formulas.map(f=>({id:f.id,name:f.name,tag:f.scope==='source'?'source':'formula',kind:'formula',scope:f.scope}));
 const measurePills:Pill[]=model.measures.map(m=>({id:m.id,name:measureLabel(m,label(m.sourceFieldId),model.measures),tag:m.aggregation===undefined?'Choose aggregation':AGGREGATION_NAMES[m.aggregation],kind:'measure'}));
 const values=dataIds(model);
 const used=new Set([...model.layout.rows,...model.layout.columns,...(model.layout.page?[model.layout.page.categoryId]:[])]);
 const lists:Record<List,Pill[]>={available:[...categories.filter(c=>!used.has(c.id)),...formulaPills.filter(f=>f.scope==='source'||!values.includes(f.id)),...columns.filter(c=>!model.formulas.some(f=>f.id===c.id)).map(c=>({id:c.id,name:c.label,tag:c.dtype??'field',kind:'field' as const}))],rows:model.layout.rows.flatMap(id=>categories.filter(c=>c.id===id)),columns:model.layout.columns.flatMap(id=>categories.filter(c=>c.id===id)),values:values.flatMap(id=>[...measurePills,...formulaPills].filter(p=>p.id===id))};
 const commit=async(apply:ModelEdit['apply'])=>{if(readonly)return;setError('');const saved=onEditModel?await onEditModel({apply}):await onCommitModel(apply(model));if(!saved)setError('Could not save arrangement. Try again.');};
 const move=(pill:Pill,target:List,beforeId?:string)=>{
  if(readonly||beforeId===pill.id)return;
  const freshId=crypto.randomUUID();
  void commit(current=>{
   const existing=pill.kind==='measure'?current.measures.some(m=>m.id===pill.id):pill.kind==='formula'?current.formulas.some(f=>f.id===pill.id):pill.kind==='category'?current.categories.some(c=>c.id===pill.id):columns.some(c=>c.id===pill.id);
   if(!existing)return current;
   if(pill.kind==='formula'&&pill.scope==='aggregate'){
    if(target==='available'){const index=current.layout.values.indexOf(pill.id);return {...current,layout:{...current.layout,values:current.layout.values.filter((_,at)=>at!==index)}};}
    if(target!=='values')return current;
    const order=dataIds(current).filter(id=>id!==pill.id);return moveValue(current,pill.id,beforeId?order.indexOf(beforeId):order.length);
   }
   if(target==='values'){
    if(pill.kind==='measure'){const order=dataIds(current).filter(id=>id!==pill.id);return moveValue(current,pill.id,beforeId?order.indexOf(beforeId):order.length);}
    const sourceFieldId=pill.kind==='category'?current.categories.find(c=>c.id===pill.id)!.sourceFieldId:pill.id;
    const next={...current,measures:[...current.measures,{id:freshId,sourceFieldId}]};return beforeId?moveValue(next,freshId,dataIds(next).indexOf(beforeId)):next;
   }
   if(pill.kind==='measure')return target==='available'?{...current,measures:current.measures.filter(m=>m.id!==pill.id),layout:{...current.layout,values:current.layout.values.filter(id=>id!==pill.id)}}:current;
   let id=pill.id;let nextCategories=current.categories;
   if(pill.kind==='field'||pill.kind==='formula'){if(target==='available')return current;id=freshId;nextCategories=[...current.categories,{id,name:pill.name,sourceFieldId:pill.id,transform:'native' as const}];}
   const layout={...current.layout,rows:current.layout.rows.filter(k=>k!==id),columns:current.layout.columns.filter(k=>k!==id)};
   if(target==='rows'||target==='columns'){const index=beforeId?layout[target].indexOf(beforeId):-1;layout[target].splice(index<0?layout[target].length:index,0,id);if(layout.page?.categoryId===id)delete layout.page;}
   return {...current,categories:nextCategories,layout};
  });
 };
 const reorder=(pill:Pill,list:List,delta:number)=>void commit(current=>{
  if(list==='values'){const order=dataIds(current);const index=order.indexOf(pill.id);return index<0?current:moveValue(current,pill.id,index+delta);}
  if(list!=='rows'&&list!=='columns')return current;
  const order=[...current.layout[list]];const index=order.indexOf(pill.id),target=index+delta;if(index<0||target<0||target>=order.length)return current;
  [order[index],order[target]]=[order[target],order[index]];return {...current,layout:{...current.layout,[list]:order}};
 });
 const items=(pill:Pill,list:List):MenuItem[]=>{
  const out:MenuItem[]=[];
  if(pill.kind==='formula'&&pill.scope==='aggregate')out.push({label:list==='values'?'Move to Available':'Move to Data Columns',disabled:readonly,onSelect:()=>move(pill,list==='values'?'available':'values')});
  else if(pill.kind!=='measure'){for(const [target,name] of [['rows','Row Groups'],['columns','Column Groups'],['available','Available'],['values','Data Columns']] as const)if(target!==list)out.push({label:`Move to ${name}`,disabled:readonly,onSelect:()=>move(pill,target)});}
  else {
   out.push({label:'Remove from Data Columns',disabled:readonly,onSelect:()=>move(pill,'available')});
   const measure=model.measures.find(m=>m.id===pill.id)!;
   const {operators}=measureEligibility({model,columns,sourceFieldId:measure.sourceFieldId,sourceInspection,fallbackKind:'none'});
   out.push({label:'Aggregation',disabled:readonly,submenu:operators.map(op=>({label:AGGREGATION_NAMES[op],checked:measure.aggregation===op,disabled:readonly,onSelect:()=>void commit(current=>({...current,measures:updateMeasureAggregation(current.measures,measure.id,op)}))}))});
   if(model.formulas.some(f=>f.id===measure.sourceFieldId&&f.scope==='source'))out.push({label:'Inspect source type',onSelect:()=>onRequestSourceInspection?.({collection:'definitions',definitionId:measure.sourceFieldId,offset:0,limit:1})});
   out.push({label:`Duplicate ${pill.name}`,disabled:readonly,onSelect:()=>{const id=crypto.randomUUID();void commit(current=>({...current,measures:duplicateMeasure(current.measures,pill.id,id)}));}});
  }
  if(list==='rows'||list==='columns'||list==='values')for(const delta of [-1,1]){const order=list==='values'?values:model.layout[list];const target=order.indexOf(pill.id)+delta;out.push({label:delta===-1?'Move earlier':'Move later',disabled:readonly||target<0||target>=order.length,onSelect:()=>reorder(pill,list,delta)});}
  return out;
 };
 const drop=(event:React.DragEvent,target:List,beforeId?:string)=>{if(readonly)return;event.preventDefault();event.stopPropagation();try{const data=JSON.parse(event.dataTransfer.getData(DRAG)) as {id:string;kind:Pill['kind']};const pill=Object.values(lists).flat().find(p=>p.id===data.id&&p.kind===data.kind);if(pill)move(pill,target,beforeId);}catch{/* Foreign payloads cannot author a report. */}};
 return <><div className="pivot-columns">{(['available','rows','columns','values'] as const).map(list=><div className="pivot-column" key={list}><h3>{({available:'Available',rows:'Row Groups',columns:'Column Groups',values:'Data Columns'})[list]}<span className="pivot-column-count">{lists[list].length}</span></h3><div className="pivot-list" data-list={list} onDragOver={e=>{if(!readonly&&e.dataTransfer.types.includes(DRAG))e.preventDefault();}} onDrop={e=>drop(e,list)}>{lists[list].map(pill=><button type="button" className="pivot-pill" key={`${pill.kind}:${pill.id}`} title={pill.name} aria-label={pill.name} data-kind={pill.kind} draggable={!readonly} onDragStart={e=>e.dataTransfer.setData(DRAG,JSON.stringify({id:pill.id,kind:pill.kind}))} onDrop={e=>drop(e,list,pill.id)} onKeyDown={e=>{if(e.altKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')&&list!=='available'){e.preventDefault();reorder(pill,list,e.key==='ArrowUp'?-1:1);}}} onClick={e=>{const box=e.currentTarget.getBoundingClientRect();setMenu({pill,list,x:box.left,y:box.bottom,trigger:e.currentTarget});}} onContextMenu={e=>{e.preventDefault();setMenu({pill,list,x:e.clientX,y:e.clientY,trigger:e.currentTarget});}}>{pill.kind==='formula'?<span className="pivot-pill-fx" role="img" aria-label={pill.scope==='aggregate'?'Aggregate formula':'Source formula'}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11 2C7 0 7 4 6 8L4 14M3 6h7" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg></span>:null}<span className="pivot-pill-name">{pill.name}</span><span className="pivot-pill-tag">{pill.tag}</span></button>)}{!lists[list].length?<p className="pivot-empty">Drop here</p>:null}</div></div>)}</div>{error?<p role="alert">{error}</p>:null}{menu?<RowContextMenu portal x={menu.x} y={menu.y} anchor={menu.trigger} returnFocusTo={menu.trigger} items={items(menu.pill,menu.list)} onClose={()=>setMenu(null)}/>:null}</>;
}
