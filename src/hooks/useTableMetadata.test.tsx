// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act,renderHook,waitFor } from '@testing-library/react';
import { expect,it } from 'vitest';
import { useTableMetadata } from './useTableMetadata';
import { createTableExecutionStore } from '../stores/tableExecutionStore';
import { createWorkerExecutor } from '../lib/tableExecution/workerClient';
import { Boundary } from '../test/tableWorkerBoundary';
import { input } from '../lib/tableExecution/fixtures';
import type { InspectionResult,FacetResult } from '../lib/tableExecution/types';
import type { Dashboard } from '../lib/types';
async function setup(){
 const store=createTableExecutionStore({executor:id=>createWorkerExecutor(id,()=>new Boundary() as unknown as Worker),source:()=>({acquire:async()=>({kind:'dataset',dataset:structuredClone(input)})})});
 store.syncDashboard({id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'x'},layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard);
 store.ensureTable('d','w');await store.settled('d');return store;
}
it('reads complete engine facets on demand and ignores held inspection after revision changes',async()=>{
 const store=await setup();const active=store.readView('d','w').active!;
 const hook=renderHook(({revision})=>useTableMetadata('d','w',revision,store),{initialProps:{revision:active}});
 expect(hook.result.current.inspection).toBeUndefined();
 act(()=>hook.result.current.requestFacet('region'));
 await waitFor(()=>expect(hook.result.current.facet?.values).toEqual({A:2,B:1}));
 const executor=store.readExecutor('d','w')!;const inspect=executor.inspect!.bind(executor);let release!:()=>void;let signal!:AbortSignal;
 executor.inspect=async(...args)=>{signal=args[2];const result=await inspect(...args);return new Promise<InspectionResult>(r=>{release=()=>r(result);});};
 act(()=>hook.result.current.requestInspection({collection:'definitions',offset:0,limit:20}));
 await waitFor(()=>expect(release).toBeDefined());
 await act(async()=>{store.updateDefinition('d','w',{table:{},search:'A'},{kind:'none'});await store.settled('d');});
 hook.rerender({revision:store.readView('d','w').active!});
 expect(signal.aborted).toBe(true);
 await act(async()=>release());
 expect(hook.result.current.inspection).toBeUndefined();
 expect(hook.result.current.facet).toBeUndefined();
 hook.unmount();store.disposeDashboard('d');
});

for (const [facetFails, inspectionFails] of [[false,false],[false,true],[true,false],[true,true]]) {
 it(`clears pending when concurrent facet/inspection reads settle together (${facetFails}/${inspectionFails})`,async()=>{
  const store=await setup(), revision=store.readView('d','w').active!, executor=store.readExecutor('d','w')!;
  const signal=new AbortController().signal;
  const facet=await executor.facets(revision,'region',signal);
  const inspection=await executor.inspect!(revision,{collection:'definitions',offset:0,limit:20},signal);
  let resolveFacet!:(value:FacetResult)=>void,rejectFacet!:(reason:Error)=>void;
  let resolveInspection!:(value:InspectionResult)=>void,rejectInspection!:(reason:Error)=>void;
  executor.facets=()=>new Promise((resolve,reject)=>{resolveFacet=resolve;rejectFacet=reject;});
  executor.inspect=()=>new Promise((resolve,reject)=>{resolveInspection=resolve;rejectInspection=reject;});
  const hook=renderHook(()=>useTableMetadata('d','w',revision,store));
  act(()=>{hook.result.current.requestFacet('region');hook.result.current.requestInspection({collection:'definitions',offset:0,limit:20});});
  expect(hook.result.current.pending).toBe(true);
  await act(async()=>{
   if(facetFails)rejectFacet(new Error('facet transport'));else resolveFacet(facet);
   if(inspectionFails)rejectInspection(new Error('inspection transport'));else resolveInspection(inspection);
  });
  expect(hook.result.current.pending).toBe(false);
  if(!facetFails)expect(hook.result.current.facet).toEqual(facet);
  if(!inspectionFails)expect(hook.result.current.inspection).toEqual(inspection);
  hook.unmount();store.disposeDashboard('d');
 });
}
it('an aborted superseded read cannot settle the newer request pending state',async()=>{
 const store=await setup(),revision=store.readView('d','w').active!,executor=store.readExecutor('d','w')!;
 const value=await executor.inspect!(revision,{collection:'definitions',offset:0,limit:20},new AbortController().signal);
 const held:{signal:AbortSignal;resolve:(value:InspectionResult)=>void;reject:(reason:Error)=>void}[]=[];
 executor.inspect=(_r,_request,signal)=>new Promise((resolve,reject)=>held.push({signal,resolve,reject}));
 const hook=renderHook(()=>useTableMetadata('d','w',revision,store));
 act(()=>hook.result.current.requestInspection({collection:'definitions',offset:0,limit:20}));
 act(()=>hook.result.current.requestInspection({collection:'definitions',offset:0,limit:20}));
 expect(held[0].signal.aborted).toBe(true);
 await act(async()=>held[0].reject(new Error('obsolete rejection')));
 expect(hook.result.current.pending).toBe(true);expect(hook.result.current.error).toBeUndefined();
 await act(async()=>held[1].resolve(value));
 expect(hook.result.current.pending).toBe(false);expect(hook.result.current.inspection).toEqual(value);
 hook.unmount();store.disposeDashboard('d');
});
it('independent Page facets survive footer and Inspector reads and ignore a superseded category delivery',async()=>{
 const store=await setup(),revision=store.readView('d','w').active!,executor=store.readExecutor('d','w')!;const value=await executor.facets(revision,'region',new AbortController().signal);const held:{categoryId:string;signal:AbortSignal;resolve:(value:FacetResult)=>void}[]=[];executor.facets=(_revision,categoryId,signal)=>new Promise(resolve=>held.push({categoryId,signal,resolve}));const page=renderHook(()=>useTableMetadata('d','w',revision,store));const footer=renderHook(()=>useTableMetadata('d','w',revision,store));act(()=>{page.result.current.requestFacet('region');footer.result.current.requestFacet('revenue');page.result.current.requestFacet('date');});expect(held[0].signal.aborted).toBe(true);expect(held[1].signal.aborted).toBe(false);await act(async()=>{held[2].resolve({...value,categoryId:'date'});held[1].resolve({...value,categoryId:'revenue'});held[0].resolve(value);});expect(page.result.current.facet?.categoryId).toBe('date');expect(footer.result.current.facet?.categoryId).toBe('revenue');page.unmount();footer.unmount();store.disposeDashboard('d');
});
