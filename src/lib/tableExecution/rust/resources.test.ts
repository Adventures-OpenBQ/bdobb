// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { LocaleOrderBridge } from './orderingBridge';
import { encodeWire } from './wireCodec';
import { createRustWorkerHandler, type RustWorkerMessage } from './rust.worker';
import { input, revision } from '../fixtures';
import type { RustRuntime } from './runtime';
it('combined scalar and recipe host cache refuses long UTF16 keys while preserving ordering', () => {
    const bridge = new LocaleOrderBridge('en-US', 4096, 64);
    expect(bridge.compare(encodeWire('a'.repeat(1000)), encodeWire('b'.repeat(1000)))).toBe(-1);
    expect(bridge.compareRecipe('é'.repeat(1000), 'z'.repeat(1000))).toBe(-1);
    expect(bridge.cacheSize + bridge.recipeCacheSize).toBe(0);
    expect(bridge.cacheBytes).toBe(0);
});
it('queued input state refuses recoverably before initialization and later disposal settles', async () => {
    let resolve!: (runtime: RustRuntime) => void;
    const messages: RustWorkerMessage[] = [];
    const handler = createRustWorkerHandler(message => messages.push(message), () => new Promise(done => { resolve = done; }), 'en-US', { maxStateBytes: 1 });
    await handler({ kind: 'registerInput', requestId: 'budget', revision, input, inputRevision: 1 });
    expect(messages).toMatchObject([{ kind: 'error', error: { code: 'RESOURCE_LIMIT' } }]);
    // The unavailable runtime is a controllable initialization boundary, not evaluator evidence.
    const disposed = handler({ kind: 'dispose', requestId: 'd', revision });
    resolve({ open_session: () => 1, dispatch: () => undefined, close_session: () => { } });
    await disposed;
    expect(messages.some(m => m.kind === 'rustFailed')).toBe(false);
});
it('resource diagnostic survives Wasm decode and shared response validation without fatal reset', async () => {
    const { decodeResponse } = await import('./protocol');
    const response = decodeResponse(JSON.stringify({ protocolVersion: 1, sessionId: 1, response: { kind: 'error', requestId: 'resource', revision, completeness: { kind: 'unknown', warnings: [] }, diagnostics: [], error: { code: 'RESOURCE_LIMIT', message: 'Input row budget exceeded', severity: 'error', path: 'session' } } }), { kind: 'totals', requestId: 'resource', revision }, 1, 'raw');
    expect(response).toMatchObject({ kind: 'error', error: { code: 'RESOURCE_LIMIT' } });
});
it.each([0, 1])('zero and odd state ceilings stay enabled (%s)', async (maxStateBytes) => {
    let resolve!: (runtime: RustRuntime) => void;
    const messages: RustWorkerMessage[] = [];
    const handler = createRustWorkerHandler(message => messages.push(message), () => new Promise(done => { resolve = done; }), 'en-US', { maxStateBytes });
    const request = handler({ kind: 'registerInput', requestId: 'small', revision, input, inputRevision: 1 });
    expect(messages).toMatchObject([{ kind: 'error', error: { code: 'RESOURCE_LIMIT' } }]);
    const dispose = handler({ kind: 'dispose', requestId: 'd', revision });
    resolve({ open_session: () => 1, dispatch: () => undefined, close_session: () => { } });
    await Promise.all([request, dispose]);
});
it('worker resource configuration rejects unknown, negative, noninteger and overflowing fields before source acquisition', async () => {
    const { validateResourceLimits } = await import('./resources');
    for (const invalid of [{ maxRows: -1 }, { maxStateBytes: 4294967296 }, { maxRows: 1.5 }, { bogus: 3 }])
        expect(() => validateResourceLimits(invalid)).toThrow('Invalid Rust resource limit');
    let called = 0;
    expect(() => validateResourceLimits({ get maxRows() { called++; return 3; } })).toThrow('Invalid Rust resource limit');
    expect(called).toBe(0);
});
it.each([
    Object.create({ maxRows: 1 }),
    Object.defineProperty({}, 'maxRows', { value: 1 }),
])('resource options cannot omit an inherited or nonenumerable limit (%s)', async invalid => {
    const { validateResourceLimits } = await import('./resources');
    expect(() => validateResourceLimits(invalid)).toThrow('Invalid Rust resource limit');
});
it('resource options cannot execute a serializer before worker acquisition', async () => {
    const { createRustExecutor } = await import('./runtime');
    let called = 0;
    const serialized = Object.defineProperty({ maxRows: 1 }, 'toJSON', { value: () => { called++; return {}; } });
    expect(() => createRustExecutor('configuration', undefined, serialized)).toThrow('Invalid Rust resource limit');
    expect(called).toBe(0);
});

