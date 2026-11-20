// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {beforeEach,expect,it} from "vitest";
import {card,widget} from "../test/fixtures";
import {__reset} from "../test/memfs";
import {__resetJsonStoreForTests} from "../lib/jsonStore";
import {BUILTIN_BACKEND_ID,BUILTIN_WIDGETS,fetchesData} from "../lib/builtins";
import {useWidgetRegistryStore} from "./widgetRegistryStore";
import {useDashboardStore} from "./dashboardStore";
const settings={type:"surface" as const,display:"grouped" as const,category:"strike",measures:["1M","3M"]};
beforeEach(()=>{
 __reset();__resetJsonStoreForTests();
 useWidgetRegistryStore.setState({widgets:[...BUILTIN_WIDGETS,widget({id:"fx",type:"table"})]});
 useDashboardStore.setState({viewer:false,activeId:"d",activeTabId:"t",dashboards:[{id:"d",name:"FX",tabs:[{id:"t",name:"Data",cards:[card({id:"source",widgetId:"fx"})]}]}]});
});
it("creates one persisted linked surface tied to the specific source card",async()=>{
 const id=await useDashboardStore.getState().addLinkedSurface("source",settings);const dashboard=useDashboardStore.getState().dashboards[0];const linked=dashboard.tabs[0].cards.find(c=>c.id===id)!;
 expect(linked).toMatchObject({widgetId:"linked_chart",backendId:BUILTIN_BACKEND_ID,params:{},linkedSource:{kind:"widget",sourceWidgetId:"source"},linkedChart:settings});expect(dashboard.revision).toBe(1);
 const builtin=BUILTIN_WIDGETS.find(w=>w.id==="linked_chart")!;expect(builtin).toBeDefined();expect(fetchesData(builtin)).toBe(false);
});
it("refuses absent sources and viewer mutations",async()=>{
 expect(await useDashboardStore.getState().addLinkedSurface("absent",settings)).toBeNull();useDashboardStore.setState({viewer:true});expect(await useDashboardStore.getState().addLinkedSurface("source",settings)).toBeNull();expect(useDashboardStore.getState().dashboards[0].tabs[0].cards).toHaveLength(1);
});
