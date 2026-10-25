// Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
import { chromium } from '@playwright/test';
import { paramsOf, renderCard } from './render-card.mjs';
import fs from 'node:fs';
const allWidgets=await fetch('http://127.0.0.1:6912/widgets.json').then(r => { if (!r.ok) throw new Error(`OpenBQ catalogue HTTP ${r.status}`); return r.json(); });
const wanted=['yfinance_equity_quote_yfinance_obb','yfinance_equity_historical_yfinance_obb','yfinance_fundamental_income_yfinance_obb','yfinance_fundamental_balance_yfinance_obb','yfinance_equity_profile_yfinance_obb','yfinance_equity_fast_info_yfinance_obb','cboe_equity_quote_cboe_obb','sec_equity_search_sec_obb'];
const widgets=Object.fromEntries(Object.entries(allWidgets).filter(([id])=>wanted.includes(id)));
if (Object.keys(widgets).length !== wanted.length) throw new Error('Selected smoke widgets missing from OpenBQ catalogue');
const browser=await chromium.launch();const results=[];fs.mkdirSync('e2e-results/openbq-smoke-shots',{recursive:true});
for(const [caseId,w] of [...Object.entries(widgets), ['historical-chart', {...widgets.yfinance_equity_historical_yfinance_obb, _chart:true}]]){
 const id = w._chart ? 'yfinance_equity_historical_yfinance_obb' : caseId;
 const params=paramsOf(w);
 if(w.params?.some(p=>p.paramName==='symbol'))params.symbol='AMD';if(id==='sec_equity_search_sec_obb')params.query='Advanced Micro Devices';if(id==='yfinance_equity_historical_yfinance_obb')params.period='1mo';
 const {text,evidence,error,errors,ok}=await renderCard(browser,{baseUrl:'http://127.0.0.1:6912',widgetId:id,params,chartView:w._chart,shot:`e2e-results/openbq-smoke-shots/${caseId.replaceAll('/','_')}.png`});
 const status=!evidence?'failed':ok&&(w._chart ? evidence.svg>0 : (w.type!=='table'||evidence.rows>1))?'rendered':'needs-review';
 results.push({id:caseId,widgetId:id,type:w.type??'table',status,text:text.slice(0,1000),reason:error??JSON.stringify(evidence),errors});
 fs.writeFileSync('e2e-results/openbq-smoke-results.json',JSON.stringify({source:'openbq-docker final-source image',inventory:Object.keys(allWidgets).length,yfinanceWidgets:Object.keys(allWidgets).filter(k=>k.includes('yfinance')).length,target:wanted.length+1,results},null,2));
 console.log(caseId,status);
}
await browser.close();

if (results.length !== wanted.length + 1 || results.some(r => r.status !== 'rendered')) process.exitCode = 1;
