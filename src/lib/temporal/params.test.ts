// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest';
import type {ParameterSpec} from './contracts';
import {defaultParams,mayNeedResolution,parseParamText,previewParam,resolveParams} from './params';
const spec=(type:ParameterSpec['type'],extra:Partial<ParameterSpec>={}):ParameterSpec=>({name:'p',type,required:true,nullable:false,...extra});
// A Friday afternoon in New York, so T-1bd is the Thursday.
const now=new Date('2026-10-16T18:00:00Z');const ctx={zone:'America/New_York'};
describe('typed TemporalDB parameters',()=>{
 it('parses each declared type and keeps relative expressions as typed',()=>{
  expect(parseParamText(spec('integer'),'42')).toEqual({ok:true,value:42});
  expect(parseParamText(spec('integer'),'4.2').ok).toBe(false);
  expect(parseParamText(spec('number'),'1e3')).toEqual({ok:true,value:1000});
  expect(parseParamText(spec('number'),'Infinity').ok).toBe(false);
  expect(parseParamText(spec('boolean'),'true')).toEqual({ok:true,value:true});
  expect(parseParamText(spec('uuid'),'11111111-1111-4111-8111-11111111111X').ok).toBe(false);
  expect(parseParamText(spec('string'),' T ')).toEqual({ok:true,value:' T '});
  expect(parseParamText(spec('date'),'2026-10-15')).toEqual({ok:true,value:'2026-10-15'});
  expect(parseParamText(spec('date'),'T-1bd')).toEqual({ok:true,value:'T-1bd'});
  expect(parseParamText(spec('date'),'yesterday').ok).toBe(false);
  expect(parseParamText(spec('timestamp'),'2026-10-15T16:00:00-04:00').ok).toBe(true);
  expect(parseParamText(spec('timestamp'),'2026-10-15T16:00:00').ok).toBe(false);
  expect(parseParamText(spec('timestamp'),'T-1h').ok).toBe(true);
 });
 it('treats blank as null when nullable, omitted when optional, and an error when required',()=>{
  expect(parseParamText(spec('date',{nullable:true}),'')).toEqual({ok:true,value:null});
  expect(parseParamText(spec('date',{required:false}),'')).toEqual({ok:true,value:undefined,omit:true});
  expect(parseParamText(spec('date'),'').ok).toBe(false);
 });
 it('resolves every expression once against one clock and leaves literals and strings alone',()=>{
  const specs=[{name:'as_of',type:'date' as const},{name:'since',type:'timestamp' as const},{name:'ticker',type:'string' as const},{name:'fixed',type:'date' as const}];
  const r=resolveParams(specs,{as_of:'T-1bd',since:'T-1h',ticker:'T',fixed:'2026-01-02'},now,ctx);
  expect(r.params).toEqual({as_of:'2026-10-15',since:'2026-10-16T13:00:00-04:00',ticker:'T',fixed:'2026-01-02'});
  expect(r.expressions).toEqual({as_of:'T-1bd',since:'T-1h'});
 });
 it('refuses a run whose expression has nothing to resolve against',()=>{
  expect(()=>resolveParams([{name:'start',type:'date'}],{start:'earliest'},now,ctx)).toThrow(/cannot be resolved/);
 });
 it('previews only expressions and seeds defaults from the definition',()=>{
  expect(previewParam(spec('date'),'2026-10-15',ctx)).toBeNull();
  expect(previewParam(spec('date'),'T-1bd',{...ctx,now})).toBe('2026-10-15');
  expect(defaultParams([{name:'a',type:'date',default:'T-1bd',required:true},{name:'b',type:'integer',required:false},{name:'c',type:'integer',required:true}])).toEqual({a:'T-1bd',b:null});
  expect(mayNeedResolution({a:'2026-10-15',b:3})).toBe(false);expect(mayNeedResolution({a:'T-1bd'})).toBe(true);
 });
});
