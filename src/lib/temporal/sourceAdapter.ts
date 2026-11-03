// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type {SourceAdapter} from '../widgetData/source';
import type {DatasetColumn,CloneSafeValue,TemporalReceiptReference} from '../widgetData/types';
import {parseQueryBinding,type QueryBinding} from './bindings';
import type {TemporalClient} from './client';
import {parseResultPage} from './contracts';
import {mayNeedResolution,resolveParams} from './params';
const check=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException('Temporal acquisition cancelled','AbortError');};
function delay(signal:AbortSignal){return new Promise<void>((resolve,reject)=>{
 const abort=()=>{clearTimeout(timer);reject(new DOMException('Temporal acquisition cancelled','AbortError'));};
 const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},250);
 if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
});}
/** Acquisition only. The table execution store owns activation and linked transformations.
 * One 1000-row page is intentionally bounded; it never claims a whole result. */
export function createTemporalSourceAdapter(client:TemporalClient,binding:QueryBinding):SourceAdapter {
 const intent=parseQueryBinding(binding);
 return {async acquire(signal){
  check(signal);let executionId:string;let revision:number|undefined;
  if(intent.kind==='execution')executionId=intent.executionId;
  else {
   // A literal-only fixed binding needs no lookup. Latest, or a relative
   // date/timestamp, reads the definition: types decide what is an expression
   // (a string param "T" is AT&T, not today).
   const needsDefinition=intent.revisionPolicy==='latest'||mayNeedResolution(intent.params);
   const definition=needsDefinition?await client.get(intent.queryId,intent.revisionPolicy==='latest'?undefined:intent.revision,signal):undefined;
   revision=intent.revisionPolicy==='latest'?definition!.revision:intent.revision!;
   check(signal);
   const params=definition?resolveParams(definition.parameters,intent.params,new Date()).params:intent.params;
   const handle=await client.start({query_id:intent.queryId,revision,params,context:intent.context},signal);
   check(signal);executionId=handle.execution_id;
  }
  for(let attempts=0;;attempts++){
   check(signal);const status=await client.status(executionId,signal);check(signal);
   if(status.execution_id!==executionId)throw new Error('Execution identity mismatch');
   if(status.state==='succeeded')break;
   if(status.state==='failed'||status.state==='cancelled')throw new Error(`TemporalDB execution ${status.state}`);
   if(attempts>=239)throw new Error('TemporalDB execution is still pending; refresh to retry');
   await delay(signal);
  }
  const page=parseResultPage(await client.page(executionId,undefined,signal));check(signal);
  const r=page.receipt;
  if(r.execution_id!==executionId)throw new Error('Execution receipt identity mismatch');
  if(intent.kind==='query'&&(r.query_id!==intent.queryId||r.query_revision!==revision))throw new Error('Query receipt revision mismatch');
  const columns:DatasetColumn[]=page.schema.map(c=>({id:c.name,label:c.name,dtype:/^(int|uint|float|double|decimal)/.test(c.type)&&page.rows.every(row=>row[c.name]===null||typeof row[c.name]==='number')?'number':c.type==='bool'?'boolean':/^date|^timestamp/.test(c.type)?'dateString':'text',metadata:{arrowType:c.type,nullable:c.nullable}}));
  const kind=page.next_cursor?'paged':page.truncated||!page.complete||r.completeness!=='complete'?'partial':page.total_count>page.rows.length?'paged':'complete';
  const warnings=kind==='complete'?[]:[`TemporalDB ${kind} result: ${page.rows.length} loaded rows of ${page.total_count} (${page.count_quality}); table, pivot, chart and export use loaded rows only.`];
  const temporal={executionId:r.execution_id,queryId:r.query_id,queryRevision:r.query_revision,resultHash:r.result_hash,knowledgeBasis:r.context.knowledge_basis??null,context:r.context,inputManifest:r.input_manifest,environmentDigest:r.environment_digest,transformVersions:r.transform_versions,frozenAt:r.frozen_at,codec:r.codec,completeness:r.completeness,orderContract:r.order_contract};
  return {kind:'dataset',dataset:{rows:page.rows.map((values,i)=>({id:`${executionId}:${i}`,values:structuredClone(values)})),columns,resultRevision:0,outputRevision:0,
   provenance:{sourceWidgetId:executionId,sourceKind:'temporaldb',metadata:{temporalLocalRuntime:{engine:'bdobb-table',version:1},temporalPage:{countQuality:page.count_quality,totalCount:page.total_count,loadedRows:page.rows.length,hasNextPage:page.next_cursor!==null,serverComplete:page.complete,truncated:page.truncated}},receipt:{temporal:structuredClone(temporal) as TemporalReceiptReference},parameters:structuredClone(r.parameters) as {[key:string]:CloneSafeValue}},
   completeness:{kind,acquiredRowCount:page.rows.length,totalRowCount:page.total_count,...(page.count_quality==='exact'?{totalRowCountKind:'exact' as const}:{}),warnings},freshness:{availability:'available',stale:false,lastSuccessAt:Date.now()}}};
 }};
}
