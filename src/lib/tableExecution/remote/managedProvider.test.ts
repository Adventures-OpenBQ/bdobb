// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import {expect,it} from 'vitest';
import {build} from 'esbuild';
import {createManagedProvider} from './managedProvider';
import {localCapabilities} from '../rust/providerCapabilities';
import {encodeWire} from '../rust/wireCodec';
import {ExecutionProtocolError} from '../validation';
import type {Revision,SourceBinding} from '../types';
const revision={widgetId:'card',input:4,model:1,output:1};
const definition={table:{},search:''};
const source:SourceBinding={kind:'remote',sourceId:'source/opaque',snapshotId:'old-hint',managed:{version:1,inputRevision:4}};
const options={protocolVersion:1,widgetId:'card',locale:'en-US'};
const signal=new AbortController().signal;
const capabilities={...localCapabilities(),remoteAcquisition:true};
const context={completeness:{kind:'unknown',warnings:['upstream completeness unknown']},diagnostics:[]};
type Command={sessionId:string;sourceSnapshotId:string;resultId?:string;wire:string;refresh?:{inputRevision:number}};
function server(){
 const calls:{path:string;method:string;body:unknown}[]=[];
 let snapshot='snapshot-A',result='result-A',opens=0,expired=false;
 let mutate:(reply:Record<string,unknown>,request:Record<string,unknown>)=>void=()=>{};
 let pending:Promise<void>|undefined;
 let exportCommand:Command,exportRequest:Record<string,unknown>;
 const reply=(command:Command,q:Record<string,unknown>)=>{
  const base={...context,requestId:q.requestId,revision:q.revision};let response:Record<string,unknown>;
  switch(q.kind){
   case 'applyModel':response={...base,kind:'viewReady',columns:[{id:'value',label:'Value'}],topLevelCount:{kind:'exact',value:1},inspection:{inputColumns:[],inputPeriodicity:{},definition,aggregations:{}}};break;
   case 'rows':response={...base,kind:'rows',groupPath:[],offset:0,rows:[{id:'r',values:{value:encodeWire(-0),large:encodeWire(9007199254740993n)}}],siblingCount:{kind:'exact',value:1},groups:[]};break;
   case 'totals':case 'facets':response={...base,kind:q.kind,categoryId:'category',scope:'presented',values:{value:encodeWire(42)}};break;
   case 'selection':response={...base,kind:'selection',selection:{kind:'none'},selectedCount:0,eligibleCount:1,checked:false,indeterminate:false,rows:[]};break;
   case 'inspect':response={...base,kind:'inspect',collection:'definitions',offset:0,limit:1,rows:[],total:0,truncated:false};break;
   case 'identityWitness':response={...base,kind:'identityWitness',identities:[{id:'r',state:'present'}]};break;
   case 'previewDefinition':response={...base,kind:'previewDefinition',columns:[],rows:[],total:0};break;
   case 'bindFormula':response={...base,kind:'bindFormula',ast:{kind:'literal',value:1},bindingDiagnostics:[],diagnosticCount:0,truncated:false,resolvedOperators:[],authoringWarnings:[],authoringWarningCount:0,authoringWarningsTruncated:false};break;
   case 'memberDomain':response={...base,...q,kind:'memberDomain',rows:[],total:0,truncated:false,scanned:0,omittedCount:0,classificationComplete:true,categoryErrorCount:0,authoringWarnings:[],authoringWarningCount:0,authoringWarningsTruncated:false};delete response.definition;break;
   case 'chartData':response={...base,kind:'chartData',columns:[],rows:[],resultRevision:1,outputRevision:1,provenance:{sourceWidgetId:'card'},freshness:{availability:'available',stale:false}};break;
   case 'presented':case 'nextSubset':response={...base,kind:'subset',transferId:q.transferId,sequence:q.sequence??0,columns:[],rows:[{id:'original',values:{value:encodeWire(7)}}],final:q.sequence===1};break;
   default:throw new Error(`Unexpected ${String(q.kind)}`);
  }
  const out:Record<string,unknown>={sessionId:command.sessionId,sourceSnapshotId:command.sourceSnapshotId,...(command.resultId?{resultId:command.resultId}:{})};
  if(q.kind==='applyModel'){out.sourceSnapshotId=snapshot;out.resultId=result;}
  mutate(response,q);out.wire=JSON.stringify({protocolVersion:1,sessionId:1,response});return out;
 };
 const request:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname.replace('/api/','');const method=init?.method??'GET';const body=init?.body?JSON.parse(String(init.body)):undefined;
  calls.push({path,method,body});
  if(method==='DELETE')return Response.json({deleted:true,disposed:true});
  if(path.endsWith('/cancel'))return Response.json({cancelled:true});
  if(path==='sessions'){opens++;if(opens>1)snapshot=`snapshot-open-${opens}`;return Response.json({sessionId:`session-${opens}`,sourceSnapshotId:snapshot,capabilities,limits:{max_row_block_rows:500,max_export_batch_bytes:1048576},expiresInSeconds:100});}
  if(expired)return Response.json({error:{code:'SNAPSHOT_EXPIRED',message:'gone'}},{status:410});
  if(pending)await pending;
  if(path.startsWith('exports/'))return Response.json(reply(exportCommand,{...exportRequest,kind:'nextSubset',sequence:Number(new URL(String(input)).searchParams.get('sequence'))}));
  const command=body as Command,q=JSON.parse(command.wire).request;
  if(command.refresh)snapshot='snapshot-B';
  if(q.kind==='applyModel')result=`result-${(q.revision as Revision).model}`;
  const batch=reply(command,q);
  if(path.endsWith('/exports')){exportCommand={...command};exportRequest=q;return Response.json({exportId:'export/opaque',batch});}
  return Response.json(batch);
 };
 return {calls,request,setExpired(value:boolean){expired=value;},mutate(fn:typeof mutate){mutate=fn;},hold(value:Promise<void>|undefined){pending=value;}};
}
async function opened(config:Partial<Parameters<typeof createManagedProvider>[0]>={}){const http=server();const provider=createManagedProvider({baseUrl:'https://service/api/',request:http.request,...config});return {http,provider,session:await provider.open(source,options)};}
const apply=(session:Awaited<ReturnType<typeof opened>>['session'],r=revision,s=signal)=>session.result.applyModel(definition,{kind:'none'},r,s);
it('opens from explicit revision metadata and preserves server-owned identities and tagged cells',async()=>{
 const {http,session}=await opened();expect(http.calls[0].body).toEqual({sourceId:'source/opaque',protocolVersion:1,widgetId:'card',locale:'en-US',inputRevision:4});expect(session.sourceSnapshotId).toBe('snapshot-A');expect(session.consistency).toEqual({kind:'snapshot'});
 const ready=await apply(session);expect(ready.consistency).toEqual({kind:'snapshot'});expect(ready).toMatchObject({sessionId:'session-1',sourceSnapshotId:'snapshot-A',resultId:'result-1',topLevelCount:{kind:'exact',value:1},completeness:context.completeness});
 const rows=await session.result.rows(revision,{groupPath:[],offset:0,limit:1},signal);expect(Object.is(rows.rows[0].values.value,-0)).toBe(true);expect(rows.rows[0].values.large).toBe(9007199254740993n);expect(rows.siblingCount).toEqual({kind:'exact',value:1});
 expect(session.result).not.toHaveProperty('registerInput');expect(session.result).not.toHaveProperty('importFile');session.result.dispose();
});
it('refuses unversioned managed metadata unless a legacy default is explicitly configured',async()=>{
 const http=server(),provider=createManagedProvider({baseUrl:'https://service',request:http.request});
 await expect(provider.open({kind:'remote',sourceId:'opaque',snapshotId:'opaque-99'},options)).rejects.toMatchObject({descriptor:{code:'INVALID_REQUEST'}});expect(http.calls).toHaveLength(0);
 const compatible=createManagedProvider({baseUrl:'https://service/api',request:http.request,inputRevision:4});const s=await compatible.open({kind:'remote',sourceId:'opaque',snapshotId:'hint'},options);expect(http.calls[0].body).toMatchObject({inputRevision:4});s.result.dispose();
});
it('preserves exact inner structural negative-zero text',async()=>{
 const {http,session}=await opened();
 // A structural column width is an accepted declarative numeric field.
 await session.result.applyModel({table:{widths:{value:-0}},search:''},{kind:'none'},revision,signal);
 const command=http.calls[1].body as Command;expect(command.wire).toContain('"value":-0');expect(JSON.parse(command.wire).sessionId).toBe(1);session.result.dispose();
});
it('dispatches every analytical operation through the managed command envelope',async()=>{
 const {http,session}=await opened();const e=session.result;await apply(session);
 expect((await e.previewDefinition!(revision,definition,signal)).kind).toBe('previewDefinition');
 expect((await e.bindFormula!(revision,{definition,draft:{id:'f',name:'F',scope:'source',expression:'1'},bindings:[]},signal)).kind).toBe('bindFormula');
 expect((await e.memberDomain!(revision,{definition,categoryId:'category',categoryRecipe:'recipe',offset:0,limit:1},signal)).kind).toBe('memberDomain');
 expect((await e.selection(revision,{kind:'summary'},[],signal)).eligibleCount).toBe(1);
 expect((await e.facets(revision,'category',signal)).values.value).toBe(42);
 expect((await e.totals(revision,signal)).values.value).toBe(42);
 expect((await e.inspect!(revision,{collection:'definitions',offset:0,limit:1},signal)).total).toBe(0);
 expect((await e.identityWitness!(revision,[definition,definition],['r'],signal)).identities).toEqual([{id:'r',state:'present'}]);
 expect((await e.chartData(revision,[],signal)).kind).toBe('chartData');
 expect(http.calls.slice(1).every(call=>call.path==='sessions/session-1/commands')).toBe(true);e.dispose();
});
it('refreshes only on newer input revisions and exposes the newly published snapshot',async()=>{
 const {http,session}=await opened();await apply(session);const refreshed={...revision,input:5,model:2,output:2};
 const ready=await apply(session,refreshed);expect(ready.sourceSnapshotId).toBe('snapshot-B');expect(session.sourceSnapshotId).toBe('snapshot-B');expect(http.calls[2].body).toMatchObject({sourceSnapshotId:'snapshot-A',resultId:'result-1',refresh:{inputRevision:5}});
 await expect(session.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).rejects.toMatchObject({descriptor:{code:'REVISION_MISMATCH'}});session.result.dispose();
});
it.each(['outer','request','revision','kind','count'] as const)('refuses stale or malformed %s responses',async fault=>{
 const {http,session}=await opened();await apply(session);
 if(fault==='outer'){const original=http.request; // outer result identity injection
 const provider=createManagedProvider({baseUrl:'https://service/api',request:async(...args)=>{const res=await original(...args);const v=await res.json();if(v.resultId&&String(args[1]?.body).includes('rows'))v.resultId='foreign';return Response.json(v);}});const s=await provider.open(source,options);await apply(s);await expect(s.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).rejects.toMatchObject({descriptor:{code:'REVISION_MISMATCH'}});s.result.dispose();
 }else{http.mutate(response=>{if(fault==='request')response.requestId='foreign';if(fault==='revision')response.revision={...revision,output:999};if(fault==='kind')response.kind='totals';if(fault==='count')response.siblingCount={kind:'unknown'};});await expect(session.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).rejects.toMatchObject({descriptor:{code:fault==='count'?'COUNT_UNAVAILABLE':fault==='kind'?'INVALID_REQUEST':'REVISION_MISMATCH'}});}
 session.result.dispose();
});
it('pins export identity, sequence, schema and rows through apply and refresh and deletes on return',async()=>{
 const {http,session}=await opened();await apply(session);const iterator=session.result.presented(revision,signal,true)[Symbol.asyncIterator]();
 expect((await iterator.next()).value).toMatchObject({sequence:0,resultId:'result-1',sourceSnapshotId:'snapshot-A',rows:[{id:'original'}]});
 await apply(session,{...revision,input:5,model:2,output:2});
 expect((await iterator.next()).value).toMatchObject({sequence:1,final:true,resultId:'result-1',sourceSnapshotId:'snapshot-A'});await iterator.return?.();
 expect(http.calls.at(-1)).toMatchObject({path:'exports/export%2Fopaque',method:'DELETE'});session.result.dispose();
});
it('cleans paused exports immediately on abort and deletes on early generator return',async()=>{
 for(const abort of [true,false]){const {http,session}=await opened();await apply(session);const controller=new AbortController(),iterator=session.result.presented(revision,controller.signal)[Symbol.asyncIterator]();await iterator.next();if(abort){controller.abort();await new Promise(resolve=>setTimeout(resolve,0));await expect(iterator.next()).rejects.toThrow();}else await iterator.return?.();expect(http.calls.some(call=>call.path==='exports/export%2Fopaque'&&call.method==='DELETE')).toBe(true);session.result.dispose();}
});
it('bounds export batches and rejects skipped sequence without leaking the cursor',async()=>{
 for(const malformed of [false,true]){const {http,session}=await opened({maxExportBatches:1});await apply(session);if(malformed)http.mutate(response=>{if(response.kind==='subset')response.sequence=99;});const iterator=session.result.presented(revision,signal)[Symbol.asyncIterator]();if(malformed)await expect(iterator.next()).rejects.toThrow(/sequence/i);else{await iterator.next();await expect(iterator.next()).rejects.toThrow(/limit/i);}expect(http.calls.some(call=>call.method==='DELETE'&&call.path.startsWith('exports/'))).toBe(true);session.result.dispose();}
});
it('sends cancellation independently of an in-flight command and rejects late publication',async()=>{
 const {http,session}=await opened();await apply(session);let release!:()=>void;http.hold(new Promise<void>(resolve=>{release=resolve;}));const controller=new AbortController();const pending=apply(session,{...revision,model:2,output:2},controller.signal);await new Promise(resolve=>setTimeout(resolve,0));controller.abort();await expect(pending).rejects.toThrow();expect(http.calls.some(call=>call.path.endsWith('/cancel'))).toBe(true);release();session.result.dispose();
});
it('refuses reads after expiry and reconnects explicitly with a new open and apply',async()=>{
 const {http,session,provider}=await opened();await apply(session);http.setExpired(true);
 await expect(session.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).rejects.toMatchObject({descriptor:{code:'SNAPSHOT_EXPIRED',sourceSnapshotId:'snapshot-A'}});
 http.setExpired(false);const next=await provider.open(source,options);expect(next.sessionId).toBe('session-2');expect(next.sourceSnapshotId).not.toBe(session.sourceSnapshotId);await expect(next.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).rejects.toMatchObject({descriptor:{code:'REVISION_MISMATCH'}});expect((await apply(next)).topLevelCount).toEqual({kind:'exact',value:1});session.result.dispose();next.result.dispose();
});
it('refuses after disposal and does not let an in-flight read publish',async()=>{
 const {http,session}=await opened();await apply(session);let release!:()=>void;http.hold(new Promise<void>(resolve=>{release=resolve;}));const pending=session.result.totals(revision,signal);await new Promise(resolve=>setTimeout(resolve,0));session.result.dispose();await expect(pending).rejects.toThrow();release();await expect(apply(session)).rejects.toMatchObject({descriptor:{code:'SESSION_DISPOSED'}});expect(http.calls.some(call=>call.method==='DELETE'&&call.path==='sessions/session-1')).toBe(true);
});
it('production managed-provider import graph excludes remoteProviderFixture and calculators',async()=>{
 const built=await build({entryPoints:['src/lib/tableExecution/remote/managedProvider.ts'],bundle:true,write:false,metafile:true,format:'esm',packages:'external'});
 expect(Object.keys(built.metafile!.inputs).some(path=>/remoteProviderFixture|table\.worker|rust\.worker|calculate\.ts/.test(path))).toBe(false);
});

