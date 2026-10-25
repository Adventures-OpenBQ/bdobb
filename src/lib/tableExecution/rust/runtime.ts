// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {ExecutionProtocolError} from '../validation';
import {estimatedHostBytes,resourceCheck,resourceResponse,validateResourceLimits,inputLimit,type ResourceLimits} from './resources';
export type {ResourceLimits} from './resources';
import { createWorkerExecutor } from '../workerClient';
import wasmUrl from './generated/pivot_wasm_bg.wasm?url';
import type { ExecutionRequest, ExecutionResponse, LocalWorkerExecutor } from '../types';
import { PIVOT_PROTOCOL_VERSION, assertProtocolVersion, assertUnicodeScalarGraph, type WireValue } from './wireCodec';
import { LocaleOrderBridge } from './orderingBridge';
import { encodeRequest, decodeResponse, presentationShape, type PresentationShape } from './protocol';
export type WasmModule = {protocol_version():number; open_session(options:unknown):number; dispatch(handle:number,request:string):string; close_session(handle:number):void};
export type RustSessionOptions = {protocolVersion:number;locale:string;limits?:ResourceLimits;batchRows?:number};
export type RustRuntime = {open_session(options:RustSessionOptions):number;dispatch(handle:number,request:ExecutionRequest):ExecutionResponse|undefined;close_session(handle:number):void};
export async function loadRustRuntime(loader:()=>Promise<WasmModule> = async()=>{
  const module=await import('./generated/pivot_wasm');
  await module.default({module_or_path:wasmUrl});return module as unknown as WasmModule;
}):Promise<RustRuntime> {
  const module=await loader();assertProtocolVersion(module.protocol_version());
  if(['open_session','dispatch','close_session'].some(key=>typeof module[key as keyof WasmModule]!=='function'))throw new Error('Malformed Rust module exports');
  const sessions=new Map<number,{locale:string;shape:PresentationShape;limits:ResourceLimits;sourceBytes:number;modelBytes:number;bridge:LocaleOrderBridge}>();
  return {
    open_session(options) {
      assertUnicodeScalarGraph(options);assertProtocolVersion(options.protocolVersion);
      validateResourceLimits(options.limits);
      const stateBudget=options.limits?.maxStateBytes===undefined?undefined:Math.floor(options.limits.maxStateBytes/2);
      const nativeOptions={...options,limits:{...options.limits,...(stateBudget===undefined?{}:{maxStateBytes:stateBudget})}};
      const bridge=new LocaleOrderBridge(options.locale,4096,stateBudget);
      const handle=module.open_session({wire:JSON.stringify(nativeOptions),order:(json:string)=>{
        try {
          const command=JSON.parse(json) as {kind:string;a:WireValue&string;b:WireValue&string;values:WireValue[][];descending:boolean[]};
          let value:unknown;
          switch(command.kind){
            case 'scalar':value=bridge.compare(command.a,command.b);break;
            case 'raw':{const raw=bridge.compareRaw(command.a,command.b);value=Number.isNaN(raw)?'unordered':Math.sign(raw)||0;break;}
            case 'recipe':value=bridge.compareRecipe(command.a,command.b);break;
            case 'sort':value=bridge.sortPermutation(command.values,command.descending);break;
            default:throw new Error('Unsupported host order operation');
          }
          return JSON.stringify({ok:value});
        } catch(error) {
          const caught=error as {descriptor?:{code:string;message:string;severity?:string};message?:string};
          const diagnostic=caught.descriptor?{severity:'error',...caught.descriptor}:{code:'HOST_ORDER_FAILURE',message:caught.message??'Host ordering failed',severity:'error',path:'ordering'};
          assertUnicodeScalarGraph(diagnostic);return JSON.stringify({error:diagnostic});
        }
      }});
      if(!Number.isInteger(handle)||handle<1||sessions.has(handle))throw new RustRuntimeFailure('Malformed Rust session handle');
      sessions.set(handle,{locale:options.locale,shape:'raw',limits:options.limits??{},sourceBytes:0,modelBytes:0,bridge});return handle;
    },
    dispatch(handle,request) {
      const session=sessions.get(handle);if(!session)throw new Error('Unknown Rust session');
      try {
        if(request.kind==='registerInput'){resourceCheck(session.limits.maxRows,request.input.rows.length,'Input row budget exceeded');if(inputLimit(session.limits)!==undefined)resourceCheck(inputLimit(session.limits),estimatedHostBytes(request.input,inputLimit(session.limits)),'Input conversion reservation unavailable or exceeded');}
        if(session.limits.maxStateBytes!==undefined&&request.kind!=='dispose'&&request.kind!=='cancel')resourceCheck(session.limits.maxStateBytes===undefined?undefined:Math.floor(session.limits.maxStateBytes/2),session.sourceBytes+session.modelBytes+session.bridge.cacheBytes+estimatedHostBytes(request)*4,'Host conversion state budget exceeded');
      } catch(error){if(error instanceof ExecutionProtocolError)return resourceResponse({requestId:request.requestId,revision:request.revision},error.message);throw error;}
      const encoded=encodeRequest(request,session.locale,handle);
      if(request.kind==='registerInput'){try{resourceCheck(inputLimit(session.limits),new TextEncoder().encode(encoded).byteLength,'Encoded input budget exceeded');}catch(error){return resourceResponse({requestId:request.requestId,revision:request.revision},(error as Error).message);}}

      try {const response=decodeResponse(module.dispatch(handle,encoded),request,handle,session.shape);if(request.kind==='applyModel'&&response?.kind==='viewReady'){session.shape=presentationShape(request.definition);session.modelBytes=session.limits.maxStateBytes===undefined?0:estimatedHostBytes(request.definition);}if(request.kind==='registerInput'&&response?.kind==='registered'){session.shape='raw';session.sourceBytes=session.limits.maxStateBytes===undefined?0:estimatedHostBytes(request.input);session.modelBytes=0;}return response;}
      catch(error){throw new RustRuntimeFailure('Rust dispatch failed', {cause:error});}
    },
    close_session(handle){sessions.delete(handle);module.close_session(handle);}
  };
}
export class RustRuntimeFailure extends Error { constructor(message:string,options?:ErrorOptions){super(message,options);this.name='RustRuntimeFailure';} }
export function createRustExecutor(widgetId:string,factory?:()=>Worker,limits?:ResourceLimits):LocalWorkerExecutor {
  validateResourceLimits(limits);
  if(factory&&limits!==undefined)throw new Error('Custom Rust worker factories must configure their own resource limits');
  const configuration=JSON.stringify({pivotLimits:limits});
  return createWorkerExecutor(widgetId,factory??(()=>new Worker(new URL('./rust.worker.ts',import.meta.url),/* @vite-ignore */ {type:'module',name:configuration})),{readyKind:'rustReady',failureKind:'rustFailed',protocolVersion:PIVOT_PROTOCOL_VERSION});
}
