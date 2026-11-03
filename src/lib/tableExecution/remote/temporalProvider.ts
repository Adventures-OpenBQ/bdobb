// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type {BackendConfig} from '../../types';
import {isRecord,isUuid} from '../../temporal/contracts';
import type {ExecutionProvider,ProviderSession} from '../types';
import {createManagedProvider} from './managedProvider';
import {createSourceClient} from './sourceClient';
import {createManagedTableRequest} from '../../dataClient';
export type TemporalProviderConfig={tableBackend:BackendConfig;temporalBackendId:string;executionId:string;resultHash:string;request?:typeof globalThis.fetch};
/** Retained source import happens on the server. Browser traffic carries only opaque identities. */
export function createTemporalTableProvider(config:TemporalProviderConfig):ExecutionProvider {
 if(!isUuid(config.executionId)||!/^[a-f0-9]{64}$/.test(config.resultHash)||!config.temporalBackendId||config.temporalBackendId.length>128)throw new Error('Invalid temporal source identity');
 const request=config.request??createManagedTableRequest(config.tableBackend);
 const catalog=createSourceClient(config.tableBackend,{request});
 const managed=createManagedProvider({baseUrl:config.tableBackend.baseUrl,request});
 return {async open(source,options):Promise<ProviderSession>{
  if(source.kind!=='remote'||source.sourceId!==config.executionId||source.snapshotId!==config.resultHash)throw new Error('Temporal source identity mismatch');
  options.signal?.throwIfAborted();
  const admitted=await catalog.registerBackend({backendId:config.temporalBackendId,widgetId:'temporal_execution',params:{execution_id:config.executionId,expected_hash:config.resultHash}},options.signal);
  const retire=()=>{void catalog.deleteSource(admitted.sourceId).catch(()=>{/* Scope revocation can prevent catalog cleanup; its quotas still apply. */});};
  let session:ProviderSession|undefined;
  try{
   options.signal?.throwIfAborted();session=await managed.open({...source,sourceId:admitted.sourceId,snapshotId:''},options);
   const proof=session.sourceReceipt;
   if(!isRecord(proof)||proof.executionId!==config.executionId||proof.resultHash!==config.resultHash)throw new Error('Managed temporal source receipt mismatch');
   options.signal?.throwIfAborted();const retained=session;let disposed=false;
   return Object.freeze({...retained,get sourceSnapshotId(){return retained.sourceSnapshotId;},result:{...retained.result,dispose(){if(disposed)return;disposed=true;try{retained.result.dispose();}finally{retire();}}}});
  }catch(error){session?.result.dispose();retire();throw error;}
 }};
}
