// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
if(process.platform !== 'linux')throw new Error('This smoke requires real Linux worker containment');
const {TABLE_SMOKE_GATEWAY,TABLE_SMOKE_SERVICE,TABLE_SMOKE_WORKER,TABLE_SMOKE_INGEST}=process.env;
if(!TABLE_SMOKE_GATEWAY || !TABLE_SMOKE_SERVICE || !TABLE_SMOKE_WORKER || !TABLE_SMOKE_INGEST)throw new Error('Set TABLE_SMOKE_GATEWAY (canonical server.mjs), TABLE_SMOKE_SERVICE, TABLE_SMOKE_WORKER and TABLE_SMOKE_INGEST absolute paths');
const {createGateway}=await import(pathToFileURL(resolve(TABLE_SMOKE_GATEWAY)).href);
const dir=await mkdtemp(join(tmpdir(),'table-gateway-smoke-'));
const servicePort=Number(process.env.TABLE_SMOKE_PORT ?? 18080);
const token='task10_shared_test_bearer_credential_12345', relay='task10_private_relay_credential_123456789', serviceToken='task10_private_service_credential_1234567';
const config={listen:`127.0.0.1:${servicePort}`,catalog_path:dir+'/durable-sources',catalog:{limits:{max_parse_bytes:8388608,max_upload_bytes:1048576,max_row_block_rows:2},backend_widgets:{}},auth:{desktop_tokens:{},gateway_token:serviceToken},ingestion:{node:process.execPath,entry:resolve(TABLE_SMOKE_INGEST),backend_config:null,max_concurrent_children:1,max_child_heap_mb:128},worker:{executable:resolve(TABLE_SMOKE_WORKER),memory_budget_bytes:536870912,max_frame_bytes:8392704,max_starting_workers:2},runtime:{compute_workers:2,max_admitted_jobs:4,max_http_requests:4}};
await writeFile(dir+'/settings.json',JSON.stringify(config),{mode:0o600});
let service,gateway;
async function start(){service=spawn(resolve(TABLE_SMOKE_SERVICE),[],{env:{...process.env,TABLE_SERVICE_CONFIG:dir+'/settings.json'},stdio:['ignore','ignore','inherit']});for(let n=0;n<100;n++){try{const r=await fetch(`http://127.0.0.1:${servicePort}/healthz`);if(r.status===401)return;}catch{/* Wait for this task-owned listener to become ready. */}await new Promise(r=>setTimeout(r,20));}throw new Error('startup');}
async function stop(){const done=once(service,'exit');service.kill('SIGTERM');await done;service=null;}
async function call(path,method='GET',body,principal='github:42',extra={}){
 const response=await fetch(`http://127.0.0.1:${gateway.address().port}/table${path}`,{method,headers:{Authorization:`Bearer ${token}`,...(principal?{'X-Table-Relay-Token':relay,'X-Table-Principal':principal}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...extra},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
 return {status:response.status,json:await response.json()};
}
const check=(result,status=200)=>{assert.equal(result.status,status,JSON.stringify(result));return result.json;};
async function apply(session,widget='widget',input=1){return check(await call(`/sessions/${session.sessionId}/commands`,'POST',{sessionId:session.sessionId,sourceSnapshotId:session.sourceSnapshotId,wire:JSON.stringify({protocolVersion:1,sessionId:1,request:{kind:'applyModel',requestId:'apply-'+widget,revision:{widgetId:widget,input,model:1,output:1},definition:{protocolVersion:1,locale:'en-US',definition:{table:{},search:''}},selection:{kind:'none'},reconcileMissing:false,provenAbsentIds:[],runtimeParams:[]}})}));}
try{
 await start();
 const gatewayConfig={origin:'http://127.0.0.1',token,apiAuthorization:'unused',maxConcurrent:8,tableOrigin:`http://127.0.0.1:${servicePort}`,tableGatewayToken:serviceToken,tableRelayToken:relay,tableDesktopPrincipal:'desktop:owner',ssrmRoutes:[]};gateway=createGateway(gatewayConfig);gateway.listen(0,'127.0.0.1');await once(gateway,'listening');gatewayConfig.origin=`http://127.0.0.1:${gateway.address().port}`;
 check(await call('/healthz'));const discovery=check(await call('/widgets.json'));assert.equal(discovery.managed_table.provider,'managed-native');
 const upload=check(await call('/sources/uploads','POST','x,y\n1,a\n2,b\n3,c\n4,d\n5,e\n','github:42',{'Content-Type':'text/csv','Idempotency-Key':'task10-'+Date.now(),'X-Upload-Filename':'smoke.csv'}));
 const open={sourceId:upload.sourceId,protocolVersion:1,widgetId:'widget',locale:'en-US',inputRevision:1};
 check(await call('/sessions','POST',open,'github:43'),404);
 check(await call('/sessions','POST',open,null,{'X-Table-Principal':'github:42','X-Table-Gateway-Token':serviceToken}),404);
 const parent=await apply(check(await call('/sessions','POST',open)));
 assert.equal(JSON.parse(parent.wire).response.topLevelCount.value,5);
 const child=check(await call(`/sessions/${parent.sessionId}/derive`,'POST',{parent:{sessionId:parent.sessionId,sourceSnapshotId:parent.sourceSnapshotId,resultId:parent.resultId},revision:{widgetId:'widget',input:1,model:1,output:1},requestId:'derive-task10',protocolVersion:1,widgetId:'child',inputRevision:7,locale:'en-US'}));
 assert.equal(child.rows,undefined);assert.equal(child.sourceId,undefined);
 const applied=await apply(child,'child',7);assert.equal(JSON.parse(applied.wire).response.topLevelCount.value,5);
 let workers=0;
 for(const pid of await readdir('/proc')){if(!/^\d+$/.test(pid))continue;try{const command=await readFile(`/proc/${pid}/comm`,'utf8');if(!command.startsWith('pivot-native'))continue;const limits=await readFile(`/proc/${pid}/limits`,'utf8');assert.match(limits,/Max address space\s+536870912\s+536870912/);workers++;}catch(error){if(error.code!=='ENOENT')throw error;}}
 assert.ok(workers>=2,`contained workers: ${workers}`);
 const exported=check(await call(`/sessions/${applied.sessionId}/exports`,'POST',{sessionId:applied.sessionId,sourceSnapshotId:applied.sourceSnapshotId,resultId:applied.resultId,wire:JSON.stringify({protocolVersion:1,sessionId:1,request:{kind:'presented',requestId:'export-child',revision:{widgetId:'child',input:7,model:1,output:1},transferId:'task10-export',ignoreSelection:false}})}));
 assert.equal(JSON.parse(exported.batch.wire).response.rows.length,2);
 const next=check(await call(`/exports/${exported.exportId}/batches?sequence=1`));assert.equal(JSON.parse(next.wire).response.rows.length,2);
 await stop();await start();
 check(await call(`/sessions/${parent.sessionId}/commands`,'POST',{sessionId:parent.sessionId,sourceSnapshotId:parent.sourceSnapshotId,wire:JSON.stringify({protocolVersion:1,sessionId:1,request:{kind:'inputSchema',requestId:'after-restart',revision:{widgetId:'widget',input:1,model:1,output:1}}})}),410);
 const reopened=check(await call('/sessions','POST',open));const reapplied=await apply(reopened);assert.equal(JSON.parse(reapplied.wire).response.topLevelCount.value,5);
 check(await call('/sessions','POST',open,'github:43'),404);
 check(await call(`/sessions/${reopened.sessionId}`,'DELETE'));check(await call(`/sources/${upload.sourceId}`,'DELETE'));
 console.log(JSON.stringify({result:'PASS',node:process.versions.node,icu:process.versions.icu,containedWorkers:workers,upload:true,foreignOwnerRefused:true,desktopSpoofRefused:true,deriveRows:5,exportBatchRows:2,restartReopen:true,oldSessionUnavailable:true}));
}finally{if(gateway)gateway.closeGateway();if(service)await stop();await rm(dir,{recursive:true,force:true});}
