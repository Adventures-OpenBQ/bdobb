// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {contractSchema,type ContractTypes} from './generated';
export type {QueryDefinition,TemporalContext,InputManifest,ParameterSpec,ColumnSpec} from './generated';
type Schema = { $ref?:string; const?:unknown; enum?:unknown[]; type?:string; anyOf?:Schema[]; allOf?:Schema[]; not?:Schema; if?:Schema; then?:Schema; properties?:Record<string,Schema>; required?:string[]; additionalProperties?:boolean|Schema; items?:Schema; contains?:Schema; minimum?:number; maximum?:number; minLength?:number; maxLength?:number; pattern?:string; format?:string };
export class TemporalValidationError extends Error {}
export const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v);
const domainDefinitions=contractSchema.$defs as Record<string,Schema>;
function valid(v:unknown,s:Schema,definitions=domainDefinitions):boolean {
 if(s.$ref)return valid(v,definitions[s.$ref.split('/').at(-1)!],definitions);
 if(s.const!==undefined&&v!==s.const)return false;
 if(s.enum&&!s.enum.includes(v))return false;
 if(s.anyOf&&!s.anyOf.some(x=>valid(v,x,definitions)))return false;
 if(s.allOf&&!s.allOf.every(x=>valid(v,x,definitions)))return false;
 if(s.not&&valid(v,s.not,definitions))return false;
 if(s.if&&valid(v,s.if,definitions)&&s.then&&!valid(v,s.then,definitions))return false;
 if(s.type==='null'&&v!==null)return false;
 if(s.type==='boolean'&&typeof v!=='boolean')return false;
 if(s.type==='integer'&&(!Number.isSafeInteger(v)))return false;
 if(s.type==='number'&&(typeof v!=='number'||!Number.isFinite(v)))return false;
 if(s.type==='string'&&typeof v!=='string')return false;
 if(typeof v==='number'&&((s.minimum!==undefined&&v<s.minimum)||(s.maximum!==undefined&&v>s.maximum)))return false;
 if(typeof v==='string'){
  if(s.minLength!==undefined&&v.length<s.minLength||s.maxLength!==undefined&&v.length>s.maxLength||s.pattern&&!new RegExp(s.pattern).test(v))return false;
  // arrow-json-v1 emits canonical decimal strings only beyond the safe JSON
  // integer range. Compare digits lexically; never coerce a snapshot identity.
  if(s.format==='large-snapshot-id'&&(v.length<16||v.length===16&&v<='9007199254740991'))return false;
  if(s.format==='uuid'&&!isUuid(v))return false;
  if(s.format==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v).toISOString().slice(0,10)!==v))return false;
  if(s.format==='date-time'&&(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v))))return false;
 }
 if(s.type==='array'&&!Array.isArray(v))return false;
 if(Array.isArray(v)){
  if(s.items&&!v.every(x=>valid(x,s.items!,definitions)))return false;
  if(s.contains&&!v.some(x=>valid(x,s.contains!,definitions)))return false;
 }
 if(s.type==='object'&&!isRecord(v))return false;
 if(isRecord(v)){
  if(s.required?.some(k=>!Object.hasOwn(v,k)))return false;
  for(const [k,x] of Object.entries(v)){
   if(s.properties&&Object.hasOwn(s.properties,k)){if(!valid(x,s.properties[k],definitions))return false;}
   else if(s.additionalProperties===false)return false;
   else if(typeof s.additionalProperties==='object'&&!valid(x,s.additionalProperties,definitions))return false;
  }
 }
 return true;
}
/** Validate generated B1 JSON Schema, including conditional temporal constraints. */
export function parseContract<K extends keyof ContractTypes>(name:K,value:unknown):ContractTypes[K]{
 let ok=false;try{ok=valid(value,(contractSchema.$defs as Record<string,Schema>)[name]);}catch{/* invalid dates */}
 if(!ok)throw new TemporalValidationError(`Invalid TemporalDB v1 ${name}`);
 return value as ContractTypes[K];
}
// Q2/Q3 dataclass HTTP extensions are source-authoritative (api/{executions,audit}.py;
// query/results.py, library.py). They are NOT present in B1's exported definitions.
export type ResultColumn={name:string;type:string;nullable:boolean};
export type ExecutionState='queued'|'running'|'succeeded'|'failed'|'cancelled';
export type ExecutionHandle={execution_id:string;state:ExecutionState};
/** B1 models describe Python integers. HTTP wire() recursively stringifies
 * unsafe integers; a receipt's manifest therefore has a distinct wire type. */
