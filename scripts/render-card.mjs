// Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
/* global window */
// One seeded widget card in the browser harness, shared by reference-render.mjs and openbq-smoke.mjs.
export const paramsOf = w => {
 const params={};for(const p of w.params??[])if(p.paramName&&p.value!==undefined)params[p.paramName]=Array.isArray(p.value)?p.value.join(","):p.value==null?"":String(p.value);
 return params;
};
// evidence is null when the card never got that far; error is the first failure, if any.
export async function renderCard(browser, { baseUrl, widgetId, params, chartView, shot, failedShot, interact }) {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(`${baseUrl}/**`,async route=>{try{const response=await route.fetch({timeout:25000});await route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':'*'}});}catch{await route.abort().catch(()=>{});}});
 const files={'settings.json':'{}','backends.json':JSON.stringify([{id:'ref',name:'Reference',baseUrl,authLocation:'header',validateWidgets:false}]),'dashboards/d1.json':JSON.stringify({id:'d1',name:'Reference',tabs:[{id:'t1',name:'Main',cards:[{id:'c1',backendId:'ref',widgetId,params,...(chartView ? {view:'chart'} : {}),layout:{x:0,y:0,w:40,h:25}}]}]})};
 await page.addInitScript(seed=>{window.__bdobbSeed=seed;},files);
 let text='',evidence=null,error=null;
 try{
 await page.goto(`http://localhost:${process.env.BDOBB_BROWSER_PORT ?? 4173}/`);await page.mouse.move(1300,950);
 await page.locator('.widget-card').waitFor({timeout:15000});
 const run=page.getByRole('button',{name:'Run',exact:true});if(await run.count())await run.first().click();
 await interact?.(page);
 await page.waitForTimeout(1800);for(let n=0;n<20;n++){const t=await page.locator('.card-body,.card-render').first().innerText();if(!/Loading|Waiting for/i.test(t))break;await page.waitForTimeout(1000);}
 const body=page.locator('.card-body,.card-render').first();text=await body.innerText();
 evidence=await body.evaluate(el=>({text:el.textContent?.trim().slice(0,1800),svg:el.querySelectorAll('svg').length,canvas:el.querySelectorAll('canvas').length,rows:el.querySelectorAll('[role="row"],tr').length,iframe:el.querySelectorAll('iframe').length,img:el.querySelectorAll('img').length,html:el.innerHTML.length}));
 await page.screenshot({path:shot});
 }catch(e){error=e.message;if(failedShot){text=await page.locator(".card-body,.card-render").first().innerText().catch(()=>"");await page.screenshot({path:failedShot}).catch(()=>{});}}
 await page.unrouteAll({behavior:'ignoreErrors'});await page.close();
 const negative=/Could not|not supported|No data|not on any connected|Request failed|Failed to|Loading|Waiting for|Backend is offline/i.test(text);
 return {text,evidence,error,errors,ok:evidence!==null&&!negative&&evidence.html>20&&errors.length===0};
}
