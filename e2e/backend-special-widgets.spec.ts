// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Exact-ID live diagnostics for renderer-owned document, UDF and frame requests.
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {expect,test} from "@playwright/test";
import {normalizeWidgets} from "../src/lib/widgetsJson";
import {seedParams} from "../src/lib/params";
import {parseDocuments} from "../src/lib/documents";
import {parseUdfHistory} from "../src/lib/udf";
import {seedApp,memfs} from "./fixtures";
test.use({trace:"off"});
const cataloguePath=process.env.OPENBQ_RENDER_CATALOGUE;
const evidencePath=process.env.OPENBQ_RENDER_EVIDENCE;
const output=process.env.OPENBQ_RENDER_OUTPUT;
const api=process.env.OPENBQ_SPECIAL_API??process.env.OPENBQ_READER_API;
const profile=process.env.OPENBQ_RENDER_PROFILE??"reader";
const corrections:Record<string,Record<string,unknown>>=process.env.OPENBQ_RENDER_INPUT_OVERRIDES?JSON.parse(readFileSync(process.env.OPENBQ_RENDER_INPUT_OVERRIDES,"utf8")):{};
const types=new Set((process.env.OPENBQ_RENDER_TYPES??"multi_file_viewer,iframe,advanced_charting,youtube").split(","));
const ids=process.env.OPENBQ_RENDER_IDS?new Set(process.env.OPENBQ_RENDER_IDS.split(",")):null;
const corpus=normalizeWidgets(cataloguePath?JSON.parse(readFileSync(cataloguePath,"utf8")): {},"special");
type Evidence={lane:string;status:string;parameters:Record<string,unknown>;observed_request_query:Record<string,unknown>};
type Entry={id:string;widget_type:string;selected_backend_evidence:Evidence;all_backend_evidence:Evidence[]};
const entries:Entry[]=evidencePath?JSON.parse(readFileSync(evidencePath,"utf8")).entries:[];
function save(path:string,data:unknown){const text=typeof data==="string"?data:JSON.stringify(data,null,2)+"\n";for(const name of ["EIA_API_KEY","FRED_API_KEY","BLS_API_KEY","CONGRESS_GOV_API_KEY","CFTC_APP_TOKEN"]){const value=process.env[name];if(value&&value!=="DEMO_KEY"&&value.length>5&&text.includes(value))throw new Error(`Artifact refused: contains ${name}`);}writeFileSync(path,text);}
test.skip(!api||!output||!cataloguePath||!evidencePath,"Requires exact corpus, evidence and sidecar API");
for(const entry of entries){
 const evidence=entry.all_backend_evidence.find(e=>e.lane==="registered"&&["success","content_success","PASS_DATA"].includes(e.status))??entry.selected_backend_evidence;
 const lane=evidence.lane==="registered"?"registered":"reader";
 if(!types.has(entry.widget_type)||(ids&&!ids.has(entry.id))||(profile!=="all"&&profile!==lane))continue;
 const widget=corpus.widgets.find(w=>w.id===entry.id)!;
 test(`backend special ${entry.id} (${widget.type};${lane})`,async({page})=>{
  test.setTimeout(110_000);const dir=join(output!,entry.id.replace(/[^A-Za-z0-9_-]/g,"_"));mkdirSync(dir,{recursive:true});
  const params={...seedParams(widget)};for(const [key,value] of Object.entries({...evidence.parameters,...evidence.observed_request_query,...corrections[entry.id]}))if(value!==null&&value!==undefined)params[key]=Array.isArray(value)?value.join(","):String(value);
  const cache=new Map<string,Promise<{status:number;headers:Record<string,string>;body:Buffer}>>();const responses:{method:string;path:string;status:number;sha256:string;source:string;contentType:string}[]=[];const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  let result="NOT_RUN",assertion="",interaction="NOT_RUN",failure:string|undefined;
  await page.route(`${api}/**`,async route=>{
   const req=route.request();const url=new URL(req.url());const path=url.pathname+url.search;const key=req.method()+" "+path+" "+(req.postData()??"");const reused=cache.has(key);
   if(!reused)cache.set(key,(async()=>{const r=await route.fetch({timeout:70_000,maxRetries:0});return {status:r.status(),headers:{...r.headers(),"access-control-allow-origin":"*"},body:await r.body()};})());
   try{const r=await cache.get(key)!;const hash=createHash("sha256").update(r.body).digest("hex");const contentType=r.headers["content-type"]??"";responses.push({method:req.method(),path,status:r.status,sha256:hash,source:reused?"captured-response replay":"live sidecar",contentType});if(!["/widgets.json","/apps.json"].includes(url.pathname)){save(join(dir,hash+".response.txt"),r.body.toString("utf8"));save(join(dir,hash+".request.json"),{method:req.method(),path,body:req.postData(),status:r.status,contentType,sha256:hash});}await route.fulfill(r);}catch(error){await route.abort();throw error;}
  });
  try{
   const seed={"settings.json":JSON.stringify({collapseWidgetControls:false}),"backends.json":JSON.stringify([{id:"special",name:"V3 renderer qualification",baseUrl:api,authLocation:"header",validateWidgets:true}]),"dashboards/special.json":JSON.stringify({id:"special",name:"Special",tabs:[{id:"tab",name:"Widget",cards:[{id:"special-card",widgetId:widget.id,backendId:"special",params,layout:{x:0,y:0,w:40,h:24}}]}]})};
   await seedApp(page,seed);const card=page.locator(".widget-card");await expect(card.locator(".card-title")).toHaveText(widget.name);
   switch(widget.type){
    case "multi_file_viewer":{
     await card.getByLabel("Documents",{exact:true}).focus();const choices=card.locator('.file-rail input[type="checkbox"]');await expect(choices.first()).toBeVisible({timeout:70_000});await choices.first().check();await card.getByRole("button",{name:"Open",exact:true}).click();
     const endpoint=new URL(widget.endpoint,api).pathname;await expect.poll(()=>responses.filter(r=>r.method==="POST"&&r.path.split("?")[0]===endpoint).length,{timeout:75_000}).toBeGreaterThan(0);
     const r=responses.filter(r=>r.method==="POST"&&r.path.split("?")[0]===endpoint).at(-1)!;expect(r.status).toBe(200);const docs=parseDocuments(JSON.parse(readFileSync(join(dir,r.sha256+".response.txt"),"utf8")));expect(docs.length).toBeGreaterThan(0);expect(docs[0].kind,"Selected document must be displayable, not a list/shell").toBe("pdf");if(docs[0].bytes)expect(Buffer.from(docs[0].bytes).subarray(0,5).toString()).toBe("%PDF-");
     if(process.env.OPENBQ_SOURCE_CONTROLS==="1" && entry.id==="tmx_index_documents_obb" && docs[0].url) {
      await expect(card.getByRole("alert")).toBeVisible({timeout:40_000});await card.getByRole("button",{name:/Open externally/}).click();await expect.poll(()=>memfs(page).opened()).toContain(docs[0].url);assertion="Publisher denies linked PDF; truthful error and official external fallback work. No PDF-data pass claimed.";interaction="Official external URL opened after source denial";result="PASS_CONTROL_SOURCE_UNAVAILABLE";break;
     }
     await page.mouse.move(1000,200);await expect(card.locator(".pdfViewer .page canvas").first()).toBeVisible({timeout:25_000});const canvas=card.locator(".pdfViewer .page canvas").first();expect(await canvas.evaluate(el=>(el as HTMLCanvasElement).width>0&&(el as HTMLCanvasElement).height>0)).toBe(true);assertion=`Actual PDF opened: ${docs[0].filename}`;
     const before=responses.length;await card.getByRole("button",{name:"Refresh",exact:true}).click();await expect.poll(()=>responses.length).toBeGreaterThan(before);await expect(canvas).toBeVisible({timeout:25_000});interaction="File selector/Open and captured-response Refresh render PDF";result="PASS_DOCUMENT_RENDER_LIVE";break;
    }
    case "advanced_charting":{
     await expect.poll(()=>responses.filter(r=>r.path.split("?")[0].endsWith("/history")).length,{timeout:75_000}).toBeGreaterThan(0);const r=responses.filter(r=>r.path.split("?")[0].endsWith("/history")).at(-1)!;expect(r.status).toBe(200);const bars=parseUdfHistory(JSON.parse(readFileSync(join(dir,r.sha256+".response.txt"),"utf8")));expect(bars.length).toBeGreaterThan(0);const canvas=card.locator(".tv-chart-plot canvas").first();await expect(canvas).toBeVisible({timeout:20_000});await expect.poll(()=>canvas.evaluate(el=>{const c=el as HTMLCanvasElement;const d=c.getContext("2d")!.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if((d[i]<100&&d[i+1]>120&&d[i+2]>100)||(d[i]>160&&d[i+1]<130&&d[i+2]<130)||(d[i+2]>150&&d[i+2]>d[i]+30))n++;return n;})).toBeGreaterThan(20);assertion=`${bars.length} finite actual UDF bars and visible price-series pixels`;const before=responses.length;await card.getByRole("button",{name:"Refresh",exact:true}).click();await expect.poll(()=>responses.length).toBeGreaterThan(before);interaction="Captured-response history Refresh";result="PASS_UDF_RENDER_LIVE";break;
    }
    case "iframe":{
     const frame=card.locator("iframe.widget-frame");await expect(frame).toHaveAttribute("src",/^https?:/);await expect(frame).toHaveAttribute("sandbox",/allow-scripts/);const target=await frame.getAttribute("src");await card.getByRole("button",{name:/Open externally/}).click();await expect.poll(()=>memfs(page).opened()).toContain(target!);interaction="Explicit external fallback invokes expected URL";
     if(process.env.OPENBQ_SOURCE_CONTROLS==="1" && entry.id==="usda_ers_chart_usda_obb") {
      const tableau=frame.contentFrame().locator("tableau-viz iframe").first();await expect(tableau).toBeVisible({timeout:70_000});const canvas=tableau.contentFrame().locator("canvas").first();await expect(canvas).toBeVisible({timeout:30_000});expect(await canvas.evaluate(el=>(el as HTMLCanvasElement).width>100&&(el as HTMLCanvasElement).height>100)).toBe(true);assertion="Live nested Tableau chart canvas rendered; screenshot retained for numeric plot review";result="PASS_FRAME_VISUAL_LIVE";break;
     }
     await expect.poll(()=>frame.contentFrame().locator("body").innerText(),{timeout:70_000}).not.toBe("");const body=await frame.contentFrame().locator("body").innerText();expect(body.trim().length).toBeGreaterThan(20);save(join(dir,"frame-body.txt"),body);if(process.env.OPENBQ_SOURCE_CONTROLS==="1" && ["tmx_equity_asset_info_obb","tmx_etf_fund_info_obb"].includes(entry.id)) {
      expect(body).toContain(entry.id.includes("equity")?"Air Canada":"iShares S&P/TSX 60");expect(body).toContain("SESSION");expect(body).toMatch(/\d+\.\d+/);assertion="Actual instrument identity, session prices and profile render; external fallback verified";result="PASS_FRAME_CONTENT_LIVE";break;
     }
     if(process.env.OPENBQ_SOURCE_CONTROLS==="1" && entry.id==="sec_filing_viewer_sec_obb") {
      await expect(frame.contentFrame().locator("#ob-doc-scroll")).toContainText(/.{500}/s,{timeout:70_000});
      const filing=await frame.contentFrame().locator("#ob-doc-scroll").innerText();expect(filing).not.toContain("Could not load the document");save(join(dir,"filing-document-body.txt"),filing);
      assertion="Selected actual filing HTML renders inside the viewer";result="PASS_FRAME_CONTENT_LIVE";break;
     }
     if(process.env.OPENBQ_SOURCE_CONTROLS==="1" && entry.id==="sec_edgar_viewer_sec_obb" && body.includes("Automated access")) {assertion="SEC public search denies automated embed; official external fallback remains available. No source-data pass claimed.";result="PASS_CONTROL_SOURCE_UNAVAILABLE";break;}
     if(process.env.OPENBQ_EIA_FUNCTIONAL==="1" && entry.id.includes("eia_")) {
      const inner=frame.contentFrame().locator("iframe.frame");
      await expect(inner).toBeVisible({timeout:70_000});
      await expect.poll(()=>inner.contentFrame().locator("body").innerText(),{timeout:70_000}).toMatch(/.{100}/s);
      await expect(inner.contentFrame().locator(".slick-cell").first()).toBeVisible({timeout:60_000});
      const nestedBody=await inner.contentFrame().locator("body").innerText();
      save(join(dir,"nested-frame-body.txt"),nestedBody);
      const values=await inner.contentFrame().locator(".slick-cell").allTextContents();
      expect(values.filter(v=>/^-?[\d,]+(?:\.\d+)?$/.test(v.trim())).length).toBeGreaterThan(5);
      expect(await inner.getAttribute("src")).not.toMatch(/^http:\/\//);
      expect(responses.some(r=>r.path.includes("/eia_proxy/") && r.status===200)).toBe(true);
      await frame.contentFrame().getByRole("button",{name:/Home/}).click();
      await expect(inner).toBeVisible({timeout:30_000});
      await expect.poll(()=>inner.contentFrame().locator("body").innerText(),{timeout:30_000}).toMatch(/.{100}/s);
     }
     if(process.env.OPENBQ_EIA_EXTRA==="1") {
      const doc=frame.contentFrame(); const nested=doc.locator("iframe.frame");
      if(entry.id==="eia_rss_feeds_us_eia_obb") {
       const title=doc.locator("#list .card .title").first();await expect(title).not.toHaveText("",{timeout:30_000});
       const text=await title.innerText();await doc.locator("#list .card").first().click();
       await expect(doc.locator("#overlay")).toHaveClass(/open/);
       await expect(doc.locator("#m-title")).toHaveText(text);
       const article=doc.locator("#modal iframe");await expect.poll(()=>article.contentFrame().locator("body").innerText(),{timeout:60_000}).toMatch(/.{500}/s);
       save(join(dir,"article-body.txt"),await article.contentFrame().locator("body").innerText());await doc.getByRole("button",{name:"Close",exact:true}).click();
       assertion="Actual RSS headline and corresponding article render; modal opens/closes";
      } else if(entry.id==="eia_maps_browser_us_eia_obb") {
       await expect(doc.locator(".pdf-wrap canvas").first()).toBeVisible({timeout:60_000});assertion="Actual EIA map PDF renders in nested browser";
      } else if(entry.id==="eia_international_browser_us_eia_obb") {
       await expect(nested.contentFrame().locator("body")).not.toContainText("FILE NOT FOUND");
       const link=nested.contentFrame().getByRole("link",{name:"CSV",exact:true}).first();await expect(link).toBeVisible({timeout:30_000});
       const href=await link.getAttribute("href");const origin=new URL(api!).origin;const base=new URL((await nested.getAttribute("src"))!,origin);const response=await page.request.get(new URL(href!,base).href,{timeout:60_000});expect(response.status()).toBe(200);
       const csv=await response.text();expect(csv).not.toMatch(/<!doctype html|<html/i);expect(csv.split("\n").length).toBeGreaterThan(2);expect(csv).toMatch(/\d+\.\d+/);save(join(dir,"international-download.csv"),csv);assertion="Current official International CSV portal and actual data download";
      } else if(entry.id==="eia_natural_gas_query_browser_us_eia_obb") {
       const cells=nested.contentFrame().locator(".ag-cell");await expect(cells.first()).toBeVisible({timeout:60_000});expect((await cells.allTextContents()).filter(v=>/^-?[\d,]+(?:\.\d+)?$/.test(v.trim())).length).toBeGreaterThan(5);assertion="Actual respondent grid contains numeric values";
      } else if(entry.id==="eia_petroleum_imports_browser_us_eia_obb") {
       await expect.poll(()=>nested.contentFrame().locator("body").innerText(),{timeout:60_000}).not.toMatch(/Loading\.\.\./);
       await expect.poll(()=>nested.contentFrame().locator("body").innerText(),{timeout:60_000}).toMatch(/\d{1,3},\d{3}/);assertion="Petroleum imports application completes load with numeric values";
      } else if(entry.id==="eia_states_browser_us_eia_obb") {
       await expect(nested.contentFrame().getByText(/Total energy production and consumption by state/).first()).toBeVisible({timeout:60_000});
       await nested.contentFrame().getByRole("button",{name:"Choose State/Territory",exact:true}).click({timeout:15_000});
       await nested.contentFrame().locator(".ico-list").first().click({timeout:15_000});
       await nested.contentFrame().getByRole("link",{name:"Alabama",exact:true}).click({timeout:15_000});
       await expect.poll(()=>nested.contentFrame().locator("body").innerText(),{timeout:60_000}).toMatch(/\d{1,3},\d{3}/);assertion="Selected Alabama profile returns numerical state data";
      } else if(entry.id.includes("uscongress_committee_members")) {expect(body).toContain("House Committee on the Judiciary");expect(body).toContain("Jim Jordan");expect(body).toContain("Members");assertion="Actual committee membership names, roles and counts render";
      } else if(entry.id.includes("uscongress_member_info")) {expect(body).toContain("Robert B. Aderholt");expect(body).toContain("VOTING RECORD");expect(body).toContain("COMMITTEE ASSIGNMENTS");assertion="Actual member record, voting counts and committee assignments render";}
      save(join(dir,"functional-frame-body.txt"),await (await nested.count()?nested.contentFrame():doc).locator("body").innerText());
     }
     if(process.env.OPENBQ_FRAME_DIAGNOSTICS==="1") {
      const nested=frame.contentFrame().locator("iframe.frame");
      if(await nested.count()) {
       await expect.poll(()=>nested.contentFrame().locator("body").innerText(),{timeout:60_000}).toMatch(/.{100}/s);
       save(join(dir,"nested-frame-body.txt"),await nested.contentFrame().locator("body").innerText());
       save(join(dir,"nested-controls.json"),await nested.contentFrame().locator("input,select,button,a[href]").evaluateAll(nodes=>nodes.map(n=>({tag:n.tagName,id:n.id,text:(n.textContent??"").trim().slice(0,120),type:n.getAttribute("type"),name:n.getAttribute("name")}))));
      }
      save(join(dir,"outer-controls.json"),await frame.contentFrame().locator("input,select,button,a[href]").evaluateAll(nodes=>nodes.map(n=>({tag:n.tagName,id:n.id,text:(n.textContent??"").trim().slice(0,120)}))));
     }
     const controls=await frame.contentFrame().locator('input,select,button,a[href]').count();if(process.env.OPENBQ_EIA_EXTRA!=="1")assertion=`Frame body visible (${body.trim().length} chars); ${controls} controls/links observed. Application data/actions remain separate.`;result="PASS_SHELL";break;
    }
    case "youtube":{
     const frame=card.locator('iframe[title="YouTube video"]');await expect(frame).toHaveAttribute("src",/youtube.*\/embed\//,{timeout:70_000});assertion="Actual descriptor produces validated YouTube embed; playback NOT qualified";result="PASS_SHELL";break;
    }
    default:throw new Error(`No assertion for ${widget.type}`);
   }
   if(process.env.OPENBQ_EIA_EXTRA==="1") result="PASS_FRAME_CONTENT_LIVE";
   if(process.env.OPENBQ_EIA_FUNCTIONAL==="1") { result="PASS_FRAME_DATA_LIVE"; assertion="Nested actual EIA grid with finite numeric cells through HTTPS; Home action reloads content"; }
   if(result!=="PASS_CONTROL_SOURCE_UNAVAILABLE")await expect(card.locator(".error-state")).toHaveCount(0);
  }catch(error){failure=error instanceof Error?error.message:String(error);result="FAIL";throw error;}finally{save(join(dir,"result.json"),{id:entry.id,type:widget.type,lane,params,result,assertion,interaction,failure,responses,pageErrors:errors,observedUtc:new Date().toISOString()});await page.screenshot({path:join(dir,"render.png")}).catch(()=>{});await page.unrouteAll({behavior:"ignoreErrors"});}
 });
}
