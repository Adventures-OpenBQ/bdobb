// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {createManagedTableRequest} from '../../dataClient';
import type {BackendConfig,ManagedSourceReference} from '../../types';
import {createRemoteTransport,positiveLimit,type RemoteTransportConfig} from './transport';
export type BackendSourceBinding={backendId:string;widgetId:string;params:Record<string,string>};
export type BackendSourceOption={backendId:string;label:string;widgets:{widgetId:string;label:string;parameters:string[]}[]};
type Options=Partial<Omit<RemoteTransportConfig,'baseUrl'>>&{maxUploadBytes?:number};
const credential=/^(authorization|cookie|password|secret|token|api[_-]?key|headers)$/i;
export function createSourceClient(backend:BackendConfig,options:Options={}) {
 const request=options.request??createManagedTableRequest(backend);
 const config={...options,baseUrl:backend.baseUrl,request};
 const transport=createRemoteTransport(config),limit=positiveLimit(options.maxUploadBytes,16*1024*1024);
 const reference=(value:unknown,kind:ManagedSourceReference['kind']):ManagedSourceReference=>{
  const sourceId=(value as {sourceId?:unknown})?.sourceId;
  if(typeof sourceId!=='string'||!sourceId||sourceId.length>4096)throw new Error('Invalid source response');
  return {sourceId,kind,version:1};
 };
 return {
  async uploadFile(file:File,signal?:AbortSignal):Promise<ManagedSourceReference>{
   if(!Number.isSafeInteger(file.size)||file.size<1||file.size>limit)throw new Error('Upload byte limit exceeded');
   if(!/\.(csv|tsv|json|xlsx|xls)$/i.test(file.name)||file.name.length>240||[...file.name].some(c=>c.charCodeAt(0)<32))throw new Error('Unsupported upload filename');
   // The HTTP service decodes this UTF-8 URI component exactly once, then validates the basename.
   const key=crypto.randomUUID();
   const upload=createRemoteTransport({...config,request:(url,init)=>request(url,{...init,body:file,headers:{'Content-Type':file.type||'application/octet-stream','Idempotency-Key':key,'X-Upload-Filename':encodeURIComponent(file.name)}})});
   return reference(await upload.json('POST','sources/uploads',undefined,signal),'upload');
  },
  async registerBackend(binding:BackendSourceBinding,signal?:AbortSignal):Promise<ManagedSourceReference>{
   if(Object.keys(binding.params).some(k=>credential.test(k))||Object.values(binding.params).some(v=>typeof v!=='string'))throw new Error('Credential parameters cannot be saved as a source');
   return reference(await transport.json('POST','sources/backends',{idempotencyKey:crypto.randomUUID(),binding:{backendId:binding.backendId,widgetId:binding.widgetId,params:{...binding.params}}},signal),'backend');
  },
  async deleteSource(sourceId:string,signal?:AbortSignal){await transport.json('DELETE',`sources/${encodeURIComponent(sourceId)}`,undefined,signal);},
  async backends(signal?:AbortSignal):Promise<BackendSourceOption[]>{
   const value=await transport.json('GET','sources/backends',undefined,signal) as {backends?:BackendSourceOption[]};
   if(!Array.isArray(value?.backends)||value.backends.some(b=>typeof b.backendId!=='string'||typeof b.label!=='string'||!Array.isArray(b.widgets)||b.widgets.some(w=>typeof w.widgetId!=='string'||typeof w.label!=='string'||!Array.isArray(w.parameters)||w.parameters.some(p=>typeof p!=='string'))))throw new Error('Invalid backend source discovery');
   return value.backends;
  },
 };
}
