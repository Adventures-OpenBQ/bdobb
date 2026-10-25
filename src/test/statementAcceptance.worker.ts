// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/** Supplemental shared-engine scope/resource probe, never used by the product worker. */
import { calculateView } from '../lib/tableExecution/engine';
import { calculateTotals } from '../lib/tableModel/totals';
import { fixture } from '../lib/statementModel/compileFixtures';
import { statementTemplate } from '../lib/statementModel/catalog';
import { statementOwnedIds, type StatementIntent } from '../lib/statementModel/types';
import { identifyRows } from '../lib/widgetData/identity';
import { unpivotDataset } from '../lib/tableModel/unpivot';
import type { WidgetDataset } from '../lib/widgetData/types';
function scopes(){
 const results=[];
 for(const kind of ['balance','cashflow'] as const)for(const missing of [undefined,0,1,2]){
  const f=fixture(),intent=f.statement as StatementIntent;intent.template=statementTemplate(kind,'1.0.0')!;const ids=statementOwnedIds(intent.template);
  const field=kind==='balance'?'total_assets':'operating_cash_flow';
  intent.bindings.shape='long';intent.bindings.mappings=[];intent.bindings.longFields={itemFieldId:'item',valueFieldId:'amount'};
  const anchor=kind==='balance'?'cash_and_cash_equivalents':'net_income';
  const rows=[2024,2025,2026].flatMap((year,index)=>{
   const values={symbol:'ACME',period:'FY',year,date:`${year}-12-31`,start:`${year}-01-01`,end:`${year}-12-31`};
   return [{id:`anchor-${index}`,values:{...values,item:ids.line(anchor),amount:1}},...(missing===index?[]:[{id:`value-${index}`,values:{...values,item:ids.line(field),amount:[100,20,60][index]}}])];
  });
  const data:WidgetDataset={...f.source,rows,columns:Object.keys(rows[0].values).map(id=>({id,label:id}))};
  const view=calculateView(data,{table:{},search:'',analytical:intent},{kind:'none'}),a=view.analytical!;
  const result=calculateTotals(new Set(a.pool.rows.map(r=>r.id)),a.pool,a.compiled,{categoryConstraints:new Map([[ids.item,JSON.stringify(['string',ids.line(field)])]])}).measures.cells.get(ids.value);
  results.push({kind,missing:missing??null,result});
 }
 return results;
}
function expansion(count:number){
 const f=fixture();const source:WidgetDataset={...f.source,rows:Array.from({length:count},(_,i)=>({id:`source-${i}`,values:{...f.source.rows[0].values,revenue:i,cost_of_revenue:i/2}}))};
 const spec={id:'acceptance-unpivot',carryFieldIds:['symbol','period','date','year','start','end'],mappings:[{sourceFieldId:'revenue',lineId:'revenue'},{sourceFieldId:'cost_of_revenue',lineId:'cost'}],itemFieldId:'item',valueFieldId:'value'};
 const start=performance.now();const expanded=unpivotDataset(source,spec);
 const duplicates={...source,rows:identifyRows([f.source.rows[0].values,f.source.rows[0].values])};
 const first=unpivotDataset(duplicates,spec),second=unpivotDataset({...duplicates,rows:[...duplicates.rows].reverse()}, {...spec,mappings:[...spec.mappings].reverse()});
 return {inputRows:source.rows.length,expandedRows:expanded.rows.length,elapsedMs:performance.now()-start,identities:first.rows.map(r=>r.id),reorderedIdentities:second.rows.map(r=>r.id),duplicateSourceIds:duplicates.rows.map(r=>r.id)};
}
self.onmessage=(event:MessageEvent<{kind:'scope'|'expansion';count?:number}>)=>{
 try{self.postMessage(event.data.kind==='scope'?scopes():expansion(event.data.count!));}catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
