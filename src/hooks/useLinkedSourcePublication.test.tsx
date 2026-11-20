// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {renderHook} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
import {linkedSourceKey,useLinkedSourcesStore} from "../stores/linkedSourcesStore";
import {useLinkedSourcePublication,type SourceAcquisition} from "./useLinkedSourcePublication";
const read=()=>useLinkedSourcesStore.getState().sources.get(linkedSourceKey("d","c"))?.publication;
const ready:SourceAcquisition={status:"ready",data:[{x:2},{x:1}],error:undefined,responseCurrent:true,acquisition:{},queryKey:"q",stale:false,dataStale:false,retry:vi.fn()};
beforeEach(()=>useLinkedSourcesStore.setState({sources:new Map()}));
it("publishes the full source projection without a renderer or independent fetch",()=>{
 const {unmount}=renderHook(()=>useLinkedSourcePublication({dashboardId:"d",cardId:"c",title:"FX",enabled:true,acquisition:ready,tableState:{sorting:[{id:"x",desc:false}]},spec:{columns:[{field:"x",cellDataType:"number"}]}}));
 expect(read()?.data?.rows).toEqual([{x:1},{x:2}]);expect(read()?.refresh).toBe(ready.retry);unmount();expect(read()).toBeUndefined();
});
it("withdraws old rows for a new acquisition before the loading effect runs",()=>{
 const {rerender}=renderHook(({acquisition})=>useLinkedSourcePublication({dashboardId:"d",cardId:"c",title:"FX",enabled:true,acquisition}),{initialProps:{acquisition:ready}});
 const generation=read()!.generation;
 rerender({acquisition:{...ready,acquisition:{},queryKey:"q2",responseCurrent:false}});
 expect(read()?.status).toBe("loading");expect(read()?.data).toBeUndefined();expect(read()!.generation).toBeGreaterThan(generation);
});
it("reports errors, valid empty results and stale un-run edits explicitly",()=>{
 const {rerender}=renderHook(({acquisition})=>useLinkedSourcePublication({dashboardId:"d",cardId:"c",title:"FX",enabled:true,acquisition}),{initialProps:{acquisition:ready}});
 rerender({acquisition:{...ready,status:"error",error:"Provider unavailable"}});expect(read()?.error).toBe("Provider unavailable");expect(read()?.data).toBeUndefined();
 rerender({acquisition:{...ready,data:[],stale:true}});expect(read()?.status).toBe("ready");expect(read()?.data?.rows).toEqual([]);expect(read()?.stale).toBe(true);
});
it("does not register or project unreferenced sources",()=>{
 renderHook(()=>useLinkedSourcePublication({dashboardId:"d",cardId:"c",title:"FX",enabled:false,acquisition:ready}));expect(read()).toBeUndefined();
});
