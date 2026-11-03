// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {finiteJson,isRecord,isUuid,parseContract,type TemporalContext} from './contracts';
export type QueryBinding = {kind:'query';queryId:string;revisionPolicy:'fixed'|'latest';revision?:number;params:Record<string,unknown>;context:TemporalContext}|{kind:'execution';executionId:string};
/** Reject invalid intent at use time; disk/import retains original fields for repair. */
export function parseQueryBinding(v:unknown):QueryBinding {
 const fail=()=>{throw new Error('Invalid or future TemporalDB query binding; choose a query to repair it');};
 if(!isRecord(v)||!finiteJson(v))return fail();
 if(v.kind==='execution'){
  if(Object.keys(v).some(k=>!['kind','executionId'].includes(k))||!isUuid(v.executionId))return fail();
 }else if(v.kind==='query'){
  if(Object.keys(v).some(k=>!['kind','queryId','revisionPolicy','revision','params','context'].includes(k))||!isUuid(v.queryId)||!isRecord(v.params)||!['fixed','latest'].includes(String(v.revisionPolicy))||v.revisionPolicy==='fixed'&&(!Number.isSafeInteger(v.revision)||Number(v.revision)<1)||v.revision!==undefined&&(!Number.isSafeInteger(v.revision)||Number(v.revision)<1))return fail();
  try{parseContract('TemporalContext',v.context);}catch{return fail();}
 }else return fail();
 return structuredClone(v) as QueryBinding;
}