export type WireCatalogPin=Omit<ContractTypes['CatalogPin'],'snapshot_id'>&{snapshot_id:number|string};
export type WireInputManifest=Omit<ContractTypes['InputManifest'],'pins'|'source_manifests'>&{pins:WireCatalogPin[];source_manifests?:Record<string,WireInputManifest>|null};
// Adapt only CatalogPin.snapshot_id. Keep every generated B1 constraint and
// the raw domain schema unchanged, including strict revision/version integers.
const wireManifestDefinitions:Record<string,Schema>={
 ...domainDefinitions,
 CatalogPin:{...domainDefinitions.CatalogPin,properties:{...domainDefinitions.CatalogPin.properties,
  snapshot_id:{anyOf:[domainDefinitions.CatalogPin.properties!.snapshot_id,{type:'string',pattern:'^[1-9][0-9]*$',format:'large-snapshot-id'}]},
 }},
};
export function parseWireInputManifest(value:unknown):WireInputManifest {
 if(!valid(value,domainDefinitions.InputManifest,wireManifestDefinitions))throw new TemporalValidationError('Invalid TemporalDB wire InputManifest');
 return value as WireInputManifest;
}
export type ExecutionReceipt={execution_id:string;query_id:string;query_revision:number;parameters:Record<string,unknown>;context:ContractTypes['TemporalContext'];input_manifest:WireInputManifest;environment_digest:string;transform_versions:Record<string,unknown>;schema:ResultColumn[];completeness:string;result_hash:string;order_contract:string;frozen_at:string;codec:'arrow-json-v1';runtime_artifact:string|null};
export type ResultPage={rows:Record<string,unknown>[];schema:ResultColumn[];receipt:ExecutionReceipt;total_count:number;count_quality:'exact'|'lower_bound';complete:boolean;truncated:boolean;next_cursor:string|null;codec:'arrow-json-v1'};
export type ImportReport={import_id:string;entries:{index:number;status:'imported'|'unavailable';source_backend?:string|null;target_backend?:string|null;query_id?:string|null;reason?:string|null}[]};
export type QueryExport={version:1;entries:unknown[]};
export type AuditRun={run_id:string;execution_id:string;label:string;hold_ids:string[];record:Record<string,unknown>};
export function finiteJson(v:unknown,depth=0):boolean {return depth<=64&&(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||(Array.isArray(v)?v.every(x=>finiteJson(x,depth+1)):isRecord(v)&&Object.values(v).every(x=>finiteJson(x,depth+1))));}
function require(ok:unknown,message:string):asserts ok {if(!ok)throw new TemporalValidationError(`Invalid TemporalDB ${message}`);}
export function parseHandle(v:unknown):ExecutionHandle {
 require(isRecord(v)&&isUuid(v.execution_id)&&['queued','running','succeeded','failed','cancelled'].includes(String(v.state)),'execution handle');return v as ExecutionHandle;
}
function columns(v:unknown):asserts v is ResultColumn[]{require(Array.isArray(v)&&v.every(c=>isRecord(c)&&typeof c.name==='string'&&typeof c.type==='string'&&typeof c.nullable==='boolean')&&new Set(v.map(c=>c.name)).size===v.length,'result schema');}
/** Scalar tags are carried by the Arrow schema; exact values stay strings. */
function scalar(value:unknown,column:ResultColumn):boolean {
 if(value===null)return column.nullable||column.type==='null';
 const kind=column.type;
 if(/^(u?int)(8|16|32|64)$/.test(kind)){
  if(typeof value==='number')return Number.isSafeInteger(value);
  if(typeof value!=='string'||!/^[-]?\d+$/.test(value))return false;
  try{const n=BigInt(value),bits=BigInt(Number(kind.match(/\d+/)![0])),unsigned=kind.startsWith('u');return (n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))&&(unsigned?n>=0n&&n<(1n<<bits):n>=-(1n<<(bits-1n))&&n<(1n<<(bits-1n)));}catch{return false;}
 }
 if(/^decimal(?:128|256)\(/.test(kind))return typeof value==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value);
 if(/^date(?:32|64)\[/.test(kind)){try{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value).toISOString().slice(0,10)===value;}catch{return false;}}
 if(/^timestamp\[/.test(kind))return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value));
 if(['float','double','halffloat'].includes(kind))return typeof value==='number'&&Number.isFinite(value);
 if(kind==='bool')return typeof value==='boolean';
 if(kind==='string'||kind==='large_string')return typeof value==='string';
 if(/^(?:large_|fixed_size_)?list</.test(kind))return Array.isArray(value)&&finiteJson(value);
 if(kind.startsWith('struct<'))return isRecord(value)&&finiteJson(value);
 return false;
}
export function parseResultPage(v:unknown):ResultPage {
 require(isRecord(v)&&finiteJson(v),'finite result page');columns(v.schema);
 const r=v.receipt;require(isRecord(r)&&isUuid(r.execution_id)&&isUuid(r.query_id)&&Number.isSafeInteger(r.query_revision)&&Number(r.query_revision)>0&&isRecord(r.parameters)&&isRecord(r.transform_versions)&&typeof r.environment_digest==='string'&&typeof r.completeness==='string'&&typeof r.result_hash==='string'&&/^[a-f0-9]{64}$/.test(r.result_hash)&&typeof r.order_contract==='string'&&typeof r.frozen_at==='string'&&Number.isFinite(Date.parse(r.frozen_at))&&r.codec==='arrow-json-v1'&&(r.runtime_artifact===null||typeof r.runtime_artifact==='string'),'execution receipt');
 parseContract('TemporalContext',r.context);parseWireInputManifest(r.input_manifest);columns(r.schema);
 require(JSON.stringify(r.schema)===JSON.stringify(v.schema),'receipt schema mismatch');
 require(v.codec==='arrow-json-v1'&&Array.isArray(v.rows)&&v.rows.every(row=>isRecord(row)&&Object.keys(row).length===(v.schema as ResultColumn[]).length&&(v.schema as ResultColumn[]).every(c=>Object.hasOwn(row,c.name)&&scalar(row[c.name],c)))&&Number.isSafeInteger(v.total_count)&&Number(v.total_count)>=v.rows.length&&['exact','lower_bound'].includes(String(v.count_quality))&&typeof v.complete==='boolean'&&typeof v.truncated==='boolean'&&(v.next_cursor===null||typeof v.next_cursor==='string'),'result page');
 return v as ResultPage;
}
export function parseImportReport(v:unknown):ImportReport {
 require(isRecord(v)&&isUuid(v.import_id)&&Array.isArray(v.entries)&&v.entries.every(e=>isRecord(e)&&Number.isSafeInteger(e.index)&&Number(e.index)>=0&&['imported','unavailable'].includes(String(e.status))&&(e.query_id==null||isUuid(e.query_id))&&['source_backend','target_backend','reason'].every(k=>e[k]==null||typeof e[k]==='string')),'import report');return v as ImportReport;
}
export function parseExport(v:unknown):QueryExport {require(isRecord(v)&&v.version===1&&Array.isArray(v.entries)&&finiteJson(v),'export');return v as QueryExport;}
export function parseAudit(v:unknown):AuditRun {require(isRecord(v)&&isUuid(v.run_id)&&isUuid(v.execution_id)&&typeof v.label==='string'&&Array.isArray(v.hold_ids)&&v.hold_ids.every(isUuid)&&isRecord(v.record)&&finiteJson(v.record),'audit run');return v as AuditRun;}
