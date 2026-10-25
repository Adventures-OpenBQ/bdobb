// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { createServer, type Server, type RequestListener } from 'node:http';
import { acquireBackend, type ServerBackendConfig } from './backend';
import { datasetFromRows } from '../../src/lib/localTableData';
const servers: Server[]=[];
afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>new Promise<void>(r=>{s.closeAllConnections();s.close(()=>r());})));});
async function upstream(handler: RequestListener) {
  const server=createServer(handler);servers.push(server);
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const a=server.address() as {port:number};return `http://127.0.0.1:${a.port}/table`;
}
const binding={backendId:'configured',widgetId:'financials',params:{symbol:'AAPL'}};
function config(url:string):ServerBackendConfig {return {maxBytes:100000,maxRows:100,maxColumns:10,timeoutMs:200,backends:{configured:{widgets:{financials:{url,headers:{Authorization:'Bearer private-token'},parameters:['symbol'],response:{kind:'rows',columns:[{id:'value',label:'Revenue',metadata:{fiscalYearEndMonth:9}}],provenance:{sourceWidgetId:'financials',sourceKind:'backend',metadata:{fiscalYearEndMonth:9}},completeness:{kind:'partial',warnings:['upstream cap'],totalRowCount:300,totalRowCountKind:'exact'}}}}}}};}
it('injects operator credentials, validated query values, fiscal columns and honest bounds', async()=>{
  const url=await upstream((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify([{value:req.headers.authorization==='Bearer private-token'&&req.url==='/table?symbol=AAPL'?12:0}]));});
  const result=await acquireBackend(binding,config(url));
  expect(result.rows[0].values).toEqual({value:12});
  expect(result.columns).toEqual([{id:'value',label:'Revenue',metadata:{fiscalYearEndMonth:9}}]);
  expect(result.provenance.metadata).toEqual({fiscalYearEndMonth:9});
  expect(result.completeness).toEqual({kind:'partial',warnings:['upstream cap'],acquiredRowCount:1,totalRowCount:300,totalRowCountKind:'exact'});
  expect(JSON.stringify(result)).not.toContain('private-token');
});
it('retains all supplied WidgetDataset evidence',async()=>{
  const dataset=datasetFromRows([{x:1}],'original',7,'backend');
  dataset.completeness={kind:'paged',warnings:['more pages'],totalRowCount:100};dataset.provenance.receipt={fiscalCalendar:'issuer'};dataset.columns[0].metadata={fiscalYearEndMonth:6};
  dataset.diagnostics=[{code:'UPSTREAM',message:'limited',severity:'warning'}];
  const url=await upstream((_req,res)=>res.end(JSON.stringify(dataset)));const c=config(url);
  c.backends.configured.widgets.financials.response={kind:'dataset'};
  expect(await acquireBackend(binding,c)).toEqual(dataset);
});
it('refuses unknown IDs and parameters, arbitrary URLs and all redirects before disclosing credentials',async()=>{
  let redirected=0;const dest=await upstream((_q,r)=>{redirected++;r.end('[]');});
  const url=await upstream((_q,r)=>{r.writeHead(302,{Location:dest});r.end();});const c=config(url);
  for(const b of [{...binding,backendId:'other'},{...binding,widgetId:'other'},{...binding,params:{url:dest}},{...binding,params:{symbol:dest}},{...binding,params:{symbol:{nested:1}}},binding]) {
    await expect(acquireBackend(b,c)).rejects.toThrow(/^Could not acquire configured table source$/);
  }
  expect(redirected).toBe(0);
});
it('bounds fetch deadline, bytes, rows and columns with sanitized errors',async()=>{
  const slow=await upstream((_q,r)=>{setTimeout(()=>r.end('[]'),150);});const c=config(slow);c.timeoutMs=20;
  await expect(acquireBackend(binding,c)).rejects.toThrow(/^Could not acquire configured table source$/);
  const url=await upstream((_q,r)=>r.end('[{"value":1,"extra":2},{"value":3}]'));
  for(const limits of [{maxBytes:4},{maxRows:1},{maxColumns:1}]) await expect(acquireBackend(binding,{...config(url),...limits})).rejects.toThrow();
});
it('defaults ordinary rows to unknown completeness instead of inventing complete evidence',async()=>{
  const url=await upstream((_q,r)=>r.end('[{"value":1}]'));const c=config(url);
  c.backends.configured.widgets.financials.response={kind:'rows',columns:[],provenance:{sourceWidgetId:'financials',sourceKind:'backend'}};
  expect((await acquireBackend(binding,c)).completeness).toEqual({kind:'unknown',warnings:[],acquiredRowCount:1});
});
it('serializes flat arrays as repeated query keys and keeps source discovery private',async()=>{
  const {backendDescriptors}=await import('./backend');
  const url=await upstream((req,res)=>res.end(JSON.stringify([{query:req.url}])));const c=config(url);
  c.backends.configured.label='Configured';c.backends.configured.widgets.financials.parameters=['symbol','years','adjusted','none'];
  const result=await acquireBackend({...binding,params:{symbol:'A&B',years:[2023,2024],adjusted:true,none:null}},c);
  expect(result.rows[0].values.query).toBe('/table?symbol=A%26B&years=2023&years=2024&adjusted=true&none=');
  expect(backendDescriptors(c)).toEqual([{backendId:'configured',label:'Configured',widgets:[{widgetId:'financials',label:'financials',parameters:['symbol','years','adjusted','none']}]}]);
});
it('extracts ordinary result rows only through an operator configured object path',async()=>{
  const url=await upstream((_q,r)=>r.end('{"results":[{"value":12}],"provider":"configured"}'));const c=config(url);
  c.backends.configured.widgets.financials.response={kind:'rows',rowsPath:['results'],columns:[{id:'value',label:'Revenue'}],provenance:{sourceWidgetId:'financials',metadata:{provider:'configured'}}};
  expect((await acquireBackend(binding,c)).rows[0].values).toEqual({value:12});
  c.backends.configured.widgets.financials.response.rowsPath=['missing'];
  await expect(acquireBackend(binding,c)).rejects.toThrow(/^Could not acquire configured table source$/);
});
it('retains explicit schema metadata on empty results and nulls wholly absent declared columns',async()=>{
  for(const body of ['[]','[{"other":1}]']) {
    const url=await upstream((_q,r)=>r.end(body));const result=await acquireBackend(binding,config(url));
    expect(result.columns[0]).toEqual({id:'value',label:'Revenue',metadata:{fiscalYearEndMonth:9}});
    if(result.rows.length)expect(result.rows[0].values).toEqual({other:1,value:null});
  }
});
