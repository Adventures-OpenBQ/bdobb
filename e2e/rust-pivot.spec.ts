// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {test,expect,type Page} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {decodeWire,type WireValue} from '../src/lib/tableExecution/rust/wireCodec';
import type {OracleCase,OracleResult} from '../src/lib/tableExecution/rust/oracle';

declare global {interface Window {pivotHarness:{finalReviewProbe():Promise<unknown>;wasmUrl:string;batchProbe():Promise<{sequence:number;final:boolean;ids:string[];metadata:boolean}[]>;stats:{active:number;terminated:number;pending:number};disposeRace():Promise<{rejected:boolean;terminated:number}>;trace(frozen:WireValue):Promise<WireValue>;memory():Promise<{shared:boolean;buffer:boolean;isolated:boolean}>}}}
function equivalent(actual:unknown,expected:unknown,path=''):void {
 if(typeof actual==='number'&&typeof expected==='number'&&/(margin|ratio|mean|avg)/i.test(path)&&Number.isFinite(actual)&&Number.isFinite(expected)){
  assert.ok(Math.abs(actual-expected)<=Math.max(1e-12,1e-12*Math.max(Math.abs(actual),Math.abs(expected))),path);return;
 }
 if(actual&&expected&&typeof actual==='object'&&typeof expected==='object'){
  assert.equal(Array.isArray(actual),Array.isArray(expected),path);assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),path);
  for(const key of Object.keys(expected))equivalent((actual as Record<string,unknown>)[key],(expected as Record<string,unknown>)[key],`${path}.${key}`);return;
 }
 assert.deepEqual(actual,expected,path);
}
function workerSubset(subset:Required<OracleResult>['export']) {
 const batches=[];const count=Math.max(1,Math.ceil(subset.rows.length/500));
 for(let sequence=0;sequence<count;sequence++){
  const {columns:_columns,provenance:_provenance,freshness:_freshness,...common}=subset.batches[0];
  batches.push({...common,...(sequence===0?{columns:subset.columns,provenance:subset.provenance,freshness:subset.freshness}:{}),sequence,rows:subset.rows.slice(sequence*500,(sequence+1)*500),final:sequence===count-1});
 }
 return {...subset,batches};
}
async function check(page:Page,url:string,all:boolean){
 const origin=new URL(url).origin,external:string[]=[],errors:string[]=[],wasmResponses:{status:number;mime:string;url:string}[]=[];
 await page.context().route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(new URL(response.url()).pathname.endsWith('.wasm')&&response.request().resourceType()==='fetch')wasmResponses.push({status:response.status(),mime:response.headers()['content-type'],url:response.url()});});
 await page.goto(url);await expect(page.locator('#status')).toHaveText('Portable Pivot ready');
 expect(await page.evaluate(()=>window.pivotHarness.memory())).toEqual({shared:false,buffer:true,isolated:false});
 const files=all?readdirSync('src/test/fixtures/rust-pivot').filter(name=>name.endsWith('.json')):['legacy-all-operators.json','runtime-authoring-linked.json','statement-income-long.json','typed-blanks.json'];
 for(const file of files){
  const frozen=JSON.parse(readFileSync(`src/test/fixtures/rust-pivot/${file}`,'utf8')) as WireValue;
  const {case:c,result:want}=decodeWire(frozen) as {case:OracleCase;result:Required<OracleResult>};
  const actual=decodeWire(await page.evaluate(frozen=>window.pivotHarness.trace(frozen),frozen));
  if(c.expectFailure){equivalent(actual,{error:want.error.message},file);continue;}
  const operations=want.operations.map((op,i)=>c.operations[i].kind==='identityWitness'&&'path' in c.operations[i]&&c.operations[i].path.length<2?undefined:op.value);
  equivalent(actual,{ready:want.ready,operations,deliveries:want.deliveries.map(({size,blocks})=>({size,blocks})),facets:want.facets,inspection:want.inspection,totals:want.totals,selection:want.selection,chart:want.chart,linked:workerSubset(want.linked),export:workerSubset(want.export)},file);
 }
 expect(await page.evaluate(()=>window.pivotHarness.stats)).toEqual({active:0,terminated:files.length,pending:0});
 expect(await page.evaluate(()=>window.pivotHarness.disposeRace())).toEqual({rejected:true,terminated:1});
 const batches=await page.evaluate(()=>window.pivotHarness.batchProbe());expect(batches.map(({sequence,final,ids,metadata})=>({sequence,final,rows:ids.length,metadata}))).toEqual([{sequence:0,final:false,rows:500,metadata:true},{sequence:1,final:false,rows:500,metadata:false},{sequence:2,final:true,rows:1,metadata:false}]);expect(batches.flatMap(batch=>batch.ids)).toEqual(Array.from({length:1001},(_,i)=>`r${i}`));
 expect(errors).toEqual([]);expect(external).toEqual([]);expect(wasmResponses.length).toBeGreaterThan(0);
 for(const response of wasmResponses){expect(response.status).toBe(200);expect(response.mime).toMatch(/^application\/wasm/);if(url.includes('/nested/'))expect(new URL(response.url).pathname).toMatch(/^\/nested\//);}
}
test('built worker contracts under packaged desktop CSP, local unshared Wasm and disposal',async({page})=>{await check(page,'http://127.0.0.1:4175/built/',true);});
test('non-root built asset paths retain contracts',async({page})=>{await check(page,'http://127.0.0.1:4175/nested/',false);});
test('direct Vite dev serves Wasm with portable contracts',async({page})=>{await check(page,'http://127.0.0.1:4176/dev/rust-pivot.html',true);});
test('authenticated private web assets keep MIME, cache, routes and worker contracts',async({page,context})=>{
 const cookie=JSON.parse(readFileSync('dist/pivot-conformance/session.json','utf8'));await context.addCookies([cookie]);
 await check(page,'https://localhost:4177/',false);
 const url=await page.evaluate(()=>new URL(window.pivotHarness.wasmUrl,location.href).href);
 const response=await context.request.get(url);expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toBe('private, no-store');expect(response.headers()['vercel-cdn-cache-control']).toBe('no-store');
 expect((await context.request.get(url+'?x=1')).status()).toBe(404);expect((await context.request.get('https://localhost:4177/assets/missing.wasm')).status()).toBe(404);
 await context.clearCookies();expect((await context.request.get(url)).status()).toBe(401);
});
test('built Rust worker module graph excludes TypeScript calculation',()=>{
 const graph=JSON.parse(readFileSync('dist/pivot-conformance/root/rust-worker-graph.json','utf8')) as {entry:string;modules:string[]};
 expect(graph.entry).toBe('src/lib/tableExecution/rust/rust.worker.ts');const sources=graph.modules;
 expect(sources.some(name=>name.endsWith('rust/runtime.ts'))).toBe(true);
 expect(sources.some(name=>name.endsWith('localTableData.ts'))).toBe(true);
 expect(sources.some(name=>name.includes('xlsx'))).toBe(true);
 const forbidden=/tableExecution\/(?:engine|resultStore|table\.worker|formulaAuthoring|identityWitness)\.(?:ts|js)$|tableModel\/(?:calculate|formulaEvaluation|totals|layoutValues|scopes)\.ts$|statementModel\/(?:calculate|compile)\.ts$|pivotTable\.ts$/;
 expect(sources.filter(name=>forbidden.test(name))).toEqual([]);
});

test('review regressions preserve structural tag maps, leaf metadata and old publication after coercion refusal',async({page})=>{
 await page.goto('http://127.0.0.1:4175/built/');await expect(page.locator('#status')).toHaveText('Portable Pivot ready');
 expect(await page.evaluate(()=>window.pivotHarness.finalReviewProbe())).toEqual({structural:true,leaves:[['b','percent','b'],['a','int','a']],coercions:[{refused:true,id:'old',totalsRevision:1,exported:['old']},{refused:true,id:'old',totalsRevision:1,exported:['old']}]});
});
