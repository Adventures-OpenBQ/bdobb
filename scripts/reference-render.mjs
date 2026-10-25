// Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { paramsOf, renderCard } from './render-card.mjs';
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
 if(id==='omni-python-widget'){results.push({id,status:'excluded',reason:'Python Omni absent from curated reference; not qualified'});continue;}
 const params=paramsOf(w);
 const chartView = layoutItems[id]?.state?.chartView?.enabled === true;
 for (const [name, value] of Object.entries(layoutItems[id]?.state?.params ?? {})) params[name] = Array.isArray(value) ? value.join(",") : value == null ? "" : String(value);
 const {text,evidence,error,errors,ok}=await renderCard(browser,{baseUrl:'http://127.0.0.1:7780',widgetId:id,params,chartView,shot:`e2e-results/reference-render-shots/${id.replaceAll('/','_')}.png`,failedShot:`e2e-results/reference-render-shots/${id.replaceAll("/","_")}-failed.png`,interact:async page=>{
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
 }});
 const status=!evidence?'failed':ok&&(!chartView||evidence.svg>0)?'rendered':'needs-review';
 results.push({id,type:w.type??'table',status,text:text.slice(0,1000),reason:error??JSON.stringify(evidence),errors});
 fs.writeFileSync(resultPath,JSON.stringify({pin:'a6293707576e16edda8305adda95b07b6a4b968b',inventory:71,target:entries.length,layoutViews:true,results},null,2));
 console.log(id,status);
}
await browser.close();

if (results.length !== entries.length || results.some(r => !['rendered','excluded'].includes(r.status))) process.exitCode = 1;
