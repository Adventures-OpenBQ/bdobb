// Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
import xnys from '../../test/fixtures/retained-calendar/xnys_2026.json?raw';
import xhkg from '../../test/fixtures/retained-calendar/xhkg_2026.json?raw';
import clipped from '../../test/fixtures/retained-calendar/clipped_xshg_1990.json?raw';
import {webcrypto} from 'node:crypto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createRetainedCalendarProvider,type RetainedCalendarProvider} from './retained';
import {CalendarCache} from './cache';
import {sharedBundleCache} from './bundles';
import {canonical,sha256} from './artifact';
import {createIndex,sessionBounds} from './operations';
import {resolveCalendarFields} from './consumers';
import {temporalScope,invalidateTemporalScope} from '../temporal/security';
import {page as basePage,executionId,queryId} from '../temporal/fixtures';

vi.stubGlobal('crypto',webcrypto);
const dataset='calendar_source.CalendarBundle',version='runtime-calendar-observations-1';
const providers:RetainedCalendarProvider[]=[];
const raw=(name='xnys_2026')=>({xnys_2026:xnys,xhkg_2026:xhkg,clipped_xshg_1990:clipped})[name]!;
beforeEach(()=>{sharedBundleCache.clear();});
afterEach(()=>{providers.splice(0).forEach(provider=>provider.dispose());});

async function selection(text=raw(),options:{executionId?:string;context?:Record<string,unknown>}={}){
 const bundle=JSON.parse(text),id=options.executionId??executionId;
 const row={kind:'calendar_bundle_snapshot',source_model:'CalendarBundle',source_authority:'qualified-library',source_mode:'current_corrected',
  capture_id:'55555555-5555-4555-8555-555555555555',calendar_id:bundle.calendarId,calendar_digest:bundle.digest,
  source_body_sha256:await sha256(text),source_generated_at:bundle.generatedAt,source_package_version:bundle.source.packageVersion,
  timezone_data_version:bundle.source.tzdataVersion,source_rule_digest:bundle.source.ruleDigest,calendar_timezone:bundle.timezone,
  coverage_start:bundle.coverage.start,coverage_end:bundle.coverage.end,coverage_complete:bundle.coverage.complete,
  included_days:bundle.days.length,requested_start:bundle.coverage.start,requested_end:bundle.coverage.end,
  requested_coverage_status:'covered',observed_at:'2026-11-04T03:00:00+00:00',evidence_status:'library_baseline',calendar_bundle_json:text};
 const schema=Object.entries(row).map(([name,value])=>({name,type:typeof value==='boolean'?'bool':typeof value==='number'?'int64':'string',nullable:false}));
 const manifest={schema_version:1 as const,manifest_id:queryId,publication_id:'66666666-6666-4666-8666-666666666666',
  pins:[{schema_version:1 as const,catalog_id:'hot',snapshot_id:1}],projection_versions:{[dataset]:version},source_manifests:null};
 return {backendId:'b',scope:temporalScope('b'),executionId:id,page:{...structuredClone(basePage),rows:[row],schema,total_count:1,next_cursor:null,
  receipt:{...structuredClone(basePage.receipt),execution_id:id,schema,context:options.context??{mode:'current_corrected'},
   input_manifest:manifest,transform_versions:{[dataset]:version},environment_digest:'e'.repeat(64),runtime_artifact:'e'.repeat(64)}}};
}
async function create(input:Awaited<ReturnType<typeof selection>>,cache=sharedBundleCache){
 const provider=await createRetainedCalendarProvider(input,cache);providers.push(provider);return provider;
}

it('verifies actual retained bytes and prepares existing calendar consumers without a live fetch',async()=>{
 const input=await selection(),provider=await create(input);
 const bundle=await provider.load({calendarId:'exchange:XNYS',start:'2026-11-26',end:'2026-11-27'},new AbortController().signal);
 expect(sessionBounds(createIndex(bundle),'2026-11-27').value?.close).toBe('2026-11-27T18:00:00Z');
 expect(sessionBounds(createIndex(bundle),'2026-01-02').value?.open).toBe('2026-01-02T14:30:00Z');
 expect(sessionBounds(createIndex(bundle),'2026-07-01').value?.open).toBe('2026-07-01T13:30:00Z');
 expect(bundle.days.find(day=>day.date==='2026-11-26')!.state).toBe('closed');
 expect(provider.reference).toMatchObject({schemaVersion:1,executionId,sourceBodySha256:input.page.rows[0].source_body_sha256,
  evidenceStatus:'library_baseline',observedAt:'2026-11-04T03:00:00+00:00'});
 expect(Object.isFrozen(provider.reference)).toBe(true);
 const result=await resolveCalendarFields([{fieldId:'prior',expression:'T-1bd',outputType:'date',
  binding:{schemaVersion:1,kind:'single',calendarId:'exchange:XNYS'},policy:'operational-v1'}],provider,
  '2026-11-27T19:00:00Z',new AbortController().signal,{start:'2026-11-25',end:'2026-11-28'});
 expect(result.values.prior).toBe('2026-11-25');
 expect(result.prepared.bundles[0].digest).toBe(provider.reference.calendarDigest);
});