it.each([
 {limits:{maxStateBytes:0},command:{kind:'registerInput',requestId:'raw-state',revision,input,inputRevision:1}},
 {limits:{maxInputBytes:0},command:{kind:'importFile',requestId:'raw-file',revision,name:'large.json',bytes:new Uint8Array(1024*1024),inputRevision:1}},
])('refuses oversized raw admission before structuredClone (%s)', async ({limits,command})=>{
 const messages:RustWorkerMessage[]=[];
 const clone=vi.spyOn(globalThis,'structuredClone');
 try {
  const handler=createRustWorkerHandler(m=>messages.push(m),()=>new Promise(()=>{}),'en-US',limits);
  await handler(command);
  expect(messages).toMatchObject([{kind:'error',requestId:command.requestId,revision,error:{code:'RESOURCE_LIMIT'}}]);
  expect(clone).not.toHaveBeenCalled();
 }finally{clone.mockRestore();}
});
it('reserves raw plus validated request copies before queued allocation and releases after settlement',async()=>{
 const {estimatedHostBytes}=await import('./resources');
 const command={kind:'totals',requestId:'queued',revision};
 const bytes=estimatedHostBytes(command);
 let resolve!:(runtime:RustRuntime)=>void;const messages:RustWorkerMessage[]=[];
 const handler=createRustWorkerHandler(m=>messages.push(m),()=>new Promise(done=>{resolve=done;}),'en-US',{maxStateBytes:bytes*4});
 const first=handler(command);const clone=vi.spyOn(globalThis,'structuredClone');
 await handler({...command,requestId:'second'});
 expect(messages).toMatchObject([{kind:'error',error:{code:'RESOURCE_LIMIT'}}]);expect(clone).not.toHaveBeenCalled();clone.mockRestore();
 resolve({open_session:()=>1,dispatch:(_h,r)=>({kind:'error',requestId:r.requestId,revision:r.revision,completeness:{kind:'unknown',warnings:[]},diagnostics:[],error:{code:'RESOURCE_LIMIT',message:'native bound'}}),close_session:()=>{}});
 await first;
 await handler(command);expect(messages.filter(m=>m.kind==='error')).toHaveLength(3);
 await handler({kind:'dispose',requestId:'d',revision});
});
it.each(['source','metadata'])('refuses unbounded BigInt %s before cloning or decimal conversion under byte profiles',async location=>{
 const huge=10n**100000n;
 const candidate={...input,rows:location==='source'?[{id:'huge',values:{revenue:huge}}]:input.rows,provenance:{...input.provenance,...(location==='metadata'?{metadata:{huge}}:{})}};
 for(const limits of [{maxStateBytes:1000000},{maxInputBytes:1000000},{inputBytes:1000000}]){
  const messages:RustWorkerMessage[]=[];const clone=vi.spyOn(globalThis,'structuredClone');const decimal=vi.spyOn(BigInt.prototype,'toString');
  try{
   const handler=createRustWorkerHandler(m=>messages.push(m),()=>new Promise(()=>{}),'en-US',limits);
   await handler({kind:'registerInput',requestId:'huge',revision,input:candidate,inputRevision:1});
   expect(messages).toMatchObject([{kind:'error',error:{code:'RESOURCE_LIMIT'}}]);expect(clone).not.toHaveBeenCalled();expect(decimal).not.toHaveBeenCalled();
  }finally{clone.mockRestore();decimal.mockRestore();}
 }
});
it('raw admission does not execute accessors or publish invalid correlations',async()=>{
 let getter=0;const messages:RustWorkerMessage[]=[];
 const handler=createRustWorkerHandler(m=>messages.push(m),()=>new Promise(()=>{}),'en-US',{maxStateBytes:0});
 await handler({kind:'registerInput',requestId:'bad',revision,get input(){getter++;return input;},inputRevision:1});
 expect(getter).toBe(0);expect(messages).toMatchObject([{kind:'error',error:{code:'INVALID_REQUEST'}}]);
 messages.length=0;
 await handler({kind:'registerInput',requestId:'bad',revision:{...revision,widgetId:'\ud800'},input,inputRevision:1});expect(messages).toEqual([]);
});