it('keeps old snapshot and result after a failed refresh and requires newer attempt revisions',async()=>{
 const {http,session}=await opened();await apply(session);
 http.mutate((response,q)=>{if(q.kind==='applyModel')Object.assign(response,{kind:'error',error:{code:'INVALID_REQUEST',message:'candidate refused'}});});
 await expect(apply(session,{...revision,input:5,model:2,output:2})).rejects.toThrow();
 expect(session.sourceSnapshotId).toBe('snapshot-A');
 expect((await session.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).resultId).toBe('result-1');
 await expect(apply(session,{...revision,input:5,model:2,output:2})).rejects.toMatchObject({descriptor:{code:'REVISION_MISMATCH'}});session.result.dispose();
});
it('refuses an older delayed apply and a delayed read after a newer publication',async()=>{
 const {http,session}=await opened();await apply(session);
 let release!:()=>void;http.hold(new Promise<void>(resolve=>{release=resolve;}));
 const oldRead=session.result.totals(revision,signal),oldApply=apply(session,{...revision,model:2,output:2});
 await new Promise(resolve=>setTimeout(resolve,0));http.hold(undefined);
 expect((await apply(session,{...revision,model:3,output:3})).resultId).toBe('result-3');release();
 await expect(oldApply).rejects.toMatchObject({descriptor:{code:'REVISION_MISMATCH'}});
 await expect(oldRead).rejects.toMatchObject({descriptor:{code:'REVISION_MISMATCH'}});
 expect((await session.result.totals({...revision,model:3,output:3},signal)).resultId).toBe('result-3');session.result.dispose();
});
it('refuses unsupported protocol, invalid options, and unavailable count admission before HTTP commands',async()=>{
 const {http,session,provider}=await opened();
 await expect(provider.open(source,{...options,protocolVersion:99})).rejects.toMatchObject({descriptor:{code:'UNSUPPORTED_PROTOCOL'}});
 const initialCalls=http.calls.length;await expect(provider.open(source,{...options,widgetId:''})).rejects.toThrow();expect(http.calls).toHaveLength(initialCalls);
 const noGuarantee=createManagedProvider({baseUrl:'https://service/api',request:async(...args)=>{const response=await http.request(...args),body=await response.json();if(body.capabilities)body.capabilities.safeExactCountAdmission=false;return Response.json(body);}});
 const second=await noGuarantee.open(source,options);const count=http.calls.length;
 await expect(second.result.applyModel(definition,{kind:'none'},revision,signal,undefined,undefined,undefined,undefined,{counts:'safeExact'})).rejects.toMatchObject({descriptor:{code:'COUNT_UNAVAILABLE'}});
 expect(http.calls).toHaveLength(count);second.result.dispose();session.result.dispose();
});

