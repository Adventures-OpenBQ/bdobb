// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { decodeWire, encodeWire, assertProtocolVersion, type WireValue } from './wireCodec';
import { encodeOracleValue } from './oracle';

describe('portable wire codec', () => {
 it('preserves omission, missing, null, bigint and ordinary __proto__ fields', () => {
  const source = Object.create(null);
  Object.assign(source, { missing: undefined, null: null, exact: 9007199254740993n });
  Object.defineProperty(source, '__proto__', { value: 'ordinary', enumerable: true });
  const encoded = encodeWire(source);
  expect(encoded).toEqual({ tag: 'record', value: [['missing', {tag:'missing'}], ['null',{tag:'null'}], ['exact',{tag:'bigint-string',value:'9007199254740993'}], ['__proto__',{tag:'string',value:'ordinary'}]] });
  const decoded = decodeWire(JSON.parse(JSON.stringify(encoded))) as Record<string,unknown>;
  expect(Object.hasOwn(decoded,'absent')).toBe(false);
  expect(Object.hasOwn(decoded,'missing')).toBe(true);
  expect(decoded.missing).toBeUndefined(); expect(decoded.null).toBeNull();
  expect(decoded.exact).toBe(9007199254740993n); expect(decoded.__proto__).toBe('ordinary');
  expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
 });
 it('materializes sparse array entries as explicit missing without losing positions', () => {
  const values:unknown[] = new Array(4);
  values[0]=undefined; values[2]=null; values[3]=3;
  expect(encodeWire(values)).toEqual({tag:'array',value:[{tag:'missing'},{tag:'missing'},{tag:'null'},{tag:'f64',value:3}]});
  expect(decodeWire(encodeWire(values))).toEqual([undefined,undefined,null,3]);
 });
 it('preserves nonfinite and negative zero tags exactly as the baseline corpus', () => {
  const values = [NaN,Infinity,-Infinity,-0,0,9007199254740993n];
  expect(encodeWire(values)).toEqual(encodeOracleValue(values));
  const decoded = decodeWire(encodeWire(values)) as unknown[];
  values.forEach((value,index) => expect(Object.is(decoded[index],value)).toBe(true));
 });
 it('rejects getters without invoking them, even on wire input', () => {
  let invoked=0;
  const unsafe = Object.defineProperty({},'value',{get(){invoked++;return 1;},enumerable:true});
  expect(()=>encodeWire(unsafe)).toThrow(/accessor/i);
  expect(()=>decodeWire(unsafe as WireValue)).toThrow(/accessor/i);
  expect(invoked).toBe(0);
 });
 it.each([new Date(),new Map(),()=>1,Symbol('x')])('refuses unsupported values', value => expect(()=>encodeWire(value)).toThrow());
 it('rejects cycles, symbol fields and custom array properties', () => {
  const cycle:unknown[]=[];cycle.push(cycle);
  expect(()=>encodeWire(cycle)).toThrow(/cycl/i);
  expect(()=>encodeWire({[Symbol('x')]:1})).toThrow();
  expect(()=>encodeWire(Object.assign([1],{extra:2}))).toThrow();
 });
 it.each([{tag:'f64',value:'other'},{tag:'bigint-string',value:'1.2'},{tag:'null',value:1},{tag:'null',value:null},{tag:'missing',value:null},{tag:'missing',value:1},{tag:'record',value:[['a',{tag:'null'}],['a',{tag:'null'}]]}])('refuses malformed wire values', value => expect(()=>decodeWire(value as WireValue)).toThrow());
 it('refuses unknown protocol versions before use', () => {
  expect(()=>assertProtocolVersion(1)).not.toThrow();
  expect(()=>assertProtocolVersion(2)).toThrow(/version/i);
 });
});

it('decodes valid scalar cells without recursive ancestor tracking', () => {
 const values:WireValue[]=[{tag:'missing'},{tag:'null'},{tag:'bool',value:false},{tag:'string',value:'😀\0'},{tag:'bigint-string',value:'9007199254740993'},{tag:'f64',value:1.25},{tag:'f64',value:'-0'},{tag:'f64',value:'NaN'}];
 const original=Set.prototype.add;
 let additions=0,decoded:unknown[];
 Set.prototype.add=function<T>(this:Set<T>,value:T){additions++;return original.call(this,value) as Set<T>;};
 try {decoded=values.map(decodeWire);}finally{Set.prototype.add=original;}
 expect(decoded!).toEqual([undefined,null,false,'😀\0',9007199254740993n,1.25,-0,NaN]);
 expect(additions).toBe(0);
});

it('keeps strict descriptor and graph checks around scalar-looking cells', () => {
 let invoked=0;
 const accessorValue=Object.defineProperty({tag:'f64'},'value',{get(){invoked++;return 1;},enumerable:true});
 const accessorTag=Object.defineProperty({value:1},'tag',{get(){invoked++;return 'f64';},enumerable:true});
 for(const value of [accessorValue,accessorTag])expect(()=>decodeWire(value as WireValue)).toThrow(/accessor/i);
 expect(invoked).toBe(0);
 const hidden=Object.defineProperty({tag:'f64'},'value',{value:1,enumerable:false});
 const symbol={tag:'f64',value:1,[Symbol('extra')]:2};
 const custom=Object.assign(Object.create({}),{tag:'f64',value:1});
 const cycle:{tag:string;value?:unknown}={tag:'f64'};cycle.value=cycle;
 for(const value of [hidden,symbol,custom,cycle,{tag:'f64',value:1,extra:2},{tag:'string',value:'\ud800'},{tag:'f64',value:1,'\ud800':0}])expect(()=>decodeWire(value as WireValue)).toThrow();
 for(const value of [-0,NaN,Infinity,-Infinity,undefined,null,true,1n])expect(()=>decodeWire({tag:'f64',value} as WireValue)).toThrow();
 expect(decodeWire(Object.assign(Object.create(null),{tag:'string',value:'😀'}))).toBe('😀');
 expect(decodeWire(Object.freeze({tag:'f64',value:2}))).toBe(2);
});
