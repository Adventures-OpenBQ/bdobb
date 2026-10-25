// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { createWorkerHandler } from './table.worker';
import { revision } from './fixtures';
import { fixture } from '../statementModel/compileFixtures';
import { validateExecutionResponse } from './validation';
import type { ExecutionResponse } from './types';
it('calculates a bounded Statement draft without replacing the active worker result', async () => {
 const {source,statement}=fixture(), responses:ExecutionResponse[]=[];
 const handler=createWorkerHandler(r=>responses.push(r));
 await handler({kind:'registerInput',requestId:'input',revision,input:source,inputRevision:revision.input});
 await handler({kind:'applyModel',requestId:'active',revision,definition:{table:{},search:''},selection:{kind:'none'}});
 await handler({kind:'previewDefinition',requestId:'preview',revision,definition:{table:{},search:'',analytical:statement}});
 const result=validateExecutionResponse(responses.at(-1),revision,'preview');
 expect(result.kind).toBe('previewDefinition');
 if(result.kind==='previewDefinition') expect(result.rows.some(row=>Object.values(row.values).includes(40))).toBe(true);
 await handler({kind:'rows',requestId:'rows',revision,request:{groupPath:[],offset:0,limit:10}});
 const active=responses.at(-1); expect(active?.kind).toBe('rows');
 if(active?.kind==='rows') expect(active.rows[0].values.revenue).toBe(100);
});

it('bounds trusted Statement diagnostics and keeps unrelated exceptions generic',async()=>{
 const {vi}=await import('vitest');const engine=await import('./engine');const {StatementCompilationError}=await import('../statementModel/compile');
 const {source,statement}=fixture(),responses:ExecutionResponse[]=[];const handler=createWorkerHandler(r=>responses.push(r));
 await handler({kind:'registerInput',requestId:'input',revision,input:source,inputRevision:revision.input});
 const spy=vi.spyOn(engine,'calculateView');
 try{
  for(const [error,expected]of [[new StatementCompilationError([{code:'missing-reference',severity:'error',path:'bindings',message:'x'.repeat(5000)}]),'x'.repeat(4096)],[new Error('internal implementation details'),'Table execution failed']] as const){
   spy.mockImplementationOnce(()=>{throw error;});
   await handler({kind:'previewDefinition',requestId:'preview',revision,definition:{table:{},search:'',analytical:statement}});
   expect(responses.at(-1)).toMatchObject({kind:'error',error:{code:'INVALID_REQUEST',message:expected}});
  }
 }finally{spy.mockRestore();}
});
