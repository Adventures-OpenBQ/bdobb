// Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
import { chromium } from '@playwright/test';
/* global window */
import fs from 'node:fs';
const allWidgets=await fetch('http://127.0.0.1:6912/widgets.json').then(r => { if (!r.ok) throw new Error(`OpenBQ catalogue HTTP ${r.status}`); return r.json(); });
const wanted=['yfinance_equity_quote_yfinance_obb','yfinance_equity_historical_yfinance_obb','yfinance_fundamental_income_yfinance_obb','yfinance_fundamental_balance_yfinance_obb','yfinance_equity_profile_yfinance_obb','yfinance_equity_fast_info_yfinance_obb','cboe_equity_quote_cboe_obb','sec_equity_search_sec_obb'];
const widgets=Object.fromEntries(Object.entries(allWidgets).filter(([id])=>wanted.includes(id)));
if (Object.keys(widgets).length !== wanted.length) throw new Error('Selected smoke widgets missing from OpenBQ catalogue');
const browser=await chromium.launch();const results=[];fs.mkdirSync('e2e-results/openbq-smoke-shots',{recursive:true});
for(const [caseId,w] of [...Object.entries(widgets), ['historical-chart', {...widgets.yfinance_equity_historical_yfinance_obb, _chart:true}]]){
 const id = w._chart ? 'yfinance_equity_historical_yfinance_obb' : caseId;
 if(results.some(x=>x.id===caseId))continue;
 if(id==='omni-python-widget'){results.push({id,status:'excluded',reason:'User excluded Python Omni execution'});continue;}
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:6912/**',async route=>{try{const response=await route.fetch({timeout:25000});await route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':'*'}});}catch{await route.abort().catch(()=>{});}});
 const params={};for(const p of w.params??[])if(p.paramName&&p.value!==undefined)params[p.paramName]=Array.isArray(p.value)?p.value.join(","):p.value==null?"":String(p.value);
 if(w.params?.some(p=>p.paramName==='symbol'))params.symbol='AMD';if(id==='sec_equity_search_sec_obb')params.query='Advanced Micro Devices';if(id==='yfinance_equity_historical_yfinance_obb')params.period='1mo';
 const files={'settings.json':'{}','backends.json':JSON.stringify([{id:'ref',name:'Reference',baseUrl:'http://127.0.0.1:6912',authLocation:'header',validateWidgets:false}]),'dashboards/d1.json':JSON.stringify({id:'d1',name:'Reference',tabs:[{id:'t1',name:'Main',cards:[{id:'c1',backendId:'ref',widgetId:id,params,...(w._chart ? {view:'chart'} : {}),layout:{x:0,y:0,w:40,h:25}}]}]})};
 await page.addInitScript(seed=>{window.__bdobbSeed=seed;},files);
 let status='failed',reason='',text='';
 try{
 await page.goto(`http://localhost:${process.env.BDOBB_BROWSER_PORT ?? 4173}/`);await page.mouse.move(1300,950);
 await page.locator('.widget-card').waitFor({timeout:15000});
 const run=page.getByRole('button',{name:'Run',exact:true});if(await run.count())await run.first().click();
 await page.waitForTimeout(1800);for(let n=0;n<20;n++){const t=await page.locator('.card-body,.card-render').first().innerText();if(!/Loading|Waiting for/i.test(t))break;await page.waitForTimeout(1000);}
 const body=page.locator('.card-body,.card-render').first();text=await body.innerText();
 const evidence=await body.evaluate(el=>({text:el.textContent?.trim().slice(0,1800),svg:el.querySelectorAll('svg').length,canvas:el.querySelectorAll('canvas').length,rows:el.querySelectorAll('[role="row"],tr').length,iframe:el.querySelectorAll('iframe').length,img:el.querySelectorAll('img').length,html:el.innerHTML.length}));
 reason=JSON.stringify(evidence);
 const negative=/Could not|not supported|No data|not on any connected|Request failed|Failed to|Loading|Waiting for|Backend is offline/i.test(text);
 status=!negative&&evidence.html>20&&errors.length===0&&(w._chart ? evidence.svg>0 : (w.type!=='table'||evidence.rows>1))?'rendered':'needs-review';
 await page.screenshot({path:`e2e-results/openbq-smoke-shots/${caseId.replaceAll('/','_')}.png`});
 }catch(e){reason=e.message;}
 results.push({id:caseId,widgetId:id,type:w.type??'table',status,text:text.slice(0,1000),reason,errors});
 fs.writeFileSync('e2e-results/openbq-smoke-results.json',JSON.stringify({source:'openbq-docker final-source image',inventory:Object.keys(allWidgets).length,yfinanceWidgets:Object.keys(allWidgets).filter(k=>k.includes('yfinance')).length,target:wanted.length+1,results},null,2));
 console.log(caseId,status);await page.unrouteAll({behavior:'ignoreErrors'});await page.close();
}
await browser.close();

if (results.length !== wanted.length + 1 || results.some(r => r.status !== 'rendered')) process.exitCode = 1;
