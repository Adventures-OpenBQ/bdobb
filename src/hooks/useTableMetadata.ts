// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Revision, InspectionRequest, InspectionResult, FacetResult } from '../lib/tableExecution/types';
import { tableExecutionStore } from '../stores/tableExecutionStore';
const key=(revision:Revision|undefined)=>JSON.stringify(revision);
type Delivery={identity:string;inspection?:InspectionResult;facet?:FacetResult;error?:string;pending:boolean};
/** One inspection page and one engine facet, requested on demand and fenced to the displayed revision. */
export function useTableMetadata(dashboardId:string,widgetId:string,revision:Revision|undefined,store=tableExecutionStore) {
  const identity=JSON.stringify([dashboardId,widgetId,revision]);
  const [delivery,setDelivery]=useState<Delivery>();
  const reads=useRef(new Map<string,AbortController>());
  useEffect(()=>{const pending=reads.current;return()=>{for(const controller of pending.values()) controller.abort();pending.clear();};},[identity]);
  const read=useCallback((kind:'facet'|'inspection',request:InspectionRequest|string)=>{
    const executor=store.readExecutor(dashboardId,widgetId);
    if(!revision||!executor||key(store.readView(dashboardId,widgetId).active)!==key(revision)) return;
    reads.current.get(kind)?.abort();
    const controller=new AbortController();reads.current.set(kind,controller);
    setDelivery(old=>({...(old?.identity===identity?old:{identity}),pending:true,error:undefined}));
    const operation=kind==='facet'?executor.facets(revision,request as string,controller.signal):executor.inspect?.(revision,request as InspectionRequest,controller.signal);
    if(!operation){reads.current.delete(kind);setDelivery(old=>({...old!,pending:reads.current.size>0,error:'Inspection unavailable.'}));return;}
    void operation.then(result=>{
      if(controller.signal.aborted||key(result.revision)!==key(revision)||key(store.readView(dashboardId,widgetId).active)!==key(revision)) return;
      setDelivery(old=>({...(old?.identity===identity?old:{identity}),[kind]:result,error:undefined,pending:true}));
    }).catch(()=>{if(!controller.signal.aborted && key(store.readView(dashboardId,widgetId).active)===key(revision))setDelivery(old=>({...(old?.identity===identity?old:{identity}),error:'Could not load table metadata; try again.',pending:true}));})
      .finally(()=>{
        if(reads.current.get(kind)!==controller)return;
        reads.current.delete(kind);
        if(controller.signal.aborted || key(store.readView(dashboardId,widgetId).active)!==key(revision))return;
        const pending=reads.current.size>0;
        setDelivery(old=>old?.identity===identity?{...old,pending}:old);
      });
  },[dashboardId,widgetId,revision,identity,store]);
  const requestFacet=useCallback((id:string)=>read('facet',id),[read]);
  const requestInspection=useCallback((request:InspectionRequest)=>read('inspection',request),[read]);
  const current=delivery?.identity===identity?delivery:undefined;
  return {inspection:current?.inspection,facet:current?.facet,pending:current?.pending??false,error:current?.error,requestFacet,requestInspection};
}
