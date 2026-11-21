// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// EXPERIMENT ONLY. Structural reservation is not a measured process/device limit.
import {isDeepStrictEqual} from 'node:util';
import {calculateView} from '../../src/lib/tableExecution/engine';
import {reorderCanonical} from './sort-reuse-prototype';
import type {CalculatedView,TableDefinition,SelectionSpec} from '../../src/lib/tableExecution/types';
import type {WidgetDataset} from '../../src/lib/widgetData/types';
import type {RuntimeParams} from '../../src/lib/tableExecution/runtimeParams';
const inputSnapshots=new WeakMap<object,WidgetDataset>();
export function captureInput(input:WidgetDataset):object {const token=Object.freeze({});inputSnapshots.set(token,structuredClone(input));return token;}
export function releaseInput(token:object):void {inputSnapshots.delete(token);}
type Context={session:object;inputGeneration:object;ordering:object;runtimeParams:RuntimeParams};
type Entry={context:Context;definition:TableDefinition;view:CalculatedView;bytes:number};
export function reserveGraph(root:unknown,maximum=Infinity):number {
 let bytes=0;const seen=new Set<object>();
 const charge=(n:number)=>{bytes+=n;if(bytes>maximum)throw 0;};
 const visit=(value:unknown):void=>{
  if(typeof value==='string'){charge(64+value.length*14);return;}
  if(typeof value==='bigint'||typeof value==='function'||typeof value==='symbol')throw 0;
  if(value===null||typeof value!=='object'){charge(32);return;}
  charge(32);if(seen.has(value))return;seen.add(value);charge(256);
  const proto=Object.getPrototypeOf(value);
  if(proto===Map.prototype){for(const [key,child]of value as Map<unknown,unknown>){charge(256);visit(key);visit(child);}return;}
  if(proto===Set.prototype){for(const child of value as Set<unknown>){charge(256);visit(child);}return;}
  if(Array.isArray(value)){charge(value.length*64);}
  else if(proto!==Object.prototype&&proto!==null)throw 0;
  for(const key in value){if(!Object.hasOwn(value,key))continue;const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!('value'in d))throw 0;charge(256+key.length*14);visit(d.value);}
 };
 try{visit(root);return bytes;}catch{return Infinity;}
}
const canonicalDefinition=(definition:TableDefinition)=>({...definition,table:{...definition.table,sorting:[]}});
export class SortCacheExperiment {
 private entry?:Entry;
 constructor(readonly maximumBytes:number){if(!Number.isSafeInteger(maximumBytes)||maximumBytes<0)throw Error('Invalid cache reservation');}
 clear(){this.entry=undefined;}
 get retainedReservation(){return this.entry?.bytes??0;}
 apply<T>(definition:TableDefinition,selection:SelectionSpec,context:Context,publish:(view:CalculatedView)=>T):{publication:T;hit:boolean;admitted:boolean;reservation:number}{
  const input=inputSnapshots.get(context.inputGeneration);if(!input)throw Error('Unknown input snapshot');
  const key=canonicalDefinition(definition),entry=this.entry;
  const overhead=reserveGraph({definition,selection,runtimeParams:context.runtimeParams},this.maximumBytes)*4;
  const eligible=definition.analytical?.schemaVersion===1&&this.maximumBytes>0&&Number.isFinite(overhead);
  const matches=eligible&&entry&&entry.context.session===context.session&&entry.context.inputGeneration===context.inputGeneration&&entry.context.ordering===context.ordering&&isDeepStrictEqual(entry.context.runtimeParams,context.runtimeParams)&&isDeepStrictEqual(entry.definition,key);
  const fits=!!matches&&entry.bytes*4+overhead<=this.maximumBytes;
  if(fits){
   const candidate=reorderCanonical(entry.view,definition,selection);
   const publication=publish(candidate); // failure leaves the prior entry intact
   return {publication,hit:true,admitted:true,reservation:entry.bytes*4+overhead};
  }
  // Budgetless/unsupported paths use the unchanged calculation and commit only
  // after successful publication. No speculative canonical clone is allocated.
  if(!eligible){
   const publication=publish(calculateView(input,definition,selection,true,undefined,[],context.runtimeParams));
   this.entry=undefined;return {publication,hit:false,admitted:false,reservation:0};
  }
  const canonical=calculateView(input,key,{kind:'none'},true,undefined,[],context.runtimeParams);
  const previousReservation=(entry?.bytes??0)*2;
  const bytes=reserveGraph(canonical,Math.max(0,(this.maximumBytes-overhead-previousReservation)/4));
  const admitted=Number.isFinite(bytes)&&bytes*4+overhead+previousReservation<=this.maximumBytes;
  const candidate=admitted?reorderCanonical(canonical,definition,selection):calculateView(input,definition,selection,true,undefined,[],context.runtimeParams);
  const pending=admitted?{view:canonical,bytes,definition:structuredClone(key),context:{session:context.session,inputGeneration:context.inputGeneration,ordering:context.ordering,runtimeParams:structuredClone(context.runtimeParams)}}:undefined;
  const publication=publish(candidate);
  this.entry=pending;
  return {publication,hit:false,admitted,reservation:admitted?bytes*4+overhead+previousReservation:0};
 }
}
