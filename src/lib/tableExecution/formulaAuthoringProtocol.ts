// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {boundedPlainData} from '../tableModel/validation';
import {validateFormulaAst} from '../tableModel/formulaSyntax';
import {AGG_NAMES} from '../types';
import {ExecutionProtocolError} from './validation';
import type {FormulaBindRequest,FormulaBindResult,MemberDomainRequest,MemberDomainResult} from './types';
export const FORMULA_AUTHORING_LIMITS={requestBytes:8388608,entries:1024,entryBytes:131072,textBytes:16384,diagnostics:100,diagnosticBytes:131072,responseBytes:262144,astBytes:131072,memberRowsBytes:131072,labelBytes:256,page:100,searchBytes:256} as const;
export const byteLength=(s:string)=>new TextEncoder().encode(s).length;
const fail=(message:string):never=>{throw new ExecutionProtocolError('INVALID_REQUEST',message);};
export function authoringPlainData(raw:unknown,max:number=FORMULA_AUTHORING_LIMITS.requestBytes):void{if(!boundedPlainData(raw))fail('Unsafe formula authoring graph');if(byteLength(JSON.stringify(raw))>max)fail('Formula authoring payload exceeds budget');}
type Obj=Record<string,unknown>;
const object=(raw:unknown):Obj=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('Expected authoring object');return raw as Obj;};
const fields=(raw:Obj,allowed:string[])=>{if(Object.keys(raw).some(k=>!allowed.includes(k)))fail('Unexpected formula authoring field');};
const text=(raw:unknown,limit=16384,nonempty=false)=>{if(typeof raw!=='string'||nonempty&&!raw.length||byteLength(raw)>limit)fail('Formula authoring text exceeds budget');};
const count=(raw:unknown)=>{if(!Number.isSafeInteger(raw)||(raw as number)<0)fail('Invalid authoring count');};
const scalar=(raw:unknown)=>raw===null||typeof raw==='string'||typeof raw==='boolean'||typeof raw==='number'&&Number.isFinite(raw);
export function validateBindRequest(raw:unknown):asserts raw is FormulaBindRequest{
 const v=object(raw),d=object(v.draft);fields(d,['id','name','scope','expression','format']);text(d.id,16384,true);text(d.name,16384,true);text(d.expression);if(d.format!==undefined)text(d.format);if(!['source','aggregate'].includes(String(d.scope)))fail('Invalid formula scope');
 if(!Array.isArray(v.bindings)||v.bindings.length>1024||byteLength(JSON.stringify(v.bindings))>131072)fail('Scoped binding budget exceeded');const seen=new Set<string>();
 for(const raw of v.bindings as unknown[]){const b=object(raw),r=object(b.reference);fields(b,['scope','name','reference']);fields(r,['kind','target','id']);if(!['source','aggregate'].includes(String(b.scope))||r.kind!=='reference'||!['field','formula','measure'].includes(String(r.target)))fail('Invalid scoped reference');text(b.name,16384,true);text(r.id,16384,true);const key=JSON.stringify([b.scope,b.name]);if(seen.has(key))fail('Duplicate scoped reference');seen.add(key);}
}
export function validateMemberRequest(raw:unknown):asserts raw is MemberDomainRequest{
 const v=object(raw);text(v.categoryId,16384,true);text(v.categoryRecipe,16384,true);count(v.offset);count(v.limit);if((v.limit as number)<1||(v.limit as number)>100)fail('Member page must be 1–100');if(v.search!==undefined)text(v.search,256);
}
const envelope=['authoringWarnings','authoringWarningCount','authoringWarningsTruncated','kind','requestId','revision','completeness','diagnostics'];
function warnings(v:Obj):void{
 count(v.authoringWarningCount);if(typeof v.authoringWarningsTruncated!=='boolean'||!Array.isArray(v.authoringWarnings)||v.authoringWarnings.length>100||byteLength(JSON.stringify(v.authoringWarnings))>16384)fail('Authoring warning budget exceeded');
 for(const raw of v.authoringWarnings as unknown[]){const w=object(raw);fields(w,['code','message','severity']);text(w.code,256,true);text(w.message,1024);if(w.severity!=='warning')fail('Invalid authoring warning');}
 const n=(v.authoringWarnings as unknown[]).length;if((v.authoringWarningCount as number)<n||v.authoringWarningsTruncated!==((v.authoringWarningCount as number)>n))fail('Inconsistent authoring warning count');
}
export function validateBindResult(raw:unknown):asserts raw is FormulaBindResult{
 const v=object(raw);warnings(v);fields(v,[...envelope,'ast','bindingDiagnostics','diagnosticCount','truncated','resolvedOperators']);count(v.diagnosticCount);if(typeof v.truncated!=='boolean'||!Array.isArray(v.bindingDiagnostics)||(v.bindingDiagnostics as unknown[]).length>100||byteLength(JSON.stringify(v.bindingDiagnostics))>131072)fail('Binding diagnostic budget exceeded');
 const codes=['syntax','invalid-ast','expression-limit','node-limit','depth-limit','parser-nesting-limit','missing-reference','missing-member','missing-aggregation','ambiguous-reference','scope','cycle','blocked-dependency','duplicate-id'];
 for(const raw of v.bindingDiagnostics as unknown[]){const d=object(raw);fields(d,['code','message','definitionId','dependencyIds','candidateIds','position']);if(!codes.includes(String(d.code)))fail('Invalid binding diagnostic');text(d.message,1024);if(d.definitionId!==undefined)text(d.definitionId);if(d.position!==undefined)count(d.position);for(const key of ['dependencyIds','candidateIds'])if(d[key]!==undefined){if(!Array.isArray(d[key])||(d[key] as unknown[]).length>100)fail('Binding diagnostic identity budget exceeded');for(const id of d[key] as unknown[])text(id,16384,true);}}
 if(v.diagnosticCount as number<(v.bindingDiagnostics as unknown[]).length||v.truncated!==((v.diagnosticCount as number)>(v.bindingDiagnostics as unknown[]).length))fail('Inconsistent binding diagnostics');
 if(!Array.isArray(v.resolvedOperators)||v.resolvedOperators.length>9||new Set(v.resolvedOperators).size!==v.resolvedOperators.length||v.resolvedOperators.some(op=>!AGG_NAMES.includes(op)))fail('Invalid resolved operators');
 if(v.ast!==undefined&&(v.diagnosticCount!==0||v.truncated||!validateFormulaAst(v.ast).ast||byteLength(JSON.stringify(v.ast))>131072))fail('Invalid bound AST');
 if(v.ast===undefined&&v.diagnosticCount===0)fail('Missing binding outcome');
}
export function validateMemberResult(raw:unknown):asserts raw is MemberDomainResult{
 const v=object(raw);warnings(v);fields(v,[...envelope,'categoryId','categoryRecipe','offset','limit','search','rows','total','nextOffset','truncated','scanned','omittedCount','classificationComplete','categoryErrorCount']);validateMemberRequest({...v});for(const k of ['total','scanned','omittedCount','categoryErrorCount'])count(v[k]);if(typeof v.truncated!=='boolean'||typeof v.classificationComplete!=='boolean')fail('Invalid member classification');if(v.nextOffset!==undefined)count(v.nextOffset);
 if(!Array.isArray(v.rows)||(v.rows as unknown[]).length>(v.limit as number)||byteLength(JSON.stringify(v.rows))>131072)fail('Member row budget exceeded');const keys=new Set<string>();
 for(const raw of v.rows as unknown[]){const r=object(raw);fields(r,['key','label','labelTruncated','value','observedCount','eligibleCount']);text(r.key,16384,true);text(r.label,256);if(typeof r.labelTruncated!=='boolean'||!scalar(r.value)||byteLength(JSON.stringify(r.value))>16384)fail('Invalid typed member');count(r.observedCount);count(r.eligibleCount);if((r.eligibleCount as number)>(r.observedCount as number)||keys.has(r.key as string))fail('Invalid member counts/identity');keys.add(r.key as string);}
 const next=Math.min(v.offset as number,v.total as number)+(v.scanned as number);
 if((v.scanned as number)<(v.rows as unknown[]).length||(v.scanned as number)>(v.limit as number)||next>(v.total as number)||(v.omittedCount as number)>(v.total as number)||v.classificationComplete&&(v.categoryErrorCount as number)>0||v.truncated!==(next<(v.total as number))||(v.truncated?v.nextOffset!==next||next<=(v.offset as number):v.nextOffset!==undefined))fail('Inconsistent member continuation');
}
