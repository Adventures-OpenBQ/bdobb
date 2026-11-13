// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {sortDisplay,sourceDisplayValue,groupDisplayValue,type DisplayOrderEntry} from '../tableModel/displaySort';
import {validateTableModel} from './validation';
import {validateRuntimeParams,type RuntimeParams} from './runtimeParams';
import {reconcileViewSelection} from './selection';
import {sameSortData,sortReuseDefinition,sortReuseReservation,withoutSorting} from './sortReusePolicy';
import type {CalculatedView,Diagnostic,LogicalGroup,SelectionSpec,TableDefinition} from './types';
import type {DatasetRow} from '../widgetData/types';
export type SortReuseState={positions:Map<object,DisplayOrderEntry>;diagnostics:Diagnostic[];runtimeParams:RuntimeParams;reservation:number;limit:number};
/** Attach only to an isolated calculation, before selection reconciliation. */
export function attachSortReuse(view:CalculatedView,runtimeParams:RuntimeParams|undefined,limit:number):void {
 const a=view.analytical,positions=a?.displayOrder;
 if(a)delete a.displayOrder;
 if(!positions||!a?.complete||view.completeness.kind!=='complete'||!sortReuseDefinition(view.definition))return;
 const runtime=runtimeParams??{},reservation=512+positions.size*1024+view.diagnostics.length*128+sortReuseReservation(runtime,limit)*4;
 if(reservation>limit)return;
 view.sortReuse={positions,diagnostics:view.diagnostics.slice(),runtimeParams:structuredClone(runtime),reservation,limit};
}
export function prefixSortDiagnostics(view:CalculatedView,prefix:Diagnostic[]):void {
 const state=view.sortReuse;if(!state)return;
 const reservation=state.reservation+prefix.length*128;
 if(reservation>state.limit){delete view.sortReuse;return;}
 state.diagnostics=[...prefix,...state.diagnostics];state.reservation=reservation;
}
/** Caller owns publication; failure never changes the previous view. */
export function resortAnalytical(view:CalculatedView,definition:TableDefinition,selection:SelectionSpec,runtimeParams:RuntimeParams|undefined,maximum:number):CalculatedView|undefined {
 if(!Number.isSafeInteger(maximum)||maximum<=0||maximum>4294967295)return;
 const state=view.sortReuse;
 if(!state||!sortReuseDefinition(definition)||!sameSortData(withoutSorting(view.definition),withoutSorting(definition))||!sameSortData(state.runtimeParams,runtimeParams??{}))return;
 // Retain the normal validation order, even on a hit.
 validateRuntimeParams(runtimeParams,definition);validateTableModel(definition,selection);
 const reservation=sortReuseReservation(view,maximum)*4+sortReuseReservation({definition,selection,runtimeParams},maximum)*4;
 if(!Number.isFinite(reservation)||reservation>maximum)return;
 const result=structuredClone(view),order=result.sortReuse!;
 const position=(value:object)=>{const n=order.positions.get(value);if(n===undefined)throw Error('Missing canonical sort position');return n.index;};
 const reset=(nodes:LogicalGroup[])=>{nodes.sort((a,b)=>position(a)-position(b));for(const node of nodes)if(node.children.length)reset(node.children);else{const leaves=node.rows.slice(1).sort((a,b)=>position(a)-position(b));node.rows=[node.rows[0],...leaves];}};
 if(result.groups.length)reset(result.groups);else result.logicalRows.sort((a,b)=>position(a)-position(b));
 result.definition=structuredClone(definition);result.diagnostics=order.diagnostics.slice();result.selection={kind:'none'};result.presentedRows=[];
 const a=result.analytical!,model=a.compiled.model,structural=new Set([...model.layout.rows,...model.layout.columns]);
 const source=new Map(a.pool.rows.filter(row=>a.recordIds.has(row.id)).map(row=>[row.id,row])),bindings=new Map(model.measures.map(m=>[m.id,m.sourceFieldId]));
 const sort=<T>(items:T[],value:(v:T,id:string)=>unknown)=>sortDisplay(items,definition.table.sorting,value);
 const sourceValue=(row:DatasetRow,id:string,bind:boolean)=>sourceDisplayValue(row,id,bind,source,bindings,structural);
 if(!result.groups.length){sort(result.logicalRows,(row,id)=>sourceValue(row,id,false));result.selectionEligibleRows=[...result.logicalRows];}
 else{
  const rows:DatasetRow[]=[],eligible:DatasetRow[]=[];
  const visit=(nodes:LogicalGroup[])=>{
   sort(nodes,(node,id)=>{const key=order.positions.get(node)?.groupKey;if(!key)throw Error('Missing canonical group sort key');return groupDisplayValue(node,id,key,structural);});
   for(const node of nodes){rows.push(node.rows[0]);if(node.children.length)visit(node.children);else{const leaves=node.rows.slice(1);sort(leaves,(row,id)=>sourceValue(row,id,true));node.rows=[node.rows[0],...leaves];rows.push(...leaves);eligible.push(node.rows[0]);}}
  };visit(result.groups);result.logicalRows=rows;result.selectionEligibleRows=eligible;
 }
 a.groups=result.groups;a.rows=result.logicalRows;a.eligibleRows=result.selectionEligibleRows;
 return reconcileViewSelection(result,selection,true,undefined,[]);
}
