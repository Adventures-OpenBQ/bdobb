// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {isRecord} from './isRecord';
export type StudyValue=string|number|boolean|null;
export type StudyColumn={id:string;study:string;output:string;params:Record<string,StudyValue>;interval:string;session:string;basis:string;provider:string;points:number;presentation:'latest'|'sparkline'|'both';definition_version?:string};
export type StudyParam={type:'integer'|'number'|'string'|'boolean';default:StudyValue;label?:string;minimum?:number;maximum?:number;step?:number;enum?:StudyValue[];nullable?:boolean};
export type StudyEntry={name:string;label:string;definition_version:string;outputs:string[];param_schema:Record<string,StudyParam>;unsupportedReason?:string};
const scalar=(v:unknown):v is StudyValue=>v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=128;
export function parseStudyCatalog(raw:unknown):StudyEntry[]{
 if(!isRecord(raw)||raw.schema_version!==1||!Array.isArray(raw.studies)||raw.studies.length>512)throw new Error('Invalid study catalog');
 return raw.studies.flatMap((entry):StudyEntry[]=>{
  try {
  if(!isRecord(entry)||!text(entry.name)||!isRecord(entry.param_schema)||!text(String(entry.definition_version??'')))throw new Error('Invalid study definition');
  const schema:Record<string,StudyParam>=Object.create(null);
  for(const [key,value] of Object.entries(entry.param_schema)){
   if(!text(key)||!isRecord(value)||!['integer','number','string','boolean'].includes(String(value.type))||!scalar(value.default))throw new Error('Invalid parameter schema');
   const descriptor={...value,enum:value.enum??value.choices} as StudyParam;
   if(descriptor.enum!==undefined&&(!Array.isArray(descriptor.enum)||descriptor.enum.length>256||!descriptor.enum.every(scalar)))throw new Error('Invalid choices');
   schema[key]=descriptor;
  }
  const outputs=Array.isArray(entry.outputs)?entry.outputs:isRecord(entry.render)?Object.keys(entry.render):[];
  if(!outputs.length||!outputs.every(text))throw new Error('Invalid study outputs');
  const unsupportedReason=(Array.isArray(entry.times)&&entry.times.length>0)||(Array.isArray(entry.tickers)&&entry.tickers.length>0)||entry.sessioned===true?'Requires chart time, ticker or session context; unavailable as a grid column.':undefined;
  const result={unsupportedReason,name:entry.name,label:typeof entry.label==='string'?entry.label:entry.name,definition_version:String(entry.definition_version),outputs:outputs as string[],param_schema:schema};
  if(validateStudyParams(result,studyDefaults(result)))throw new Error('Invalid parameter defaults');
  return [result];
  } catch {
    if(!isRecord(entry)||typeof entry.name!=='string'||entry.name.length<1||entry.name.length>64)return [];
    return [{name:entry.name,label:typeof entry.label==='string'?entry.label:entry.name,definition_version:String(entry.definition_version??'unknown'),outputs:isRecord(entry.render)?Object.keys(entry.render):[],param_schema:{},unsupportedReason:'Parameter metadata is not supported by the grid editor.'}];
  }
 });
}
export function studyDefaults(entry:StudyEntry):Record<string,StudyValue>{return Object.fromEntries(Object.entries(entry.param_schema).map(([key,descriptor])=>[key,descriptor.default]));}
export function validateStudyParams(entry:StudyEntry,params:Record<string,unknown>):string|null{
 if(Object.keys(params).some(key=>!Object.hasOwn(entry.param_schema,key)))return 'Unknown study parameter';
 for(const [key,descriptor]of Object.entries(entry.param_schema)){
  const value=params[key],label=descriptor.label??key;
  if(value===null&&descriptor.nullable===true)continue;
  if(descriptor.type==='integer'?typeof value!=='number'||!Number.isInteger(value):descriptor.type==='number'?typeof value!=='number'||!Number.isFinite(value):typeof value!==descriptor.type)return `${label}: invalid ${descriptor.type}`;
  if(typeof value==='number'&&((descriptor.minimum!==undefined&&value<descriptor.minimum)||(descriptor.maximum!==undefined&&value>descriptor.maximum)))return `${label}: outside allowed range`;
  if(descriptor.enum&&!descriptor.enum.includes(value as StudyValue))return `${label}: choose an allowed value`;
 }
 return null;
}
export function parseStudyColumns(raw:unknown):StudyColumn[]{
 if(!Array.isArray(raw)||raw.length>16)throw new Error('Invalid study columns');
 const ids=new Set<string>();
 return raw.map(value=>{
  if(!isRecord(value)||!['study','output','interval','session','basis'].every(key=>text(value[key]))||typeof value.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(value.id)||String(value.study).length>64||String(value.output).length>64||typeof value.provider!=='string'||value.provider.length>32||!isRecord(value.params)||!Object.values(value.params).every(scalar)||Object.keys(value.params).length>64||!Number.isInteger(value.points)||Number(value.points)<1||Number(value.points)>256||!['latest','sparkline','both'].includes(String(value.presentation))||ids.has(String(value.id))||(value.definition_version!==undefined&&!text(value.definition_version)))throw new Error('Invalid study column');
  ids.add(String(value.id));return {id:String(value.id),study:String(value.study),output:String(value.output),params:{...value.params} as Record<string,StudyValue>,interval:String(value.interval),session:String(value.session),basis:String(value.basis),provider:value.provider,points:Number(value.points),presentation:value.presentation as StudyColumn['presentation'],...(value.definition_version===undefined?{}:{definition_version:String(value.definition_version)})};
 });
}
export type StudyResult={id:string;symbol:string;latest:number|null;points:{time:string;value:number|null}[];status:'ok'|'warming_up'|'error';error_code?:string;revision?:unknown;as_of?:unknown;input_cursor?:unknown;params?:unknown;context?:unknown;definition_version?:unknown};
export function parseStudyResults(raw:unknown,columns:readonly StudyColumn[],symbols:readonly string[]):Map<string,StudyResult>{
 if(!isRecord(raw)||raw.schema_version!==1||!Array.isArray(raw.results)||raw.results.length>800)throw new Error('Invalid study response');
 const requested=new Map(columns.map(column=>[column.id,column])),known=new Set(symbols),out=new Map<string,StudyResult>();
 for(const value of raw.results){
  if(!isRecord(value)||!requested.has(String(value.id))||!known.has(String(value.symbol))||!['ok','warming_up','error'].includes(String(value.status))||!(value.latest===null||typeof value.latest==='number'&&Number.isFinite(value.latest))||!Array.isArray(value.points)||value.points.length>requested.get(String(value.id))!.points||value.points.some(point=>!isRecord(point)||typeof point.time!=='string'||!Number.isFinite(Date.parse(point.time))||!(point.value===null||typeof point.value==='number'&&Number.isFinite(point.value))))throw new Error('Invalid study result');
  const key=`${value.id}:${value.symbol}`;if(out.has(key))throw new Error('Duplicate study result');
  out.set(key,{...value,error_code:typeof value.error_code==='string'&&/^[A-Za-z0-9_.-]{1,128}$/.test(value.error_code)?value.error_code:undefined} as StudyResult);
 }
 return out;
}
