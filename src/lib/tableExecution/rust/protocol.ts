// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { ExecutionRequest, ExecutionResponse, TableDefinition, Revision } from '../types';
import { ExecutionProtocolError, validateExecutionRequest, validateExecutionResponse } from '../validation';
import { encodeWire, decodeWire, assertUnicodeScalarGraph, PIVOT_PROTOCOL_VERSION, type WireValue } from './wireCodec';
import type { DatasetColumn, DatasetRow, WidgetDataset, DatasetProvenance } from '../../widgetData/types';
const record = (values:Record<string,unknown>) => Object.fromEntries(Object.entries(values).map(([key,value])=>[key,encodeWire(value)]));
const members = (path:DatasetRow['groupPath']) => path?.map(member=>({...member,value:encodeWire(member.value)}));
const column = (value:DatasetColumn) => ({...value,...(value.metadata!==undefined?{metadata:record(value.metadata)}:{}),...(value.splitPath!==undefined?{splitPath:members(value.splitPath)}:{})});
const provenance = (value:DatasetProvenance) => {
 const out:Record<string,unknown>={...value};for(const key of ['metadata','parameters','receipt'] as const)if(value[key]!==undefined)out[key]=record(value[key]!);return out;
};
const dataset = (value:WidgetDataset) => {
 // Legacy identity uses the top-level values object as a key. The tagged tree
 // cannot preserve shared keys; distinct equal objects and nested aliases work.
 const seen=new WeakSet<object>();
 for(const row of value.rows){if(seen.has(row.values))throw new ExecutionProtocolError('INVALID_REQUEST','Unsupported input representation: shared top-level row.values object identity; clone values per row');seen.add(row.values);}
 return {...value,columns:value.columns.map(column),provenance:provenance(value.provenance),rows:value.rows.map(row=>({...row,values:record(row.values),...(row.groupPath!==undefined?{groupPath:members(row.groupPath)}:{})}))};
};
const definition = (value:TableDefinition,locale:string) => ({
 protocolVersion:PIVOT_PROTOCOL_VERSION,locale,
 definition:{...value,table:{...value.table,...(value.table.columnFilters!==undefined?{columnFilters:value.table.columnFilters.map(filter=>({...filter,value:encodeWire(filter.value)}))}:{})}},
 ...(value.analytical!==undefined?{analyticalRecipeSource:encodeWire(value.analytical)}:{})
});
/** Every operation passes the existing exact collection/budget guards before conversion. */
export function encodeRequest(raw:ExecutionRequest,locale:string,sessionId:number):string {
 assertUnicodeScalarGraph(raw);
 const request=validateExecutionRequest(raw);
 const command:Record<string,unknown>={...request};
 if(request.kind==='registerInput')command.input=dataset(request.input);
 // The worker consumes supported imports before this seam. Direct core calls
 // still receive its explicit acquisition refusal rather than a transport trap.
 if(request.kind==='importFile')command.bytes=Array.from(request.bytes);
 if('definition' in request)command.definition=definition(request.definition,locale);
 if(request.kind==='identityWitness')command.path=request.path.map(value=>definition(value,locale));
 if(request.kind==='applyModel'){
  command.runtimeParams=Object.entries(request.runtimeParams??{});
  command.reconcileMissing=request.reconcileMissing??true;command.provenAbsentIds=request.provenAbsentIds??[];
 }
 if(request.kind==='inspect'&&request.groupEvidence)command.groupEvidence=[request.groupEvidence.groupId,request.groupEvidence.transportValue];
 return stringifyRequest({protocolVersion:PIVOT_PROTOCOL_VERSION,sessionId,request:command})!;
}
/** Reorder inert echo objects for existing serialized UI identities; never substitute returned values. */
function authoredOrder(value:unknown,template:unknown):unknown {
 if(Array.isArray(value))return value.map((entry,index)=>authoredOrder(entry,Array.isArray(template)?template[index]:undefined));
 if(!value||typeof value!=='object'||!template||typeof template!=='object'||Array.isArray(template)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||![Object.prototype,null].includes(Object.getPrototypeOf(template)))return value;
 const source=value as Record<string,unknown>,recipe=template as Record<string,unknown>,ordered:Record<string,unknown>={};
 for(const key of [...Object.keys(recipe),...Object.keys(source)])if(Object.hasOwn(source,key)&&!Object.hasOwn(ordered,key))Object.defineProperty(ordered,key,{value:authoredOrder(source[key],recipe[key]),enumerable:true,writable:true,configurable:true});
 return ordered;
}
/** Only a requested response payload is decoded; internal calculated state never crosses this seam. */
export type PresentationShape = 'legacy'|'analytical'|'raw';
export function presentationShape(definition:TableDefinition):PresentationShape {
 if(definition.analytical){const model=definition.analytical as {schemaVersion:number;enabled?:boolean;layout?:{rows:string[];columns:string[]}};return model.schemaVersion===2||model.enabled&&!!(model.layout?.rows.length||model.layout?.columns.length)?'analytical':'raw';}
 const pivot=definition.table.pivot;return pivot?.enabled&&(pivot.grouping.length||pivot.split.length)?'legacy':'raw';
}
export function decodeResponse(json:string,request:ExecutionRequest,sessionId:number,shape:PresentationShape='raw'):ExecutionResponse|undefined {
 const wire=JSON.parse(json) as {protocolVersion:unknown;sessionId:unknown;response:Record<string,unknown>};
 if(wire.protocolVersion!==PIVOT_PROTOCOL_VERSION||wire.sessionId!==sessionId||!wire.response)throw new Error('Malformed Rust response envelope');
 // Wire values occur only at the contract's typed cell/metadata positions.
 // Structural maps may have arbitrary column names, including `tag`.
 type ObjectValue = Record<string, unknown>;
 const object=(value:unknown):ObjectValue=>value as ObjectValue;
 const list=(value:unknown):ObjectValue[]=>Array.isArray(value)?value:[];
 const decodeField=(item:ObjectValue,key:string)=>{if(Object.hasOwn(item,key))item[key]=decodeWire(item[key] as WireValue);};
 const decodeRecord=(value:unknown)=>{if(value&&typeof value==='object')for(const key of Object.keys(value))decodeField(object(value),key);};
 const decodeMembers=(value:unknown)=>{for(const member of list(value))decodeField(member,'value');};
 const decodeColumns=(value:unknown)=>{for(const column of list(value)){decodeRecord(column.metadata);decodeMembers(column.splitPath);}};
 const decodeRows=(value:unknown)=>{for(const row of list(value)){decodeRecord(row.values);decodeMembers(row.groupPath);}};
 const response=wire.response;
 decodeColumns(response.columns);decodeColumns(response.chartColumns);
 if(['rows','chartData','subset','previewDefinition'].includes(String(response.kind)))decodeRows(response.rows);
 if(response.kind==='totals'||response.kind==='facets'){decodeRecord(response.values);decodeMembers(response.members);}
 if(response.kind==='memberDomain')decodeMembers(response.rows);
 if(response.kind==='columnProfile')for(const field of list(response.fields)){decodeField(field,'min');decodeField(field,'max');if(Array.isArray(field.samples))field.samples=field.samples.map(value=>decodeWire(value as WireValue));}
 if(response.kind==='chartData'||response.kind==='subset'){
  const p=response.provenance;if(p)for(const key of ['metadata','parameters','receipt'])decodeRecord(object(p)[key]);
 }
 if(response.kind==='viewReady'){
  const inspection=object(response.inspection);decodeColumns(inspection.inputColumns);
  const def=object(inspection.definition),table=object(def.table);
  for(const filter of list(table.columnFilters))decodeField(filter,'value');
 }
 assertUnicodeScalarGraph(response);
 if(request.kind==='cancel'||request.kind==='dispose'){
  if(response.requestId!==request.requestId||(['widgetId','input','model','output'] as const).some(key=>(response.revision as Revision)?.[key]!==request.revision[key])||response.kind!==(request.kind==='cancel'?'cancelled':'disposed'))throw new Error('Malformed Rust control response');
  return undefined;
 }
 const count=(value:unknown):number=>{const c=value as {kind?:string;value?:number};if(c?.kind!=='exact'||!Number.isSafeInteger(c.value)||c.value!<0)throw new Error('Unsupported Rust result count');return c.value!;};
 if(response.kind==='viewReady'){response.topLevelCount=count(response.topLevelCount);if(!Object.hasOwn(response,'selectionNamespace'))response.selectionNamespace=undefined;const inspection=response.inspection as {definition:TableDefinition;paramMatches?:unknown};if(inspection.definition.analytical===undefined)delete inspection.paramMatches;}
 if(request.kind==='applyModel'||request.kind==='previewDefinition')shape=presentationShape(request.definition);
 if(response.kind==='inputSchema'){delete response.modelWarnings;delete response.modelWarningCount;}
 if(shape!=='raw'&&response.kind!=='inputSchema'){
  for(const field of ['columns','chartColumns'])if(Array.isArray(response[field]))for(const rawColumn of response[field] as Record<string,unknown>[]){
   if(shape==='legacy'&&Array.isArray(rawColumn.splitPath))for(const member of rawColumn.splitPath as Record<string,unknown>[])if(!Object.hasOwn(member,'bucket'))member.bucket=undefined;
   for(const key of shape==='legacy'?['sourceFieldId','aggregation','measureId','sourceBindingId','splitPath']:['sourceBindingId','measureId','aggregation'])if(!Object.hasOwn(rawColumn,key))rawColumn[key]=undefined;
  }
 }
 if(shape==='legacy'&&Array.isArray(response.rows))for(const row of response.rows as {groupPath?:Record<string,unknown>[]}[])for(const member of row.groupPath??[])if(!Object.hasOwn(member,'bucket'))member.bucket=undefined;
 if(response.kind==='rows'){
  response.siblingCount=count(response.siblingCount);
  response.groups=(response.groups as Record<string,unknown>[]).map(group=>({...group,childCount:count(group.childCount)}));
 }
 if(response.kind==='inspect'&&Array.isArray(response.groupEvidence))response.groupEvidence={groupId:response.groupEvidence[0],transportValue:response.groupEvidence[1]};
 if(response.kind==='error'){
  const diagnostic=response.error as {code:string;message:string};
  response.error={code:['INVALID_REQUEST','INVALID_RESPONSE','UNBOUND_ANALYTICAL','REVISION_MISMATCH','MISSING_FIELD','RESOURCE_LIMIT'].includes(diagnostic.code)?diagnostic.code:'INVALID_REQUEST',message:diagnostic.message};
  // Preserve original codes and all diagnostic evidence through the existing envelope.
  response.diagnostics=[...(response.diagnostics as unknown[]),diagnostic];
 }
 const validated=validateExecutionResponse(response,request.revision,request.requestId);
 if((request.kind==='applyModel'||request.kind==='previewDefinition')&&validated.kind==='viewReady')validated.inspection.definition=authoredOrder(validated.inspection.definition,request.definition) as TableDefinition;
 // Existing UI cache identities serialize coordinates; retain their canonical field order.
 const {widgetId,input,model,output,...extra}=validated.revision;
 return {...validated,revision:{widgetId,input,model,output,...extra}};
}

// JSON permits -0, but JSON.stringify rewrites it to 0. Retain floating literals;
// integer coordinates use their validated canonical zero representation.
const integerFields=new Set(['protocolVersion','sessionId','input','model','output','inputRevision','resultRevision','outputRevision','offset','limit','sequence','acquiredRowCount','totalRowCount','periodCount','affectedRecordCount','modelWarningCount','decimalPlaces']);
function stringifyRequest(value:unknown,key=''):string|undefined {
 if(value===undefined)return undefined;
 if(typeof value==='number'){
  if(!Number.isFinite(value))throw new Error('Nonfinite structural wire number');
  return Object.is(value,-0)&&!integerFields.has(key)?'-0':JSON.stringify(value);
 }
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return `[${value.map(item=>stringifyRequest(item)??'null').join(',')}]`;
 const fields:string[]=[];
 for(const [name,child] of Object.entries(value)){const encoded=stringifyRequest(child,name);if(encoded!==undefined)fields.push(`${JSON.stringify(name)}:${encoded}`);}
 return `{${fields.join(',')}}`;
}
