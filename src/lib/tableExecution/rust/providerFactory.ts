// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {createWorkerExecutor} from '../workerClient';
import type {ExecutionProvider,LocalWorkerExecutor} from '../types';
import type {BackendConfig,WidgetDef} from '../../types';
import {sendParams,type WireContext} from '../../params';
import {createOpenbbSsrmProvider,type OpenbbSsrmConfig} from '../remote/openbbSsrm';
import {createManagedTableRequest} from '../../dataClient';
import {createManagedProvider,type RemoteProviderConfig} from '../remote/managedProvider';
import {createRustExecutor} from './runtime';
import {ProviderContractError,capabilityPreflight,localCapabilities} from './providerCapabilities';
export type TableEngine='typescript'|'rust';
export type TableProviderOptions={workerFactory?:()=>Worker};
/** Rollout override is explicit and development-only; release defaults await device acceptance. */
export function resolveTableEngine():TableEngine{
 const override=import.meta.env.DEV?import.meta.env.VITE_TABLE_ENGINE:undefined;
 if(override===undefined||override==='')return 'typescript';
 if(override==='typescript'||override==='rust')return override;
 throw new ProviderContractError({code:'INVALID_REQUEST',message:'Invalid table engine override'});
}
/** Acquisition-capable local facade. Snapshot-bound common providers use providerContract.ts. */
export function createTableProvider(widgetId:string,engine:TableEngine,options:TableProviderOptions={}):LocalWorkerExecutor{
 if(engine!=='typescript'&&engine!=='rust')throw new ProviderContractError({code:'INVALID_REQUEST',message:'Invalid table engine'});
 // Both worker entry points capture the host locale; there is no locale option until a configurable transport exists.
 const executor=engine==='rust'?createRustExecutor(widgetId,options.workerFactory):createWorkerExecutor(widgetId,options.workerFactory);
 if(engine==='rust'){
  const capabilities=localCapabilities(),apply=executor.applyModel.bind(executor),preview=executor.previewDefinition?.bind(executor);
  executor.applyModel=async(...args)=>{capabilityPreflight(capabilities,args[0],args[1],args[7]);return apply(...args);};
  if(preview)executor.previewDefinition=async(...args)=>{capabilityPreflight(capabilities,args[1],{kind:'none'});return preview(...args);};
 }
 return executor;
}

/** The standard table_ssrm adapter supplies a saved opaque source to this provider. */
export function createManagedTableProvider(backend:BackendConfig,options:Omit<RemoteProviderConfig,'baseUrl'|'request'>={}):ExecutionProvider {
 return createManagedProvider({...options,baseUrl:backend.baseUrl,request:createManagedTableRequest(backend)});
}

/** Ordinary OpenBB SSRM uses the configured widget endpoint and existing parameter/auth conventions. */
export function createOpenbbTableProvider(backend:BackendConfig,widget:WidgetDef,params:Record<string,string>,options:Omit<OpenbbSsrmConfig,'baseUrl'|'endpoint'|'params'|'request'>,context?:WireContext):ExecutionProvider {
 return createOpenbbSsrmProvider({...options,baseUrl:backend.baseUrl,endpoint:widget.endpoint,params:sendParams(widget,params,context),request:createManagedTableRequest(backend)});
}
