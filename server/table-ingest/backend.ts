// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { DatasetColumn, DatasetCompleteness, DatasetProvenance, WidgetDataset } from '../../src/lib/widgetData/types';
import { datasetFromRows } from '../../src/lib/localTableData';
import { tableRows } from '../../src/lib/tableRowValues';
import { correctStatementRows, FISCAL_AS_REPORTED, fiscalPeriodLabel, isStatementPeriodParam, statementReporters } from '../../src/lib/statementFiscal';
import { FISCAL_YEAR_END_PATH, fiscalYearEndOf } from '../../src/lib/periods';
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
  /**
   * `url` is the backend's base URL, as a client connection names it. Ingest reads `<url>/widgets.json`
   * to tell a statement widget (the client's isStatementPeriodParam) and relabels its rows from
   * `<url>/api/v1/fundamentals/fiscal_year_end`, both with the configured widget's own headers.
   */
  backends:Record<string,{label?:string;url?:string;widgets:Record<string,BackendWidget>}>;
};
const own = <T>(record:Record<string,T>,key:string):T|undefined=>Object.hasOwn(record,key)?record[key]:undefined;
const forbidden=/(url|uri|endpoint|header|authorization|credential|password|token|secret|api_key|apikey)/i;
function param(value:unknown):string {
  if(typeof value==='string' && value.length<=4096 && !Array.from(value).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127) && !/(?:https?:|file:|\/\/)/i.test(value)) return value;
  if(typeof value==='number' && Number.isFinite(value) || typeof value==='boolean') return String(value);
  if(value===null) return '';
  throw new Error();
}
function upstreamUrl(raw:string):URL {
  const url=new URL(raw);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)throw new Error();
  return url;
}
async function readJson(response:Response,maxBytes:number):Promise<unknown> {
  if(!response.ok||!response.body)throw new Error();
  const declared=response.headers.get('content-length');if(declared && Number(declared)>maxBytes)throw new Error();
  const chunks:Uint8Array[]=[];let size=0;
  const reader=response.body.getReader();
  try {while(true) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw new Error();chunks.push(value);}} finally {reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks,size).toString('utf8')) as unknown;
}
// The client's dataClient joinUrl.
const joinUrl=(base:string,endpoint:string)=>`${base.replace(/\/+$/,'')}/${endpoint.replace(/^\/+/,'')}`;
const endpointOf=(url:URL)=>url.origin+url.pathname;
// isStatementPeriodParam reads only option values. Not widgetsJson's toOptions: that module would bundle Tauri into the server child.
const optionValues=(options:unknown)=>(Array.isArray(options)?options:[]).flatMap(o=>o&&typeof o==='object'&&typeof o.value==='string'?[{label:'',value:o.value as string}]:[]);
/**
 * Whether the backend's widgets.json says the widget at `widget.url` is a statement widget, or undefined
 * when that cannot be told (no base URL, widgets.json fails, or no entry resolves to the widget's endpoint).
 */
