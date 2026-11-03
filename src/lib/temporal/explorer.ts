// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type {DatasetDescription} from './catalog';
import {contractSchema} from './generated';
import {isRecord,parseContract,type ColumnSpec,type ParameterSpec,type QueryDefinition,type ResultColumn,type TemporalContext} from './contracts';
import {detectPeriodicity} from '../periodicity';
import {pivotValueKey} from '../pivotKeys';
import {parseParamText,resolveParams} from './params';

/**
 * The TemporalDB explorer's builder state, kept on the card as JSON in
 * params.draft. `params` are typed fields: a dataset's request fields, or a
 * SQL query's declared parameters. Values stay as typed text. Relative dates
 * resolve when a definition is built and stay expressions on a bound widget.
 */
export type ExplorerParam={name:string;type:ParameterSpec['type'];value:string};
export type ExplorerDraft={mode:'dataset'|'sql';title:string;description:string;context:TemporalContext;params:ExplorerParam[];sources:Record<string,string>;sql:string;maxRows:number;timeoutSeconds:number;columns:ColumnSpec[];queryId?:string;revision?:number};
/** query_create replaces it; validate still needs a well-formed identity. */
export const PLACEHOLDER_QUERY_ID='00000000-0000-0000-0000-000000000000';
export const emptyDraft=():ExplorerDraft=>({mode:'dataset',title:'',description:'',context:{mode:'current_corrected'},params:[],sources:{},sql:'',maxRows:10000,timeoutSeconds:30,columns:[]});
const PARAM_TYPES:readonly unknown[]=contractSchema.$defs.ParameterSpec.properties.type.enum;
const isString=(v:unknown)=>typeof v==='string';
const isNumber=(v:unknown)=>typeof v==='number'&&Number.isFinite(v);
/** Each stored field's shape. A field that is absent (a draft from an older build) keeps emptyDraft's default. */
const DRAFT_FIELDS:Record<string,(v:unknown)=>boolean>={
 title:isString,description:isString,sql:isString,queryId:isString,maxRows:isNumber,timeoutSeconds:isNumber,
 revision:v=>Number.isSafeInteger(v)&&(v as number)>0,
 params:v=>Array.isArray(v)&&v.every(p=>isRecord(p)&&isString(p.name)&&PARAM_TYPES.includes(p.type)&&isString(p.value)),
 sources:v=>isRecord(v)&&Object.values(v).every(isString),
 // parseContract throws on a bad column; parseDraft's catch starts over.
 columns:v=>Array.isArray(v)&&v.every(c=>parseContract('ColumnSpec',c)),
};
/** A card's saved draft. Anything unreadable starts over rather than breaking the card: an imported
 * apps.json carries card params verbatim, so every field is checked, not just the mode and context. */
