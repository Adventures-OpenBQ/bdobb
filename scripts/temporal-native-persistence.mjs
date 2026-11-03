// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Real OS files + fresh processes through production dashboardsFile/jsonStore.
// This verifies the persistence boundary; it does not launch a packaged Tauri app.
import {build} from 'esbuild';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const dir=mkdtempSync(join(tmpdir(),'temporal-native-persistence-'));
const fsAdapter=join(dir,'fs.mjs');
writeFileSync(fsAdapter,`
import * as fs from 'node:fs/promises';import {join} from 'node:path';
const base=process.env.TEMPORAL_TEST_DATA;const path=p=>join(base,p);
export const BaseDirectory={AppData:1};
export const exists=async p=>{try{await fs.access(path(p));return true;}catch{return false;}};
export const mkdir=(p,opts)=>fs.mkdir(path(p),{recursive:opts?.recursive});
export const readDir=async p=>(await fs.readdir(path(p),{withFileTypes:true})).map(e=>({name:e.name,isDirectory:e.isDirectory(),isFile:e.isFile(),isSymlink:e.isSymbolicLink()}));
export const readTextFile=p=>fs.readFile(path(p),'utf8');
export const writeTextFile=(p,text,opts)=>fs.writeFile(path(p),text,{flag:opts?.append?'a':'w'});
export const remove=p=>fs.rm(path(p));export const rename=(a,b)=>fs.rename(path(a),path(b));export const stat=p=>fs.stat(path(p));
`);
const eventAdapter=join(dir,'events.mjs');writeFileSync(eventAdapter,'export const emit=async()=>{};export const listen=async()=>()=>{};');
const fixture=resolve('src/lib/temporal/fixtures.ts'),entry=join(dir,'driver.ts');
writeFileSync(entry,`
import assert from 'node:assert/strict';
import {saveDashboard,loadDashboards,storedDashboard,readStoredDashboard} from ${JSON.stringify(resolve('src/lib/dashboardsFile.ts'))};
import {parseQueryBinding} from ${JSON.stringify(resolve('src/lib/temporal/bindings.ts'))};
import {fixed,executionId} from ${JSON.stringify(fixture)};
const bindings=[fixed,{kind:'query',queryId:fixed.queryId,revisionPolicy:'latest',params:{},context:fixed.context},{kind:'execution',executionId}];
if(process.argv[2]==='write'){
 await saveDashboard({id:'native-query-proof',name:'Native query proof',tabs:[{id:'t',name:'Tab',cards:bindings.map((queryBinding,i)=>({id:'q'+i,widgetId:'query_data',backendId:'exact-backend',params:{},layout:{x:0,y:0,w:20,h:10},queryBinding}))}]});
 await saveDashboard({id:'future-query-proof',name:'Future query proof',tabs:[{id:'t',name:'Tab',cards:[{id:'future',widgetId:'query_data',backendId:'exact-backend',params:{},layout:{x:0,y:0,w:20,h:10},queryBinding:{...fixed,schemaVersion:99}},{id:'malformed',widgetId:'query_data',backendId:'exact-backend',params:{},layout:{x:0,y:0,w:20,h:10},queryBinding:{...fixed,revision:0}}]}]});
 console.log(JSON.stringify({phase:'write',pid:process.pid,bindings:3,invalidBindings:2}));
}else{
 const loaded=await loadDashboards();const dashboard=loaded.find(d=>d.id==='native-query-proof');assert(dashboard);
 const invalid=loaded.find(d=>d.id==='future-query-proof');assert(invalid);for(const card of invalid.tabs[0].cards)assert.throws(()=>parseQueryBinding(card.queryBinding));
 const actual=dashboard.tabs[0].cards.map(c=>parseQueryBinding(c.queryBinding));assert.deepEqual(actual,bindings);
 const file=JSON.stringify(storedDashboard(dashboard));assert(!file.includes('result_hash'));assert(!file.includes('headerValue'));
 const future=JSON.parse(file);future.tabs[0].cards[0].queryBinding.schemaVersion=99;
 const retained=readStoredDashboard(future);assert.deepEqual(retained.tabs[0].cards[0].queryBinding,future.tabs[0].cards[0].queryBinding);assert.throws(()=>parseQueryBinding(retained.tabs[0].cards[0].queryBinding));
 console.log(JSON.stringify({phase:'read-after-restart',pid:process.pid,bindings:actual.length,futureRetained:true}));
}
`);
const output=join(dir,'driver.mjs');
await build({entryPoints:[entry],outfile:output,bundle:true,platform:'node',format:'esm',target:'node22',plugins:[{name:'native-fs-boundary',setup(builder){builder.onResolve({filter:/^@tauri-apps\/plugin-fs$/},()=>({path:fsAdapter}));builder.onResolve({filter:/^@tauri-apps\/api\/event$/},()=>({path:eventAdapter}));}}]});
const receipts=[];let invalidBefore;

for(const phase of ['write','read']){const result=spawnSync(process.execPath,[output,phase],{encoding:'utf8',env:{...process.env,TEMPORAL_TEST_DATA:dir}});assert.equal(result.status,0,result.stderr);receipts.push(JSON.parse(result.stdout));if(phase==='write')invalidBefore=readFileSync(join(dir,'dashboards/future-query-proof.json'),'utf8');}
assert.equal(readFileSync(join(dir,'dashboards/future-query-proof.json'),'utf8'),invalidBefore);
assert.notEqual(receipts[0].pid,receipts[1].pid);
const bytes=readFileSync(join(dir,'dashboards/native-query-proof.json'),'utf8');assert.equal(JSON.parse(bytes).tabs[0].cards.length,3);assert(!readdirSync(join(dir,'dashboards')).some(p=>p.includes('.corrupt')));
console.log(JSON.stringify({boundary:'production dashboardsFile/jsonStore + real OS filesystem + independent Node processes; not packaged Tauri',directory:dir,receipts,bytes:Buffer.byteLength(bytes)},null,2));