async function isStatementWidget(base:string|undefined,widget:BackendWidget,maxBytes:number,signal:AbortSignal):Promise<boolean|undefined> {
  if(!base)return undefined;
  try {
    const target=endpointOf(upstreamUrl(widget.url));
    const response=await fetch(upstreamUrl(joinUrl(base,'widgets.json')),{method:'GET',headers:widget.headers,redirect:'manual',signal});
    const root=await readJson(response,maxBytes);
    if(!root||typeof root!=='object'||Array.isArray(root))return undefined;
    for(const entry of Object.values(root as Record<string,unknown>)) {
      if(!entry||typeof entry!=='object')continue;
      const {endpoint,params}=entry as {endpoint?:unknown;params?:unknown};
      if(typeof endpoint!=='string'||endpointOf(new URL(joinUrl(base,endpoint)))!==target)continue;
      return (Array.isArray(params)?params:[]).some(p=>p&&typeof p==='object'&&typeof p.paramName==='string'&&isStatementPeriodParam({paramName:p.paramName,options:optionValues(p.options)}));
    }
    return undefined;
  } catch { return undefined; }
}
/** A symbol's fiscal-year-end month, or null for any failure (404 included), as the client's lookup. */
async function yearEnd(base:string,widget:BackendWidget,symbol:string,maxBytes:number,signal:AbortSignal):Promise<number|null> {
  try {
    const url=upstreamUrl(joinUrl(base,FISCAL_YEAR_END_PATH));url.searchParams.set('symbol',symbol);
    const response=await fetch(url,{method:'GET',headers:widget.headers,redirect:'manual',signal});
    return fiscalYearEndOf(await readJson(response,maxBytes))??null;
  } catch { return null; }
}
/** GET adapter with fixed endpoints and private credentials; client values only become query parameters. */
export async function acquireBackend(binding:BackendBinding,context:ServerBackendConfig):Promise<WidgetDataset> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  const controller=new AbortController();
  try {
    for(const n of [context.maxBytes,context.maxRows,context.maxColumns,context.timeoutMs]) if(!Number.isSafeInteger(n)||n<=0) throw new Error();
    const backend=own(context.backends,binding.backendId);
    const widget=backend&&own(backend.widgets,binding.widgetId);if(!widget)throw new Error();
    const url=upstreamUrl(widget.url);
    for(const [key,value] of Object.entries(binding.params)) {
      if(forbidden.test(key)||!widget.parameters.includes(key))throw new Error();
      url.searchParams.delete(key);
      const values=Array.isArray(value)?value:[value];if(values.length>64)throw new Error();
      for(const entry of values)url.searchParams.append(key,param(entry));
    }
    timer=setTimeout(()=>controller.abort(),context.timeoutMs);
    const response=await fetch(url,{method:'GET',headers:widget.headers,redirect:'manual',signal:controller.signal});
    const data=await readJson(response,context.maxBytes);
    if(widget.response.kind==='dataset')return admitDataset(data as WidgetDataset,context.maxRows,context.maxColumns);
    let rowData=data;
    const path=widget.response.rowsPath??[];if(path.length>16)throw new Error();
    for(const key of path) {
      if(typeof key!=='string'||!key.length||!rowData||typeof rowData!=='object'||Array.isArray(rowData)||!Object.hasOwn(rowData,key))throw new Error();
      rowData=(rowData as Record<string,unknown>)[key];
    }
    let rows=tableRows(rowData);if(!rows||rows.length>context.maxRows)throw new Error();
    const period=url.searchParams.get('period')??undefined;let asReported=false;
    if(typeof period==='string' && fiscalPeriodLabel(period)!==undefined) {
      const statement=await isStatementWidget(backend.url,widget,context.maxBytes,controller.signal);
      // Untellable: the rows stay as reported, with the note when they look like statement rows.
      if(statement===undefined) asReported=statementReporters(rows)!==null||rows.some(r=>Object.hasOwn(r,'period_ending'));
      else if(statement) {
        // The client's statementSymbolsOf: the card's `symbol`, split on commas; a flat array is its entries.
        const symbol=binding.params.symbol;
        const symbols=[...new Set((Array.isArray(symbol)?symbol:[symbol]).flatMap(s=>typeof s==='string'?s.split(','):[]).map(s=>s.trim().toUpperCase()).filter(Boolean))];
        // Only symbols correctStatementRows reads (a row's own, else the single card symbol), capped:
        // a symbol past the cap has no year end, so its rows stay as reported with the note.
        const wanted=[...new Set([...rows.flatMap(r=>typeof r.symbol==='string'?[r.symbol.toUpperCase()]:[]),...(symbols.length===1?symbols:[])])].slice(0,64);
        const months=await Promise.all(wanted.map(s=>yearEnd(backend.url as string,widget,s,context.maxBytes,controller.signal)));
        ({rows,asReported}=correctStatementRows(rows,period,Object.fromEntries(wanted.map((s,i)=>[s,months[i]])),symbols));
      }
    }
    const declaredColumns=structuredClone(widget.response.columns);
    if(declaredColumns.length>context.maxColumns)throw new Error();
    for(const row of rows)for(const column of declaredColumns)if(!Object.hasOwn(row,column.id))
      Object.defineProperty(row,column.id,{value:null,enumerable:true,writable:true,configurable:true});
    const result=datasetFromRows(rows,context.targetWidgetId??binding.widgetId,context.inputRevision??1,'backend',undefined,declaredColumns);
    if(!rows.length)result.columns=declaredColumns;
    result.provenance=structuredClone(widget.response.provenance);
    result.completeness={...structuredClone(widget.response.completeness??{kind:'unknown',warnings:[]}),acquiredRowCount:rows.length};
    // The card's "Fiscal labels as reported" note: input diagnostics reach the result view.
    if(asReported)result.diagnostics=[{...FISCAL_AS_REPORTED}];
    return admitDataset(result,context.maxRows,context.maxColumns);
  } catch { throw new Error('Could not acquire configured table source'); }
  finally {if(timer!==undefined)clearTimeout(timer);controller.abort();}
}
/** Safe discovery data; same IDs and parameter names must be admitted by CatalogConfig. */
export function backendDescriptors(context:ServerBackendConfig) {
  return Object.entries(context.backends).map(([backendId,backend])=>({backendId,label:backend.label??backendId,widgets:Object.entries(backend.widgets).map(([widgetId,widget])=>({widgetId,label:widget.label??widgetId,parameters:widget.parameters.slice()}))}));
}