it('cleans up malformed negotiated sessions and refuses malformed capabilities and limits',async()=>{
 for(const fault of ['capabilities','limits','expiry','missing-limit','missing-expiry','export-limit']){
  const http=server();const provider=createManagedProvider({baseUrl:'https://service/api',request:async(...args)=>{const response=await http.request(...args),body=await response.json();if(body.sessionId){if(fault==='capabilities')body.capabilities.features=['invented'];if(fault==='limits')body.limits.max_row_block_rows=-1;if(fault==='expiry')body.expiresInSeconds='forever';if(fault==='missing-limit')delete body.limits.max_row_block_rows;if(fault==='missing-expiry')delete body.expiresInSeconds;if(fault==='export-limit')body.limits.max_export_batch_bytes=0;}return Response.json(body);}});
  await expect(provider.open(source,options)).rejects.toThrow();await new Promise(resolve=>setTimeout(resolve,0));expect(http.calls.some(call=>call.method==='DELETE'&&call.path==='sessions/session-1')).toBe(true);
 }
});
it('bounds outgoing wire and requested rows before sending them',async()=>{
 const {http,session}=await opened({maxWireBytes:600,maxRowBlockRows:1});expect(session.rowBlockLimit).toBe(1);await apply(session);const count=http.calls.length;
 await expect(session.result.rows(revision,{groupPath:[],offset:0,limit:2},signal)).rejects.toThrow(/limit/i);
 await expect(session.result.applyModel({table:{},search:'x'.repeat(1000)},{kind:'none'},{...revision,model:2,output:2},signal)).rejects.toThrow(/limit/i);
 expect(http.calls).toHaveLength(count);session.result.dispose();
});
it('refuses unknown top-level and child counts without publishing a replacement',async()=>{
 const {http,session}=await opened();await apply(session);
 http.mutate(response=>{if(response.kind==='viewReady')response.topLevelCount={kind:'unknown'};});
 await expect(apply(session,{...revision,model:2,output:2})).rejects.toMatchObject({descriptor:{code:'COUNT_UNAVAILABLE'}});
 expect((await session.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).resultId).toBe('result-1');
 http.mutate(response=>{if(response.kind==='rows')response.groups=[{rowId:'r',path:['r'],childCount:{kind:'unknown'}}];});
 await expect(session.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).rejects.toMatchObject({descriptor:{code:'COUNT_UNAVAILABLE'}});session.result.dispose();
});
it('refuses a recycled result identity on a newer successful apply',async()=>{
 const http=server();let recycle=false;
 const provider=createManagedProvider({baseUrl:'https://service/api',request:async(...args)=>{const res=await http.request(...args),body=await res.json();if(recycle&&body.resultId)body.resultId='result-1';return Response.json(body);}});
 const session=await provider.open(source,options);await apply(session);recycle=true;
 await expect(apply(session,{...revision,model:2,output:2})).rejects.toMatchObject({descriptor:{code:'REVISION_MISMATCH'}});session.result.dispose();
});
it('captures caller row coordinates before an asynchronous reply',async()=>{
 const {http,session}=await opened();await apply(session);let release!:()=>void;http.hold(new Promise<void>(resolve=>{release=resolve;}));
 const query={groupPath:[],offset:0,limit:1},pending=session.result.rows(revision,query,signal);query.offset=99;query.limit=0;release();
 expect((await pending).offset).toBe(0);session.result.dispose();
});
it('allows source authoring before publication and refuses expired export pulls without zero rows',async()=>{
 const {http,session}=await opened();expect(await session.result.previewDefinition!(revision,definition,signal)).not.toHaveProperty('resultId');await apply(session);
 const iterator=session.result.presented(revision,signal)[Symbol.asyncIterator]();await iterator.next();http.setExpired(true);
 await expect(iterator.next()).rejects.toMatchObject({descriptor:{code:'SNAPSHOT_EXPIRED'}});expect(http.calls.some(call=>call.method==='DELETE'&&call.path.startsWith('exports/'))).toBe(true);session.result.dispose();
});