it('raw correlation refuses wrong types/accessors without calling getters or cloning',async()=>{
 let calls=0;const messages:RustWorkerMessage[]=[];
 const handler=createRustWorkerHandler(m=>messages.push(m),()=>new Promise(()=>{}),'en-US',{maxStateBytes:0});
 const clone=vi.spyOn(globalThis,'structuredClone');
 try{
  for(const bad of [
   {kind:'totals',requestId:'id',revision:{...revision,input:'1'}},
   {kind:'totals',get requestId(){calls++;return 'id';},revision},
   {kind:'totals',requestId:'\ud800',revision},
   {kind:'totals',requestId:'id',revision:{...revision,get output(){calls++;return 1;}}},
  ])await handler(bad);
  expect(messages).toEqual([]);expect(calls).toBe(0);expect(clone).not.toHaveBeenCalled();
 }finally{clone.mockRestore();}
});
it('sparse source slots and traversal work refuse before clone under tiny input budgets',async()=>{
 const messages:RustWorkerMessage[]=[];const rows=new Array(1000000);
 let calls=0;Object.defineProperty(rows,'0',{enumerable:true,get(){calls++;return input.rows[0];}});
 const handler=createRustWorkerHandler(m=>messages.push(m),()=>new Promise(()=>{}),'en-US',{maxInputBytes:1000});
 const clone=vi.spyOn(globalThis,'structuredClone');
 try{
  await handler({kind:'registerInput',requestId:'sparse',revision,input:{...input,rows},inputRevision:1});
  expect(messages).toMatchObject([{kind:'error',error:{code:'RESOURCE_LIMIT'}}]);expect(calls).toBe(0);expect(clone).not.toHaveBeenCalled();
 }finally{clone.mockRestore();}
});
it('zero-budget disposal canonicalizes unrelated raw payload without copying it',async()=>{
 const messages:RustWorkerMessage[]=[];let resolve!:(runtime:RustRuntime)=>void;
 const handler=createRustWorkerHandler(m=>messages.push(m),()=>new Promise(done=>{resolve=done;}),'en-US',{maxStateBytes:0});
 const clone=vi.spyOn(globalThis,'structuredClone');
 try{
  const disposed=handler({kind:'dispose',requestId:'d',revision,unused:new Uint8Array(1024*1024)});
  expect(clone).toHaveBeenCalledTimes(1);expect(clone.mock.calls[0][0]).not.toHaveProperty('unused');
  resolve({open_session:()=>1,dispatch:()=>undefined,close_session:()=>{}});await disposed;expect(messages).toEqual([]);
 }finally{clone.mockRestore();}
});
it('direct runtime refuses unbounded BigInt before full request clone/codec/dispatch only in byte profiles',async()=>{
 const {loadRustRuntime}=await import('./runtime');
 const huge=10n**100000n;
 for(const limits of [{maxStateBytes:1000000},{maxInputBytes:1000000},{inputBytes:1000000}]){
  const dispatch=vi.fn();const runtime=await loadRustRuntime(async()=>({protocol_version:()=>1,open_session:()=>1,dispatch,close_session:()=>{}}));
  const handle=runtime.open_session({protocolVersion:1,locale:'en-US',limits});
  const clone=vi.spyOn(globalThis,'structuredClone');const string=vi.spyOn(globalThis,'String');
  try{
   const result=runtime.dispatch(handle,{kind:'registerInput',requestId:'huge',revision,input:{...input,rows:[{id:'big',values:{revenue:huge}}]},inputRevision:1});
   expect(result).toMatchObject({kind:'error',error:{code:'RESOURCE_LIMIT'}});expect(clone).not.toHaveBeenCalled();expect(string.mock.calls.some(([value])=>typeof value==='bigint')).toBe(false);expect(dispatch).not.toHaveBeenCalled();
  }finally{clone.mockRestore();string.mockRestore();runtime.close_session(handle);}
 }
});
