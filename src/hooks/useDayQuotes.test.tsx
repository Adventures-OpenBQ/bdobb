// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {act,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useDayQuotes} from './useDayQuotes';
import {FakeSocket} from '../test/fakeSocket';
import type {BackendConfig} from '../lib/types';
const backend={id:'b',name:'b',baseUrl:'http://h'} as BackendConfig;
beforeEach(()=>{FakeSocket.last=null;FakeSocket.all=[];vi.stubGlobal('WebSocket',FakeSocket);});
afterEach(()=>vi.unstubAllGlobals());
it('subscribes to the same grid feed, filters stale/foreign rows, and clears on membership change',async()=>{
 const {result,rerender}=renderHook(({symbols})=>useDayQuotes(backend,symbols),{initialProps:{symbols:['AAPL']}});
 await waitFor(()=>expect(FakeSocket.last).not.toBeNull());
 const socket=FakeSocket.last!;expect(socket.url).toBe('ws://h/live_grid_ws');
 act(()=>{socket.open();socket.emit({symbol:'AAPL',price:101,change:1,change_percent:.01,updated_ts:'2026-11-20T15:00:00Z'});});
 expect(result.current.quotes.AAPL.price).toBe(101);expect(result.current.quotes.AAPL.change_percent).toBe(1);
 act(()=>{socket.emit({symbol:'MSFT',price:999,updated_ts:'2026-11-20T15:01:00Z'});socket.emit({symbol:'AAPL',price:90,updated_ts:'2026-11-20T14:00:00Z'});});
 expect(result.current.quotes.AAPL.price).toBe(101);expect(result.current.quotes.MSFT).toBeUndefined();
 rerender({symbols:[]});expect(result.current.quotes.AAPL).toBeUndefined();
});
it('retains a visible latest quote when scrolling changes nearby membership',async()=>{
 const {result,rerender}=renderHook(({symbols})=>useDayQuotes(backend,symbols),{initialProps:{symbols:['AAPL','MSFT']}});
 await waitFor(()=>expect(FakeSocket.last).not.toBeNull());
 act(()=>{FakeSocket.last!.open();FakeSocket.last!.emit({symbol:'AAPL',price:101,updated_ts:'2026-11-20T15:00:00Z'});});
 rerender({symbols:['AAPL','NVDA']});expect(result.current.quotes.AAPL?.price).toBe(101);
});
