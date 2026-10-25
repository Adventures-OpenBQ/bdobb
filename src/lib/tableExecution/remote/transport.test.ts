// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {createRemoteTransport} from './transport';
vi.mock('@tauri-apps/plugin-http',()=>({fetch:vi.fn(async()=>Response.json({ok:true}))}));
import {fetch as pluginFetch} from '@tauri-apps/plugin-http';
import {createManagedTableRequest} from '../../dataClient';
import type {BackendConfig} from '../../types';

it('caps streamed bytes without content-length and cancels at the boundary',async()=>{
 let cancelled=false,pulls=0;
 const body=new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(new Uint8Array(8));},cancel(){cancelled=true;}});
 const request=vi.fn(async()=>new Response(body));
 const transport=createRemoteTransport({baseUrl:'https://service/api/',request,maxResponseBytes:10});
 await expect(transport.json('GET','sessions')).rejects.toThrow(/limit/i);
 expect(cancelled).toBe(true);expect(pulls).toBeLessThanOrEqual(3);
});
it('refuses declared oversized bodies before reading and sanitizes HTTP/network errors',async()=>{
 let cancelled=false;
 const request=vi.fn(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-length':'100'}}));
 await expect(createRemoteTransport({baseUrl:'https://service',request,maxResponseBytes:10}).json('GET','sessions')).rejects.toThrow(/limit/i);
 expect(cancelled).toBe(true);
 const failure=async()=>{throw new Error('https://user:secret@service/?key=secret');};
 await expect(createRemoteTransport({baseUrl:'https://service',request:failure}).json('GET','sessions')).rejects.toThrow('Table request failed');
 await expect(createRemoteTransport({baseUrl:'https://service',request:async()=>Response.json({error:{message:'secret'}} ,{status:401})}).json('GET','sessions')).rejects.toThrow('HTTP 401');
});
it('cancels stalled body reads on abort and preserves the caller abort reason',async()=>{
 let cancelled=false;
 const controller=new AbortController();
 const transport=createRemoteTransport({baseUrl:'https://service',request:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))});
 const pending=transport.json('GET','sessions',undefined,controller.signal);
 await new Promise(resolve=>setTimeout(resolve,0));controller.abort(new Error('stop reading'));
 await expect(pending).rejects.toThrow('stop reading');expect(cancelled).toBe(true);
});
it('bounds outgoing JSON and joins nested service paths without discarding the prefix',async()=>{
 const request=vi.fn(async()=>Response.json({ok:true}));
 const transport=createRemoteTransport({baseUrl:'https://service/api/',request,maxRequestBytes:30});
 await transport.json('POST','sessions',{a:1});
 expect(request.mock.calls[0]).toMatchObject(['https://service/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"a":1}'}]);
 await expect(transport.json('POST','sessions',{a:'x'.repeat(50)})).rejects.toThrow(/limit/i);
 expect(request).toHaveBeenCalledTimes(1);
});
it('uses an end-to-end deadline even when fetch ignores the signal',async()=>{
 const transport=createRemoteTransport({baseUrl:'https://service',request:()=>new Promise(()=>{}),timeoutMs:10});
 await expect(transport.json('GET','sessions')).rejects.toThrow(/timed out/i);
});

it.each(['header','query','cookie'] as const)('uses backend %s credentials on every managed request and refuses foreign destinations',async authLocation=>{
 const backend:BackendConfig={id:'b',name:'Managed',baseUrl:'https://service/api',authLocation,headerName:authLocation==='header'?'Authorization':'table-auth',headerValue:'Bearer private',validateWidgets:false};
 const request=createManagedTableRequest(backend);await request('https://service/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 const [input,init]=vi.mocked(pluginFetch).mock.calls.at(-1)!;const url=new URL(String(input)),headers=new Headers(init?.headers);
 if(authLocation==='query')expect(url.searchParams.get('table-auth')).toBe('Bearer private');
 else expect(headers.get(authLocation==='header'?'Authorization':'Cookie')).toBe(authLocation==='header'?'Bearer private':'table-auth=Bearer private');
 expect(headers.get('Content-Type')).toBe('application/json');
 await expect(request('https://foreign/api/sessions')).rejects.toThrow(/destination/i);
 await expect(request('https://service/api-foreign/sessions')).rejects.toThrow(/destination/i);
});

it('supports older WebKit and releases combined signal listeners after successful work',async()=>{
 const {withRemoteSignal}=await import('./transport');
 const native=AbortSignal.any;
 delete (AbortSignal as {any?:unknown}).any;
 try {
  const lifetime=new AbortController(),caller=new AbortController();
  let combined:AbortSignal|undefined;
  await withRemoteSignal(caller.signal,lifetime.signal,async signal=>{combined=signal;expect(signal.aborted).toBe(false);});
  // Aborting the completed combination removes the fallback's lifetime listeners.
  expect(combined!.aborted).toBe(true);
  lifetime.abort('disposed');expect(combined!.reason).not.toBe('disposed');
 }finally{AbortSignal.any=native;}
});
