// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('@tauri-apps/plugin-http',()=>({fetch:vi.fn()}));
import {fetch} from '@tauri-apps/plugin-http';
import {backend} from '../../test/fixtures';
import {createTemporalClient,temporalErrorText} from './client';
import {temporalScope} from './security';
import {parseContract,parseResultPage} from './contracts';
import {coverage,dataset,definition,description,executionId,page,queryId} from './fixtures';
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
beforeEach(()=>{vi.mocked(fetch).mockReset();});
it('uses existing URL and auth placement for actual Q1 Q2 and Q3 routes',async()=>{
 const client=createTemporalClient(backend({baseUrl:'https://example.test/root/',headerName:'Authorization',headerValue:'Bearer secret'}));
 vi.mocked(fetch).mockResolvedValueOnce(response({queries:[definition]}));expect(await client.list()).toEqual([definition]);
 expect(vi.mocked(fetch).mock.calls[0]).toMatchObject(['https://example.test/root/temporal/v1/queries',{headers:{Authorization:'Bearer secret'}}]);
 vi.mocked(fetch).mockResolvedValueOnce(response({execution_id:executionId,state:'queued'}));
 await client.start({query_id:queryId,revision:2,params:{},context:definition.temporal});
 expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body))).toMatchObject({revision:2,page_size:1000});
 vi.mocked(fetch).mockResolvedValueOnce(response({execution_id:executionId,state:'queued'}));
 await client.replay(executionId);expect(String(vi.mocked(fetch).mock.calls.at(-1)![0]).endsWith(`/audits/${executionId}/replay`)).toBe(true);
 vi.mocked(fetch).mockResolvedValueOnce(response({error:{code:'ACCESS_DENIED',message:'credentials or scope rejected',request_id:queryId}},401));
 await expect(client.list()).rejects.toMatchObject({code:'ACCESS_DENIED',status:401});
});
it('validates canonical definitions, conditional temporal rules and finite typed pages at runtime',()=>{
 expect(parseContract('QueryDefinition',definition)).toEqual(definition);
 for(const bad of [{...definition,revision:0},{...definition,schema_version:2},{...definition,temporal:{mode:'known_at'}},{...definition,extra:true}])expect(()=>parseContract('QueryDefinition',bad)).toThrow();
 expect(parseResultPage({...page,rows:[{Revenue:'9223372036854775807'}]}).rows[0].Revenue).toBe('9223372036854775807');
 expect(()=>parseResultPage({...page,schema:[page.schema[0],page.schema[0]]})).toThrow();
 expect(()=>parseResultPage({...page,rows:[{Revenue:Infinity}]})).toThrow();
});
it('honors query and cookie credentials on every verb and preserves transport errors',async()=>{
 for(const authLocation of ['query','cookie'] as const){
  vi.mocked(fetch).mockResolvedValueOnce(response({retired:true}));
  await createTemporalClient(backend({baseUrl:'https://example.test',headerName:'key',headerValue:'a+b=',authLocation})).retire(queryId);
  const [url,init]=vi.mocked(fetch).mock.calls.at(-1)!;expect(init!.method).toBe('DELETE');
  if(authLocation==='query')expect(new URL(String(url)).searchParams.get('key')).toBe('a+b=');else expect(init!.headers).toMatchObject({Cookie:'key=a+b='});
 }
 vi.mocked(fetch).mockRejectedValue(new Error('offline'));
 await expect(createTemporalClient(backend()).list()).rejects.toThrow('offline');
});

it('validates typed scalar wire values without converting exact decimal, date or large integer strings',()=>{
 const schema=[{name:'Id',type:'int64',nullable:false},{name:'Amount',type:'decimal128(38, 18)',nullable:false},{name:'Day',type:'date32[day]',nullable:false}];
 const value={...page,schema,receipt:{...page.receipt,schema},rows:[{Id:'9223372036854775807',Amount:'1.000000000000000001',Day:'2026-10-15'}]};
 expect(parseResultPage(value).rows[0]).toEqual(value.rows[0]);
 for(const row of [{...value.rows[0],Id:Number('9223372036854775807')},{...value.rows[0],Amount:Number('1.000000000000000001')},{...value.rows[0],Day:'2026-02-30'}])expect(()=>parseResultPage({...value,rows:[row]})).toThrow();
});

