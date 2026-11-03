// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type {SourceAdapter} from '../widgetData/source';
import type {DatasetColumn,CloneSafeValue,TemporalReceiptReference} from '../widgetData/types';
import {parseQueryBinding,type QueryBinding} from './bindings';
import type {TemporalClient} from './client';
import {parseResultPage} from './contracts';
import {createTemporalPager,type TemporalPage} from './paging';
const check=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException('Temporal acquisition cancelled','AbortError');};
/** Acquisition only. The table execution store owns activation and linked transformations.
 * One 1000-row page is intentionally bounded; it never claims a whole result. */
export function createTemporalSourceAdapter(client:TemporalClient,binding:QueryBinding,retained?:TemporalPage):SourceAdapter {
 const intent=parseQueryBinding(binding);
 return {async acquire(signal){
  check(signal);
  const selected=retained??await (async()=>{const pager=createTemporalPager(client,intent);try{return await pager.open(signal);}finally{pager.dispose();}})();
  check(signal);const {executionId,offset}=selected;const page=parseResultPage(selected.page),r=page.receipt;
  if(r.execution_id!==executionId||intent.kind==='execution'&&r.execution_id!==intent.executionId)throw new Error('Execution receipt identity mismatch');
  if(intent.kind==='query'&&(r.query_id!==intent.queryId||intent.revisionPolicy==='fixed'&&r.query_revision!==intent.revision))throw new Error('Query receipt revision mismatch');
  const columns:DatasetColumn[]=page.schema.map(c=>({id:c.name,label:c.name,dtype:/^(int|uint|float|double|decimal)/.test(c.type)&&page.rows.every(row=>row[c.name]===null||typeof row[c.name]==='number')?'number':c.type==='bool'?'boolean':/^date|^timestamp/.test(c.type)?'dateString':'text',metadata:{arrowType:c.type,nullable:c.nullable}}));
  const kind=offset>0||page.next_cursor?'paged':page.truncated||!page.complete||r.completeness!=='complete'?'partial':page.total_count>page.rows.length?'paged':'complete';
  const warnings=kind==='complete'?[]:[`TemporalDB ${kind} result: ${page.rows.length} loaded rows of ${page.total_count} (${page.count_quality}); table, pivot, chart and export use loaded rows only.`];
  const temporal={executionId:r.execution_id,queryId:r.query_id,queryRevision:r.query_revision,resultHash:r.result_hash,knowledgeBasis:r.context.knowledge_basis??null,context:r.context,inputManifest:r.input_manifest,environmentDigest:r.environment_digest,transformVersions:r.transform_versions,frozenAt:r.frozen_at,codec:r.codec,completeness:r.completeness,orderContract:r.order_contract};
  return {kind:'dataset',dataset:{rows:page.rows.map((values,i)=>({id:`${executionId}:${offset+i}`,values:structuredClone(values)})),columns,resultRevision:0,outputRevision:0,
   provenance:{sourceWidgetId:executionId,sourceKind:'temporaldb',metadata:{temporalLocalRuntime:{engine:'bdobb-table',version:1},temporalPage:{countQuality:page.count_quality,totalCount:page.total_count,loadedRows:page.rows.length,hasNextPage:page.next_cursor!==null,serverComplete:page.complete,truncated:page.truncated,...(retained?{pageOffset:offset,pageNumber:selected.pageNumber}:{})}},receipt:{temporal:structuredClone(temporal) as TemporalReceiptReference},parameters:structuredClone(r.parameters) as {[key:string]:CloneSafeValue}},
   completeness:{kind,acquiredRowCount:page.rows.length,totalRowCount:page.total_count,...(page.count_quality==='exact'?{totalRowCountKind:'exact' as const}:{}),warnings},freshness:{availability:'available',stale:false,lastSuccessAt:Date.now()}}};
 }};
}
