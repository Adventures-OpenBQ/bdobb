// Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
import {isUuid,parseResultPage} from '../temporal/contracts';
import {onTemporalScopeChange,temporalScope} from '../temporal/security';
import {canonical,sha256,verifyBundle} from './artifact';
import {sharedBundleCache} from './bundles';
import type {CalendarCache} from './cache';
import {CalendarError,freeze} from './contracts';
import {createBundleProvider,type CalendarProvider} from './provider';

const dataset='calendar_source.CalendarBundle',projection='runtime-calendar-observations-1';
export type RetainedCalendarSelection={backendId:string;scope:string;executionId:string;page:unknown};
export type RetainedCalendarProvider=CalendarProvider&{
 reference:Readonly<{schemaVersion:1;executionId:string;calendarDigest:string;sourceBodySha256:string;evidenceStatus:string;observedAt:string;[key:string]:unknown}>;
 dispose():void;
};
function requireRetained(ok:unknown):asserts ok {if(!ok)throw new CalendarError('INVALID_RETAINED_CALENDAR');}
/** Exact retained input only: no source discovery, network access, or current-head substitution. */
export async function createRetainedCalendarProvider(
 selection:RetainedCalendarSelection,cache:CalendarCache=sharedBundleCache,
):Promise<RetainedCalendarProvider>{
 const {backendId,scope,executionId}=selection;
 const check=()=>{if(scope!==temporalScope(backendId))throw new CalendarError('CALENDAR_SCOPE_CHANGED');};
 check();
 const page=parseResultPage(structuredClone(selection.page)),r=page.receipt;
 requireRetained(isUuid(executionId)&&r.execution_id===executionId&&page.rows.length===1&&page.total_count===1&&
  page.count_quality==='exact'&&page.complete&&!page.truncated&&page.next_cursor===null&&r.completeness==='complete');
 requireRetained(/^[a-f0-9]{64}$/.test(r.environment_digest)&&r.runtime_artifact===r.environment_digest);
 const context=r.context;
 requireRetained(['current_corrected','snapshot','known_at'].includes(context.mode)&&
  (context.mode!=='known_at'||context.knowledge_basis==='local_received')&&
  context.effective_at==null&&context.date_range==null);
 const manifest=r.input_manifest.source_manifests?.[dataset]??r.input_manifest;
 requireRetained(!manifest.source_manifests&&isUuid(manifest.publication_id)&&manifest.pins.length>0&&
  manifest.projection_versions[dataset]===projection&&r.transform_versions[dataset]===projection);
 const row=page.rows[0],text=row.calendar_bundle_json;
 requireRetained(row.kind==='calendar_bundle_snapshot'&&row.source_model==='CalendarBundle'&&
  row.source_mode==='current_corrected'&&typeof row.source_authority==='string'&&row.source_authority.length>0&&
  isUuid(row.capture_id)&&row.evidence_status==='library_baseline'&&typeof text==='string'&&
  !text.startsWith('\ufeff')&&new TextEncoder().encode(text).byteLength<=1048576&&
  typeof row.observed_at==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(row.observed_at)&&Number.isFinite(Date.parse(row.observed_at)));
 requireRetained(await sha256(text)===row.source_body_sha256);check();
 const bundle=await verifyBundle(JSON.parse(text));check();
 requireRetained(bundle.source.adapter==='openbq-calendar/0.1.0'&&bundle.source.packageVersion==='4.13.2'&&
  bundle.source.tzdataVersion==='2026.5'&&bundle.source.ruleDigest==='2ce5dc9810c3b21a1468a476517070bd758b87b7a386b6d4aa28d438114d1f15'&&
  bundle.kind==='exchange_trading'&&bundle.days.every(day=>day.evidenceStatus==='library_baseline'));
 const pairs:Record<string,unknown>={calendar_id:bundle.calendarId,calendar_digest:bundle.digest,
  source_generated_at:bundle.generatedAt,source_package_version:bundle.source.packageVersion,
  timezone_data_version:bundle.source.tzdataVersion,source_rule_digest:bundle.source.ruleDigest,
  calendar_timezone:bundle.timezone,coverage_start:bundle.coverage.start,coverage_end:bundle.coverage.end,
  coverage_complete:bundle.coverage.complete,included_days:bundle.days.length};
 requireRetained(Object.entries(pairs).every(([key,value])=>row[key]===value));
 const namespace=await sha256(canonical({backendId,scope,executionId,context,manifest,body:row.source_body_sha256}));check();
 const reference=freeze({schemaVersion:1 as const,executionId,queryId:r.query_id,queryRevision:r.query_revision,
  context, inputManifest:r.input_manifest,environmentDigest:r.environment_digest,sourceAuthority:row.source_authority,
  calendarDigest:bundle.digest,sourceBodySha256:row.source_body_sha256 as string,evidenceStatus:row.evidence_status as string,
  observedAt:row.observed_at,sourceGeneratedAt:bundle.generatedAt,coverage:bundle.coverage});
 let disposed=false;
 const unsubscribe=onTemporalScopeChange(()=>cache.clear());
 const guard=(signal:AbortSignal)=>{check();if(disposed)throw new CalendarError('CALENDAR_PROVIDER_DISPOSED');
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');};
 const provider=createBundleProvider(namespace,cache,async()=>bundle,async()=>({schemaVersion:1,providerId:namespace,
  calendars:[{calendarId:bundle.calendarId,name:bundle.calendarId,timezone:bundle.timezone,kind:bundle.kind,
   start:bundle.coverage.start,end:bundle.coverage.end,policies:['operational-v1','planning-v1']}],limits:{bytes:1048576}}));
 return {reference,dispose(){disposed=true;unsubscribe();},async list(signal){guard(signal);return provider.list(signal);},
  async load(request,signal){guard(signal);
   if(request.calendarId!==bundle.calendarId)throw new CalendarError('BUNDLE_REQUEST_MISMATCH');
   if(request.start<bundle.coverage.start||request.end>bundle.coverage.end)throw new CalendarError('COVERAGE_UNAVAILABLE');
   const result=await provider.load(request,signal);guard(signal);return result;
  }};
}
