// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { DatasetColumn, DatasetCompleteness, DatasetProvenance, WidgetDataset } from '../../src/lib/widgetData/types';
import { datasetFromRows } from '../../src/lib/localTableData';
import { tableRows } from '../../src/lib/tableRowValues';
import { admitDataset } from './index';

export type BackendBinding={backendId:string;widgetId:string;params:Record<string,unknown>};
export type BackendWidget={
  label?:string;
  /** Trusted operator configuration only; redirects are always refused. */
  url:string;headers?:Record<string,string>;parameters:string[];
  response:{kind:'dataset'}|{kind:'rows';rowsPath?:string[];columns:DatasetColumn[];provenance:DatasetProvenance;completeness?:DatasetCompleteness};
};
export type ServerBackendConfig={
  maxBytes:number;maxRows:number;maxColumns:number;timeoutMs:number;
  targetWidgetId?:string;inputRevision?:number;
  backends:Record<string,{label?:string;widgets:Record<string,BackendWidget>}>;
};
const own = <T>(record:Record<string,T>,key:string):T|undefined=>Object.hasOwn(record,key)?record[key]:undefined;
const forbidden=/(url|uri|endpoint|header|authorization|credential|password|token|secret|api_key|apikey)/i;
function param(value:unknown):string {
  if(typeof value==='string' && value.length<=4096 && !Array.from(value).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127) && !/(?:https?:|file:|\/\/)/i.test(value)) return value;
  if(typeof value==='number' && Number.isFinite(value) || typeof value==='boolean') return String(value);
  if(value===null) return '';
  throw new Error();
}
/** GET adapter with fixed endpoints and private credentials; client values only become query parameters. */
export async function acquireBackend(binding:BackendBinding,context:ServerBackendConfig):Promise<WidgetDataset> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  const controller=new AbortController();
  try {
    for(const n of [context.maxBytes,context.maxRows,context.maxColumns,context.timeoutMs]) if(!Number.isSafeInteger(n)||n<=0) throw new Error();
    const backend=own(context.backends,binding.backendId);
    const widget=backend&&own(backend.widgets,binding.widgetId);if(!widget)throw new Error();
    const url=new URL(widget.url);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)throw new Error();
    for(const [key,value] of Object.entries(binding.params)) {
      if(forbidden.test(key)||!widget.parameters.includes(key))throw new Error();
      url.searchParams.delete(key);
      const values=Array.isArray(value)?value:[value];if(values.length>64)throw new Error();
      for(const entry of values)url.searchParams.append(key,param(entry));
    }
    timer=setTimeout(()=>controller.abort(),context.timeoutMs);
    const response=await fetch(url,{method:'GET',headers:widget.headers,redirect:'manual',signal:controller.signal});
    if(!response.ok||!response.body)throw new Error();
    const declared=response.headers.get('content-length');if(declared && Number(declared)>context.maxBytes)throw new Error();
    const chunks:Uint8Array[]=[];let size=0;
    const reader=response.body.getReader();
    try {while(true) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>context.maxBytes)throw new Error();chunks.push(value);}} finally {reader.releaseLock();}
    const data=JSON.parse(Buffer.concat(chunks,size).toString('utf8')) as unknown;
    if(widget.response.kind==='dataset')return admitDataset(data as WidgetDataset,context.maxRows,context.maxColumns);
    let rowData=data;
    const path=widget.response.rowsPath??[];if(path.length>16)throw new Error();
    for(const key of path) {
      if(typeof key!=='string'||!key.length||!rowData||typeof rowData!=='object'||Array.isArray(rowData)||!Object.hasOwn(rowData,key))throw new Error();
      rowData=(rowData as Record<string,unknown>)[key];
    }
    const rows=tableRows(rowData);if(!rows||rows.length>context.maxRows)throw new Error();
    const declaredColumns=structuredClone(widget.response.columns);
    if(declaredColumns.length>context.maxColumns)throw new Error();
    for(const row of rows)for(const column of declaredColumns)if(!Object.hasOwn(row,column.id))
      Object.defineProperty(row,column.id,{value:null,enumerable:true,writable:true,configurable:true});
    const result=datasetFromRows(rows,context.targetWidgetId??binding.widgetId,context.inputRevision??1,'backend',undefined,declaredColumns);
    if(!rows.length)result.columns=declaredColumns;
    result.provenance=structuredClone(widget.response.provenance);
    result.completeness={...structuredClone(widget.response.completeness??{kind:'unknown',warnings:[]}),acquiredRowCount:rows.length};
    return admitDataset(result,context.maxRows,context.maxColumns);
  } catch { throw new Error('Could not acquire configured table source'); }
  finally {if(timer!==undefined)clearTimeout(timer);controller.abort();}
}
/** Safe discovery data; same IDs and parameter names must be admitted by CatalogConfig. */
export function backendDescriptors(context:ServerBackendConfig) {
  return Object.entries(context.backends).map(([backendId,backend])=>({backendId,label:backend.label??backendId,widgets:Object.entries(backend.widgets).map(([widgetId,widget])=>({widgetId,label:widget.label??widgetId,parameters:widget.parameters.slice()}))}));
}