it('retains Hong Kong breaks and daily labels through the same verified provider seam',async()=>{
 const provider=await create(await selection(raw('xhkg_2026')));
 const bundle=await provider.load({calendarId:'exchange:XHKG',start:'2026-01-02',end:'2026-01-02'},new AbortController().signal);
 expect(bundle.days.find(day=>day.date==='2026-01-02')!.segments).toHaveLength(2);
 expect(bundle.days.find(day=>day.date==='2026-01-02')!.date).toBe('2026-01-02');
});

it('refuses clipped coverage without a weekday or live-calendar fallback',async()=>{
 const provider=await create(await selection(raw('clipped_xshg_1990')));
 await expect(provider.load({calendarId:'exchange:XSHG',start:'1990-01-01',end:'1990-01-02'},new AbortController().signal)).rejects.toThrow('COVERAGE_UNAVAILABLE');
});

it('keeps old and corrected executions and different temporal contexts in separate cache entries',async()=>{
 const cache=new CalendarCache(),old=await create(await selection(),cache);
 const changed=JSON.parse(raw()),day=changed.days.find((d:{date:string})=>d.date==='2026-11-27');
 day.close=day.segments[0].end='2026-11-27T17:30:00Z';
 changed.digest=await sha256(canonical(Object.fromEntries(Object.entries(changed).filter(([key])=>!['digest','generatedAt'].includes(key)))));
 const newer=await create(await selection(JSON.stringify(changed),{executionId:'77777777-7777-4777-8777-777777777777'}),cache);
 const known=await create(await selection(raw(),{context:{mode:'known_at',known_at:'2026-11-04T03:00:00Z',knowledge_basis:'local_received'}}),cache);
 const request={calendarId:'exchange:XNYS',start:'2026-11-27',end:'2026-11-27'},signal=new AbortController().signal;
 expect((await old.load(request,signal)).days.find(day=>day.date==='2026-11-27')!.close).toBe('2026-11-27T18:00:00Z');
 expect((await newer.load(request,signal)).days.find(day=>day.date==='2026-11-27')!.close).toBe('2026-11-27T17:30:00Z');
 await known.load(request,signal);expect(cache.size).toBe(3);
});

it('invalidates both cached and delayed owners when the authenticated scope changes',async()=>{
 const cache=new CalendarCache(),provider=await create(await selection(),cache),signal=new AbortController().signal;
 const request={calendarId:'exchange:XNYS',start:'2026-11-27',end:'2026-11-27'};
 const pending=provider.load(request,signal);invalidateTemporalScope();
 await expect(pending).rejects.toThrow('CALENDAR_SCOPE_CHANGED');expect(cache.size).toBe(0);
 await expect(provider.load(request,signal)).rejects.toThrow('CALENDAR_SCOPE_CHANGED');
 const fresh=await create(await selection(),cache);await fresh.load(request,signal);expect(cache.size).toBe(1);
});

it('disposing one copied owner does not cancel a second owner of the same retained input',async()=>{
 const cache=new CalendarCache(),input=await selection(),one=await create(input,cache),two=await create(input,cache);
 one.dispose();
 await two.load({calendarId:'exchange:XNYS',start:'2026-11-27',end:'2026-11-27'},new AbortController().signal);
 expect(cache.size).toBe(1);
});

it.each(['bytes','manifest','runtime','execution','complete','publication','authority'] as const)('rejects inconsistent %s before it becomes calendar authority',async mutation=>{
 const input=await selection();
 if(mutation==='bytes')input.page.rows[0].calendar_bundle_json+=' ';
 if(mutation==='manifest')input.page.receipt.input_manifest.projection_versions[dataset]='unqualified';
 if(mutation==='runtime')input.page.receipt.runtime_artifact=null as unknown as string;
 if(mutation==='execution')input.executionId=queryId;
 if(mutation==='complete')input.page.complete=false;
 if(mutation==='publication')input.page.receipt.input_manifest.publication_id=queryId+'bad';
 if(mutation==='authority')input.page.rows[0].evidence_status='market_final';
 await expect(create(input)).rejects.toThrow();
});

it('refuses an unqualified library profile even with internally consistent hashes',async()=>{
 const changed=JSON.parse(raw());changed.source.packageVersion='99.0.0';
 changed.digest=await sha256(canonical(Object.fromEntries(Object.entries(changed).filter(([key])=>!['digest','generatedAt'].includes(key)))));
 await expect(create(await selection(JSON.stringify(changed)))).rejects.toThrow();
});
