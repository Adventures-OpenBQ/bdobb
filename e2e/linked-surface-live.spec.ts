// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,test,type Locator,type Page} from "@playwright/test";
import {seedApp,memfs,openRail,type SeedFiles} from "./fixtures";
const api=process.env.OPENBQ_FX_API;
test.skip(!api,"Requires the isolated V3 API through its Tailscale HTTPS sidecar");
const WIDGET="cftc_fx_implied_vol_cftc_obb";
const measures=["vol_1w","vol_2w","vol_1m","vol_2m","vol_3m","vol_6m","vol_9m","vol_1y","vol_2y"];
const source=(id:string,pair="EURUSD")=>({id,widgetId:WIDGET,backendId:"live",params:{pair,basis:"empirical",min_trades:"3",use_cache:"true",provider:"cftc"},layout:{x:0,y:0,w:40,h:20}});
const linked=(sourceId:string)=>({id:"fx-chart",widgetId:"linked_chart",backendId:"builtin",params:{},layout:{x:0,y:20,w:40,h:22},linkedSource:{kind:"widget",sourceWidgetId:sourceId},linkedChart:{type:"surface",display:"grouped",category:"strike",measures}});
function files(dashboard:unknown):SeedFiles{return {"settings.json":JSON.stringify({collapseWidgetControls:false,minimizeButton:true}),"backends.json":JSON.stringify([{id:"live",name:"Release V3 API",baseUrl:api,authLocation:"header",validateWidgets:true}]),"dashboards/fx-live.json":JSON.stringify(dashboard)};}
const chart=(page:Page)=>page.locator(".widget-card").filter({has:page.locator(".linked-surface")});
async function trace(plot:Locator){return plot.evaluate(el=>(el as unknown as {data:{type:string;x:number[];z:(number|null)[][]}[]}).data[0]);}
async function readyPlot(page:Page){const plot=chart(page).locator(".chart-plot.js-plotly-plot");await expect(plot).toBeVisible({timeout:65_000});await expect.poll(async()=>(await trace(plot)).type).toBe("surface");await expect(plot.locator("canvas").first()).toBeVisible();return plot;}
async function passThrough(page:Page,calls:string[]){await page.route(`${api}/**`,async route=>{if(new URL(route.request().url()).pathname.endsWith("/cftc/fx_implied_vol"))calls.push(new URL(route.request().url()).searchParams.get("pair")??"");const response=await route.fetch({timeout:65_000,maxRetries:0});await route.fulfill({response,headers:{...response.headers(),"access-control-allow-origin":"*"}});});}

test("real FX source action, complete projection, refresh and portable persistence",async({page},info)=>{
 test.setTimeout(120_000);const calls:string[]=[];await passThrough(page,calls);
 const seed=files({id:"fx-live",name:"FX live",tabs:[{id:"fx",name:"FX",cards:[source("fx-source")]}]});await seedApp(page,seed);
 const table=page.locator(".widget-card").filter({hasText:"FX Implied Volatility"}).first();await expect(table.locator("tbody tr[data-index]").first()).toBeVisible({timeout:65_000});
 const before=calls.length;await table.getByRole("button",{name:"Card menu"}).click();await page.getByRole("menuitem",{name:"Create linked surface"}).click();
 let plot=await readyPlot(page);const original=await trace(plot);expect(original.x.length).toBeGreaterThan(2);expect(original.z.some(row=>row.some(n=>typeof n==="number" && Number.isFinite(n)))).toBe(true);expect(calls.length).toBe(before);
 await info.attach("real-fx-surface",{body:JSON.stringify({observedUtc:new Date().toISOString(),pair:"EURUSD",rows:original.x.length,strikes:original.x,series:original.z.length,finiteCells:original.z.flat().filter(n=>typeof n==="number" && Number.isFinite(n)).length,transport:"Tailscale HTTPS sidecar",independentLinkedFetches:0}),contentType:"application/json"});
 await chart(page).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath("fx-surface-live.png")});
 await table.getByRole("button",{name:"Filter rows"}).click();const min=table.getByLabel("Minimum Strike");const ordered=[...original.x].sort((a,b)=>a-b);await min.fill(String(ordered[2]));await expect.poll(async()=>(await trace(chart(page).locator(".chart-plot"))).x.length).toBe(original.x.filter(x=>x>=ordered[2]).length);
 await min.fill(String(Math.max(...original.x)+1));await expect(chart(page).getByText(/source has no rows/i)).toBeVisible();await expect(chart(page).locator(".chart-plot")).toHaveCount(0);await min.fill("");plot=await readyPlot(page);expect((await trace(plot)).x).toEqual(original.x);
 await table.getByLabel("View",{exact:true}).selectOption("raw");await readyPlot(page);await table.getByRole("button",{name:"Minimize card"}).click();await readyPlot(page);expect(calls.length).toBe(before);await table.getByRole("button",{name:"Expand card"}).click();
 const refreshed=calls.length;await chart(page).getByRole("button",{name:"Refresh",exact:true}).click();await expect.poll(()=>calls.length).toBe(refreshed+1);await readyPlot(page);
 const fs=memfs(page);await expect.poll(()=>fs.read("dashboards/fx-live.json")).toBeDefined();const written=(await fs.read("dashboards/fx-live.json"))!;expect(JSON.parse(written).tabs[0].cards[1].linkedSource.sourceWidgetId).toBe("fx-source");
 await seedApp(page,{...seed,"dashboards/fx-live.json":written});await readyPlot(page);
 await openRail(page);const row=page.locator("nav.left-rail button.rail-item",{hasText:"FX live"});await row.click({button:"right"});await page.getByRole("menuitem",{name:"Save…",exact:true}).click();await page.getByRole("menuitem",{name:"BDOBB Workspace",exact:true}).click();await expect.poll(()=>memfs(page).read("exports/FX live.apps.json")).toBeDefined();const exported=(await memfs(page).read("exports/FX live.apps.json"))!;expect(exported).not.toContain("fx-source");
 await openRail(page);await row.click({button:"right"});await page.getByRole("menuitem",{name:"Duplicate",exact:true}).click();await expect.poll(async()=>(await memfs(page).list()).filter(p=>p.startsWith("dashboards/")).length).toBe(2);
 const copiedPath=(await memfs(page).list()).find(p=>p.startsWith("dashboards/") && p!=="dashboards/fx-live.json")!;const copied=JSON.parse((await memfs(page).read(copiedPath))!);expect(copied.tabs[0].cards[1].linkedSource.sourceWidgetId).toBe(copied.tabs[0].cards[0].id);expect(copied.tabs[0].cards[0].id).not.toBe("fx-source");
 const importSeed=files({id:"fx-live",name:"Import rehearsal",tabs:[{id:"blank",name:"Blank",cards:[]}]});await seedApp(page,{...importSeed,"imports/apps.json":exported});await openRail(page);await page.locator("nav.left-rail [data-testid='rail-section-label']",{hasText:"My Dashboards"}).click({button:"right"});await page.getByRole("menuitem",{name:"Import apps.json…"}).click();await readyPlot(page);await expect(chart(page).getByLabel("Source table")).not.toHaveValue("fx-source");await page.unrouteAll({behavior:"ignoreErrors"});
});

