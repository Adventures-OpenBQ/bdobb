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
