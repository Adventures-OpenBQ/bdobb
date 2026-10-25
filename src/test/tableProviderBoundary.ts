// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {createWorkerHandler} from '../lib/tableExecution/table.worker';
import {createRustWorkerHandler,type RustWorkerMessage} from '../lib/tableExecution/rust/rust.worker';
import {loadRustRuntime,type RustRuntime,type WasmModule} from '../lib/tableExecution/rust/runtime';
import type {ExecutionResponse} from '../lib/tableExecution/types';
import type {TableEngine} from '../lib/tableExecution/rust/providerFactory';
let instance=0;
const generated=`${process.cwd()}/src/lib/tableExecution/rust/generated/`;
const glue=readFileSync(generated+'pivot_wasm.js','utf8');
const bytes=readFileSync(generated+'pivot_wasm_bg.wasm');
/** TEST ONLY: replace transport, while retaining the actual compiled Rust calculator. */
export function realRustRuntime():Promise<RustRuntime>{
 // Unique module URL isolates Wasm globals exactly as separate production Web Workers do.
 return loadRustRuntime(async()=>{const url='data:text/javascript;base64,'+Buffer.from(glue).toString('base64')+'#worker-'+(++instance);const module=await import(/* @vite-ignore */ url);await module.default({module_or_path:bytes});return module as WasmModule;});
}
const handlers=new Set<(raw:unknown)=>Promise<void>>();
afterEach(async()=>{await Promise.all([...handlers].map(handle=>handle({kind:'dispose',requestId:'test-cleanup',revision:{widgetId:'cleanup',input:0,model:0,output:0}})));handlers.clear();});
export function providerHandler(engine:TableEngine,send:(response:RustWorkerMessage|ExecutionResponse)=>void){
 const handler=engine==='rust'?createRustWorkerHandler(send,realRustRuntime):createWorkerHandler(send);handlers.add(handler);return handler;
}
export class ProviderBoundary {
 onmessage:((event:MessageEvent)=>void)|null=null;
 onerror:((event:Event)=>void)|null=null;
 onmessageerror=null;
 handler;
 constructor(url:URL|string){this.handler=providerHandler(String(url).includes('rust.worker')?'rust':'typescript',data=>this.onmessage?.({data} as MessageEvent));}
 postMessage(request:unknown){void this.handler(request);}
 terminate(){}
}