it('uses the exact Q1 import/export/revision and Q3 protect/get/replay bodies',async()=>{
 const client=createTemporalClient(backend({baseUrl:'https://temporal.test'}));
 vi.mocked(fetch).mockResolvedValueOnce(response(definition));await client.revise(queryId,2,definition);expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body))).toEqual({expected_revision:2,definition});
 vi.mocked(fetch).mockResolvedValueOnce(response({version:1,entries:[]}));await client.exportQuery(queryId,2,executionId);expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toContain(`/queries/${queryId}/export?revision=2&receipt_id=${executionId}`);
 vi.mocked(fetch).mockResolvedValueOnce(response({import_id:executionId,entries:[{index:0,status:'unavailable',reason:'unsupported source'}]}));expect((await client.importEntries([{version:99}])).entries[0].status).toBe('unavailable');expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body))).toEqual({entries:[{version:99}]});
 const audit={run_id:queryId,execution_id:executionId,label:'Protected run',hold_ids:[queryId],record:{}};
 vi.mocked(fetch).mockResolvedValueOnce(response(audit));expect(await client.protect(executionId,'Protected run')).toEqual(audit);expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body))).toEqual({execution_id:executionId,label:'Protected run'});
 vi.mocked(fetch).mockResolvedValueOnce(response(audit));await client.audit(queryId);expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toContain(`/audits/${queryId}`);
});

it('preserves nonempty large snapshot pins from the actual pages HTTP body',async()=>{
 const client=createTemporalClient(backend());const ids=[Number.MAX_SAFE_INTEGER,'9007199254740992','9223372036854775807'];
 const result={...page,receipt:{...page.receipt,input_manifest:{...page.receipt.input_manifest,pins:ids.map((snapshot_id,i)=>({catalog_id:`catalog-${i}`,snapshot_id}))}}};
 vi.mocked(fetch).mockResolvedValueOnce(response(result));
 const loaded=await client.page(executionId);expect(loaded.receipt.input_manifest.pins.map(p=>p.snapshot_id)).toEqual(ids);
});

it('evicts the TemporalDB scope on 401 but fails only the request on a per-resource 403',async()=>{
 const client=createTemporalClient(backend());const before=temporalScope('b');
 vi.mocked(fetch).mockResolvedValueOnce(response({error:{code:'ACCESS_DENIED',message:'query not entitled',request_id:queryId}},403));
 await expect(client.get(queryId)).rejects.toMatchObject({code:'ACCESS_DENIED',status:403});
 expect(temporalScope('b')).toBe(before);
 vi.mocked(fetch).mockResolvedValueOnce(response({error:{code:'ACCESS_DENIED',message:'credentials rejected',request_id:queryId}},401));
 await expect(client.list()).rejects.toMatchObject({status:401});
 expect(temporalScope('b')).not.toBe(before);
});

it('calls cache discovery and validate with exact routes and bodies and validates the answers',async()=>{
 const client=createTemporalClient(backend({baseUrl:'https://temporal.test'}));
 vi.mocked(fetch).mockResolvedValueOnce(response({datasets:[dataset],next_cursor:'abc.def',consistency:'live_per_page',observed_at:'2026-10-19T00:00:00Z'}));
 expect((await client.datasets({cursor:'a_b.c',limit:50})).datasets[0].dataset_id).toBe('eodhd.eod');
 expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toContain('/temporal/v1/cache/datasets?cursor=a_b.c&limit=50');
 await expect(client.datasets({limit:101})).rejects.toThrow('Invalid page limit');
 vi.mocked(fetch).mockResolvedValueOnce(response(description));
 expect((await client.describe({dataset_id:'eodhd.eod',tier:'silver'})).observed_schema?.[0].name).toBe('raw_close');
 expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body))).toEqual({dataset_id:'eodhd.eod',tier:'silver'});
 vi.mocked(fetch).mockResolvedValueOnce(response(coverage));
 expect((await client.coverage({dataset_id:'eodhd.eod',tier:'silver',filters:{symbol:'AAPL.US'},limit:50})).completeness.status).toBe('unknown');
 expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toContain('/temporal/v1/cache/coverage');
 vi.mocked(fetch).mockResolvedValueOnce(response({valid:true,definition,availability_checked:false,executed:false,saved:false}));
 expect((await client.validate(definition)).valid).toBe(true);
 expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body))).toEqual({definition});
 vi.mocked(fetch).mockResolvedValueOnce(response({...description,observed_schema:[{name:'x'}]}));
 await expect(client.describe({dataset_id:'eodhd.eod',tier:'silver'})).rejects.toThrow('Invalid TemporalDB dataset description');
});

