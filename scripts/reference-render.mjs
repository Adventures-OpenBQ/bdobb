// Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
import { chromium } from '@playwright/test';
import fs from 'node:fs';
/* global window */
// Repeat the earlier session's per-widget reference rehearsal; never reuse old results.
// Requires scripts/browser.mjs on :4173 and the curated reference on :7780.
const widgets = await fetch('http://127.0.0.1:7780/widgets.json').then(r => {
  if (!r.ok) throw new Error(`Reference manifest HTTP ${r.status}`);
  return r.json();
});
const apps = await fetch('http://127.0.0.1:7780/apps.json').then(r => r.json());
const onboarding = apps.find(app => app.name === 'Onboarding App for Devs');
const layoutItems = Object.fromEntries(Object.values(onboarding?.tabs ?? {}).flatMap(tab => tab.layout).map(item => [item.i, item]));
const wanted = process.env.REFERENCE_WIDGET_IDS?.split(',');
const entries = Object.entries(widgets).filter(([id]) => !wanted || wanted.includes(id));
if (wanted && entries.length !== wanted.length) throw new Error('Requested reference widget missing');
const resultPath = wanted ? 'e2e-results/reference-layout-results.json' : 'e2e-results/reference-render-results.json';
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  ready = await fetch(`http://localhost:${process.env.BDOBB_BROWSER_PORT ?? 4173}/`).then(r => r.ok, () => false);
  if (ready) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!ready) throw new Error('Fresh browser harness is not ready');
const browser=await chromium.launch();const results=[];fs.mkdirSync('e2e-results/reference-render-shots',{recursive:true});
for(const [id,w] of entries){
 if(results.some(x=>x.id===id))continue;
 if(id==='omni-python-widget'){results.push({id,status:'excluded',reason:'Python Omni absent from curated reference; not qualified'});continue;}
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:7780/**',async route=>{try{const response=await route.fetch({timeout:25000});await route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':'*'}});}catch{await route.abort().catch(()=>{});}});
 const params={};for(const p of w.params??[])if(p.paramName&&p.value!==undefined)params[p.paramName]=Array.isArray(p.value)?p.value.join(","):p.value==null?"":String(p.value);
 const chartView = layoutItems[id]?.state?.chartView?.enabled === true;
 for (const [name, value] of Object.entries(layoutItems[id]?.state?.params ?? {})) params[name] = Array.isArray(value) ? value.join(",") : value == null ? "" : String(value);
 const files={'settings.json':'{}','backends.json':JSON.stringify([{id:'ref',name:'Reference',baseUrl:'http://127.0.0.1:7780',authLocation:'header',validateWidgets:false}]),'dashboards/d1.json':JSON.stringify({id:'d1',name:'Reference',tabs:[{id:'t1',name:'Main',cards:[{id:'c1',backendId:'ref',widgetId:id,params,...(chartView ? {view:"chart"} : {}),layout:{x:0,y:0,w:40,h:25}}]}]})};
 await page.addInitScript(seed=>{window.__bdobbSeed=seed;},files);
 let status='failed',reason='',text='';
 try{
 await page.goto(`http://localhost:${process.env.BDOBB_BROWSER_PORT ?? 4173}/`);await page.mouse.move(1300,950);
 await page.locator('.widget-card').waitFor({timeout:15000});
 const run=page.getByRole('button',{name:'Run',exact:true});if(await run.count())await run.first().click();
 if (w.type === 'multi_file_viewer') {
 await page.locator('.file-rail').hover();
 await page.locator('.file-rail').getByRole('checkbox').first().check();
 await page.getByRole('button', {name:'Open', exact:true}).click();
 await page.locator('.pdf-body canvas').first().waitFor({timeout:30000});
}
if (w.type === 'omni') {
 await page.getByPlaceholder('Enter a prompt to query this widget').fill(id==='omni-sql-widget' ? 'SELECT * FROM stocks LIMIT 3' : 'Reference rendering proof');
 await page.getByRole('button', {name:'Submit', exact:true}).click();
}
await page.waitForTimeout(1800);for(let n=0;n<20;n++){const t=await page.locator('.card-body,.card-render').first().innerText();if(!/Loading|Waiting for/i.test(t))break;await page.waitForTimeout(1000);}
 const body=page.locator('.card-body,.card-render').first();text=await body.innerText();
 const evidence=await body.evaluate(el=>({text:el.textContent?.trim().slice(0,1800),svg:el.querySelectorAll('svg').length,canvas:el.querySelectorAll('canvas').length,rows:el.querySelectorAll('[role="row"],tr').length,iframe:el.querySelectorAll('iframe').length,img:el.querySelectorAll('img').length,html:el.innerHTML.length}));
 reason=JSON.stringify(evidence);
 const negative=/Could not|not supported|No data|not on any connected|Request failed|Failed to|Loading|Waiting for|Backend is offline/i.test(text);
 status=!negative&&evidence.html>20&&errors.length===0&&(!chartView||evidence.svg>0)?'rendered':'needs-review';
 await page.screenshot({path:`e2e-results/reference-render-shots/${id.replaceAll('/','_')}.png`});
 }catch(e){reason=e.message; text=await page.locator(".card-body,.card-render").first().innerText().catch(()=>""); await page.screenshot({path:`e2e-results/reference-render-shots/${id.replaceAll("/","_")}-failed.png`}).catch(()=>{});}
 results.push({id,type:w.type??'table',status,text:text.slice(0,1000),reason,errors});
 fs.writeFileSync(resultPath,JSON.stringify({pin:'a6293707576e16edda8305adda95b07b6a4b968b',inventory:71,target:entries.length,layoutViews:true,results},null,2));
 console.log(id,status);await page.unrouteAll({behavior:'ignoreErrors'});await page.close();
}
await browser.close();

if (results.length !== entries.length || results.some(r => !['rendered','excluded'].includes(r.status))) process.exitCode = 1;
