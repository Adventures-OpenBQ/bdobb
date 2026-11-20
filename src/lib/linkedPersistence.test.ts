// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {beforeEach,expect,it} from "vitest";
import {card} from "../test/fixtures";
import type {Dashboard} from "./types";
import {decodeV3CardExtension} from "./appsExtensionsV3";
import {saveDashboard,loadDashboards} from "./dashboardsFile";
import {exportCompatibleApp,importApps} from "./appsJson";
import {fromWorkspace,toWorkspace} from "./workspaceDashboards";
import {useDashboardStore} from "../stores/dashboardStore";
import {__reset} from "../test/memfs";
import {__resetJsonStoreForTests} from "./jsonStore";
const settings={type:"surface" as const,category:"strike",measures:["1M","3M"],display:"grouped" as const};
function fixture():Dashboard{return {id:"private-dashboard-id",name:"FX",tabs:[
 {id:"t1",name:"Source",cards:[card({id:"private-source-a",widgetId:"fx"}),card({id:"private-source-b",widgetId:"fx"})]},
 {id:"t2",name:"Chart",cards:[Object.assign(card({id:"private-linked",widgetId:"linked_chart"}),{linkedSource:{kind:"widget" as const,sourceWidgetId:"private-source-b"},linkedChart:settings})]},
]};}
function verify(d:Dashboard){const source=d.tabs[0].cards[1],linked=d.tabs[1].cards[0];expect(linked.linkedSource).toEqual({kind:"widget",sourceWidgetId:source.id});expect(linked.linkedChart).toEqual(settings);expect(source.id).not.toBe("private-source-b");expect(linked.id).not.toBe("private-linked");}
beforeEach(()=>{__reset();__resetJsonStoreForTests();useDashboardStore.setState({dashboards:[],viewer:false});});
it("remaps compatible app references across tabs and repeated widget definitions",()=>{
 const result=exportCompatibleApp(fixture());expect(result.ok).toBe(true);if(!result.ok)throw Error(result.issue.message);
 const text=JSON.stringify(result.value);expect(text).not.toContain("private-source");expect(text).not.toContain("private-linked");
 verify(importApps([result.value],[]).dashboards[0]);verify(importApps([result.value],[]).dashboards[0]);
});
it.each(["app","dashboard"] as const)("remaps Workspace %s references over repeated round trips",store=>{
 let d=fixture();for(let i=0;i<2;i++){const wire=toWorkspace(d,store);d=fromWorkspace(wire,store,[]);verify(d);}
});
it("duplicates sources and charts together without linking back to the original dashboard",async()=>{
 const d=fixture();useDashboardStore.setState({dashboards:[d]});const id=await useDashboardStore.getState().duplicateDashboard(d.id);const copy=useDashboardStore.getState().dashboards.find(x=>x.id===id)!;verify(copy);expect(d.tabs[1].cards[0].linkedSource?.sourceWidgetId).toBe("private-source-b");
});
it("refuses portable export when the source is outside the dashboard",()=>{
 const d=fixture();d.tabs[0].cards.pop();expect(exportCompatibleApp(d).ok).toBe(false);expect(()=>toWorkspace(d,"app")).toThrow(/source/i);
});
it.each(["missing","duplicate","linked-target"] as const)("refuses %s transport references instead of rebinding another widget",kind=>{
 const result=exportCompatibleApp(fixture());if(!result.ok)throw Error(result.issue.message);
 const first=result.value.tabs.t1.layout[0].state!.extensions!.bdobb as Record<string,unknown>;
 const second=result.value.tabs.t1.layout[1].state!.extensions!.bdobb as Record<string,unknown>;
 const chart=result.value.tabs.t2.layout[0].state!.extensions!.bdobb as Record<string,unknown>;
 if(kind==="missing")chart.sourceRef="absent";
 if(kind==="duplicate")second.instanceId=first.instanceId;
 if(kind==="linked-target")chart.sourceRef=chart.instanceId;
 expect(()=>importApps([result.value],[])).toThrow(/reference|source/i);
});

it.each([
 {type:"surface",display:"grouped",measures:["1M","1M"]},
 {type:"surface",display:"grouped",measures:["1M"],rows:[{private:1}]},
 {type:"surface",display:"stacked",measures:["1M"]},
 {type:"bar",display:"grouped",measures:["1M"]},
 {type:"surface",display:"grouped",measures:Array.from({length:65},(_,n)=>String(n))},
 JSON.parse('{"type":"surface","display":"grouped","measures":[],"__proto__":{}}'),
])("refuses unsupported or runtime-only chart state",linkedChart=>{
 expect(decodeV3CardExtension({schemaVersion:1,profile:"v3",linkedChart},"$").ok).toBe(false);
});
it("persists local source intent without replacing its local identities",async()=>{
 await saveDashboard(fixture());const [restored]=await loadDashboards();
 expect(restored.tabs[1].cards[0].linkedSource?.sourceWidgetId).toBe(restored.tabs[0].cards[1].id);
 expect(restored.tabs[1].cards[0].linkedChart).toEqual(settings);
});
it("can copy a dashboard with malformed legacy chart settings for explicit repair",async()=>{
 const d=fixture();d.tabs[1].cards[0].linkedChart=JSON.parse('{"type":"surface","display":"grouped","measures":null}');useDashboardStore.setState({dashboards:[d]});
 await expect(useDashboardStore.getState().duplicateDashboard(d.id)).resolves.not.toBeNull();
});