it('carries the request ID on TemporalDB errors and evicts the scope on a discovery 401',async()=>{
 const client=createTemporalClient(backend());const before=temporalScope('b');
 vi.mocked(fetch).mockResolvedValueOnce(response({error:{code:'CAPABILITY_UNAVAILABLE',message:'requested cache metadata unavailable',request_id:executionId}},422));
 const error=await client.describe({dataset_id:'eodhd.eod',tier:'gold'}).catch(e=>e);
 expect(error).toMatchObject({code:'CAPABILITY_UNAVAILABLE',status:422,requestId:executionId});
 expect(temporalErrorText(error)).toBe(`requested cache metadata unavailable (request ${executionId})`);
 expect(temporalScope('b')).toBe(before);
 vi.mocked(fetch).mockResolvedValueOnce(response({error:{code:'ACCESS_DENIED',message:'credentials or scope rejected',request_id:executionId}},401));
 await expect(client.datasets()).rejects.toMatchObject({status:401});
 expect(temporalScope('b')).not.toBe(before);
});

it('uses scoped policy discovery and durable run routes without starting an execution',async()=>{
 const client=createTemporalClient(backend({baseUrl:'https://temporal.test'}));
 const policy={policy_id:queryId,revision:3,title:'Reviewed daily prices',enabled:true,datasets:['eodhd.eod']};
 const request={query_id:queryId,revision:2,params:{symbol:'AAPL.US'},context:definition.temporal,policy_id:queryId,policy_revision:3,idempotency_key:'widget:stable-attempt'};
 const handle={run_id:executionId,state:'waiting',policy_id:queryId,policy_revision:3,submitted_at:'2026-11-03T20:00:00Z',deadline:'2026-11-03T20:05:00Z',context:definition.temporal,stage:'coverage',resolved_params:request.params};
 vi.mocked(fetch).mockResolvedValueOnce(response({schema_version:1,policies:[policy]}));
 expect(await client.policies()).toEqual([policy]);
 vi.mocked(fetch).mockResolvedValueOnce(response(handle));expect(await client.submitRun(request)).toEqual(handle);
 expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body))).toEqual(request);
 vi.mocked(fetch).mockResolvedValueOnce(response({...handle,state:'ready',execution_id:queryId}));expect((await client.runStatus(executionId)).execution_id).toBe(queryId);
 vi.mocked(fetch).mockResolvedValueOnce(response({...handle,state:'cancelled'}));expect((await client.cancelRun(executionId)).state).toBe('cancelled');
 expect(vi.mocked(fetch).mock.calls.map(([url,init])=>[new URL(String(url)).pathname,init?.method])).toEqual([
  ['/temporal/v1/acquisition/policies','GET'],['/temporal/v1/runs','POST'],[`/temporal/v1/runs/${executionId}`,'GET'],[`/temporal/v1/runs/${executionId}`,'DELETE']]);
 const calls=vi.mocked(fetch).mock.calls.length;
 await expect(client.submitRun({...request,policy_revision:0})).rejects.toThrow();expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
 vi.mocked(fetch).mockResolvedValueOnce(response({...handle,state:'future'}));await expect(client.runStatus(executionId)).rejects.toThrow();
});
