// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {act,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fetchEndpoint} from '../lib/dataClient';
import {useClosedSession} from './useClosedSession';
import type {BackendConfig} from '../lib/types';
vi.mock('../lib/dataClient',()=>({fetchEndpoint:vi.fn()}));
const backend={id:'b',name:'b',baseUrl:'https://h/grid'} as BackendConfig;
const answer=(symbol:string)=>({schema_version:1,mode:'closed',symbol,interval:'1m',source:'eodhd',session:{date:'2026-11-20',status:'closed'},bars:[{date:'2026-11-20T14:30:00Z',open:100,high:103,low:99,close:102,volume:5}]});
beforeEach(()=>{vi.mocked(fetchEndpoint).mockReset();});
afterEach(()=>vi.useRealTimers());
it('clears the old symbol immediately and ignores a late response',async()=>{
 let finish!:(x:unknown)=>void;
 vi.mocked(fetchEndpoint).mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockResolvedValue(answer('MSFT'));
 const {result,rerender}=renderHook(({symbol})=>useClosedSession(backend,symbol,'1m',true,0),{initialProps:{symbol:'AAPL'}});
 await waitFor(()=>expect(fetchEndpoint).toHaveBeenCalledTimes(1));
 const signal=vi.mocked(fetchEndpoint).mock.calls[0][3];
 rerender({symbol:'MSFT'});expect(result.current.bars).toEqual([]);expect(signal?.aborted).toBe(true);
 await waitFor(()=>expect(result.current.mode).toBe('closed'));
 act(()=>finish(answer('AAPL')));expect(result.current.symbol).toBe('MSFT');expect(result.current.bars[0].close).toBe(102);
});
it('does not fetch when unadvertised, and lets an open market use the stream',async()=>{
 const {result,rerender}=renderHook(({enabled})=>useClosedSession(backend,'AAPL','1m',enabled,0),{initialProps:{enabled:false}});
 expect(fetchEndpoint).not.toHaveBeenCalled();expect(result.current.mode).toBe('stream');
 vi.mocked(fetchEndpoint).mockResolvedValue({schema_version:1,mode:'stream',symbol:'AAPL',interval:'1m',bars:[]});rerender({enabled:true});
 await waitFor(()=>expect(fetchEndpoint).toHaveBeenCalled());await waitFor(()=>expect(result.current.mode).toBe('stream'));
});

it('retains the last valid session if a later refresh fails',async()=>{
 vi.useFakeTimers();let calls=0;vi.mocked(fetchEndpoint).mockImplementation(async()=>{if(calls++===0)return answer('AAPL');throw new Error('offline');});
 const {result}=renderHook(()=>useClosedSession(backend,'AAPL','1m',true,0));
 await act(async()=>{await Promise.resolve();});expect(result.current.mode).toBe('closed');
 await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
 expect(result.current.mode).toBe('closed');expect(result.current.bars).toHaveLength(1);
 expect(String(result.current.error)).toContain('last successful');
});

it('loads BTC backfilled candles while keeping the live stream enabled',async()=>{
 vi.mocked(fetchEndpoint).mockResolvedValue({...answer('BTC-USD'),mode:'stream',source:'eodhd+kdb ticks+coinbase',session:{date:'2026-11-22',status:'open'},live_from:'2026-11-22T14:31:00Z'});
 const {result}=renderHook(()=>useClosedSession(backend,'BTC-USD','1m',true,0));
 await waitFor(()=>expect(result.current.bars).toHaveLength(1));
 expect(result.current.mode).toBe('stream');expect(result.current.source).toContain('coinbase');
});
