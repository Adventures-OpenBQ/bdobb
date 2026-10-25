// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {createRustExecutor} from '../../src/lib/tableExecution/rust/runtime';
import {input} from '../../src/lib/tableExecution/fixtures';
import type {TableDefinition} from '../../src/lib/tableExecution/types';
import type {WidgetDataset} from '../../src/lib/widgetData/types';

export async function finalReviewProbe() {
 const signal=new AbortController().signal;
 const revision={widgetId:'review',input:1,model:1,output:1};
 const executor=createRustExecutor('review');
 try {
  const source:WidgetDataset={...input,columns:[{id:'region',label:'Region'},{id:'tag',label:'Tag',dtype:'number',metadata:{tag:'string',nested:{tag:'not-wire'}}}],rows:['a','b'].map((id,i)=>({id,values:{region:'A',tag:1},cellFormats:{tag:{formatterFn:i?'percent':'int'}},cellErrors:{tag:{code:'upstream',message:id}}}))};
  await executor.registerInput(source,1,signal);
  const ready=await executor.applyModel({search:'',table:{pivot:{enabled:true,grouping:['region'],split:[],aggregationFns:{tag:'sum'}}}},{kind:'none'},revision,signal);
  const root=await executor.rows(revision,{groupPath:[],offset:0,limit:1},signal);
  const leaves=[];
  for(const offset of [1,0]){const block=await executor.rows(revision,{groupPath:[root.rows[0].id],offset,limit:1},signal);const row=block.rows[0];leaves.push([row.id,row.cellFormats?.tag.formatterFn,row.cellErrors?.tag.message]);}
  const structural=ready.inspection.aggregations.tag==='sum'&&ready.inspection.inputColumns[1].metadata?.tag==='string';
  executor.dispose();
  const coercions=[];
  for(const bad of [{toString:'bad'},[{toString:'bad'}]]) {
   const worker=createRustExecutor('review');
   try {
    await worker.registerInput({...input,columns:[{id:'region',label:'Region'},{id:'bad',label:'Bad'}],rows:[{id:'old',values:{region:'A',bad}}]},1,signal);
    const safe:TableDefinition={search:'',table:{},analytical:{schemaVersion:1,enabled:false,params:{promotePage:true,filters:[]},categories:[],measures:[],formulas:[],layout:{rows:[],columns:[],values:[]},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:true}}};
    await worker.applyModel(safe,{kind:'none'},revision,signal);
    let refused=false;
    try {await worker.applyModel({search:'',table:{pivot:{enabled:true,grouping:['region'],split:[],aggregationFns:{bad:'uniqueCount'}}}},{kind:'none'},{...revision,model:2,output:2},signal);}catch{refused=true;}
    const old=await worker.rows(revision,{groupPath:[],offset:0,limit:1},signal);
    const totals=await worker.totals(revision,signal);
    const exported=[];for await(const batch of worker.presented(revision,signal,true))exported.push(...batch.rows.map(r=>r.id));
    coercions.push({refused,id:old.rows[0].id,totalsRevision:totals.revision.model,exported});
   } finally {worker.dispose();}
  }
  return {structural,leaves,coercions};
 } finally {executor.dispose();}
}