it('accepts a live open signal and refuses an already aborted open before HTTP',async()=>{
 const http=server(),provider=createManagedProvider({baseUrl:'https://service/api',request:http.request}),controller=new AbortController();
 const session=await provider.open(source,{...options,signal:controller.signal});session.result.dispose();
 const count=http.calls.length;controller.abort();await expect(provider.open(source,{...options,signal:controller.signal})).rejects.toThrow();expect(http.calls).toHaveLength(count);
});
it('keeps the input attempt high-water mark when a higher refresh is pending',async()=>{
 const {http,session}=await opened();await apply(session);let release!:()=>void;http.hold(new Promise<void>(resolve=>{release=resolve;}));
 const pending=apply(session,{...revision,input:6,model:2,output:2});await new Promise(resolve=>setTimeout(resolve,0));http.hold(undefined);const count=http.calls.length;
 await expect(apply(session,{...revision,input:5,model:3,output:3})).rejects.toMatchObject({descriptor:{code:'REVISION_MISMATCH'}});expect(http.calls).toHaveLength(count);release();expect((await pending).revision.input).toBe(6);session.result.dispose();
});

it.each(['RESOURCE_LIMIT','MISSING_FIELD','UNBOUND_ANALYTICAL','REVISION_MISMATCH'] as const)('preserves semantic %s errors and the prior publication after failed refresh',async code=>{
 const {http,session}=await opened();await apply(session);
 const message=`core semantic ${code}`;
 http.mutate((response,q)=>{if(q.kind==='applyModel')Object.assign(response,{kind:'error',error:{code,message,severity:'error'}});});
 const failure=apply(session,{...revision,input:5,model:2,output:2});
 await expect(failure).rejects.toBeInstanceOf(ExecutionProtocolError);
 await expect(failure).rejects.toMatchObject({descriptor:{code,message},message});
 expect(session.sourceSnapshotId).toBe('snapshot-A');
 expect((await session.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).resultId).toBe('result-1');
 session.result.dispose();
});
it('derives a child using pinned identity only and adopts independent negotiated transport',async()=>{
 const http=server();const calls:{path:string;body:unknown}[]=[];
 const request:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname;const body=init?.body?JSON.parse(String(init.body)):undefined;calls.push({path,body});
  if(path.endsWith('/derive'))return Response.json({sessionId:'child-session',sourceSnapshotId:'child-snapshot',capabilities:{...capabilities,linkedDerivation:true},limits:{max_row_block_rows:2,max_export_batch_bytes:1048576},expiresInSeconds:100});
  const response=await http.request(input,init);const value=await response.json();if(value.capabilities)value.capabilities.linkedDerivation=true;
  if(path.includes('/child-session/commands')){value.sourceSnapshotId='child-snapshot';}
  return Response.json(value);
 };
 const parent=await createManagedProvider({baseUrl:'https://service/api/',request}).open(source,options);await apply(parent);
 expect(parent.deriveLinked).toBeTypeOf('function');
 const child=await parent.deriveLinked!(revision,{...options,widgetId:'child',inputRevision:9,signal});
 expect(child).toMatchObject({sessionId:'child-session',sourceSnapshotId:'child-snapshot',rowBlockLimit:2,consistency:{kind:'snapshot'}});
 expect(calls.find(c=>c.path.endsWith('/derive'))?.body).toMatchObject({parent:{sessionId:'session-1',sourceSnapshotId:'snapshot-A',resultId:'result-1'},revision,widgetId:'child',inputRevision:9,locale:'en-US',protocolVersion:1});
 expect(calls.filter(c=>c.path.endsWith('/derive'))[0].body).not.toHaveProperty('wire');
 expect(calls.some(c=>c.path.includes('exports'))).toBe(false);
 parent.result.dispose();await apply(child,{widgetId:'child',input:9,model:1,output:1});
 const before=calls.length;await expect(apply(child,{widgetId:'child',input:10,model:2,output:2})).rejects.toThrow(/derive/i);expect(calls).toHaveLength(before);
 child.result.dispose();await new Promise(r=>setTimeout(r,0));expect(calls.some(c=>c.path==='/api/sessions/child-session'&&c.body===undefined)).toBe(true);
});
it.each(['abort','dispose','timeout','malformed'] as const)('cleans remote derivation on %s without adopting a child',async fault=>{
 const http=server(),calls:{path:string;method:string;body:unknown}[]=[];let started!:()=>void;const entering=new Promise<void>(r=>started=r);
 const request:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname,method=init?.method??'GET';calls.push({path,method,body:init?.body?JSON.parse(String(init.body)):undefined});
  if(path.endsWith('/derive')){started();if(fault==='malformed')return Response.json({sessionId:'bad-child',sourceSnapshotId:'bad-snapshot',capabilities,limits:{max_row_block_rows:0},expiresInSeconds:10});return new Promise(()=>{});}
  const r=await http.request(input,init),value=await r.json();if(value.capabilities)value.capabilities.linkedDerivation=true;return Response.json(value);
 };
 const parent=await createManagedProvider({baseUrl:'https://service/api/',request,timeoutMs:fault==='timeout'?30:1000}).open(source,options);await apply(parent);
 const controller=new AbortController();const pending=parent.deriveLinked!(revision,{...options,widgetId:'child',inputRevision:8,signal:controller.signal});const rejected=expect(pending).rejects.toThrow();await entering;
 if(fault==='abort')controller.abort();if(fault==='dispose')parent.result.dispose();await rejected;await new Promise(r=>setTimeout(r,0));
 expect(calls.some(c=>c.path.endsWith('/cancel')&&typeof (c.body as {targetRequestId?:unknown}).targetRequestId==='string')).toBe(true);
 if(fault==='malformed')expect(calls.some(c=>c.path.endsWith('/bad-child')&&c.method==='DELETE')).toBe(true);
 parent.result.dispose();
});
it('omits derivation for older managed servers and refuses stale revisions before HTTP',async()=>{
 const {session}=await opened();expect(session.deriveLinked).toBeUndefined();session.result.dispose();
 const http=server();const request:typeof fetch=async(...args)=>{const r=await http.request(...args),v=await r.json();if(v.capabilities)v.capabilities.linkedDerivation=true;return Response.json(v);};
 const parent=await createManagedProvider({baseUrl:'https://service/api/',request}).open(source,options);await apply(parent);const before=http.calls.length;
 await expect(parent.deriveLinked!({...revision,model:99},{...options,widgetId:'child',inputRevision:8})).rejects.toMatchObject({descriptor:{code:'REVISION_MISMATCH'}});expect(http.calls).toHaveLength(before);parent.result.dispose();
});
it.each(['session','snapshot'] as const)('refuses a recycled child %s identity without disposing the parent',async recycled=>{
 const http=server();const deleted:string[]=[];
 const request:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname;if(init?.method==='DELETE')deleted.push(path);
  if(path.endsWith('/derive'))return Response.json({sessionId:recycled==='session'?'session-1':'child',sourceSnapshotId:recycled==='snapshot'?'snapshot-A':'child-snapshot',capabilities:{...capabilities,linkedDerivation:true},limits:{max_row_block_rows:2,max_export_batch_bytes:1048576},expiresInSeconds:100});
  const r=await http.request(input,init),v=await r.json();if(v.capabilities)v.capabilities.linkedDerivation=true;return Response.json(v);
 };
 const parent=await createManagedProvider({baseUrl:'https://service/api/',request}).open(source,options);await apply(parent);
 await expect(parent.deriveLinked!(revision,{...options,widgetId:'child',inputRevision:8})).rejects.toMatchObject({descriptor:{code:'REVISION_MISMATCH'}});await new Promise(r=>setTimeout(r,0));
 expect(deleted).not.toContain('/api/sessions/session-1');if(recycled==='snapshot')expect(deleted).toContain('/api/sessions/child');parent.result.dispose();
});
