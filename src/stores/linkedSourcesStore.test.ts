// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {beforeEach,expect,it} from "vitest";
import {acquireLinkedSource,useLinkedSourcesStore,type LinkedSourcePublication} from "./linkedSourcesStore";
const snapshot=(n:number):LinkedSourcePublication=>({status:"ready",generation:n,queryKey:`q${n}`,title:"FX",stale:false,data:{columns:[{id:"x",label:"X"}],rows:[{x:n}]}});
beforeEach(()=>useLinkedSourcesStore.setState({sources:new Map()}));
it("isolates two card instances and dashboard owners",()=>{
  const a=acquireLinkedSource("d1","c1"),b=acquireLinkedSource("d1","c2"),c=acquireLinkedSource("d2","c1");
  a.publish(snapshot(1));b.publish(snapshot(2));c.publish(snapshot(3));
  expect(a.read()?.data?.rows[0].x).toBe(1);expect(b.read()?.data?.rows[0].x).toBe(2);expect(c.read()?.data?.rows[0].x).toBe(3);
  a.dispose();expect(a.read()).toBeUndefined();expect(b.read()?.data?.rows[0].x).toBe(2);
});
it("old publishers cannot overwrite or dispose a replacement owner",()=>{
  const old=acquireLinkedSource("d","c"),current=acquireLinkedSource("d","c");current.publish(snapshot(5));
  old.publish(snapshot(9));old.dispose();expect(current.read()?.generation).toBe(5);
});
it("rejects obsolete acquisitions and publishes empty/error state explicitly",()=>{
  const source=acquireLinkedSource("d","c");source.publish(snapshot(4));source.publish(snapshot(3));expect(source.read()?.generation).toBe(4);
  source.publish({...snapshot(5),data:{columns:[],rows:[]}});expect(source.read()?.data?.rows).toEqual([]);
  source.publish({...snapshot(6),status:"error",data:undefined,error:"Provider unavailable"});expect(source.read()?.status).toBe("error");expect(source.read()?.data).toBeUndefined();
});