export function parseDraft(text:string|undefined):ExplorerDraft{
 if(!text)return emptyDraft();
 try{
  const v:unknown=JSON.parse(text);if(!isRecord(v)||(v.mode!=='dataset'&&v.mode!=='sql'))return emptyDraft();parseContract('TemporalContext',v.context);
  if(Object.entries(DRAFT_FIELDS).some(([k,ok])=>Object.hasOwn(v,k)&&!ok(v[k])))return emptyDraft();
  return {...emptyDraft(),...v} as ExplorerDraft;
 }
 catch{return emptyDraft();}
}
const spec=(p:ExplorerParam):ParameterSpec=>({name:p.name,type:p.type,required:false,nullable:false});
/** The typed values a query widget binds: literals typed, relative dates kept as text. */
export function draftValues(draft:ExplorerDraft):{ok:true;values:Record<string,unknown>}|{ok:false;error:string}{
 const values:Record<string,unknown>={};
 for(const p of draft.params){if(p.value.trim()==='')continue;const r=parseParamText(spec(p),p.value);if(!r.ok)return {ok:false,error:r.error};values[p.name]=r.value;}
 return {ok:true,values};
}
const JSON_TYPES:Record<string,ParameterSpec['type']>={integer:'integer',number:'number',boolean:'boolean'};
/** describe's request fields as typed fields. EODHD names them; yfinance gives a schema map; FRED gives none (null). */
export function requestFields(d:DatasetDescription):ExplorerParam[]|null{
 const p=d.parameters;
 if(Array.isArray(p.names))return p.names.filter((n):n is string=>typeof n==='string').map(name=>({name,type:(name==='from'||name==='to')&&/^eodhd\.(eod|splits|div)$/.test(d.dataset_id)?'date':'string',value:''}));
 if(p.status==='CAPABILITY_UNAVAILABLE')return null;
 return Object.entries(p).filter((e):e is [string,Record<string,unknown>]=>isRecord(e[1])).map(([name,s])=>({name,type:s.format==='date'?'date':JSON_TYPES[String(s.type)]??'string',value:''}));
}
/** A source's default SQL alias: its endpoint name as an identifier, unique within the query. */
export function sourceAlias(datasetId:string,taken:Record<string,string>):string{
 const base=(datasetId.split('.').slice(1).join('_')||datasetId).replace(/[^A-Za-z0-9_]/g,'_').replace(/^(?=\d)/,'_').toLowerCase();
 let alias=base;for(let n=2;Object.hasOwn(taken,alias);n++)alias=`${base}_${n}`;return alias;
}
// Only Arrow types the runner can check (query/runner.py): `string` exactly, `struct<`/`list<` as json.
const expectationType=(t:string):ColumnSpec['type']|null=>/^u?int(8|16|32|64)$/.test(t)?'integer':/^(float|double|halffloat|decimal)/.test(t)?'number':t==='bool'?'boolean':/^date(32|64)\[/.test(t)?'date':/^timestamp\[/.test(t)?'timestamp':t==='string'?'string':/^(struct|list)</.test(t)?'json':null;
/** Result columns (Arrow types) as schema_expectation in result order; [] (no expectation) if any column's type cannot be pinned. */
export function columnSpecs(columns:readonly ResultColumn[]):ColumnSpec[]{
 const specs:ColumnSpec[]=[];
 for(const c of columns){const type=expectationType(c.type);if(!type)return [];specs.push({name:c.name,nullable:c.nullable,type});}
 return specs;
}
/**
 * describe_table's column profile (crates/pivot-core/src/profile.rs) over a Run's
 * first page, display only: TemporalDB returns no counts, so nothing here is the cache.
 * `expectation` null is a type columnSpecs cannot pin.
 */
export type ExplorerColumnProfile={scope:'preview';rowsProfiled:number;completeness:string;fields:Array<{id:string;type:string;expectation:ColumnSpec['type']|null;kind:'text'|'number'|'date'|'boolean'|'none';count:number;missing:number;distinct:number;distinctCapped:boolean;min:string|number|null;max:string|number|null;samples:Array<string|number|boolean>;periodicity:string|null;cellErrors:number}>};
type ProfileKind=ExplorerColumnProfile['fields'][number]['kind'];
const KINDS:Partial<Record<ColumnSpec['type'],ProfileKind>>={integer:'number',number:'number',date:'date',timestamp:'date',boolean:'boolean',string:'text'};
// Strings the runner cannot pin are still text to the profile.
const kindOf=(type:string,expectation:ColumnSpec['type']|null):ProfileKind=>(expectation&&KINDS[expectation])??(/^(large_string|string_view)$/.test(type)?'text':'none');
const DISTINCT_CAP=1000,SAMPLES=5,CLIP=40;
const clip=<T,>(v:T)=>typeof v==='string'?v.slice(0,CLIP):v;
const numeric=(v:unknown)=>typeof v==='number'?Number.isFinite(v):typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v));
const isoDate=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}/.test(v);
// A present value that does not fit the column's kind; text and none take anything.
const FITS:Record<ProfileKind,(v:unknown)=>boolean>={number:numeric,date:isoDate,boolean:v=>typeof v==='boolean',text:()=>true,none:()=>true};
/** Profiles the rows given, nothing fetched. Missing is null, "" or absent; distinct keys are pivotValueKey's, as the worker's pivot_value_key. */
export function profileColumns(columns:readonly ResultColumn[],rows:readonly Record<string,unknown>[],completeness='unknown'):ExplorerColumnProfile{
 return {scope:'preview',rowsProfiled:rows.length,completeness,fields:columns.map(c=>{
  const expectation=expectationType(c.type),kind=kindOf(c.type,expectation),ranged=kind==='number'||kind==='date';
  const keys=new Set<string>(),samples:Array<string|number|boolean>=[];
  let count=0,cellErrors=0,min:string|number|null=null,max:string|number|null=null;
  const less=(a:string|number,b:string|number)=>kind==='number'?Number(a)<Number(b):String(a)<String(b);
  for(const r of rows){
   const v=r[c.name];if(v===null||v===undefined||v==='')continue;
   count++;
   if(keys.size<=DISTINCT_CAP&&!keys.has(pivotValueKey(v))){keys.add(pivotValueKey(v));if(samples.length<SAMPLES&&(typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)))samples.push(clip(v));}
   if(!FITS[kind](v)){cellErrors++;continue;}
   if(ranged){const x=v as string|number;if(min===null||less(x,min))min=x;if(max===null||less(max,x))max=x;}
  }
  return {id:c.name,type:c.type,expectation,kind,count,missing:rows.length-count,distinct:Math.min(keys.size,DISTINCT_CAP),distinctCapped:keys.size>DISTINCT_CAP,min:clip(min),max:clip(max),samples,periodicity:kind==='date'?detectPeriodicity(rows.map(r=>r[c.name])):null,cellErrors};
 })};
}
// ponytail: a `$` inside a string literal or comment also counts; the server's own parse is authoritative.
const SQL_PARAM=/\$([A-Za-z_][A-Za-z0-9_]*)/g;
/** The QueryDefinition a draft stands for. TemporalDB's validate answers one generic 400, so explainable mistakes are caught here. */
export function buildDefinition(draft:ExplorerDraft,datasetId:string,now=new Date()):{ok:true;definition:QueryDefinition}|{ok:false;error:string}{
 const fail=(error:string)=>({ok:false as const,error});
 if(!draft.title.trim())return fail('A title is required');
 const typed=draftValues(draft);if(!typed.ok)return typed;
 const specs=draft.params.filter(p=>Object.hasOwn(typed.values,p.name)).map(spec);
 if(new Set(specs.map(s=>s.name)).size!==specs.length)return fail('Parameter names must be unique');
 let resolved:Record<string,unknown>;
 try{resolved=resolveParams(specs,typed.values,now).params;}catch(e){return fail(e instanceof Error?e.message:'Parameters cannot be resolved');}
 const parameters=specs.map(s=>({...s,default:resolved[s.name]}));
 let request:Record<string,unknown>;
 if(draft.mode==='dataset'){
  if(!datasetId)return fail('Choose a dataset in the catalog');
  request={dataset_id:datasetId,parameters:Object.fromEntries(parameters.map(p=>[p.name,p.default]))};
 }else{
  if(!Object.keys(draft.sources).length)return fail('Add at least one source from the catalog');
  if(!draft.sql.trim())return fail('Write the SQL');
  const blank=draft.params.find(p=>!p.value.trim());if(blank)return fail(`${blank.name} needs a value`);
  const used=new Set([...draft.sql.matchAll(SQL_PARAM)].map(m=>m[1])),declared=new Set(parameters.map(p=>p.name));
  const missing=[...used].filter(n=>!declared.has(n)),unused=[...declared].filter(n=>!used.has(n));
  if(missing.length)return fail(`Declare ${missing.map(n=>'$'+n).join(', ')}`);
  if(unused.length)return fail(`Use or remove ${unused.join(', ')}`);
  if(!Number.isSafeInteger(draft.maxRows)||draft.maxRows<1||draft.maxRows>10000)return fail('Max rows must be 1 to 10,000');
  if(!Number.isSafeInteger(draft.timeoutSeconds)||draft.timeoutSeconds<1||draft.timeoutSeconds>30)return fail('Timeout must be 1 to 30 seconds');
  request={sql:draft.sql,sources:{...draft.sources},bindings:{},max_rows:draft.maxRows,timeout_seconds:draft.timeoutSeconds};
 }
 // Blank omits the key: a server built before `description` refuses unknown fields, even null.
 const description=draft.description.trim();
 const definition={query_id:draft.queryId??PLACEHOLDER_QUERY_ID,revision:draft.revision??1,title:draft.title.trim(),...(description?{description}:{}),kind:draft.mode,parameters,request,temporal:draft.context,schema_expectation:draft.columns};
 try{return {ok:true,definition:parseContract('QueryDefinition',definition)};}catch(e){return fail(e instanceof Error?e.message:'Invalid definition');}
}
