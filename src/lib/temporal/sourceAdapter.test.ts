// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it,vi} from 'vitest';
import {createTemporalSourceAdapter} from './sourceAdapter';
import {parseQueryBinding} from './bindings';
import {definition,executionId,fixed,page,receipt,acquisition} from './fixtures';
import type {TemporalClient} from './client';
const signal=()=>new AbortController().signal;
it('presents inspection clocks and sequence identifiers exactly without guessing a zone',async()=>{
 const {formatCell}=await import('../format');
 const schema=[{name:'source_timestamp_naive',type:'string',nullable:false},{name:'corroborated_timestamp_utc',type:'string',nullable:false},{name:'source_sequence',type:'int64',nullable:false}];
 const rows=[{source_timestamp_naive:'2025-01-21T09:00:00.030000',corroborated_timestamp_utc:'2025-01-21T09:00:00.030Z',source_sequence:84176},{source_timestamp_naive:'2025-01-21T09:00:00.030001',corroborated_timestamp_utc:'2025-01-21T09:00:00.031Z',source_sequence:'9007199254740993'}];
 const c=client();vi.mocked(c.page).mockResolvedValue({...page,schema,rows,total_count:2,next_cursor:null,receipt:{...receipt,schema,transform_versions:{'gold.sip_archive.ObservedSlice':'legacy-sip-inspection-v1'}}});
 const acquired=await createTemporalSourceAdapter(c,{kind:'execution',executionId}).acquire(signal());if(acquired.kind!=='dataset')throw Error('dataset');
 for(const row of acquired.dataset.rows)for(const column of acquired.dataset.columns)expect(formatCell(row.values[column.id],column.id,2,'en-US',column.format)).toBe(String(row.values[column.id]));
 expect(acquired.dataset.columns.every(column=>column.format?.formatterFn==='none')).toBe(true);
});
function client(){return {get:vi.fn(async()=>definition),start:vi.fn(async()=>({execution_id:executionId,state:'queued' as const})),status:vi.fn(async()=>({execution_id:executionId,state:'succeeded' as const,error:null})),page:vi.fn(async()=>page)} as unknown as TemporalClient;}
it('preserves the original acquisition explanation through pinned loading and serialized export',async()=>{
 const {temporalJson,temporalExportMetadata}=await import('./export');const original=structuredClone(acquisition),c=client();
 vi.mocked(c.page).mockResolvedValue({...page,receipt:{...receipt,acquisition:original}});
 const result=await createTemporalSourceAdapter(c,{kind:'execution',executionId}).acquire(signal());if(result.kind!=='dataset')throw Error('dataset');
 original.policy_revision=2;original.assumptions.freshness_seconds=60;
 expect(result.dataset.provenance.receipt?.temporal?.acquisition).toEqual(acquisition);
 const exported=JSON.parse(temporalJson(result.dataset.rows.map(r=>r.values),temporalExportMetadata(result.dataset.provenance,result.dataset.completeness)));
 expect(exported.provenance.receipt.temporal.acquisition).toEqual(acquisition);expect(c.start).not.toHaveBeenCalled();
});
it('keeps fixed revisions and page limits while refresh starts a new execution',async()=>{
 const c=client();const source=createTemporalSourceAdapter(c,fixed);
 const acquired=await source.acquire(signal());expect(acquired.kind).toBe('dataset');
 if(acquired.kind!=='dataset')throw Error('dataset');
 expect(acquired.dataset.completeness).toMatchObject({kind:'paged',acquiredRowCount:1,totalRowCount:2000,totalRowCountKind:'exact'});
 expect(acquired.dataset.provenance.receipt?.temporal).toMatchObject({executionId,resultHash:receipt.result_hash,queryRevision:2});
 expect(c.start).toHaveBeenCalledWith(expect.objectContaining({revision:2,context:{mode:'current_corrected'}}),expect.any(AbortSignal));
 expect(vi.mocked(c.start).mock.calls[0][0]).not.toHaveProperty('input_manifest');
 await source.acquire(signal());expect(c.start).toHaveBeenCalledTimes(2);expect(c.get).not.toHaveBeenCalled();
});
it('resolves latest only by explicit opt in and reads pinned executions without starting',async()=>{
 const c=client();await createTemporalSourceAdapter(c,{kind:'query',queryId:fixed.queryId,revisionPolicy:'latest',params:{},context:fixed.context}).acquire(signal());
 expect(c.get).toHaveBeenCalledWith(fixed.queryId,undefined,expect.any(AbortSignal));
 vi.mocked(c.start).mockClear();await createTemporalSourceAdapter(c,{kind:'execution',executionId}).acquire(signal());expect(c.start).not.toHaveBeenCalled();
});
it('refuses malformed/future binding intent without dropping it',()=>{
 expect(parseQueryBinding(fixed)).toEqual(fixed);
 for(const value of [{...fixed,revision:undefined},{...fixed,schemaVersion:2},{kind:'execution',executionId:'invalid'},{...fixed,revisionPolicy:'silent-latest'}])expect(()=>parseQueryBinding(value)).toThrow();
});
it('aborts stale noncooperative pages and never calls them complete',async()=>{
 const c=client();let done!:(p:typeof page)=>void;vi.mocked(c.page).mockImplementation(()=>new Promise(resolve=>{done=resolve}));
 const control=new AbortController();const pending=createTemporalSourceAdapter(c,fixed).acquire(control.signal);await vi.waitFor(()=>expect(done).toBeTypeOf('function'));control.abort();done(page);await expect(pending).rejects.toMatchObject({name:'AbortError'});
});
it('retains truncated lower-bound semantics and rejects the wrong origin',async()=>{
 const c=client();vi.mocked(c.page).mockResolvedValue({...page,next_cursor:null,complete:false,truncated:true,count_quality:'lower_bound'});
 const data=await createTemporalSourceAdapter(c,fixed).acquire(signal());expect(data.kind==='dataset'&&data.dataset.completeness).toMatchObject({kind:'partial',totalRowCount:2000});
 vi.mocked(c.page).mockResolvedValue({...page,receipt:{...receipt,query_revision:3}});await expect(createTemporalSourceAdapter(c,fixed).acquire(signal())).rejects.toThrow(/revision/i);
});

