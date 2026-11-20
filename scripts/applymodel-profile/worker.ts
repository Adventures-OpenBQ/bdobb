// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {createRustWorkerHandler} from '../../src/lib/tableExecution/rust/rust.worker';
import {loadRustRuntime} from '../../src/lib/tableExecution/rust/runtime';
import * as traced from 'profile-artifact';
import * as stock from 'stock-artifact';
import * as before from 'before-artifact';
const enabled=new URL(self.location.href).searchParams.get('trace')==='1';
const absolute=()=>performance.timeOrigin+performance.now();
let receivedAt=0,last:any;
const beforeBuild=new URL(self.location.href).searchParams.get('before')==='1';
const module=enabled?traced:beforeBuild?before:stock;
const load=async()=>{
 await module.default({module_or_path:enabled?'/traced.wasm':beforeBuild?'/before.wasm':'/stock.wasm'});
 return loadRustRuntime(async()=>({
  ...module,
  open_session(host:any){
   return module.open_session({...host,order(json:string){
    if(!enabled)return host.order(json);
    const start=performance.now();
    try{return host.order(json);}finally{if(last){last.hostCallbackMs+=(performance.now()-start);const kind=/"kind":"([^"]+)"/.exec(json)?.[1]??'unknown';last.hostCalls[kind]=(last.hostCalls[kind]??0)+1;}}
   }});
  },
  dispatch(handle:number,request:string){
   const tick=performance.now();
   if(enabled)traced.profile_start();
   const result=module.dispatch(handle,request);
   if(last){last.wasmDispatchMs=performance.now()-tick;if(enabled)last.spans=JSON.parse(traced.profile_take());}
   return result;
  }
 }));
};
const handle=createRustWorkerHandler(response=>{
 const trace=last?{...last,workerSendAt:absolute()}:undefined;
 self.postMessage({...response,...(trace?{__profile:trace}:{})});last=undefined;
},load,'en-US');
self.onmessage=event=>{
 receivedAt=absolute();last={workerReceivedAt:receivedAt,hostCallbackMs:0,hostCalls:{}};
 (globalThis as any).__profileTiming=last;
 void handle(event.data);
};
