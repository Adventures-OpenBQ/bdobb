import {expect,it,vi} from 'vitest';
import type {AcquisitionRunRequest,AcquisitionRunHandle} from './generated';
import {createTemporalRun} from './runs';
import {queryId,executionId} from './fixtures';
const request={query_id:queryId,revision:2,params:{day:'2026-11-02'},context:{mode:'current_corrected' as const},policy_id:queryId,policy_revision:3,idempotency_key:'widget:stable'};
const handle={run_id:executionId,state:'waiting' as const,policy_id:queryId,policy_revision:3,submitted_at:'2026-11-03T20:00:00Z',deadline:'2099-11-03T20:05:00Z',context:request.context,stage:'coverage',resolved_params:request.params};
it('polls the same run through acquisition and normalization to its single retained execution',async()=>{
 const client={submitRun:vi.fn(async(_input:AcquisitionRunRequest)=>handle),runStatus:vi.fn().mockResolvedValueOnce({...handle,state:'acquiring'}).mockResolvedValueOnce({...handle,state:'normalizing'}).mockResolvedValueOnce({...handle,state:'ready',execution_id:queryId}),cancelRun:vi.fn()};
 const progress=vi.fn(),run=createTemporalRun(client,request,{progress,wait:async()=>{}});
 expect(await run.open(new AbortController().signal)).toBe(queryId);
 expect(await run.open(new AbortController().signal)).toBe(queryId);
 expect(client.submitRun).toHaveBeenCalledTimes(1);expect(client.submitRun.mock.calls[0][0]).toEqual(request);
 expect(progress.mock.calls.map(([h])=>h.state)).toEqual(['waiting','acquiring','normalizing','ready']);
 expect(client.runStatus.mock.calls.every(([id])=>id===executionId)).toBe(true);
});
it.each([{state:'ready',execution_id:null},{policy_revision:4},{run_id:queryId},{state:'failed',error_code:'ACQUISITION_IDENTITY_UNAVAILABLE'}])('refuses mismatched or failed run outcomes: %j',async bad=>{
 const client={submitRun:vi.fn(async(_input:AcquisitionRunRequest)=>handle),runStatus:vi.fn(async()=>({...handle,...bad} as AcquisitionRunHandle)),cancelRun:vi.fn()};
 await expect(createTemporalRun(client,request,{wait:async()=>{}}).open(new AbortController().signal)).rejects.toThrow();
});
it('cancels only the caller run even when submission ignores abort',async()=>{
 let finish!:(h:typeof handle)=>void;
 const client={submitRun:vi.fn(()=>new Promise<typeof handle>(r=>{finish=r;})),runStatus:vi.fn(),cancelRun:vi.fn(async()=>({...handle,state:'cancelled' as const}))};
 const abort=new AbortController(),pending=createTemporalRun(client,request).open(abort.signal);abort.abort();finish(handle);
 await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(client.cancelRun).toHaveBeenCalledWith(executionId);expect(client.runStatus).not.toHaveBeenCalled();
});
it('accepts canonical server context defaults without changing requested temporal meaning',async()=>{
 const client={submitRun:vi.fn(async()=>({...handle,context:{...request.context,schema_version:1 as const,known_at:null,effective_at:null,date_range:null,knowledge_basis:null},state:'ready' as const,execution_id:queryId})),runStatus:vi.fn(),cancelRun:vi.fn()};
 expect(await createTemporalRun(client,request).open(new AbortController().signal)).toBe(queryId);
});
it('preserves the submission idempotency key and frozen parameters after a lost acknowledgement',async()=>{
 const client={submitRun:vi.fn().mockRejectedValueOnce(new Error('lost acknowledgement')).mockResolvedValueOnce({...handle,state:'ready',execution_id:queryId}),runStatus:vi.fn(),cancelRun:vi.fn()};
 const input=structuredClone(request),run=createTemporalRun(client,input);
 await expect(run.open(new AbortController().signal)).rejects.toThrow('lost acknowledgement');input.params.day='2099-01-01';
 expect(await run.open(new AbortController().signal)).toBe(queryId);
 expect(client.submitRun.mock.calls.map(([r])=>r)).toEqual([request,request]);
});
it('does not poll after credential rejection and preserves the server error',async()=>{
 const error=Object.assign(new Error('credentials expired'),{status:401});
 const client={submitRun:vi.fn(async()=>handle),runStatus:vi.fn().mockRejectedValue(error),cancelRun:vi.fn()};
 await expect(createTemporalRun(client,request,{wait:async()=>{}}).open(new AbortController().signal)).rejects.toBe(error);expect(client.runStatus).toHaveBeenCalledTimes(1);
});