it('retains exact Arrow scalar strings through acquisition and records lower-bound page metadata',async()=>{
 const c=client();const schema=[{name:'Id',type:'int64',nullable:false},{name:'Amount',type:'decimal128(38, 18)',nullable:false},{name:'Day',type:'date32[day]',nullable:false}];const values={Id:'9223372036854775807',Amount:'1.000000000000000001',Day:'2026-10-15'};
 vi.mocked(c.page).mockResolvedValue({...page,schema,rows:[values],receipt:{...receipt,schema},count_quality:'lower_bound',complete:false,truncated:true,next_cursor:null});
 const acquired=await createTemporalSourceAdapter(c,fixed).acquire(signal());if(acquired.kind!=='dataset')throw Error('dataset');expect(acquired.dataset.rows[0].values).toEqual(values);expect(acquired.dataset.columns.map(c=>c.dtype)).toEqual(['text','text','dateString']);expect(acquired.dataset.provenance.metadata?.temporalPage).toMatchObject({countQuality:'lower_bound',loadedRows:1});
});

it('retains exact snapshot pins through fixed, latest and pinned acquisition into all serialized export metadata',async()=>{
 const {temporalExportMetadata,temporalJson,temporalCsv}=await import('./export');const {toXlsx}=await import('../export');const XLSX=await import('xlsx');
 const ids=[Number.MAX_SAFE_INTEGER,'9007199254740992','9223372036854775807'];const input_manifest={...receipt.input_manifest,pins:ids.map((snapshot_id,i)=>({catalog_id:`catalog-${i}`,snapshot_id})),source_manifests:{'eodhd.eod':{manifest_id:receipt.input_manifest.manifest_id,pins:[{catalog_id:'hot',snapshot_id:'9223372036854775807'}],projection_versions:{'gold.eodhd.eod':'daily-v1'}},'eodhd.fundamentals':{manifest_id:receipt.input_manifest.manifest_id,pins:[{catalog_id:'hot',snapshot_id:'9007199254740992'}],projection_versions:{'gold.eodhd.fundamentals':'fundamentals-v1'}}}};
 const bindings=[fixed,{kind:'query' as const,queryId:fixed.queryId,revisionPolicy:'latest' as const,params:{},context:fixed.context},{kind:'execution' as const,executionId}];
 for(const binding of bindings){
  const c=client();vi.mocked(c.page).mockResolvedValue({...page,receipt:{...receipt,input_manifest}});
  const acquired=await createTemporalSourceAdapter(c,binding).acquire(signal());if(acquired.kind!=='dataset')throw Error('dataset');
  const data=acquired.dataset,metadata=temporalExportMetadata(data.provenance,data.completeness),rows=data.rows.map(r=>r.values);
  const exported=JSON.parse(temporalJson(rows,metadata));expect(exported.provenance.receipt.temporal.inputManifest).toEqual(input_manifest);
  const csv=XLSX.read(temporalCsv(rows,['Revenue'],metadata),{type:'string'}),csvRows=XLSX.utils.sheet_to_json<Record<string,string>>(csv.Sheets[csv.SheetNames[0]]);
  expect(JSON.parse(csvRows[0].__temporaldb_provenance_v1).receipt.temporal.inputManifest).toEqual(input_manifest);
  const excel=XLSX.read(await toXlsx(rows,['Revenue'],undefined,{},metadata),{type:'array'}),excelRows=XLSX.utils.sheet_to_json<Record<string,string>>(excel.Sheets.TemporalDB);
  expect(JSON.parse(excelRows.find(r=>r.Field==='provenance')!.JSON).receipt.temporal.inputManifest).toEqual(input_manifest);
 }
});

