// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest';
import type {DatasetDescription} from './catalog';
import {description} from './fixtures';
import {PLACEHOLDER_QUERY_ID,buildDefinition,columnSpecs,emptyDraft,parseDraft,profileColumns,requestFields,sourceAlias,type ExplorerDraft} from './explorer';
const described=description as unknown as DatasetDescription;
const now=new Date('2026-10-19T15:00:00Z');
const draft=(over:Partial<ExplorerDraft>={}):ExplorerDraft=>({...emptyDraft(),title:'AAPL',params:[{name:'symbol',type:'string',value:'AAPL.US'}],...over});
describe('the explorer draft',()=>{
 it('reads a saved draft and starts over on anything unreadable',()=>{
  const saved=draft({queryId:'11111111-1111-4111-8111-111111111111',revision:2});
  expect(parseDraft(JSON.stringify(saved))).toEqual(saved);
  for(const bad of [undefined,'','{','[]',JSON.stringify({mode:'graph'}),JSON.stringify({...saved,context:{mode:'known_at'}})])expect(parseDraft(bad)).toEqual(emptyDraft());
  // Imported apps.json card params arrive verbatim: every malformed field starts over.
  const p=saved.params[0];
  for(const over of [{params:{}},{params:[{name:'symbol',type:'string'}]},{params:[{...p,type:'money'}]},{sources:{eod:1}},{sources:['eodhd.eod']},{maxRows:'10000'},{timeoutSeconds:null},
   {title:{}},{description:1},{sql:null},{columns:[{name:'x',type:'money'}]},{columns:{}},{queryId:7},{revision:0},{revision:1.5}])
   expect(parseDraft(JSON.stringify({...saved,...over})),JSON.stringify(over)).toEqual(emptyDraft());
  // A draft saved by an older build that lacks a field keeps that field's default.
  const {columns:_c,sql:_s,...older}=saved;
  expect(parseDraft(JSON.stringify(older))).toEqual(saved);
 });
 it('types request fields from describe: EODHD names, a yfinance schema, none for FRED',()=>{
  expect(requestFields(described)?.map(f=>[f.name,f.type])).toEqual([['from','date'],['order','string'],['period','string'],['symbol','string'],['to','date']]);
  expect(requestFields({...described,dataset_id:'eodhd.ticks',parameters:{names:['from','symbol','to']}})?.map(f=>f.type)).toEqual(['string','string','string']);
  expect(requestFields({...described,dataset_id:'yfinance.YfinanceEquityHistorical',parameters:{symbol:{type:'string'},start_date:{type:'string',format:'date'},auto_adjust:{type:'boolean'}}})?.map(f=>[f.name,f.type])).toEqual([['symbol','string'],['start_date','date'],['auto_adjust','boolean']]);
  expect(requestFields({...described,dataset_id:'fred.series/observations',parameters:{status:'CAPABILITY_UNAVAILABLE'}})).toBeNull();
 });
 it('builds a dataset definition: filled fields become optional typed parameters with resolved defaults',()=>{
  const built=buildDefinition(draft({params:[{name:'symbol',type:'string',value:'AAPL.US'},{name:'from',type:'date',value:'T-1bd'},{name:'to',type:'date',value:''}]}),'eodhd.eod',now);
  if(!built.ok)throw new Error(built.error);
  expect(built.definition).toMatchObject({query_id:PLACEHOLDER_QUERY_ID,revision:1,title:'AAPL',kind:'dataset',schema_expectation:[],temporal:{mode:'current_corrected'}});
  expect(built.definition.parameters.map(p=>p.name)).toEqual(['symbol','from']);
  expect(built.definition.parameters[1].default).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(built.definition.request).toEqual({dataset_id:'eodhd.eod',parameters:{symbol:'AAPL.US',from:built.definition.parameters[1].default}});
  expect('description' in built.definition).toBe(false);
 });
 it('refuses a draft without a title or dataset, or with a mistyped value',()=>{
  expect(buildDefinition(draft({title:' '}),'eodhd.eod',now)).toEqual({ok:false,error:'A title is required'});
  expect(buildDefinition(draft(),'',now)).toEqual({ok:false,error:'Choose a dataset in the catalog'});
  expect(buildDefinition(draft({params:[{name:'limit',type:'integer',value:'1.5'}]}),'eodhd.eod',now)).toEqual({ok:false,error:'limit must be a whole number'});
 });
 it('builds SQL: aliases, $name parameters declared and used, limits, schema expectation',()=>{
  const sql=draft({mode:'sql',params:[{name:'floor',type:'number',value:'1'}],sources:{eod:'eodhd.eod'},sql:'SELECT raw_close FROM eod WHERE raw_close > $floor',columns:[{name:'raw_close',type:'number',nullable:false}]});
  const built=buildDefinition(sql,'',now);if(!built.ok)throw new Error(built.error);
  expect(built.definition.request).toEqual({sql:sql.sql,sources:{eod:'eodhd.eod'},bindings:{},max_rows:10000,timeout_seconds:30});
  expect(built.definition.parameters).toEqual([{name:'floor',type:'number',required:false,nullable:false,default:1}]);
  expect(built.definition.schema_expectation).toEqual(sql.columns);
  expect(buildDefinition({...sql,params:[]},'',now)).toEqual({ok:false,error:'Declare $floor'});
  expect(buildDefinition({...sql,params:[{name:'floor',type:'number',value:' '}]},'',now)).toEqual({ok:false,error:'floor needs a value'});
  expect(buildDefinition({...sql,sql:'SELECT 1 FROM eod'},'',now)).toEqual({ok:false,error:'Use or remove floor'});
  expect(buildDefinition({...sql,params:[...sql.params,...sql.params]},'',now)).toEqual({ok:false,error:'Parameter names must be unique'});
  expect(buildDefinition({...sql,sources:{}},'',now)).toEqual({ok:false,error:'Add at least one source from the catalog'});
  expect(buildDefinition({...sql,maxRows:10001},'',now)).toEqual({ok:false,error:'Max rows must be 1 to 10,000'});
  expect(buildDefinition({...sql,timeoutSeconds:0},'',now)).toEqual({ok:false,error:'Timeout must be 1 to 30 seconds'});
 });
 it('names a source by its endpoint, unique within the query',()=>{
  expect(sourceAlias('eodhd.eod',{})).toBe('eod');
  expect(sourceAlias('eodhd.eod',{eod:'eodhd.eod'})).toBe('eod_2');
  expect(sourceAlias('fred.series/observations',{})).toBe('series_observations');
 });
 it('maps Arrow result types to schema expectation types in result order',()=>{
  const types=['int64','decimal128(38, 18)','double','bool','date32[day]','timestamp[us, tz=UTC]','string','list<item: int64>','struct<a: int64>'];
  expect(columnSpecs(types.map((type,i)=>({name:`c${i}`,type,nullable:true}))).map(c=>c.type)).toEqual(['integer','number','number','boolean','date','timestamp','string','json','json']);
  for(const unpinnable of ['large_string','null'])expect(columnSpecs([{name:'a',type:'int64',nullable:false},{name:'b',type:unpinnable,nullable:true}])).toEqual([]);
 });
});
describe('the preview column profile',()=>{
 const columns=[{name:'raw_close',type:'decimal128(38, 18)',nullable:false},{name:'effective_from',type:'date32[day]',nullable:false},{name:'note',type:'string',nullable:true},{name:'ok',type:'bool',nullable:true},{name:'blob',type:'large_binary',nullable:true},{name:'wide',type:'large_string',nullable:true},{name:'view',type:'string_view',nullable:true}];
 it('counts present, missing, distinct and samples by the table worker rules over the rows given',()=>{
  const rows=[{raw_close:'228.41',effective_from:'2026-10-01',note:'x'.repeat(41),ok:true},{raw_close:221.4,effective_from:'2026-10-02',note:'',ok:false},{raw_close:'abc',effective_from:'not a date',note:null},{raw_close:221.4,effective_from:'2026-10-03',ok:true,blob:'b'}];
  const p=profileColumns(columns,rows,'partial');
  expect(p).toMatchObject({scope:'preview',rowsProfiled:4,completeness:'partial'});
  const [close,date,note,ok,blob]=p.fields;
  expect(close).toMatchObject({id:'raw_close',type:'decimal128(38, 18)',expectation:'number',kind:'number',count:4,missing:0,distinct:3,distinctCapped:false,min:221.4,max:'228.41',samples:['228.41',221.4,'abc'],periodicity:null,cellErrors:1});
  expect(date).toMatchObject({kind:'date',expectation:'date',min:'2026-10-01',max:'2026-10-03',cellErrors:1,periodicity:'daily'});
  expect(note).toMatchObject({kind:'text',count:1,missing:3,samples:['x'.repeat(40)],min:null,max:null,periodicity:null,cellErrors:0});
  expect(ok).toMatchObject({kind:'boolean',expectation:'boolean',count:3,distinct:2,samples:[true,false]});
  expect(blob).toMatchObject({kind:'none',expectation:null,count:1,cellErrors:0});
  for(const f of p.fields.slice(5))expect(f).toMatchObject({kind:'text',expectation:null});
 });
 it('caps distinct at 1,000 and leaves an empty range null, unknown completeness by default',()=>{
  const p=profileColumns(columns,Array.from({length:1001},(_,i)=>({note:`n${i}`})));
  expect(p.completeness).toBe('unknown');
  expect(p.fields[2]).toMatchObject({distinct:1000,distinctCapped:true,samples:['n0','n1','n2','n3','n4']});
  expect(p.fields[0]).toMatchObject({count:0,missing:1001,min:null,max:null});
 });
});
