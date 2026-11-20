// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useEffect,useRef} from "react";
import type {TableCardState,TableSpec} from "../lib/types";
import {acquireLinkedSource} from "../stores/linkedSourcesStore";
import {useTableProjection} from "./useTableProjection";
import type {useWidgetData} from "./useWidgetData";
export type SourceAcquisition=Pick<ReturnType<typeof useWidgetData>,"status"|"data"|"error"|"responseCurrent"|"acquisition"|"queryKey"|"stale"|"dataStale"|"retry">;
type Inputs={dashboardId:string;cardId:string;title:string;enabled:boolean;acquisition:SourceAcquisition;spec?:TableSpec;tableState?:TableCardState};

/** Runtime-only ownership: source view switches do not create another fetch. */
export function useLinkedSourcePublication({dashboardId,cardId,title,enabled,acquisition:state,spec,tableState}:Inputs){
  const {status,data,error,responseCurrent,acquisition,queryKey,stale,dataStale,retry}=state;
  const dataset=useTableProjection(data,spec,tableState,enabled && responseCurrent && status==="ready");
  const lease=useRef<ReturnType<typeof acquireLinkedSource>|null>(null);
  const generation=useRef<{token:object|null;number:number}>({token:null,number:0});
  useEffect(()=>{
    if(!enabled)return;
    const owner=acquireLinkedSource(dashboardId,cardId);lease.current=owner;
    generation.current={token:null,number:0};
    return ()=>{owner.dispose();if(lease.current===owner)lease.current=null;};
  },[enabled,dashboardId,cardId]);
  useEffect(()=>{
    if(!enabled || !lease.current)return;
    if(generation.current.token!==acquisition){
      generation.current={token:acquisition,number:generation.current.number+1};
    }
    const currentStatus=!responseCurrent && (status==="ready" || status==="error")?"loading":status;
    lease.current.publish({status:currentStatus,generation:generation.current.number,queryKey,title,stale:stale||dataStale,
      data:currentStatus==="ready"?dataset:undefined,error:currentStatus==="error"?error:undefined,refresh:retry});
  },[enabled,dashboardId,cardId,title,status,error,responseCurrent,acquisition,queryKey,stale,dataStale,retry,dataset]);
}
