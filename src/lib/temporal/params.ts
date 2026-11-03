// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {isExpression,parseExpression,previewExpression,resolveValue,type ResolveContext} from '../dateExpressions';
import {filterDateContext} from '../dateFilters';
import type {ParameterSpec} from './contracts';

/**
 * Typed TemporalDB parameters (v11 design review, 2026-10-16).
 *
 * The binding keeps what the user typed: a literal, or for date/timestamp
 * parameters a v5 relative expression (T-1bd, FQ-4, $currentDate-3M ...).
 * TemporalDB only accepts resolved values ("Relative times must already be
 * resolved by callers"), so every run resolves expressions once against a
 * single frozen clock and sends literals. The receipt's `parameters` then
 * records exactly what was frozen.
 */
const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const periodType=(spec:ParameterSpec)=>spec.type==='date'?'date':'datetime';
export const acceptsExpression=(spec:ParameterSpec)=>spec.type==='date'||spec.type==='timestamp';
export const isRelativeParam=(spec:ParameterSpec,value:unknown):value is string=>acceptsExpression(spec)&&typeof value==='string'&&isExpression(periodType(spec),value);
/** Could any value need a definition lookup to resolve? Literal-only bindings never do. */
export const mayNeedResolution=(params:Record<string,unknown>)=>Object.values(params).some(v=>typeof v==='string'&&parseExpression(v)!==null);

/** The field's text for a stored value. Booleans are rendered as a checkbox by the caller. */
export function paramText(value:unknown):string{return value===null||value===undefined?'':String(value);}

/** The initial binding params for a definition: declared defaults, else null for nullable optionals. */
export function defaultParams(specs:readonly ParameterSpec[]):Record<string,unknown>{
 return Object.fromEntries(specs.filter(p=>p.default!==undefined&&p.default!==null||!p.required).map(p=>[p.name,p.default??null]));
}

export type ParsedParam={ok:true;value:unknown;omit?:boolean}|{ok:false;error:string};
/** One field's text as the value stored in the binding. Expressions stay as text. */
export function parseParamText(spec:ParameterSpec,text:string):ParsedParam{
 const t=text.trim();
 if(t===''){
  if(spec.nullable)return {ok:true,value:null};
  if(!spec.required)return {ok:true,value:undefined,omit:true};
  return {ok:false,error:`${spec.name} is required`};
 }
 switch(spec.type){
  case 'string':return {ok:true,value:text};
  case 'uuid':return UUID.test(t)?{ok:true,value:t.toLowerCase()}:{ok:false,error:`${spec.name} must be a UUID`};
  case 'integer':{const n=Number(t);return /^-?\d+$/.test(t)&&Number.isSafeInteger(n)?{ok:true,value:n}:{ok:false,error:`${spec.name} must be a whole number`};}
  case 'number':{const n=Number(t);return Number.isFinite(n)?{ok:true,value:n}:{ok:false,error:`${spec.name} must be a finite number`};}
  case 'boolean':return t==='true'||t==='false'?{ok:true,value:t==='true'}:{ok:false,error:`${spec.name} must be true or false`};
  case 'date':return ISO_DATE.test(t)||isExpression('date',t)?{ok:true,value:t}:{ok:false,error:`${spec.name} must be YYYY-MM-DD or a relative date such as T-1bd`};
  case 'timestamp':return ISO_TIMESTAMP.test(t)||isExpression('datetime',t)?{ok:true,value:t}:{ok:false,error:`${spec.name} must be an ISO timestamp with offset or a relative time such as T-1h`};
 }
 return {ok:false,error:`${spec.name} has an unsupported type`};
}

/** What an expression resolves to right now, for the field's hint. Null for literals. */
export function previewParam(spec:ParameterSpec,value:unknown,ctx:Omit<ResolveContext,'trace'>=filterDateContext()):string|null{
 if(!isRelativeParam(spec,value))return null;
 return previewExpression(periodType(spec),value,ctx)?.text||null;
}

export type ResolvedParams={params:Record<string,unknown>;expressions:Record<string,string>};
/** Resolve every relative value with ONE clock, so a run's dates agree with each other. */
export function resolveParams(specs:readonly ParameterSpec[],params:Record<string,unknown>,now:Date=new Date(),ctx:ResolveContext=filterDateContext()):ResolvedParams{
 const out:Record<string,unknown>={...params};const expressions:Record<string,string>={};
 for(const spec of specs){
  const value=params[spec.name];
  if(!isRelativeParam(spec,value))continue;
  const resolved=resolveValue(periodType(spec),value,{...ctx,now});
  if(!resolved)throw new Error(`${spec.name}: ${value} cannot be resolved yet`);
  out[spec.name]=resolved;expressions[spec.name]=value;
 }
 return {params:out,expressions};
}