test("real selected source stays live on an inactive tab without fetching its sibling",async({page},info)=>{
 test.setTimeout(90_000);const calls:string[]=[];await passThrough(page,calls);
 await seedApp(page,files({id:"fx-live",name:"FX two instances",tabs:[{id:"charts",name:"Charts",cards:[{...linked("second"),layout:{x:0,y:0,w:40,h:24}}]},{id:"sources",name:"Sources",cards:[source("first","EURUSD"),{...source("second","GBPUSD"),layout:{x:0,y:20,w:40,h:20}}]}]}));
 const plot=await readyPlot(page);expect(calls.length).toBeGreaterThan(0);expect(calls.every(pair=>pair==="GBPUSD")).toBe(true);expect((await trace(plot)).z.flat().some(n=>typeof n==="number" && Number.isFinite(n))).toBe(true);const before=calls.length;await chart(page).getByRole("button",{name:"Refresh",exact:true}).click();await expect.poll(()=>calls.length).toBe(before+1);await readyPlot(page);await page.screenshot({path:info.outputPath("fx-inactive-source.png")});await page.unrouteAll({behavior:"ignoreErrors"});
});
for(const theme of ["dark","light"] as const)test(`${theme} real FX surface remains interactive`,async({page},info)=>{
 test.setTimeout(90_000);const calls:string[]=[];await passThrough(page,calls);
 const seed=files({id:"fx-live",name:"FX surface",tabs:[{id:"chart",name:"FX surface",cards:[{...linked("live-source"),layout:{x:0,y:0,w:40,h:20}}]},{id:"source",name:"Source table",cards:[source("live-source")]}]});seed["settings.json"]=JSON.stringify({theme,collapseWidgetControls:false,minimizeButton:true});await seedApp(page,seed);
 const plot=await readyPlot(page);await expect.poll(()=>plot.evaluate(el=>(el as unknown as {_fullLayout:{paper_bgcolor:string}})._fullLayout.paper_bgcolor)).toBe(theme==="dark"?"#1e242e":"#ffffff");await chart(page).screenshot({path:info.outputPath(`fx-surface-${theme}.png`)});
 // Plotly's turntable initializer writes a 500ms future camera keyframe.
 // Gestures before that transition finishes are discarded by its controller.
 // Wait for the real controller timeline, not an arbitrary screenshot delay.
 await expect.poll(()=>plot.evaluate(el=>(el as unknown as {_fullLayout:{scene:{_scene:{camera:{view:{lastT:()=>number}}}}}})._fullLayout.scene._scene.camera.view.lastT()<=performance.now())).toBe(true);
 const camera=()=>plot.evaluate(el=>JSON.stringify((el as unknown as {_fullLayout:{scene:{_scene:{getCamera:()=>unknown}}}})._fullLayout.scene._scene.getCamera()));const before=await camera();const box=(await plot.boundingBox())!;await page.mouse.move(box.x+box.width*.35,box.y+box.height*.55);await page.mouse.down();await page.mouse.move(box.x+box.width*.35+70,box.y+box.height*.55+30,{steps:12});await page.mouse.up();await expect.poll(camera).not.toBe(before);await page.unrouteAll({behavior:"ignoreErrors"});
});
