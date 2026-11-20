// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// EXPERIMENT ONLY: full canonical-view clone is not budgeted as a production cache.
import assert from 'node:assert/strict';
import {compareSorted, LABEL_FIELD} from '../../src/lib/pivotTable';
import {validateTableModel} from '../../src/lib/tableExecution/validation';
import {reconcileView} from 'audit-reconcile';
import type {CalculatedView,TableDefinition,SelectionSpec,LogicalGroup} from '../../src/lib/tableExecution/types';
import type {DatasetRow} from '../../src/lib/widgetData/types';
const withoutSort=(d:TableDefinition)=>({...d,table:{...d.table,sorting:[]}});
function checkCanonical(base:CalculatedView,definition:TableDefinition,selection:SelectionSpec):void {
 assert.equal(base.definition.analytical?.schemaVersion,1);
 assert(base.analytical && !base.analytical.compiled.execution,'statements excluded');
 assert.equal(base.definition.table.sorting?.length??0,0,'canonical order required');
 assert.equal(base.selection.kind,'none','canonical publication must not reconcile selection');
 assert.deepEqual(withoutSort(base.definition),withoutSort(definition),'sort-only dependency boundary');
 validateTableModel(definition,selection);
}
export function reorderCanonical(base:CalculatedView,definition:TableDefinition,selection:SelectionSpec):CalculatedView {
 checkCanonical(base,definition,selection);return reorderView(structuredClone(base),definition,selection);
}
export function reorderOwned(view:CalculatedView,definition:TableDefinition,selection:SelectionSpec):CalculatedView {
 checkCanonical(view,definition,selection);return reorderView(view,definition,selection);
}
function reorderView(view:CalculatedView,definition:TableDefinition,selection:SelectionSpec):CalculatedView {
 const calculated=view.analytical!;
 view.definition=structuredClone(definition);
 const model=calculated.compiled.model,structural=new Set([...model.layout.rows,...model.layout.columns]);
 const source=new Map(calculated.pool.rows.map(row=>[row.id,row]));
 const bindings=new Map(model.measures.map(m=>[m.id,m.sourceFieldId]));
 const sort=<T>(items:T[],value:(v:T,id:string)=>unknown)=>items.sort((a,b)=>{
  for(const s of definition.table.sorting??[]){const result=compareSorted(value(a,s.id),value(b,s.id),s.desc);if(result)return result;}
  return 0;
 });
 const sourceValue=(row:DatasetRow,id:string,bind:boolean)=>{
  const field=bind&&!structural.has(id)?bindings.get(id)??id:id;
  return source.get(row.id)?.values[field];
 };
 if(!view.groups.length){
  sort(view.logicalRows,(row,id)=>sourceValue(row,id,false));
  view.selectionEligibleRows=[...view.logicalRows];
 }else{
  const rows:DatasetRow[]=[],eligible:DatasetRow[]=[];
  const surviving=calculated.pool.rows.filter(row=>calculated.recordIds.has(row.id));
  const keyFor=(node:LogicalGroup)=>{
   const path=node.rows[0].groupPath!;
   const row=surviving.find(row=>path.every(member=>{
    const m=calculated.pool.members.get(row.id)?.get(member.categoryId!);
    return m?.ok&&m.value.key===member.memberKey;
   }));
   const categoryId=path.at(-1)!.categoryId!;
   const member=row&&calculated.pool.members.get(row.id)?.get(categoryId);
   return {categoryId,value:member?.ok?member.value.value:undefined};
  };
  const visit=(nodes:LogicalGroup[])=>{
   const keys=new Map(nodes.map(node=>[node.id,keyFor(node)]));
   sort(nodes,(node,id)=>{
    const key=keys.get(node.id)!;
    if(id===LABEL_FIELD)return key.value;
    if(structural.has(id))return id===key.categoryId?key.value:undefined;
    return node.rows[0].values[id];
   });
   for(const node of nodes){rows.push(node.rows[0]);if(node.children.length)visit(node.children);else{
    const leaves=node.rows.slice(1);sort(leaves,(row,id)=>sourceValue(row,id,true));
    node.rows=[node.rows[0],...leaves];rows.push(...leaves);eligible.push(node.rows[0]);
   }}
  };
  visit(view.groups);view.logicalRows=rows;view.selectionEligibleRows=eligible;
 }
 calculated.groups=view.groups;calculated.rows=view.logicalRows;calculated.eligibleRows=view.selectionEligibleRows;
 return reconcileView(view,selection,true,undefined,[]);
}
