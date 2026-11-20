// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Audit-only hooks. Production result-store source is not changed.
import assert from 'node:assert/strict';
import {buildAuditOwnedStore} from 'audit-store-owned';
import {reorderOwned} from './sort-reuse-prototype';
import {reserveGraph} from './sort-cache-prototype';
import type {CalculatedView,TableDefinition,SelectionSpec,Revision,LogicalGroup} from '../../src/lib/tableExecution/types';
const key=(d:TableDefinition)=>({...d,table:{...d.table,sorting:[]}});
type IndexedView=CalculatedView&{__auditOrder?:{positions:Map<object,number>;definition:TableDefinition;diagnostics:CalculatedView['diagnostics'];runtimeParams?:unknown}};
export function seedIndexedStore(base:CalculatedView,revision:Revision){
 assert.equal(base.definition.table.sorting?.length??0,0);assert.equal(base.selection.kind,'none');
 const owned=structuredClone(base) as IndexedView,positions=new Map<object,number>();
 if(!owned.groups.length)owned.logicalRows.forEach((row,i)=>positions.set(row,i));
 const visit=(nodes:LogicalGroup[])=>nodes.forEach((node,i)=>{positions.set(node,i);if(node.children.length)visit(node.children);else node.rows.slice(1).forEach((row,j)=>positions.set(row,j));});visit(owned.groups);
 owned.__auditOrder={positions,definition:structuredClone(key(owned.definition)),diagnostics:structuredClone(owned.diagnostics)};
 return buildAuditOwnedStore(owned,structuredClone(revision));
}
export function indexedReorder(privateView:IndexedView,definition:TableDefinition,selection:SelectionSpec,runtimeParams:unknown={}){
 assert(privateView.__auditOrder,'canonical index required');
 assert.deepEqual(privateView.__auditOrder.definition,key(definition),'changed calculation definition');
 assert.deepEqual(privateView.__auditOrder.runtimeParams??{},runtimeParams??{},'changed runtime parameters');
 const view=structuredClone(privateView) as IndexedView,meta=view.__auditOrder!;
 const position=(v:object)=>{const n=meta.positions.get(v);assert(n!==undefined,'lost canonical object reference');return n;};
 const reset=(nodes:LogicalGroup[])=>{
  nodes.sort((a,b)=>position(a)-position(b));
  for(const node of nodes)if(node.children.length)reset(node.children);else{
   const leaves=node.rows.slice(1).sort((a,b)=>position(a)-position(b));node.rows=[node.rows[0],...leaves];
  }
 };
 if(view.groups.length)reset(view.groups);else view.logicalRows.sort((a,b)=>position(a)-position(b));
 view.definition=structuredClone(meta.definition);view.selection={kind:'none'};view.presentedRows=[];view.diagnostics=structuredClone(meta.diagnostics);
 const result=reorderOwned(view,definition,selection) as IndexedView;
 result.__auditOrder!.definition=key(result.definition);return result;
}
export function indexedStats(view:IndexedView){
 const meta=view.__auditOrder;assert(meta);
 const whole=reserveGraph(view),{__auditOrder:_index,...without}=view;
 return {orderEntries:meta.positions.size,wholeReservation:whole,additionalReservation:whole-reserveGraph(without),retainedCalculationViews:1};
}

export function attachGeneratedOrder(view:IndexedView,definition:TableDefinition,runtimeParams:unknown={}){
 const positions=(view.analytical as any)?.__auditPositions as Map<object,number>|undefined;
 if(!positions)return;
 delete (view.analytical as any).__auditPositions;
 view.__auditOrder={positions,definition:key(definition),diagnostics:view.diagnostics.slice(),runtimeParams:structuredClone(runtimeParams??{})};
}
export function canIndexedResort(view:IndexedView,definition:TableDefinition,runtimeParams:unknown={}){
 if(!view.__auditOrder)return false;
 try{assert.deepEqual(view.__auditOrder.definition,key(definition));assert.deepEqual(view.__auditOrder.runtimeParams??{},runtimeParams??{});return true;}catch{return false;}
}
export function indexEntries(view:IndexedView){return view.__auditOrder?.positions.size??0;}
