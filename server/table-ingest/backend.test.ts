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
function config(url:string):ServerBackendConfig {return {maxBytes:100000,maxRows:100,maxColumns:10,timeoutMs:10_000,backends:{configured:{widgets:{financials:{url,headers:{Authorization:'Bearer private-token'},parameters:['symbol'],response:{kind:'rows',columns:[{id:'value',label:'Revenue',metadata:{fiscalYearEndMonth:9}}],provenance:{sourceWidgetId:'financials',sourceKind:'backend',metadata:{fiscalYearEndMonth:9}},completeness:{kind:'partial',warnings:['upstream cap'],totalRowCount:300,totalRowCountKind:'exact'}}}}}}};}
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
// User rulings 2026-10-15: a managed statement source is relabelled where it is ingested, as the client
// relabels a local statement card's rows (statementFiscal.correctStatementRows). Ingest tells a statement
// widget itself: it reads the backend's widgets.json at `backends[id].url`, finds the configured widget by
// its endpoint, and applies the client's isStatementPeriodParam. No per-widget operator opt-in.
const statementRows=[
  {symbol:'WMT',period_ending:'2026-07-31',fiscal_period:'quarter',fiscal_year:2026,revenue:1},
  {symbol:'WMT',period_ending:'2026-01-31',fiscal_period:'QQ4',fiscal_year:2026,revenue:2},
  {symbol:'JPM',period_ending:'2026-06-30',revenue:3},
];
const FY='/api/v1/fundamentals/fiscal_year_end';
const periodParam=(values:string[])=>({paramName:'period',options:values.map(value=>({label:value,value}))});
// Keyed unlike the configured widget ('financials'): ingest matches on the endpoint, not the key.
const statementWidgets={income_statement:{endpoint:'/table',params:[{paramName:'symbol'},periodParam(['annual','quarter'])]},other:{endpoint:'other',params:[]}};
type Upstream={yearEnds?:Record<string,number>;widgets?:unknown;rows?:unknown;seen?:string[]};
async function statementSource({yearEnds={},widgets=statementWidgets,rows=statementRows,seen=[]}:Upstream={}) {
  const url=await upstream((req,res)=>{
    const u=new URL(req.url??'','http://x');
    seen.push(`${req.headers.authorization} ${u.pathname}${u.search}`);
    if(u.pathname==='/widgets.json') {if(widgets===null){res.statusCode=404;res.end();return;}res.end(JSON.stringify(widgets));return;}
    if(u.pathname===FY) {
      const month=yearEnds[u.searchParams.get('symbol')??''];
      if(month===undefined){res.statusCode=404;res.end();return;}
      res.end(JSON.stringify({fiscalYearEnd:month}));return;
    }
    res.end(JSON.stringify(rows));
  });
  const c=config(url);c.backends.configured.url=url.replace('/table','');
  c.backends.configured.widgets.financials.parameters=['symbol','period'];
  return c;
}
const labels=(result:{rows:{values:Record<string,unknown>}[]})=>result.rows.map(r=>[r.values.fiscal_period??null,r.values.fiscal_year??null]);
it('relabels a statement widget whose URL fixes the period, not only a period param',async()=>{
  const c=await statementSource({yearEnds:{WMT:1,JPM:12}});
  const w=c.backends.configured.widgets.financials;w.url+='?period=quarter';w.parameters=['symbol'];
  expect(labels(await acquireBackend({...binding,params:{symbol:'WMT,JPM'}},c))).toEqual([['FQ2','FY2027'],['FQ4','FY2026'],['Q2','2026']]);
});
it('marks a statement widget from widgets.json and relabels it with the widget\'s credentials, with no operator opt-in',async()=>{
  const seen:string[]=[];const c=await statementSource({yearEnds:{WMT:1,JPM:12},seen});
  const result=await acquireBackend({...binding,params:{symbol:'WMT,JPM',period:'quarter'}},c);
  expect(labels(result)).toEqual([['FQ2','FY2027'],['FQ4','FY2026'],['Q2','2026']]);
  expect(seen.sort()).toEqual([`Bearer private-token ${FY}?symbol=JPM`,`Bearer private-token ${FY}?symbol=WMT`,'Bearer private-token /table?symbol=WMT%2CJPM&period=quarter','Bearer private-token /widgets.json']);
  expect(result.diagnostics).toBeUndefined();
});
it('leaves a non-statement widget alone',async()=>{
  for(const widgets of [
    {income_statement:{endpoint:'table',params:[periodParam(['annual','5y'])]}},
    {income_statement:{endpoint:'table',params:[{paramName:'frequency',options:[{label:'a',value:'annual'},{label:'q',value:'quarter'}]}]}},
  ]) {
    const seen:string[]=[];const c=await statementSource({yearEnds:{WMT:1,JPM:12},widgets,seen});
    const result=await acquireBackend({...binding,params:{symbol:'WMT,JPM',period:'quarter'}},c);
    expect(labels(result)).toEqual([['quarter',2026],['QQ4',2026],[null,null]]);
    expect(result.diagnostics).toBeUndefined();
    expect(seen.some(s=>s.includes(FY))).toBe(false);
  }
  // Not a statement period at all: widgets.json is not even asked.
  const seen:string[]=[];const c=await statementSource({seen});
  expect((await acquireBackend({...binding,params:{symbol:'WMT'}},c)).diagnostics).toBeUndefined();
  expect(seen).toEqual(['Bearer private-token /table?symbol=WMT']);
});
it('leaves a statement source as reported, with the note, when a year end is unknown',async()=>{
  const c=await statementSource({yearEnds:{WMT:1}});
  const result=await acquireBackend({...binding,params:{symbol:'WMT,JPM',period:'quarter'}},c);
  expect(labels(result)).toEqual([['quarter',2026],['QQ4',2026],[null,null]]);
  // The card shows "Fiscal labels as reported" from this mark.
  expect(result.diagnostics).toEqual([{code:'FISCAL_AS_REPORTED',severity:'info',message:'Fiscal labels as reported'}]);
});
it('leaves the rows as reported, with the note, when the backend has no base URL or widgets.json does not answer',async()=>{
  const noUrl=await statementSource({yearEnds:{WMT:1,JPM:12}});delete noUrl.backends.configured.url;
  const silent=await statementSource({yearEnds:{WMT:1,JPM:12},widgets:null});
  const unmatched=await statementSource({yearEnds:{WMT:1,JPM:12},widgets:{other:{endpoint:'elsewhere',params:[periodParam(['annual','quarter'])]}}});
  for(const c of [noUrl,silent,unmatched]) {
    const result=await acquireBackend({...binding,params:{symbol:'WMT,JPM',period:'quarter'}},c);
    expect(labels(result)).toEqual([['quarter',2026],['QQ4',2026],[null,null]]);
    expect(result.diagnostics).toEqual([{code:'FISCAL_AS_REPORTED',severity:'info',message:'Fiscal labels as reported'}]);
  }
});
it('gives the same fiscal labels as the client\'s local Statement rows (parity)',async()=>{
  const {correctStatementRows}=await import('../../src/lib/statementFiscal');
  const yearEnds={WMT:1,JPM:12};const c=await statementSource({yearEnds});
  for(const period of ['annual','quarter','ttm','quarterly_yoy']) {
    const local=correctStatementRows(structuredClone(statementRows),period,yearEnds,['WMT','JPM']).rows;
    const managed=await acquireBackend({...binding,params:{symbol:['WMT','JPM'],period}},c);
    expect(labels(managed)).toEqual(local.map(r=>[r.fiscal_period??null,r.fiscal_year??null]));
  }
});
// User ruling 2026-10-15, "all get relabelled": the same statement rows read the same labels on a backend
// statement card (period param), a managed server source (ingest) and a local file (per row, in the worker).
it('gives every relabel path the same labels for the same rows',async()=>{
  const {correctStatementRows}=await import('../../src/lib/statementFiscal');
  const {datasetFromBytes}=await import('../../src/lib/localTableData');
  const yearEnds={WMT:1,JPM:12};
  for(const [period,kind] of [['quarter','quarter'],['annual','annual'],['ttm','ttm']]) {
    const rows=[{symbol:'WMT',period_ending:'2026-07-31',fiscal_period:kind,fiscal_year:2026},{symbol:'JPM',period_ending:'2026-06-30',fiscal_period:kind,fiscal_year:2026},{symbol:'WMT',period_ending:'2026-01-31',fiscal_period:kind,fiscal_year:2026}];
    const c=await statementSource({yearEnds,rows});
    const of=(values:Record<string,unknown>[])=>values.map(v=>[v.fiscal_period,v.fiscal_year]);
    const card=of(correctStatementRows(structuredClone(rows),period,yearEnds,['WMT','JPM']).rows);
    const managed=of((await acquireBackend({...binding,params:{symbol:'WMT,JPM',period}},c)).rows.map(r=>r.values));
    const local=of((await datasetFromBytes('s.json',new TextEncoder().encode(JSON.stringify(rows)),'w',1,yearEnds)).rows.map(r=>r.values));
    expect(card).not.toEqual(of(rows));
    expect([managed,local]).toEqual([card,card]);
  }
});
it('looks up year ends only for the symbols the rows carry, at most 64 of them',async()=>{
  const seen:string[]=[];const c=await statementSource({yearEnds:{WMT:1,JPM:12},seen});
  const many=Array.from({length:500},(_,i)=>`S${i}`).join(',');
  const result=await acquireBackend({...binding,params:{symbol:`WMT,JPM,${many}`,period:'quarter'}},c);
  expect(labels(result)).toEqual([['FQ2','FY2027'],['FQ4','FY2026'],['Q2','2026']]);
  expect(seen.filter(s=>s.includes(FY)).sort()).toEqual([`Bearer private-token ${FY}?symbol=JPM`,`Bearer private-token ${FY}?symbol=WMT`]);
  // Past the cap the rest stay as reported, with the note.
  const rows=Array.from({length:70},(_,i)=>({symbol:`S${i}`,period_ending:'2026-06-30',revenue:i}));
  const yearEnds=Object.fromEntries(rows.map(r=>[r.symbol,12]));
  const capped:string[]=[];const c2=await statementSource({yearEnds,rows,seen:capped});
  const r2=await acquireBackend({...binding,params:{symbol:'S0',period:'quarter'}},c2);
  expect(capped.filter(s=>s.includes(FY))).toHaveLength(64);
  expect(r2.diagnostics).toEqual([{code:'FISCAL_AS_REPORTED',severity:'info',message:'Fiscal labels as reported'}]);
});
it('adds no note to an untellable source whose rows are not statement rows',async()=>{
  const c=await statementSource({rows:[{date:'2026-01-01',gdp:1}]});delete c.backends.configured.url;
  expect((await acquireBackend({...binding,params:{symbol:'US',period:'annual'}},c)).diagnostics).toBeUndefined();
});
