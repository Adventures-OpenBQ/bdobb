// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import {createServer,type Server,type RequestListener} from 'node:http';
import {afterEach,expect,it} from 'vitest';
import {acquireTemporalExecution,type TemporalAcquisitionConfig} from './temporal';
import {executionId,page,receipt} from '../../src/lib/temporal/fixtures';
const servers:Server[]=[];afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>new Promise<void>(r=>{s.closeAllConnections();s.close(()=>r());})));});
async function upstream(handler:RequestListener){const s=createServer(handler);servers.push(s);await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${(s.address() as {port:number}).port}/temporal/v1`;}
function config(url:string):TemporalAcquisitionConfig{return {url,principal:'alice',principalHeaders:{alice:{Authorization:'Bearer scoped-for-alice'}},maxBytes:1000000,maxRows:2000,maxColumns:10,timeoutMs:1000,targetWidgetId:'full',inputRevision:1};}
const binding={executionId,resultHash:receipt.result_hash};
it('exhausts retained pages on the server with scoped credentials and complete provenance',async()=>{
 const requests:string[]=[];const url=await upstream((req,res)=>{expect(req.headers.authorization).toBe('Bearer scoped-for-alice');requests.push(req.url!);const next=req.url?.includes('cursor=');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...page,total_count:1001,rows:next?[{Revenue:1001}]:Array.from({length:1000},(_,i)=>({Revenue:i})),next_cursor:next?null:'next'}));});
 const data=await acquireTemporalExecution(binding,config(url));expect(requests).toEqual([`/temporal/v1/executions/${executionId}/pages`,`/temporal/v1/executions/${executionId}/pages?cursor=next`]);
 expect(data.rows).toHaveLength(1001);expect(data.rows[1000]).toMatchObject({id:`${executionId}:1000`,values:{Revenue:1001}});expect(data.completeness).toMatchObject({kind:'complete',acquiredRowCount:1001,totalRowCount:1001});
 expect(data.provenance.receipt?.temporal).toMatchObject({executionId,resultHash:receipt.result_hash});expect(JSON.stringify(data)).not.toContain('scoped-for-alice');
});
it('denies an unmapped principal before any network request',async()=>{let hits=0;const url=await upstream((_q,r)=>{hits++;r.end('{}');});await expect(acquireTemporalExecution(binding,{...config(url),principal:'bob'})).rejects.toThrow('Could not acquire retained temporal source');expect(hits).toBe(0);});
it.each(['receipt','scope','loop','partial','count','redirect','bytes','rows'] as const)('refuses %s rather than publishing a complete dataset',async bad=>{
 let hits=0;const url=await upstream((_q,r)=>{hits++;r.setHeader('Content-Type','application/json');if(bad==='scope'){r.writeHead(403);r.end('{}');return;}if(bad==='redirect'){r.writeHead(302,{Location:'/elsewhere'});r.end();return;}
 const p={...page,total_count:2,rows:[{Revenue:10}],next_cursor:hits===1?'next':null,receipt:{...receipt}};
 if(bad==='receipt'&&hits>1)p.receipt.result_hash='b'.repeat(64);if(bad==='loop')p.next_cursor='next';if(bad==='partial')p.truncated=true;if(bad==='count')p.total_count=3;
 r.end(JSON.stringify(p));});const c=config(url);if(bad==='bytes')c.maxBytes=32;if(bad==='rows')c.maxRows=1;
 await expect(acquireTemporalExecution(binding,c)).rejects.toThrow('Could not acquire retained temporal source');expect(hits).toBeLessThanOrEqual(2);
});
it('retains exact large-integer and decimal strings',async()=>{
 const schema=[{name:'Revenue',type:'decimal128(38, 18)',nullable:false},{name:'Id',type:'int64',nullable:false}];
 const url=await upstream((_q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify({...page,total_count:1,rows:[{Revenue:'1.000000000000000001',Id:'9007199254740993'}],schema,receipt:{...receipt,schema},next_cursor:null}));});
 const data=await acquireTemporalExecution(binding,config(url));expect(data.rows[0].values).toEqual({Revenue:'1.000000000000000001',Id:'9007199254740993'});expect(data.columns.map(c=>c.dtype)).toEqual(['text','text']);
});
it('connects an admitted backend binding to the temporal acquisition path',async()=>{
 const {acquireBackend}=await import('./backend');
 const url=await upstream((_q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify({...page,total_count:1,rows:[{Revenue:7}],next_cursor:null}));});
 const context={...config(url),backends:{tdb:{widgets:{temporal_execution:{url,parameters:['execution_id','expected_hash'],response:{kind:'temporalExecution' as const,principalHeaders:{alice:{Authorization:'Bearer scoped-for-alice'}}}}}}}};
 const data=await acquireBackend({backendId:'tdb',widgetId:'temporal_execution',params:{execution_id:executionId,expected_hash:receipt.result_hash}},context);
 expect(data.rows[0].values.Revenue).toBe(7);expect(data.provenance.receipt?.temporal).toMatchObject({executionId});
});
