// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {finiteJson,isRecord,isUuid,parseContract,type TemporalContext} from './contracts';
export type TemporalTableTarget={kind:'managed';version:1;backendId:string;sourceBackendId:string};
export type QueryBinding = ({kind:'query';queryId:string;revisionPolicy:'fixed'|'latest';revision?:number;params:Record<string,unknown>;context:TemporalContext}|{kind:'execution';executionId:string}) & {tableExecution?:TemporalTableTarget};
/** Reject invalid intent at use time; disk/import retains original fields for repair. */
export function parseQueryBinding(v:unknown):QueryBinding {
 const fail=()=>{throw new Error('Invalid or future TemporalDB query binding; choose a query to repair it');};
 if(!isRecord(v)||!finiteJson(v))return fail();
 if(v.tableExecution!==undefined){const t=v.tableExecution;if(!isRecord(t)||t.kind!=='managed'||t.version!==1||Object.keys(t).some(k=>!['kind','version','backendId','sourceBackendId'].includes(k))||typeof t.backendId!=='string'||!t.backendId.length||t.backendId.length>256||/[\x00-\x1f\x7f]/.test(t.backendId)||typeof t.sourceBackendId!=='string'||!/^[A-Za-z0-9_.-]{1,128}$/.test(t.sourceBackendId)||['.','..'].includes(t.sourceBackendId))return fail();}
 if(v.kind==='execution'){
  if(Object.keys(v).some(k=>!['kind','executionId','tableExecution'].includes(k))||!isUuid(v.executionId))return fail();
 }else if(v.kind==='query'){
  if(Object.keys(v).some(k=>!['kind','queryId','revisionPolicy','revision','params','context','tableExecution'].includes(k))||!isUuid(v.queryId)||!isRecord(v.params)||!['fixed','latest'].includes(String(v.revisionPolicy))||v.revisionPolicy==='fixed'&&(!Number.isSafeInteger(v.revision)||Number(v.revision)<1)||v.revision!==undefined&&(!Number.isSafeInteger(v.revision)||Number(v.revision)<1))return fail();
  try{parseContract('TemporalContext',v.context);}catch{return fail();}
 }else return fail();
 return structuredClone(v) as QueryBinding;
}
