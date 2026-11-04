// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {isUuid,parseResultPage,type ResultPage} from '../../src/lib/temporal/contracts';
import {temporalDomainWarnings,temporalColumnFormat} from '../../src/lib/temporal/domainWarnings';
import type {DatasetColumn,TemporalReceiptReference,WidgetDataset,CloneSafeValue} from '../../src/lib/widgetData/types';
export type TemporalAcquisitionConfig={url:string;principal?:string;principalHeaders:Record<string,Record<string,string>>;maxBytes:number;maxRows:number;maxColumns:number;timeoutMs:number;targetWidgetId?:string;inputRevision?:number};
const canonical=(value:unknown)=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
async function readPage(response:Response,remaining:number):Promise<{value:unknown;bytes:number}>{
 if(!response.ok||!response.body||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw Error();
 const length=response.headers.get('content-length');if(length&&Number(length)>remaining)throw Error();
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>remaining)throw Error();chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return {value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),bytes:size};
}
/** Server-side retained source admission. No query execution or provider acquisition occurs here. */
export async function acquireTemporalExecution(binding:{executionId:string;resultHash:string},config:TemporalAcquisitionConfig):Promise<WidgetDataset>{
 let timer:ReturnType<typeof setTimeout>|undefined;const controller=new AbortController();
 try{
  for(const n of [config.maxBytes,config.maxRows,config.maxColumns,config.timeoutMs])if(!Number.isSafeInteger(n)||n<1)throw Error();
  if(!isUuid(binding.executionId)||!/^[a-f0-9]{64}$/.test(binding.resultHash)||!config.principal||!Object.hasOwn(config.principalHeaders,config.principal))throw Error();
  const headers=config.principalHeaders[config.principal];if(!headers||typeof headers!=='object'||Array.isArray(headers))throw Error();
  const base=new URL(config.url);if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw Error();
  const path=base.pathname.replace(/\/$/,'')+`/executions/${binding.executionId}/pages`;
  const seen=new Set<string>();let cursor:string|undefined,identity:string|undefined,first:ResultPage|undefined,bytes=0;
  const rows:WidgetDataset['rows']=[];timer=setTimeout(()=>controller.abort(),config.timeoutMs);
  for(let index=0;;index++){
   if(index>=1000||controller.signal.aborted)throw Error();
   const url=new URL(base);url.pathname=path;if(cursor!==undefined)url.searchParams.set('cursor',cursor);
   const response=await fetch(url,{method:'GET',headers,redirect:'manual',signal:controller.signal});
   const read=await readPage(response,config.maxBytes-bytes);bytes+=read.bytes;const page=parseResultPage(read.value),r=page.receipt;
   if(controller.signal.aborted||r.execution_id!==binding.executionId||r.result_hash!==binding.resultHash||page.count_quality!=='exact'||!page.complete||page.truncated||r.completeness!=='complete'||page.schema.length>config.maxColumns||page.rows.length>1000||page.total_count>config.maxRows||rows.length+page.rows.length>config.maxRows)throw Error();
   const proof=canonical({receipt:r,schema:page.schema,total:page.total_count});if(identity!==undefined&&proof!==identity)throw Error();identity=proof;first??=page;
   const offset=rows.length;for(const [i,values] of page.rows.entries())rows.push({id:`${binding.executionId}:${offset+i}`,values:structuredClone(values) as {[key:string]:CloneSafeValue}});
   if(page.next_cursor===null){if(rows.length!==page.total_count)throw Error();break;}
   if(!page.rows.length||!page.next_cursor.length||page.next_cursor.length>4096||seen.has(page.next_cursor)||rows.length>=page.total_count)throw Error();
   seen.add(page.next_cursor);cursor=page.next_cursor;
  }
  const r=first!.receipt;
  const columns:DatasetColumn[]=first!.schema.map(c=>({id:c.name,label:c.name,dtype:/^(int|uint|float|double|decimal)/.test(c.type)&&rows.every(row=>row.values[c.name]===null||typeof row.values[c.name]==='number')?'number':c.type==='bool'?'boolean':/^date|^timestamp/.test(c.type)?'dateString':'text',metadata:{arrowType:c.type,nullable:c.nullable},...(temporalColumnFormat(r.transform_versions)?{format:temporalColumnFormat(r.transform_versions)}:{})}));
  const temporal={parameters:structuredClone(r.parameters),executionId:r.execution_id,queryId:r.query_id,queryRevision:r.query_revision,resultHash:r.result_hash,knowledgeBasis:r.context.knowledge_basis??null,context:r.context,inputManifest:r.input_manifest,environmentDigest:r.environment_digest,transformVersions:r.transform_versions,frozenAt:r.frozen_at,codec:r.codec,completeness:r.completeness,orderContract:r.order_contract,...(r.acquisition?{acquisition:structuredClone(r.acquisition)}:{})};
  return {rows,columns,resultRevision:config.inputRevision??1,outputRevision:0,provenance:{sourceWidgetId:binding.executionId,sourceKind:'temporaldb',metadata:{temporalRemoteRuntime:{engine:'managed-table',version:1},temporalPage:{countQuality:'exact',totalCount:rows.length,loadedRows:rows.length,hasNextPage:false,serverComplete:true,truncated:false}},receipt:{temporal:structuredClone(temporal) as TemporalReceiptReference},parameters:structuredClone(r.parameters) as {[key:string]:CloneSafeValue}},completeness:{kind:'complete',acquiredRowCount:rows.length,totalRowCount:rows.length,totalRowCountKind:'exact',warnings:temporalDomainWarnings(r.transform_versions)},freshness:{availability:'available',stale:false,lastSuccessAt:Date.now()}};
 }catch{throw new Error('Could not acquire retained temporal source');}
 finally{if(timer!==undefined)clearTimeout(timer);controller.abort();}
}
