// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type {AcquisitionRunRequest} from './generated';
import {invalidateTemporalScope} from './security';
import {backendRequest,HttpError} from '../dataClient';
import type {BackendConfig} from '../types';
import {parseCoverage,parseDatasetPage,parseDescription,parseValidation,type Tier} from './catalog';
import {isRecord,isUuid,parseAudit,parseContract,parseExport,parseHandle,parseImportReport,parseResultPage,type QueryDefinition,type TemporalContext} from './contracts';
export class TemporalClientError extends Error {constructor(public code:string,message:string,public status:number,public requestId?:string){super(message);}}
/** A TemporalDB error as the user sees it: its message and the request ID to quote. */
export function temporalErrorText(e:unknown):string{return e instanceof TemporalClientError?`${e.message}${e.requestId?` (request ${e.requestId})`:''}`:e instanceof Error?e.message:'TemporalDB request failed';}
export function createTemporalClient(backend:BackendConfig){
 const config=structuredClone(backend);
 async function call(method:'GET'|'POST'|'PUT'|'DELETE',path:string,body?:unknown,signal?:AbortSignal){
  try{return await backendRequest(config,method,`temporal/v1/${path}`,body,signal);}
  // 401 = credentials/principal rejected: evict scope. 403 ACCESS_DENIED is per-resource and fails only that request.
  catch(e){if(e instanceof HttpError){if(e.status===401)invalidateTemporalScope();let error:unknown;try{error=JSON.parse(e.body).error;}catch{/* HTTP status still applies */}if(isRecord(error)&&typeof error.code==='string'&&typeof error.message==='string')throw new TemporalClientError(error.code,error.message,e.status,typeof error.request_id==='string'?error.request_id:undefined);}throw e;}
 }
 const id=(v:string)=>{if(!isUuid(v))throw new Error('Invalid TemporalDB identity');return encodeURIComponent(v);};
 const queryPath=(queryId:string,revision?:number,receiptId?:string)=>{
  if(revision!==undefined&&(!Number.isSafeInteger(revision)||revision<1))throw new Error('Invalid revision');
  const args=new URLSearchParams();if(revision!==undefined)args.set('revision',String(revision));if(receiptId)args.set('receipt_id',id(receiptId));return `${id(queryId)}${args.size?'?'+args:''}`;
 };
 return {
  async policies(signal?:AbortSignal){const v=await call('GET','acquisition/policies',undefined,signal);if(!isRecord(v)||v.schema_version!==1||!Array.isArray(v.policies))throw new Error('Invalid TemporalDB policies');return v.policies.map(x=>parseContract('AcquisitionPolicySummary',x));},
  async policy(policyId:string,revision?:number,signal?:AbortSignal){return parseContract('AcquisitionPolicy',await call('GET',`acquisition/policies/${queryPath(policyId,revision)}`,undefined,signal));},
  async submitRun(request:AcquisitionRunRequest,signal?:AbortSignal){parseContract('AcquisitionRunRequest',request);return parseContract('AcquisitionRunHandle',await call('POST','runs',request,signal));},
  async runStatus(runId:string,signal?:AbortSignal){return parseContract('AcquisitionRunHandle',await call('GET',`runs/${id(runId)}`,undefined,signal));},
  async cancelRun(runId:string){return parseContract('AcquisitionRunHandle',await call('DELETE',`runs/${id(runId)}`));},
  async list(signal?:AbortSignal){const v=await call('GET','queries',undefined,signal);if(!isRecord(v)||!Array.isArray(v.queries))throw new Error('Invalid TemporalDB library');return v.queries.map(x=>parseContract('QueryDefinition',x));},
  async get(queryId:string,revision?:number,signal?:AbortSignal,receiptId?:string){return parseContract('QueryDefinition',await call('GET',`queries/${queryPath(queryId,revision,receiptId)}`,undefined,signal));},
  async create(definition:QueryDefinition){parseContract('QueryDefinition',definition);return parseContract('QueryDefinition',await call('POST','queries',definition));},
  async revise(queryId:string,expectedRevision:number,definition:QueryDefinition){parseContract('QueryDefinition',definition);return parseContract('QueryDefinition',await call('PUT',`queries/${id(queryId)}`,{expected_revision:expectedRevision,definition}));},
  async retire(queryId:string){const v=await call('DELETE',`queries/${id(queryId)}`);if(!isRecord(v)||v.retired!==true)throw new Error('Invalid retirement response');},
  async importEntries(entries:unknown[]){return parseImportReport(await call('POST','queries/import',{entries}));},
  async exportImport(importId:string){return parseExport(await call('GET',`queries/import/${id(importId)}/export`));},
  async exportQuery(queryId:string,revision?:number,receiptId?:string){const path=queryPath(queryId,revision,receiptId);const [base,args]=path.split('?');return parseExport(await call('GET',`queries/${base}/export${args?'?'+args:''}`));},
  async start(input:{query_id:string;revision:number;params:Record<string,unknown>;context:TemporalContext;page_size?:number},signal?:AbortSignal){return parseHandle(await call('POST','executions',{page_size:1000,...input},signal));},
  async status(executionId:string,signal?:AbortSignal){const v=await call('GET',`executions/${id(executionId)}`,undefined,signal);const h=parseHandle(v);if(!isRecord(v)||!Object.hasOwn(v,'error'))throw new Error('Invalid execution status');return {...h,error:v.error};},
  async page(executionId:string,cursor?:string,signal?:AbortSignal){return parseResultPage(await call('GET',`executions/${id(executionId)}/pages${cursor?'?cursor='+encodeURIComponent(cursor):''}`,undefined,signal));},
  async cancel(executionId:string){const v=await call('DELETE',`executions/${id(executionId)}`);if(!isRecord(v)||!['queued','running','succeeded','failed','cancelled'].includes(String(v.state)))throw new Error('Invalid cancellation response');return v.state;},
  async protect(executionId:string,label:string){return parseAudit(await call('POST','audits',{execution_id:executionId,label}));},
  async audit(runId:string){return parseAudit(await call('GET',`audits/${id(runId)}`));},
  async replay(runId:string){return parseHandle(await call('POST',`audits/${id(runId)}/replay`,{}));},
  async datasets(input:{cursor?:string;limit?:number}={},signal?:AbortSignal){
   const args=new URLSearchParams();if(input.cursor)args.set('cursor',input.cursor);
   if(input.limit!==undefined){if(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100)throw new Error('Invalid page limit');args.set('limit',String(input.limit));}
   return parseDatasetPage(await call('GET',`cache/datasets${args.size?'?'+args:''}`,undefined,signal));
  },
  async describe(input:{dataset_id:string;tier:Tier},signal?:AbortSignal){return parseDescription(await call('POST','cache/describe',input,signal));},
  async coverage(input:{dataset_id:string;tier:Tier;filters?:{symbol?:string;series_id?:string};cursor?:string;limit?:number},signal?:AbortSignal){return parseCoverage(await call('POST','cache/coverage',input,signal));},
  async validate(definition:QueryDefinition){parseContract('QueryDefinition',definition);return parseValidation(await call('POST','queries/validate',{definition}));},
 };
}
export type TemporalClient=ReturnType<typeof createTemporalClient>;
