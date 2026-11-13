// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type {TableDefinition} from './types';
/** Conservative structural reservation, not process/device heap measurement.
 * Unknown representations decline this optional optimization, never the request. */
export function sortReuseReservation(root:unknown,maximum=Infinity):number {
 let bytes=0;const seen=new Set<object>();
 const charge=(n:number)=>{bytes+=n;if(!Number.isSafeInteger(bytes)||bytes>maximum)throw 0;};
 const visit=(value:unknown):void=>{
  if(typeof value==='string'){charge(64+value.length*14);return;}
  if(['bigint','function','symbol'].includes(typeof value))throw 0;
  if(value===null||typeof value!=='object'){charge(32);return;}
  charge(32);if(seen.has(value))return;seen.add(value);charge(256);
  const proto=Object.getPrototypeOf(value);
  if(proto===Map.prototype){for(const [key,child]of value as Map<unknown,unknown>){charge(256);visit(key);visit(child);}return;}
  if(proto===Set.prototype){for(const child of value as Set<unknown>){charge(256);visit(child);}return;}
  if(Array.isArray(value))charge(value.length*64);else if(proto!==Object.prototype&&proto!==null)throw 0;
  for(const key in value){if(!Object.hasOwn(value,key))continue;const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!('value'in d))throw 0;charge(256+key.length*14);visit(d.value);}
 };
 try{visit(root);return bytes;}catch{return Infinity;}
}
/** Deliberately conservative: property order and alias topology must match.
 * Non-plain calculation definitions take the full calculation path. */
export function sameSortData(a:unknown,b:unknown):boolean {
 const left=new WeakMap<object,object>(),right=new WeakMap<object,object>();
 const equal=(a:unknown,b:unknown):boolean=>{
  if(Object.is(a,b))return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
  const pa=Object.getPrototypeOf(a),pb=Object.getPrototypeOf(b);
  if(pa!==pb||(!Array.isArray(a)&&pa!==Object.prototype&&pa!==null))return false;
  if(left.has(a)||right.has(b))return left.get(a)===b&&right.get(b)===a;
  left.set(a,b);right.set(b,a);
  const ak=Reflect.ownKeys(a),bk=Reflect.ownKeys(b);if(ak.length!==bk.length)return false;
  return ak.every((k,i)=>{if(typeof k!=='string'||k!==bk[i])return false;const x=Object.getOwnPropertyDescriptor(a,k),y=Object.getOwnPropertyDescriptor(b,k);return !!x&&!!y&&'value'in x&&'value'in y&&equal(x.value,y.value);});
 };
 return equal(a,b);
}
export const withoutSorting=(d:TableDefinition):TableDefinition=>{const table={...d.table};delete table.sorting;return {...d,table};};
export function sortReuseDefinition(definition:TableDefinition):boolean {
 const m=definition.analytical as {schemaVersion?:number;enabled?:boolean;layout?:{rows?:unknown[];columns?:unknown[]}}|undefined;
 return m?.schemaVersion===1&&m.enabled===true&&!!m.layout&&(!!m.layout.rows?.length||!m.layout.columns?.length);
}
