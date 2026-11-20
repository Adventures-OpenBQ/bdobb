// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in exact-ID diagnostics over actual responses. Captured refresh/reload is
// renderer/persistence proof, never a second live provider success.
import {createHash} from "node:crypto";
import {readFileSync,mkdirSync,writeFileSync,existsSync} from "node:fs";
import {join,dirname,resolve} from "node:path";
import {expect,test} from "@playwright/test";
import {normalizeWidgets} from "../src/lib/widgetsJson";
import {seedParams} from "../src/lib/params";
import {tableColumns,tableRows} from "../src/lib/tableColumns";
import {formatCell} from "../src/lib/format";
import {titleCase} from "../src/lib/columnRender";
import {seedApp,memfs} from "./fixtures";

type Evidence={path:string;lane:string;status:string;parameters:Record<string,unknown>;observed_request_query:Record<string,unknown>};
type Entry={id:string;widget_type:string;endpoint:string;selected_backend_evidence:Evidence;all_backend_evidence:Evidence[];valid_parameters:{latest_reader_override:Record<string,unknown>}};
const cataloguePath=process.env.OPENBQ_RENDER_CATALOGUE;
const evidencePath=process.env.OPENBQ_RENDER_EVIDENCE;
const output=process.env.OPENBQ_RENDER_OUTPUT;
const reader=process.env.OPENBQ_READER_API;
const registered=process.env.OPENBQ_REGISTERED_API;
const catalogue=cataloguePath?JSON.parse(readFileSync(cataloguePath,"utf8")):{};
const corpus=normalizeWidgets(catalogue,"qualification");
const entries:Entry[]=evidencePath?JSON.parse(readFileSync(evidencePath,"utf8")).entries:[];
const types=new Set((process.env.OPENBQ_RENDER_TYPES??"table,newsfeed,chart,markdown,html").split(","));
const ids=process.env.OPENBQ_RENDER_IDS?new Set(process.env.OPENBQ_RENDER_IDS.split(",")):null;
const profile=process.env.OPENBQ_RENDER_PROFILE??"reader";
const corrections:Record<string,Record<string,unknown>>=process.env.OPENBQ_RENDER_INPUT_OVERRIDES?JSON.parse(readFileSync(process.env.OPENBQ_RENDER_INPUT_OVERRIDES,"utf8")):{};
const good=(e:Evidence)=>["success","PASS_DATA","content_success"].includes(e.status);
function selected(entry:Entry){return entry.all_backend_evidence.find(e=>e.lane==="registered"&&good(e))??entry.selected_backend_evidence;}
function extract(payload:unknown,key?:string):unknown {let value=payload;if(!key)return value;for(const part of key.split(".")){if(typeof value!=="object"||value===null||!(part in value))return payload;value=(value as Record<string,unknown>)[part];}return value;}
function safeWrite(path:string,value:unknown){const text=typeof value==="string"?value:JSON.stringify(value,null,2)+"\n";for(const name of ["FRED_API_KEY","BLS_API_KEY","EIA_API_KEY","CONGRESS_GOV_API_KEY","CFTC_APP_TOKEN"]){const secret=process.env[name];if(secret&&secret!=="DEMO_KEY"&&secret.length>5&&text.includes(secret))throw new Error(`Secret redaction gate: ${name} found; artifact refused`);}writeFileSync(path,text);}
test.skip(!cataloguePath||!evidencePath||!output||!reader,"Requires exact catalogue/evidence, output and sidecar origin");
for(const entry of entries){
 const chosen=selected(entry);const lane=chosen.lane==="registered"?"registered":"reader";
 if(!types.has(entry.widget_type)||(ids&&!ids.has(entry.id))||(profile!=="all"&&lane!==profile))continue;
 const widget=corpus.widgets.find(w=>w.id===entry.id)!;
 test(`backend render ${entry.id} (${widget.type};${lane})`,async({page})=>{
  test.setTimeout(100_000);const base=lane==="registered"?registered:reader;expect(base,`Missing ${lane} API`).toBeTruthy();
  const dir=join(output!,entry.id.replace(/[^A-Za-z0-9_-]/g,"_"));mkdirSync(dir,{recursive:true});
  const params={...seedParams(widget)};for(const [key,value] of Object.entries({...entry.valid_parameters.latest_reader_override,...chosen.parameters,...chosen.observed_request_query,...corrections[entry.id]}))if(value!==null&&value!==undefined)params[key]=Array.isArray(value)?value.join(","):String(value);
  // Recover omitted query fields from the saved real response's arguments.
  const recordedPath=resolve(dirname(evidencePath!),"../..",dirname(chosen.path),`${entry.id}.json`);
  if(existsSync(recordedPath)){
   const arguments_=JSON.parse(readFileSync(recordedPath,"utf8"))?.extra?.metadata?.arguments;
   for(const group of [arguments_?.provider_choices,arguments_?.standard_params,arguments_?.extra_params])for(const [key,value] of Object.entries(group??{}))if(value!==null&&value!==undefined)params[key]=Array.isArray(value)?value.join(","):String(value);
  }
  const cache=new Map<string,Promise<{status:number;headers:Record<string,string>;body:Buffer}>>();
  const events:{method:string;path:string;status:number;sha256:string;source:string}[]=[];const pageErrors:string[]=[];page.on("pageerror",err=>pageErrors.push(err.message));
  let failure:string|undefined;let result="NOT_RUN";let assertion="";let matchedValues:string[]=[];let interaction="NOT_RUN";let replay=false;
  await page.route(`${base}/**`,async route=>{
   const request=route.request();const url=new URL(request.url());const path=url.pathname+url.search;const method=request.method();const body=request.postData()??"";const key=method+" "+path+" "+body;
   const reused=cache.has(key);if(!reused)cache.set(key,(async()=>{const response=await route.fetch({timeout:65_000,maxRetries:0});return {status:response.status(),headers:{"content-type":response.headers()["content-type"]??"application/octet-stream","access-control-allow-origin":"*"},body:await response.body()};})());
   try{const response=await cache.get(key)!;const hash=createHash("sha256").update(response.body).digest("hex");events.push({method,path,status:response.status,sha256:hash,source:reused?"captured-response replay":"live sidecar"});if(url.pathname===new URL(widget.endpoint,base).pathname){safeWrite(join(dir,hash+".response.txt"),response.body.toString("utf8"));safeWrite(join(dir,hash+".request.json"),{method,path,body,status:response.status,contentType:response.headers["content-type"],sha256:hash});}await route.fulfill(response);}catch(err){await route.abort("failed");throw err;}
  });
  try{
   const seed={"settings.json":JSON.stringify({collapseWidgetControls:false,maxDecimalPlaces:2}),"backends.json":JSON.stringify([{id:"qualification",name:`V3 ${lane} qualification`,baseUrl:base,authLocation:"header",validateWidgets:true}]),"dashboards/qualification.json":JSON.stringify({id:"qualification",name:"Qualification",tabs:[{id:"tab",name:"Widget",cards:[{id:"qualified-card",widgetId:widget.id,backendId:"qualification",params,layout:{x:0,y:0,w:40,h:24}}]}]})};
   const missing=widget.params.filter(p=>p.optional===false&&p.show!==false&&!(params[p.paramName]??""));expect(missing.map(p=>p.paramName),"Observed successful parameters missing required inputs; repair evidence before retry").toEqual([]);
   await seedApp(page,seed);const card=page.locator(".widget-card");await expect(card.locator(".card-title")).toHaveText(widget.name);if(widget.runButton)await card.getByRole("button",{name:"Run",exact:true}).click();
   await expect.poll(()=>events.filter(e=>e.path.split("?")[0]===new URL(widget.endpoint,base).pathname).length,{timeout:70_000}).toBeGreaterThan(0);
   const endpointEvents=()=>events.filter(e=>e.path.split("?")[0]===new URL(widget.endpoint,base).pathname);
   const event=endpointEvents().at(-1)!;expect(event.status).toBeLessThan(300);
   if(event.status===204){await expect(card.locator(".empty-state").first()).toBeVisible();result="PASS_CONTROL_EMPTY";assertion="HTTP204 truthfully displays empty state; no positive data claimed";}
   else {
    const raw=readFileSync(join(dir,event.sha256+".response.txt"),"utf8");const metadata=JSON.parse(readFileSync(join(dir,event.sha256+".request.json"),"utf8"));const actual=/json/i.test(metadata.contentType)?JSON.parse(raw):raw;const data=extract(actual,widget.dataKey);
    switch(widget.type){
     case "table":{
      const rows=tableRows(data,widget.table);expect(rows,"Table response must have actual row objects").not.toBeNull();expect(rows!.length).toBeGreaterThan(0);await expect(card.locator("tbody tr[data-index]").first()).toBeVisible({timeout:20_000});
      const columns=tableColumns(rows!,widget.table).filter(c=>!c.hiddenByDefault);const expected=new Set<string>();for(const row of rows!)for(const col of columns){let value=Object.hasOwn(row,col.field)?row[col.field]:undefined;if(col.hoverCard&&typeof value==="object"&&value!==null)value=(value as Record<string,unknown>)[col.hoverCard.cellField];if(value===null||value===undefined)continue;const text=formatCell(value,col.field,2,undefined,col.format);expected.add(col.renderFn.includes("titleCase")?titleCase(text):text);}
      const shown=await card.locator("tbody tr[data-index] td").allTextContents();matchedValues=shown.map(s=>s.trim()).filter(s=>s!=="—"&&s.length>1&&expected.has(s));expect(matchedValues.length,"Visible cells must match actual returned values").toBeGreaterThan(0);matchedValues=[...new Set(matchedValues)].slice(0,8);assertion=`Actual ${rows!.length}-row response; visible cells match recorded payload`;
      const head=card.locator("th").first();await head.click({button:"right"});await page.getByRole("menuitem",{name:"Sort ascending",exact:true}).click();await expect.poll(async()=>{const written=await memfs(page).read("dashboards/qualification.json");return written?JSON.parse(written).tabs[0].cards[0].table?.sorting?.[0]?.desc:undefined;}).toBe(false);
      const written=(await memfs(page).read("dashboards/qualification.json"))!;replay=true;await seedApp(page,{...seed,"dashboards/qualification.json":written});if(widget.runButton)await card.getByRole("button",{name:"Run",exact:true}).click();await expect(card.locator("tbody tr[data-index]").first()).toBeVisible({timeout:20_000});const persisted=JSON.parse((await memfs(page).read("dashboards/qualification.json"))!);expect(persisted.tabs[0].cards[0].table.sorting[0].desc).toBe(false);expect(persisted.tabs[0].cards[0].params).toEqual(params);interaction="Sort ascending persisted/reloaded with exact parameters over captured actual response";break;
     }
     case "newsfeed":{const articles=Array.isArray(data)?data:[];const first=articles.find((a:Record<string,unknown>)=>typeof a.title==="string"&&a.title.trim());expect(first,"Actual article title required").toBeTruthy();await expect(card.locator(".newsfeed-title").filter({hasText:first.title}).first()).toBeVisible({timeout:20_000});matchedValues=[first.title];assertion="Visible article headline matches actual response";break;}
     case "chart":{const plot=card.locator(".chart-plot.js-plotly-plot");await expect(plot).toBeVisible({timeout:20_000});const finite=await plot.evaluate(el=>(el as unknown as {data:Record<string,unknown>[]}).data.some(t=>[t.x,t.y,t.z].some(a=>Array.isArray(a)&&a.flat(2).some(v=>typeof v==="number"&&Number.isFinite(v)))));expect(finite).toBe(true);assertion="Actual provider plot has finite plotted coordinates";break;}
     case "markdown":{await expect(card.locator(".markdown-body")).not.toHaveText("",{timeout:20_000});assertion="Actual returned markdown visibly rendered";break;}
     case "html":{const frame=card.locator("iframe");await expect(frame).toHaveAttribute("srcdoc",/\S/,{timeout:20_000});await expect.poll(()=>frame.contentFrame().locator("body").innerText()).not.toBe("");assertion="Actual returned HTML has visible frame body";break;}
     default:throw new Error(`No content assertion implemented for ${widget.type}`);
    }
    await expect(card.locator(".error-state")).toHaveCount(0);result="PASS_RENDER_LIVE";
   }
   const before=events.length;replay=true;await card.getByRole("button",{name:widget.runButton?"Run":"Refresh",exact:true}).click({timeout:5_000});await expect.poll(()=>events.length).toBeGreaterThan(before);expect(events.at(-1)!.source).toBe("captured-response replay");expect(pageErrors).toEqual([]);
  }catch(error){failure=error instanceof Error?error.message:String(error);result="FAIL";throw error;}finally{
   safeWrite(join(dir,"result.json"),{id:entry.id,type:widget.type,lane,params,result,assertion,matchedValues,interaction,refresh:replay?"Captured-response renderer refresh attempted; see events":"NOT_RUN",events,pageErrors,failure,observedUtc:new Date().toISOString()});await page.screenshot({path:join(dir,"render.png")}).catch(()=>{});await page.unrouteAll({behavior:"ignoreErrors"});
  }
 });
}