it('resolves relative date parameters at run time and sends only literals',async()=>{
 const c=client();vi.mocked(c.get).mockResolvedValue({...definition,parameters:[{name:'as_of',type:'date',required:true},{name:'ticker',type:'string',required:true}]});
 await createTemporalSourceAdapter(c,{...fixed,params:{as_of:'T-1bd',ticker:'T'}}).acquire(signal());
 expect(c.get).toHaveBeenCalledWith(fixed.queryId,2,expect.any(AbortSignal));
 const sent=vi.mocked(c.start).mock.calls[0][0].params;
 expect(sent.ticker).toBe('T');expect(sent.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);expect(sent.as_of).not.toBe('T-1bd');
});

it('adapts a retained later page without starting a query and keeps row identity global',async()=>{
 const c=client();const retained={page:{...page,total_count:2001,rows:[{Revenue:10}],next_cursor:null},executionId,offset:2000,pageNumber:3,hasPrevious:true,hasNext:false};
 const data=await createTemporalSourceAdapter(c,fixed,retained).acquire(signal());
 if(data.kind!=='dataset')throw Error('dataset');
 expect(c.start).not.toHaveBeenCalled();expect(c.page).not.toHaveBeenCalled();
 expect(data.dataset.rows[0].id).toBe(`${executionId}:2000`);
 expect(data.dataset.completeness.kind).toBe('paged');
 expect(data.dataset.provenance.metadata?.temporalPage).toMatchObject({pageOffset:2000,pageNumber:3,hasNextPage:false});
 expect(data.dataset.completeness.warnings?.join(' ')).toContain('loaded rows only');
});

it('keeps inspection-domain warnings on complete and empty retained results, including pinned copies and exports',async()=>{
 const {temporalExportMetadata,temporalJson,temporalCsv}=await import('./export');
 for(const rows of [[{Revenue:10}],[]]){
  const schema=page.schema;
  const inspected={...page,schema,rows,total_count:rows.length,next_cursor:null,complete:true,truncated:false,receipt:{...receipt,schema,transform_versions:{'sip_archive.ObservedSlice':'runtime-legacy-sip-inspection-1','gold.sip_archive.ObservedSlice':'legacy-sip-inspection-v1'}}};
  for(const binding of [fixed,{kind:'execution' as const,executionId}]){
   const data=await createTemporalSourceAdapter(client(),binding,{page:inspected,executionId,offset:0,pageNumber:1,hasPrevious:false,hasNext:false}).acquire(signal());
   if(data.kind!=='dataset')throw Error('dataset');
   expect(data.dataset.completeness.kind).toBe('complete');
   expect(data.dataset.completeness.warnings?.join(' ')).toMatch(/SIP inspection only.*sampled partition/i);
   expect(data.dataset.completeness.warnings?.join(' ')).toContain('canonical tick');
   const metadata=temporalExportMetadata(data.dataset.provenance,data.dataset.completeness);
   expect(temporalJson(rows,metadata)).toContain('SIP inspection only');
   expect(temporalCsv(rows,['Revenue'],metadata)).toContain('SIP inspection only');
  }
 }
});
