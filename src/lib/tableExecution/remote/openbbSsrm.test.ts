// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {createOpenbbSsrmProvider} from './openbbSsrm';
import {createRemoteTransport} from './transport';
import {tableExecutorAdapter} from '../rust/providerContract';
import type {OpenbbSsrmConfig} from './openbbTypes';
import type {TableDefinition} from '../types';
const revision={widgetId:'card',input:4,model:1,output:1};
const definition={table:{},search:''};
const source={kind:'remote' as const,sourceId:'saved-widget',snapshotId:'legacy-hint'};
const options={protocolVersion:1,widgetId:'card',locale:'en-US'};
const signal=new AbortController().signal;
const plainRequest={startRow:0,endRow:2,sortModel:[],filterModel:{},rowGroupCols:[],groupKeys:[],valueCols:[],pivotCols:[],pivotMode:false};
function endpoint(){
 const calls:{url:string;method:string;body:Record<string,unknown>}[]=[];
 let reply:unknown={rowData:[{country:'US',city:'NY',amount:10},{country:'CA',city:'TO',amount:20}],rowCount:10};
 const request:typeof fetch=async(input,init)=>{calls.push({url:String(input),method:init!.method!,body:JSON.parse(String(init!.body))});return Response.json(reply);};
 return {calls,request,reply(value:unknown){reply=value;}};
}
async function opened(config:Partial<OpenbbSsrmConfig>={}){
 const http=endpoint(),provider=createOpenbbSsrmProvider({baseUrl:'https://service/api/',endpoint:'data-ssrm',params:{ticker:'A&B',empty:''},inputRevision:4,pageSize:2,request:http.request,...config});
 return {http,provider,session:await provider.open(source,options)};
}
const apply=(session:Awaited<ReturnType<typeof opened>>['session'],d:TableDefinition=definition,r=revision,s=signal)=>session.result.applyModel(d,{kind:'none'},r,s);
it('posts official direct options to the fixed widget endpoint, discovers schema and identifies live pages',async()=>{
 const {http,session}=await opened();const ready=await apply(session);
 expect(http.calls).toEqual([{url:'https://service/api/data-ssrm?ticker=A%26B',method:'POST',body:plainRequest}]);
 expect(ready.columns.map(c=>c.id)).toEqual(['country','city','amount']);expect(ready.topLevelCount).toEqual({kind:'exact',value:10});
 expect(session.consistency).toEqual({kind:'live',rowIdentity:'ephemeral'});expect(ready.consistency).toEqual(session.consistency);expect(ready.sourceSnapshotId).not.toBe('legacy-hint');
 const page=await session.result.rows(revision,{groupPath:[],offset:2,limit:2},signal);
 expect(http.calls[1].body).toEqual({...plainRequest,startRow:2,endRow:4});expect(page.rows.map(r=>r.values.amount)).toEqual([10,20]);expect(page.consistency).toEqual(session.consistency);
 expect(page.completeness.kind).toBe('paged');expect(session.capabilities.safeExactCountAdmission).toBe(false);
 await expect(tableExecutorAdapter(session).applyModel(definition,{kind:'none'},revision,signal)).rejects.toMatchObject({descriptor:{code:'UNSUPPORTED_CAPABILITY'}});
});
it('translates sorting and inclusive number/text filters without wrapping or locally filtering rows',async()=>{
 const {http,session}=await opened({columns:[{id:'country',label:'Country',dtype:'text'},{id:'city',label:'City',dtype:'text'},{id:'amount',label:'Amount',dtype:'number'}]});
 await apply(session,{table:{sorting:[{id:'amount',desc:true}],columnFilters:[{id:'country',value:'US'},{id:'amount',value:{min:5,max:30}}]},search:''});
 expect(http.calls[0].body).toMatchObject({sortModel:[{colId:'amount',sort:'desc'}],filterModel:{country:{filterType:'text',type:'contains',filter:'US'},amount:{filterType:'number',type:'inRange',filter:5,filterTo:30}}});
 expect((await session.result.rows(revision,{groupPath:[],offset:0,limit:2},signal)).rows).toHaveLength(2);
});
it('maps opaque nested group paths to original keys and passes declared aggregates to the server',async()=>{
 const {http,session}=await opened({columns:[{id:'country',label:'Country'},{id:'city',label:'City'},{id:'amount',label:'Amount'}],capabilities:{grouping:true,aggregations:['sum']}});
 http.reply({rowData:[{country:'A/B',amount:900}],rowCount:1});
 const d={table:{pivot:{enabled:true,grouping:['country','city'],split:[],aggregationFns:{amount:'sum' as const}}},search:''};
 const ready=await apply(session,d);expect(ready.topLevelCount).toEqual({kind:'exact',value:1});
 const top=await session.result.rows(revision,{groupPath:[],offset:0,limit:2},signal);
 expect(top.rows[0].values.amount).toBe(900);expect(top.groups[0].childCount).toEqual({kind:'unknown'});expect(top.groups[0].path[0]).not.toBe('A/B');
 http.reply({rowData:[{city:'C/D',amount:450}],rowCount:1});
 const nested=await session.result.rows(revision,{groupPath:top.groups[0].path,offset:0,limit:2},signal);
 expect(http.calls.at(-1)!.body).toMatchObject({groupKeys:['A/B'],rowGroupCols:[{id:'country',field:'country'},{id:'city',field:'city'}],valueCols:[{id:'amount',field:'amount',aggFunc:'sum'}]});
 http.reply({rowData:[{country:'A/B',city:'C/D',amount:7}],rowCount:1});
 const leaf=await session.result.rows(revision,{groupPath:nested.groups[0].path,offset:0,limit:2},signal);
 expect(http.calls.at(-1)!.body.groupKeys).toEqual(['A/B','C/D']);expect(leaf.groups).toEqual([]);expect(leaf.rows[0].values.amount).toBe(7);
 await expect(session.result.rows(revision,{groupPath:['forged'],offset:0,limit:2},signal)).rejects.toThrow(/group/i);
});
it.each([undefined,-1,{kind:'estimated',value:123}])('preserves absent or estimated counts: %j',async count=>{
 const {http,session}=await opened();http.reply({rowData:[{amount:1}],...(count===undefined?{}:{rowCount:count})});
 expect((await apply(session)).topLevelCount).toEqual(typeof count==='object'?count:{kind:'unknown'});
});
it('does not turn duplicate or missing upstream keys into stable row identity',async()=>{
 const {http,session}=await opened();http.reply({rowData:[{id:'duplicate',amount:1},{id:'duplicate',amount:2}],rowCount:2});await apply(session);
 const first=await session.result.rows(revision,{groupPath:[],offset:0,limit:2},signal),second=await session.result.rows(revision,{groupPath:[],offset:0,limit:2},signal);
 expect(new Set(first.rows.map(r=>r.id)).size).toBe(2);expect(second.rows[0].id).not.toBe(first.rows[0].id);expect(first.consistency).toMatchObject({rowIdentity:'ephemeral'});
 http.reply({rowData:[{id:null,amount:1}],rowCount:1});expect((await session.result.rows(revision,{groupPath:[],offset:0,limit:2},signal)).rows).toHaveLength(1);
});
it('refuses whole-scope operations and undeclared aggregation/pivot/formulas before HTTP',async()=>{
 const {http,session}=await opened();await apply(session);const calls=http.calls.length;
 await expect(session.result.selection(revision,{kind:'all'},[],signal)).rejects.toMatchObject({descriptor:{code:'UNSUPPORTED_CAPABILITY'}});
 await expect(session.result.totals(revision,signal)).rejects.toMatchObject({descriptor:{code:'UNSUPPORTED_CAPABILITY'}});
 await expect(session.result.chartData(revision,[],signal)).rejects.toMatchObject({descriptor:{code:'UNSUPPORTED_CAPABILITY'}});
 await expect(session.result.presented(revision,signal)[Symbol.asyncIterator]().next()).rejects.toMatchObject({descriptor:{code:'UNSUPPORTED_CAPABILITY'}});
 await expect(apply(session,{table:{pivot:{enabled:true,grouping:['country'],split:[],aggregationFns:{amount:'median'}}},search:''},{...revision,model:2,output:2})).rejects.toMatchObject({descriptor:{code:'UNSUPPORTED_CAPABILITY'}});
 await expect(apply(session,{...definition,analytical:{schemaVersion:1}}, {...revision,model:3,output:3})).rejects.toThrow();
 await expect(session.result.applyModel(definition,{kind:'none'},{...revision,model:4,output:4},signal,undefined,undefined,undefined,undefined,{counts:'safeExact'})).rejects.toMatchObject({descriptor:{code:'COUNT_UNAVAILABLE'}});
 expect(http.calls).toHaveLength(calls);expect(session.capabilities.features).not.toContain('export');expect(session.capabilities.formulaFunctions).toEqual([]);
});
it('detects changed row schema without silently relabelling the published columns',async()=>{
 const {http,session}=await opened();await apply(session);http.reply({rowData:[{country:'US',newField:2}],rowCount:10});
 await expect(session.result.rows(revision,{groupPath:[],offset:2,limit:2},signal)).rejects.toMatchObject({descriptor:{code:'REVISION_MISMATCH'}});
});
it('rejects oversized rows/columns, unsafe counts and request coordinates',async()=>{
 for(const payload of [{rowData:[{a:1},{a:2},{a:3}],rowCount:3},{rowData:[{a:1,b:2,c:3,d:4}],rowCount:1},{rowData:[{a:1}],rowCount:1.5}]){
  const {http,session}=await opened({maxColumns:3});http.reply(payload);await expect(apply(session)).rejects.toThrow();
 }
 const {http,session}=await opened();await apply(session);const n=http.calls.length;
 for(const query of [{groupPath:[],offset:-1,limit:1},{groupPath:[],offset:0,limit:501},{groupPath:[],offset:Number.MAX_SAFE_INTEGER,limit:2}])await expect(session.result.rows(revision,query,signal)).rejects.toThrow();
 expect(http.calls).toHaveLength(n);
});
it('rejects endpoint escape, aborts streamed reads and preserves HTTP failures',async()=>{
 for(const endpoint of ['https://other/data','../data','//other/data','%2e%2e/data'])expect(()=>createOpenbbSsrmProvider({baseUrl:'https://service/api',endpoint,inputRevision:4,request:fetch})).toThrow();
 const failed=await opened({request:async()=>Response.json({detail:'failure'},{status:503})});await expect(apply(failed.session)).rejects.toMatchObject({status:503});
 // od's bounded {"detail"} names the problem; this is a standard OpenBB widget, not a managed table.
 const refused=await opened({request:async()=>Response.json({detail:[{loc:['query','symbol'],msg:'Field required'}]},{status:422})});
 const error=await apply(refused.session).catch(e=>e as Error);expect(error).toMatchObject({status:422,message:'HTTP 422: symbol — Field required'});
 let cancelled=false;const request:typeof fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"rowData":['));},cancel(){cancelled=true;}}));
 const {session}=await opened({request}),controller=new AbortController();const pending=apply(session,definition,revision,controller.signal);await new Promise(r=>setTimeout(r,0));controller.abort();await expect(pending).rejects.toThrow();expect(cancelled).toBe(true);
});
it('bounds URL parameters as well as JSON bodies before invoking authenticated fetch',async()=>{
 const http=endpoint();
 expect(()=>createOpenbbSsrmProvider({baseUrl:'https://service/api',endpoint:'data-ssrm',params:{symbol:'x'.repeat(1000)},request:http.request,inputRevision:4,maxRequestBytes:500})).toThrow(/byte limit/i);
 const {session}=await opened({request:http.request,maxRequestBytes:100});await expect(apply(session)).rejects.toThrow(/byte limit/i);expect(http.calls).toHaveLength(0);
});
it('refuses date filters, unsupported means, and undeclared pivots without silently dropping them',async()=>{
 const {http,session}=await opened({columns:[{id:'date',label:'Date',dtype:'dateString'},{id:'amount',label:'Amount'}],capabilities:{grouping:true,aggregations:['sum']}});
 for(const d of [{table:{columnFilters:[{id:'date',value:{from:'2025-01-01'}}]},search:''},{table:{pivot:{enabled:true,grouping:['date'],split:[],aggregationFns:{amount:'mean' as const}}},search:''},{table:{pivot:{enabled:true,grouping:[],split:['date']}},search:''}])await expect(apply(session,d)).rejects.toMatchObject({descriptor:{code:'UNSUPPORTED_CAPABILITY'}});
 expect(http.calls).toHaveLength(0);
});
it('maps mean to declared avg and sends a declared pivot with an explicit response schema',async()=>{
 const {http,session}=await opened({columns:[{id:'country',label:'Country'},{id:'city',label:'City'},{id:'amount',label:'Amount'}],capabilities:{grouping:true,aggregations:['mean'],pivot:{columns:[{id:'country',label:'Country'},{id:'NY_amount',label:'New York'}]}}});
 http.reply({rowData:[{country:'US',NY_amount:8}],rowCount:1});
 const ready=await apply(session,{table:{pivot:{enabled:true,grouping:['country'],split:['city'],aggregationFns:{amount:'mean'}}},search:''});
 expect(http.calls[0].body).toMatchObject({valueCols:[{id:'amount',field:'amount',aggFunc:'avg'}],pivotCols:[{id:'city',field:'city'}],pivotMode:true});
 expect(ready.columns.map(c=>c.id)).toEqual(['country','NY_amount']);
});
it('discovers ungrouped input schema before an initially grouped model without configured columns',async()=>{
 const calls:Record<string,unknown>[]=[];
 const {session}=await opened({capabilities:{grouping:true},request:async(_input,init)=>{const body=JSON.parse(String(init!.body));calls.push(body);return Response.json(body.rowGroupCols.length?{rowData:[{country:'US',count:10}],rowCount:1}:{rowData:[{country:'US',city:'NY',amount:2}],rowCount:10});}});
 const ready=await apply(session,{table:{pivot:{enabled:true,grouping:['country','city'],split:[]}},search:''});
 expect(calls[0]).toEqual(plainRequest);expect(calls[1].rowGroupCols).toEqual([{id:'country',field:'country'},{id:'city',field:'city'}]);
 expect(ready.inspection.inputColumns.map(c=>c.id)).toEqual(['country','city','amount']);expect(ready.columns.map(c=>c.id)).toEqual(['country','city','amount','count']);
});
it('refuses ambiguous null or duplicate group keys and changed value types',async()=>{
 for(const rowData of [[{country:null,count:1}],[{country:'US',count:1},{country:'US',count:2}]]){
  const {http,session}=await opened({columns:[{id:'country',label:'Country'}],capabilities:{grouping:true}});http.reply({rowData,rowCount:rowData.length});
  await expect(apply(session,{table:{pivot:{enabled:true,grouping:['country'],split:[]}},search:''})).rejects.toThrow(/group key/i);
 }
 const {http,session}=await opened();await apply(session);http.reply({rowData:[{country:'US',city:'NY',amount:'changed'}],rowCount:10});
 expect((await session.result.rows(revision,{groupPath:[],offset:2,limit:2},signal)).rows[0].values.amount).toBe('changed');
 http.reply({rowData:[{country:'US',city:'NY',amount:{changed:1}}],rowCount:10});
 await expect(session.result.rows(revision,{groupPath:[],offset:2,limit:2},signal)).rejects.toMatchObject({descriptor:{code:'REVISION_MISMATCH'}});
});
it('makes short and empty pages with absent counts unknown and preserves the last result after refusal',async()=>{
 const {http,session}=await opened();http.reply({rowData:[{amount:2}]});const ready=await apply(session);expect(ready.topLevelCount).toEqual({kind:'unknown'});
 http.reply({rowData:[]});
 await expect(apply(session,{...definition,search:'unsupported'},{...revision,model:2,output:2})).rejects.toMatchObject({descriptor:{code:'UNSUPPORTED_CAPABILITY'}});
 const page=await session.result.rows(revision,{groupPath:[],offset:0,limit:2},signal);expect(page.siblingCount).toEqual({kind:'unknown'});expect(page.resultId).toBe(ready.resultId);
});
it('rejects stale applies and delayed reads after a later model publication',async()=>{
 let hold=false,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const {session}=await opened({request:async()=>{if(hold)await gate;return Response.json({rowData:[{amount:3}],rowCount:1});}});
 await apply(session);hold=true;const read=session.result.rows(revision,{groupPath:[],offset:0,limit:1},signal),old=apply(session,definition,{...revision,model:2,output:2});
 await new Promise(r=>setTimeout(r,0));hold=false;await apply(session,definition,{...revision,model:3,output:3});release();
 await expect(read).rejects.toMatchObject({descriptor:{code:'REVISION_MISMATCH'}});await expect(old).rejects.toMatchObject({descriptor:{code:'REVISION_MISMATCH'}});
});
it('cancels reads on disposal and enforces response bytes before parsing',async()=>{
 const limited=await opened({maxResponseBytes:50});await expect(apply(limited.session)).rejects.toThrow(/byte limit/i);
 let cancelled=false;const {session}=await opened({request:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))});
 const pending=apply(session);await new Promise(r=>setTimeout(r,0));session.result.dispose();await expect(pending).rejects.toMatchObject({descriptor:{code:'SESSION_DISPOSED'}});expect(cancelled).toBe(true);
});
it('cannot enter the snapshot renderer even when a caller claims safe exact counts for live data',async()=>{
 const {session}=await opened();const falseGuarantee={...session,capabilities:{...session.capabilities,safeExactCountAdmission:true}};
 await expect(tableExecutorAdapter(falseGuarantee).applyModel(definition,{kind:'none'},revision,signal)).rejects.toMatchObject({descriptor:{code:'UNSUPPORTED_CAPABILITY'}});
});
it('runs the official-shaped fixture server for grouped and paged HTTP requests',async()=>{
 const {execFileSync}=await import('node:child_process');
 const output=execFileSync(process.execPath,['--input-type=module','-e',`
  import {createSsrmFixtureServer} from './e2e/fixtures/ssrm-provider.mjs';
  const fixture=await createSsrmFixtureServer();
  try {
   const base={startRow:0,endRow:2,sortModel:[],filterModel:{},rowGroupCols:[],groupKeys:[],valueCols:[],pivotCols:[],pivotMode:false};
   const post=async body=>(await fetch(fixture.url+'/data-ssrm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
   const raw=await post(base);
   const grouped=await post({...base,rowGroupCols:[{id:'country',field:'country'}],valueCols:[{id:'amount',field:'amount',aggFunc:'sum'}]});
   console.log(JSON.stringify({raw,grouped,calls:fixture.calls.length}));
  } finally {await fixture.close();}
 `],{encoding:'utf8'});
 expect(JSON.parse(output)).toMatchObject({raw:{rowCount:6,rowData:[{country:'US',city:'NY',amount:10},{country:'US',city:'NY',amount:20}]},grouped:{rowCount:2,rowData:[{country:'US',amount:60},{country:'CA',amount:150}]},calls:2});
});
it('refuses pivot-only group expansion where its output schema cannot describe deeper levels',async()=>{
 const {http,session}=await opened({columns:[{id:'country',label:'Country'},{id:'city',label:'City'},{id:'amount',label:'Amount'}],capabilities:{grouping:true,pivot:{columns:[{id:'country',label:'Country'},{id:'city',label:'City'},{id:'NY_amount',label:'NY'}]},aggregations:['sum']}});
 await expect(apply(session,{table:{pivot:{enabled:true,grouping:['country','city'],split:['city'],aggregationFns:{amount:'sum'}}},search:''})).rejects.toMatchObject({descriptor:{code:'UNSUPPORTED_CAPABILITY'}});expect(http.calls).toHaveLength(0);
});
it('checks declared value types before publication and permits numeric count aggregates over text',async()=>{
 const bad=await opened({columns:[{id:'country',label:'Country',dtype:'number'},{id:'city',label:'City'},{id:'amount',label:'Amount'}]});bad.http.reply({rowData:[{country:['US'],city:'NY',amount:1}],rowCount:1});await expect(apply(bad.session)).rejects.toMatchObject({descriptor:{code:'REVISION_MISMATCH'}});
 const {http,session}=await opened({columns:[{id:'country',label:'Country',dtype:'text'},{id:'city',label:'City',dtype:'text'}],capabilities:{grouping:true,aggregations:['count']}});http.reply({rowData:[{country:'US',city:5}],rowCount:1});
 await apply(session,{table:{pivot:{enabled:true,grouping:['country'],split:[],aggregationFns:{city:'count'}}},search:''});expect((await session.result.rows(revision,{groupPath:[],offset:0,limit:2},signal)).rows[0].values.city).toBe(5);
});
it('refuses grouped sorts that upstream ignores, independent aliases, and excessive output/path dimensions',async()=>{
 const {http,session}=await opened({columns:[{id:'country',label:'Country'},{id:'city',label:'City'},{id:'amount',label:'Amount'}],capabilities:{grouping:true,aggregations:['sum']},maxGroupPaths:1});
 for(const table of [{pivot:{enabled:true,grouping:['amount'],split:[],aggregationFns:{amount:'sum' as const}}},{sorting:[{id:'city',desc:false}],pivot:{enabled:true,grouping:['country'],split:[],aggregationFns:{amount:'sum' as const}}},{pivot:{enabled:true,grouping:['country'],split:[],measures:[{id:'independent',sourceFieldId:'amount',aggregation:'sum' as const}]}}])await expect(apply(session,{table,search:''})).rejects.toMatchObject({descriptor:{code:'UNSUPPORTED_CAPABILITY'}});
 expect(http.calls).toHaveLength(0);
 http.reply({rowData:[{country:'US',amount:3},{country:'CA',amount:4}],rowCount:2});await apply(session,{table:{pivot:{enabled:true,grouping:['country'],split:[],aggregationFns:{amount:'sum'}}},search:''});
 await expect(session.result.rows(revision,{groupPath:[],offset:0,limit:2},signal)).rejects.toThrow(/path limit/i);
 const bounded=await opened({columns:[{id:'country',label:'Country'}],capabilities:{grouping:true},maxColumns:1});bounded.http.reply({rowData:[],rowCount:0});
 await expect(apply(bounded.session,{table:{pivot:{enabled:true,grouping:['country'],split:[]}},search:''})).rejects.toThrow(/column limit/i);
});
it('rejects live reads through the legacy adapter even when the live result was applied directly',async()=>{
 const {session}=await opened();await apply(session);
 await expect(tableExecutorAdapter(session).rows(revision,{groupPath:[],offset:0,limit:2},signal)).rejects.toMatchObject({descriptor:{code:'UNSUPPORTED_CAPABILITY'}});
});

