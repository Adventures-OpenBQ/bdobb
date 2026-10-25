// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/** Identical to the oracle corpus, including explicit nonfinite and negative-zero tags. */
export type WireValue =
 | {tag:'missing'|'null'}
 | {tag:'bool';value:boolean}
 | {tag:'string'|'bigint-string';value:string}
 | {tag:'f64';value:number|'NaN'|'Infinity'|'-Infinity'|'-0'}
 | {tag:'array';value:WireValue[]}
 | {tag:'record';value:[string,WireValue][]};
export const PIVOT_PROTOCOL_VERSION = 1;
export function assertProtocolVersion(version:unknown):void {
 if(version!==PIVOT_PROTOCOL_VERSION)throw new Error(`Unsupported Pivot protocol version: ${String(version)}`);
}
/**
 * Inspect data descriptors before conversion: no getter or toJSON is called.
 * `strict` (the wire codec) also refuses non-plain objects, custom array
 * fields and non-enumerable fields; the lenient walk only checks strings,
 * accessors and cycles, and skips Uint8Array bytes.
 */
function graphWalk(value:unknown,strict:boolean,ancestors=new Set<object>()):void {
 if(typeof value==='string'){assertUnicodeScalar(value);return;}
 if(strict){
  if(value===null||value===undefined||['boolean','number','bigint'].includes(typeof value))return;
  if(typeof value!=='object')throw new Error('Unsupported wire value');
 } else if(value===null||typeof value!=='object')return;
 const array=Array.isArray(value),proto=Object.getPrototypeOf(value);
 if(strict&&(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null))throw new Error('Unsupported wire object');
 if(ancestors.has(value))throw new Error('Cyclic wire graph');
 if(!strict&&value instanceof Uint8Array)return;
 ancestors.add(value);
 for(const key of Reflect.ownKeys(value)) {
  if(typeof key!=='string')throw new Error('Symbol wire fields are unsupported');
  assertUnicodeScalar(key);
  const descriptor=Object.getOwnPropertyDescriptor(value,key)!;
  if(!('value' in descriptor))throw new Error('Wire accessors are unsupported');
  if(strict){
   if(array&&key==='length')continue;
   if(array&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=(value as unknown[]).length))throw new Error('Custom array fields are unsupported');
   if(!descriptor.enumerable)throw new Error('Non-enumerable wire fields are unsupported');
  }
  graphWalk(descriptor.value,strict,ancestors);
 }
 ancestors.delete(value);
}
export function encodeWire(value:unknown):WireValue {
 graphWalk(value,true);
 const encode=(v:unknown):WireValue=>{
  if(v===undefined)return {tag:'missing'};
  if(v===null)return {tag:'null'};
  if(typeof v==='boolean')return {tag:'bool',value:v};
  if(typeof v==='string')return {tag:'string',value:v};
  if(typeof v==='bigint')return {tag:'bigint-string',value:String(v)};
  if(typeof v==='number')return {tag:'f64',value:Number.isNaN(v)?'NaN':v===Infinity?'Infinity':v===-Infinity?'-Infinity':Object.is(v,-0)?'-0':v};
  if(Array.isArray(v))return {tag:'array',value:Array.from({length:v.length},(_,i)=>encode(Object.getOwnPropertyDescriptor(v,String(i))?.value))};
  return {tag:'record',value:Object.keys(v as object).map(key=>[key,encode(Object.getOwnPropertyDescriptor(v,key)!.value)])};
 };
 return encode(value);
}
export function decodeWire(value:WireValue):unknown {
 graphWalk(value,true);
 const fail=():never=>{throw new Error('Malformed wire value');};
 const decode=(v:unknown):unknown=>{
  if(v===null||typeof v!=='object'||Array.isArray(v))return fail();
  const item=v as Record<string,unknown>;
  const keys=Object.keys(item);
  if(!Object.hasOwn(item,'tag')||keys.some(key=>key!=='tag'&&key!=='value'))return fail();
  if(item.tag==='missing'||item.tag==='null') {
   if(keys.length!==1)return fail();
   return item.tag==='missing'?undefined:null;
  }
  if(!Object.hasOwn(item,'value'))return fail();
  const payload=item.value;
  switch(item.tag) {
   case 'bool':return typeof payload==='boolean'?payload:fail();
   case 'string':return typeof payload==='string'?payload:fail();
   case 'bigint-string':return typeof payload==='string'&&/^(0|-?[1-9][0-9]*)$/.test(payload)?BigInt(payload):fail();
   case 'f64':
    if(typeof payload==='number')return Number.isFinite(payload)&&!Object.is(payload,-0)?payload:fail();
    if(payload==='NaN')return NaN;
    if(payload==='Infinity')return Infinity;
    if(payload==='-Infinity')return -Infinity;
    if(payload==='-0')return -0;
    return fail();
   case 'array':
    if(!Array.isArray(payload)||Object.keys(payload).length!==payload.length)return fail();
    return payload.map(decode);
   case 'record': {
    if(!Array.isArray(payload)||Object.keys(payload).length!==payload.length)return fail();
    const record:Record<string,unknown>={};
    for(const entry of payload) {
     if(!Array.isArray(entry)||entry.length!==2||Object.keys(entry).length!==2||typeof entry[0]!=='string'||Object.hasOwn(record,entry[0]))return fail();
     Object.defineProperty(record,entry[0],{value:decode(entry[1]),enumerable:true,writable:true,configurable:true});
    }
    return record;
   }
   default:return fail();
  }
 };
 return decode(value);
}

/** Protocol 1 deliberately rejects lone UTF-16 units, without normalizing valid pairs. */
export function assertUnicodeScalar(value:string):void {
 for(let i=0;i<value.length;i++){
  const unit=value.charCodeAt(i);
  if(unit>=0xd800&&unit<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))throw new Error('Unicode scalar wire requires paired UTF16 surrogates');}
  else if(unit>=0xdc00&&unit<=0xdfff)throw new Error('Unicode scalar wire requires paired UTF16 surrogates');
 }
}
/** Descriptor traversal precedes structuredClone/JSON and includes keys and optional evidence. */
export function assertUnicodeScalarGraph(raw:unknown):void {
 graphWalk(raw,false);
}
