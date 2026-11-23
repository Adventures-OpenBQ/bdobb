// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {createRustExecutor} from '../../src/lib/tableExecution/rust/runtime';
import {encodeRequest} from '../../src/lib/tableExecution/rust/protocol';
import {ExecutionProtocolError} from '../../src/lib/tableExecution/validation';
import {input} from '../../src/lib/tableExecution/fixtures';
import type {ExecutionRequest,Revision,TableDefinition} from '../../src/lib/tableExecution/types';
import type {DatasetColumn,DatasetRow,WidgetDataset} from '../../src/lib/widgetData/types';

/** The exact native JSON fixture: own empty/prototype-named keys, three rows and eight fields. */
export async function rawFieldsProbe() {
 const rows=JSON.parse('[{"category":1,"hasOwnProperty":100,"__proto__":102,"":101,"day":"2026-11-20","hover":{"value":100,"description":"synthetic own cell"},"m1":100,"m2":200},{"category":2,"hasOwnProperty":20,"__proto__":22,"":21,"day":"2026-11-19","hover":{"value":20,"description":"synthetic own cell"},"m1":20,"m2":40},{"category":3,"hasOwnProperty":300,"__proto__":302,"":301,"day":"2026-11-21","hover":{"value":300,"description":"synthetic own cell"},"m1":300,"m2":600}]') as DatasetRow['values'][];
 const source:WidgetDataset={...input,columns:Object.keys(rows[0]).map(id=>({id,label:id})),rows:rows.map((values,i)=>({id:`raw-${i}`,values}))};
 const signal=new AbortController().signal;
 const revision:Revision={widgetId:'raw-fields',input:1,model:1,output:1};
 const executor=createRustExecutor(revision.widgetId),child=createRustExecutor('raw-child'),legacy=createRustExecutor('raw-legacy');
 try {
  await executor.registerInput(source,1,signal);
  const definition:TableDefinition={search:'',table:{sorting:[{id:'',desc:false}],columnFilters:[{id:'',value:{min:50}}],columnOrder:['','category'],hidden:['hover','day','m1','m2']}};
  const ready=await executor.applyModel(definition,{kind:'none'},revision,signal);
  const chart=await executor.chartData(revision,['','hasOwnProperty','__proto__'],signal);
  let columns:DatasetColumn[]|undefined;const delivered:DatasetRow[]=[];
  for await(const batch of executor.presented(revision,signal)){columns??=batch.columns;delivered.push(...batch.rows);}
  if(!columns)throw new Error('First real Wasm subset must carry schema');
  const childRevision={...revision,widgetId:'raw-child'};
  await child.registerInput({...source,columns,rows:delivered},1,signal);
  await child.applyModel({search:'',table:{columnFilters:[{id:'',value:{min:200}}]}},{kind:'none'},childRevision,signal);
  const linked=await child.chartData(childRevision,[''],signal);
  const legacyRevision={...revision,widgetId:'raw-legacy'};
  await legacy.registerInput(source,1,signal);
  await legacy.applyModel({search:'',table:{pivot:{enabled:true,grouping:['category'],split:[],aggregationFns:{'':'sum'}}}},{kind:'none'},legacyRevision,signal);
  const implicit=await legacy.chartData(legacyRevision,[''],signal),column=implicit.columns[0];
  const rejects=(request:ExecutionRequest)=>{
   try{encodeRequest(request,'en-US',1);return false;}
   catch(error){if(!(error instanceof ExecutionProtocolError)||error.descriptor.code!=='INVALID_REQUEST')throw error;return true;}
  };
  const register:ExecutionRequest={kind:'registerInput',requestId:'guard',revision,inputRevision:1,input:source};
  return {
   input:{rows:source.rows.length,columns:ready.inspection.inputColumns.length},
   order:ready.columns.map(c=>c.id),filtered:chart.rows.map(r=>r.values['']),
   ownKeys:chart.rows.map(r=>[Object.hasOwn(r.values,''),r.values.hasOwnProperty,r.values.__proto__]),
   subset:{columns:columns.map(c=>c.id),values:delivered.map(r=>r.values[''])},
   linked:linked.rows.map(r=>r.values['']),
   implicit:{id:column.id,sourceFieldId:column.sourceFieldId,sourceBindingId:column.sourceBindingId,measureIdAbsent:column.measureId===undefined,values:implicit.rows.map(r=>r.values[''])},
   strict:{request:rejects({...register,requestId:''}),widget:rejects({...register,revision:{...revision,widgetId:''}}),row:rejects({...register,input:{...source,rows:[{...source.rows[0],id:''}]}}),measure:rejects({kind:'applyModel',requestId:'guard',revision,selection:{kind:'none'},definition:{search:'',table:{pivot:{enabled:true,grouping:['category'],split:[],measures:[{id:'',sourceFieldId:''}]}}}})},
  };
 } finally {executor.dispose();child.dispose();legacy.dispose();}
}
Object.assign(window,{pivotRawFieldHarness:{rawFieldsProbe}});