// A request that never answers but honours abort, so only the timer can end it.
const hung:typeof fetch=(_i,init)=>new Promise((_,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true}));
async function settlesAfter(run:(request:typeof fetch)=>Promise<unknown>,ms:number){
 vi.useFakeTimers();try{
  let done=false;const p=run(hung).then(()=>{done=true;},()=>{done=true;});
  await vi.advanceTimersByTimeAsync(ms-1);const early=done;await vi.advanceTimersByTimeAsync(1);await p;return {early,done};
 }finally{vi.useRealTimers();}
}
it('gives the standard SSRM provider 120 s per request',async()=>{
 const run=async(request:typeof fetch)=>{const provider=createOpenbbSsrmProvider({baseUrl:'https://service/api/',endpoint:'data-ssrm',inputRevision:4,pageSize:2,request});return apply(await provider.open(source,options));};
 expect(await settlesAfter(run,120_000)).toEqual({early:false,done:true});
});
it('keeps the 30 s default for managed transports',async()=>{
 const run=(request:typeof fetch)=>createRemoteTransport({baseUrl:'https://service/api',request}).json('POST','x',{});
 expect(await settlesAfter(run,30_000)).toEqual({early:false,done:true});
});
it('serves the first rows() page from the applyModel read instead of posting it twice',async()=>{
 const {http,session}=await opened();await apply(session);
 const first=await session.result.rows(revision,{groupPath:[],offset:0,limit:2},signal);
 expect(http.calls).toHaveLength(1);expect(first.rows).toHaveLength(2);
 await session.result.rows(revision,{groupPath:[],offset:0,limit:2},signal);
 expect(http.calls).toHaveLength(2); // the saved read is used once; a later page 0 is fetched fresh
});
it('reports the backend warnings a page carries after the live-page warning, and none when it carries none',async()=>{
 const {http,session}=await opened();
 http.reply({rowData:[{country:'US',city:'NY',amount:10}],rowCount:1,warnings:[{category:'OpenBBWarning',message:'Results capped at 1 record.'},'plain text',{message:''},7]});
 const ready=await apply(session);
 expect(ready.completeness.warnings.slice(1)).toEqual(['Results capped at 1 record.','plain text']);
 http.reply({rowData:[{country:'US',city:'NY',amount:10}],rowCount:2});
 const page=await session.result.rows(revision,{groupPath:[],offset:1,limit:2},signal);
 expect(page.completeness.warnings).toHaveLength(1);
});
it('reads a value of another type in an ordinary column as text, declared or inferred, and keeps aggregate columns strict',async()=>{
 // OpenBB's widget generator declares bool fields as cellDataType "text" (BLS JOLTS seasonally_adjusted, CFTC swap indicators),
 // and od serves mixed-type columns (numbers and "n/a").
 const columns=[{id:'country',label:'Country',dtype:'text' as const},{id:'flag',label:'Flag',dtype:'text' as const},{id:'amount',label:'Amount',dtype:'number' as const}];
 const {http,session}=await opened({columns});
 http.reply({rowData:[{country:'US',flag:true,amount:10},{country:'CA',flag:3,amount:'n/a'}],rowCount:2});
 await expect(apply(session)).resolves.toMatchObject({kind:'viewReady'});
 const inferred=await opened({pageSize:3});
 inferred.http.reply({rowData:[{name:'A',value:2},{name:'B',value:'n/a'},{name:'C',value:1}],rowCount:3});
 await expect(apply(inferred.session)).resolves.toMatchObject({kind:'viewReady'});
 expect((await inferred.session.result.rows(revision,{groupPath:[],offset:0,limit:3},signal)).rows.map(r=>r.values.value)).toEqual([2,'n/a',1]);
 const grouped=await opened({columns,capabilities:{grouping:true,aggregations:['sum']}});
 grouped.http.reply({rowData:[{country:'US',amount:'n/a'}],rowCount:1});
 await expect(apply(grouped.session,{table:{pivot:{enabled:true,grouping:['country'],split:[],aggregationFns:{amount:'sum'}}},search:''})).rejects.toThrow('OpenBB SSRM value type changed');
});
