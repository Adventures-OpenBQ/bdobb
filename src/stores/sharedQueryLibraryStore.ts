// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {create} from 'zustand';
import type {TemporalClient} from '../lib/temporal/client';
import type {QueryDefinition,ImportReport,QueryExport} from '../lib/temporal/contracts';
type State={entries:QueryDefinition[];scope:string|null;status:'idle'|'loading'|'ready'|'saving'|'error';stale:boolean;error:string|null;clear:()=>void;load:(scope:string,client:TemporalClient)=>Promise<void>;save:(client:TemporalClient,definition:QueryDefinition,expectedRevision?:number)=>Promise<QueryDefinition>;importEntries:(client:TemporalClient,entries:unknown[])=>Promise<ImportReport>;exportQuery:(client:TemporalClient,id:string,revision?:number)=>Promise<QueryExport>};
/** Server library is authoritative. No privileged definitions/results go to disk. */
export function createSharedQueryLibraryStore(){return create<State>((set,get)=>{
 let generation=0;
 async function mutate<T>(work:()=>Promise<T>):Promise<T>{const version=generation;set({status:'saving',error:null});try{const value=await work();if(version!==generation)throw new Error('TemporalDB scope changed; reload the library');set({status:'ready'});return value;}catch(e){if(version===generation)set({status:'error',stale:true,error:e instanceof Error?e.message:'Library request failed'});throw e;}}
 return {entries:[],scope:null,status:'idle',error:null,stale:false,
  clear(){generation++;set({entries:[],scope:null,status:'idle',error:null,stale:false});},
  async load(scope,client){if(get().scope!==scope){generation++;set({entries:[],scope,stale:false});}const version=++generation;set({status:'loading',error:null});try{const entries=await client.list();if(generation===version)set({entries,status:'ready',stale:false});}catch(e){if(generation===version||get().scope===null&&typeof e==='object'&&e!==null&&'code' in e&&e.code==='ACCESS_DENIED')set({status:'error',error:e instanceof Error?e.message:'Library unavailable',stale:get().entries.length>0});}},
  save:(client,definition,expectedRevision)=>mutate(async()=>{
   const version=generation;const saved=expectedRevision===undefined?await client.create(definition):await client.revise(definition.query_id,expectedRevision,definition);
   if(version===generation)set({entries:[...get().entries.filter(q=>q.query_id!==saved.query_id),saved]});return saved;
  }),
  importEntries:(client,entries)=>mutate(()=>client.importEntries(entries)),
  exportQuery:(client,id,revision)=>mutate(()=>client.exportQuery(id,revision)),
 };
});}
export const useSharedQueryLibraryStore=createSharedQueryLibraryStore();
