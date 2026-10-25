// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useMemo,useRef} from 'react';
import {tableExecutionStore} from '../stores/tableExecutionStore';
import {useDashboardStore} from '../stores/dashboardStore';
import type {ModelEdit} from '../stores/tableCommitCoordinator';
import type {FormulaDef,TableModelV1} from '../lib/tableModel/types';
import type {FormulaBindResult,FormulaDraft,MemberDomainResult,ScopedFormulaBinding} from '../lib/tableExecution/types';
import {validateTableModel} from '../lib/tableModel/validation';
import {categoryAuthoringRecipe} from '../lib/tableModel/categoryAuthoringRecipe';
export type FormulaAuthoring={contextKey:string;bind(draft:FormulaDraft,bindings:ScopedFormulaBinding[],signal:AbortSignal):Promise<FormulaBindResult>;members(categoryId:string,offset:number,search:string,signal:AbortSignal):Promise<MemberDomainResult>;commit(formula:FormulaDef|undefined,original:FormulaDef|undefined,contextKey:string):Promise<boolean>};
const executorIds=new WeakMap<object,number>();let nextId=0;
function executorId(value:object|undefined){if(!value)return 0;let id=executorIds.get(value);if(!id){id=++nextId;executorIds.set(value,id);}return id;}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** Only binding-relevant intent; unrelated layout edits are composed by the durable lane. */
const symbols=(model:Readonly<TableModelV1>)=>[model.categories,model.measures,model.formulas];
export function useFormulaAuthoring(dashboardId:string,widgetId:string,onEditModel:(edit:ModelEdit)=>Promise<boolean>):FormulaAuthoring|undefined {
 const read=()=>{const view=tableExecutionStore.readView(dashboardId,widgetId),executor=tableExecutionStore.readExecutor(dashboardId,widgetId),state=useDashboardStore.getState();const card=state.dashboards.find(d=>d.id===dashboardId)?.tabs.flatMap(t=>t.cards).find(c=>c.id===widgetId);const authority=JSON.stringify([state.viewer,card&&[card.widgetId,card.backendId,card.params,card.linkedSource,card.view, ...(card.managedSource ? [card.managedSource] : [])],executorId(executor),view.requested.input,view.sourceRevision]);return {view,executor,viewer:state.viewer,authority,key:JSON.stringify([authority,view.requested,view.definition])};};
 const commitRef=useRef(onEditModel);commitRef.current=onEditModel;
 const initial=read();
 return useMemo(()=>{
  const authoredModel=validateTableModel(initial.view.definition.analytical).model;
  if(!authoredModel||!initial.executor?.bindFormula||!initial.executor.memberDomain||!initial.view.definition.analytical)return undefined;
  const {view,executor,key,authority}=initial,definition=structuredClone(view.definition),revision={...view.requested};
  const current=()=>{const now=read();if(now.key!==key||now.executor!==executor)throw new Error('Formula context changed. Review and bind the current draft again.');return now;};
  const proofs=new WeakMap<object,string>();
  return {contextKey:key,
   bind:async(draft,bindings,signal)=>{current();const result=await executor.bindFormula!(revision,{definition,draft,bindings},signal);current();if(signal.aborted||!equal(result.revision,revision))throw new DOMException('Obsolete formula binding','AbortError');if(result.ast&&!result.truncated&&!result.bindingDiagnostics.length)proofs.set(result.ast,JSON.stringify(draft));return result;},
   members:async(categoryId,offset,search,signal)=>{current();const categoryRecipe=categoryAuthoringRecipe(authoredModel,categoryId);const result=await executor.memberDomain!(revision,{definition,categoryId,categoryRecipe,offset,limit:100,search:search||undefined},signal);current();if(signal.aborted||!equal(result.revision,revision)||result.categoryRecipe!==categoryRecipe||result.categoryId!==categoryId)throw new DOMException('Obsolete member domain','AbortError');return result;},
   commit:async(formula,original,contextKey)=>{const now=current();if(now.viewer||contextKey!==key||formula&&proofs.get(formula.ast)!==JSON.stringify({id:formula.id,name:formula.name,scope:formula.scope,expression:formula.expression,...(formula.format===undefined?{}:{format:formula.format})}))return false;return commitRef.current({apply:model=>{const latest=read();if(latest.viewer||latest.authority!==authority||latest.executor!==executor||!equal(latest.view.definition.table,definition.table)||latest.view.definition.search!==definition.search||!equal(latest.view.selection,view.selection)||!equal(symbols(model),symbols(authoredModel))||!equal(model.formulas.find(f=>f.id===(original?.id??formula?.id)),original))throw new Error('Formula definition changed. Review and bind the current draft again.');if(formula)return {...model,formulas:original?model.formulas.map(f=>f.id===original.id?formula:f):[...model.formulas,formula]};if(!original)throw new Error('Formula is unavailable.');return {...model,formulas:model.formulas.filter(f=>f.id!==original.id),layout:{...model.layout,values:model.layout.values.filter(id=>id!==original.id)}};}});},
  };
 // The serialized identity intentionally includes definition/source/revision and executor identity.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[initial.key]);
}
