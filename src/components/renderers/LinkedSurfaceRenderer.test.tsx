// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {act,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,expect,it,vi} from "vitest";
vi.mock("./ChartRenderer",()=>({ChartRenderer:({data}:{data:unknown})=><pre data-testid="surface-figure">{JSON.stringify(data)}</pre>}));
import type {DashboardCard} from "../../lib/types";
import {card,widget} from "../../test/fixtures";
import {__reset} from "../../test/memfs";
import {__resetJsonStoreForTests} from "../../lib/jsonStore";
import {BUILTIN_BACKEND_ID,BUILTIN_WIDGETS} from "../../lib/builtins";
import {useDashboardStore} from "../../stores/dashboardStore";
import {useWidgetRegistryStore} from "../../stores/widgetRegistryStore";
import {acquireLinkedSource,useLinkedSourcesStore,type LinkedSourcePublication} from "../../stores/linkedSourcesStore";
import {LinkedSurfaceRenderer} from "./LinkedSurfaceRenderer";
const linked=card({id:"chart",widgetId:"linked_chart",backendId:BUILTIN_BACKEND_ID,linkedSource:{kind:"widget",sourceWidgetId:"b"},linkedChart:{type:"surface",display:"grouped",category:"strike",measures:["1M","3M"]}});
const ready:LinkedSourcePublication={status:"ready",generation:1,queryKey:"EURUSD",title:"FX",stale:false,data:{columns:[{id:"strike",label:"Strike",dtype:"number"},{id:"1M",label:"1M",dtype:"number"},{id:"3M",label:"3M",dtype:"number"}],rows:[{strike:90,"1M":10,"3M":20},{strike:100,"1M":11,"3M":21}]}};
function Driver(){const c=useDashboardStore(s=>s.dashboards[0].tabs[0].cards.find(c=>c.id==="chart")!);return <LinkedSurfaceRenderer dashboardId="d" card={c}/>;}
beforeEach(()=>{__reset();__resetJsonStoreForTests();useLinkedSourcesStore.setState({sources:new Map()});useWidgetRegistryStore.setState({widgets:[...BUILTIN_WIDGETS,widget({id:"fx",type:"table"})]});useDashboardStore.setState({viewer:false,activeId:"d",activeTabId:"t",dashboards:[{id:"d",name:"FX",tabs:[{id:"t",name:"Data",cards:[card({id:"a",widgetId:"fx",title:"First"}),card({id:"b",widgetId:"fx",title:"Second"}),linked]}]}]});});
it("draws only the selected source card's published rows",()=>{
 acquireLinkedSource("d","a").publish({...ready,data:{...ready.data!,rows:[{strike:1,"1M":99,"3M":99},{strike:2,"1M":99,"3M":99}]}});acquireLinkedSource("d","b").publish(ready);render(<Driver/>);
 const figure=JSON.parse(screen.getByTestId("surface-figure").textContent!);expect(figure.data[0]).toMatchObject({type:"surface",x:[90,100],z:[[10,11],[20,21]]});expect(screen.getByLabelText("Source table")).toHaveValue("b");
});
it("withdraws a surface while its source loads or fails",()=>{
 const source=acquireLinkedSource("d","b");source.publish(ready);render(<Driver/>);act(()=>source.publish({...ready,status:"loading",generation:2}));expect(screen.queryByTestId("surface-figure")).not.toBeInTheDocument();expect(screen.getByText(/Loading source/)).toBeInTheDocument();act(()=>source.publish({...ready,status:"error",generation:2,error:"Provider unavailable"}));expect(screen.getByText(/Provider unavailable/)).toBeInTheDocument();
});
it("reports empty scope and stale un-run source edits",()=>{
 acquireLinkedSource("d","b").publish({...ready,stale:true,data:{...ready.data!,rows:[]}});render(<Driver/>);expect(screen.getByText(/source has no rows/i)).toBeInTheDocument();expect(screen.getByText(/source has unrun edits or stale data/i)).toBeInTheDocument();expect(screen.queryByTestId("surface-figure")).not.toBeInTheDocument();
});
it("does not rebind another same-widget card when the selected source is deleted",()=>{
 acquireLinkedSource("d","b").publish(ready);render(<Driver/>);act(()=>useDashboardStore.setState(s=>({dashboards:s.dashboards.map(d=>({...d,tabs:d.tabs.map(t=>({...t,cards:t.cards.filter(c=>c.id!=="b")}))}))})));expect(screen.getByLabelText("Source table")).toHaveValue("b");expect(screen.getByText(/Source unavailable/)).toBeInTheDocument();expect(screen.queryByTestId("surface-figure")).not.toBeInTheDocument();
});
it("persists measure choices and draws a line for one measure",async()=>{
 acquireLinkedSource("d","b").publish(ready);render(<Driver/>);await userEvent.click(screen.getByRole("checkbox",{name:"3M"}));await waitFor(()=>expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[2].linkedChart?.measures).toEqual(["1M"]));expect(JSON.parse(screen.getByTestId("surface-figure").textContent!).data[0]).toMatchObject({type:"scatter",x:[90,100],y:[10,11]});
});
it("lets users remove unavailable selected measures after a source schema change",async()=>{
 acquireLinkedSource("d","b").publish({...ready,data:{columns:ready.data!.columns.filter(c=>c.id!=="1M"),rows:ready.data!.rows}});render(<Driver/>);
 await userEvent.click(screen.getByRole("checkbox",{name:"Unavailable: 1M"}));await waitFor(()=>expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[2].linkedChart?.measures).toEqual(["3M"]));expect(JSON.parse(screen.getByTestId("surface-figure").textContent!).data[0].type).toBe("scatter");
});
it("lets users remove a selected measure that becomes non-numeric",async()=>{
 acquireLinkedSource("d","b").publish({...ready,data:{columns:ready.data!.columns.map(c=>c.id==="1M"?{...c,dtype:"text"}:c),rows:ready.data!.rows}});render(<Driver/>);
 await userEvent.click(screen.getByRole("checkbox",{name:"Unavailable: 1M"}));await waitFor(()=>expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[2].linkedChart?.measures).toEqual(["3M"]));expect(screen.getByTestId("surface-figure")).toBeInTheDocument();
});
it.each([{type:"surface"},{type:"surface",display:"grouped",measures:null}])("refuses malformed local settings and lets the user reset them",async bad=>{
 acquireLinkedSource("d","b").publish(ready);useDashboardStore.setState(s=>({dashboards:s.dashboards.map(d=>({...d,tabs:d.tabs.map(t=>({...t,cards:t.cards.map(c=>c.id==="chart"?Object.assign({...c},{linkedChart:bad}) as unknown as DashboardCard:c)}))}))}));
 expect(()=>render(<Driver/>)).not.toThrow();expect(screen.getByText(/Invalid chart settings/)).toBeInTheDocument();await userEvent.click(screen.getByRole("button",{name:"Reset chart fields"}));await waitFor(()=>expect(screen.getByTestId("surface-figure")).toBeInTheDocument());
});
