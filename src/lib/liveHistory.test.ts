// Copyright 2026 SecretoftheUniverse.com LLC.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest';
import {mergeLiveHistory} from './liveHistory';
const b=(time:number,close:number)=>({time,open:close,high:close,low:close,close,volume:1});
it('keeps midnight history, preserves the seam straddler, and replaces live buckets without duplicates',()=>{
 expect(mergeLiveHistory([b(0,1),b(60,2),b(120,3)],[b(60,9),b(120,8),b(180,7)],120)).toEqual([b(0,1),b(60,2),b(120,8),b(180,7)]);
});

it("drops prior-day accepted candles when the UTC session rolls over",()=>{
 expect(mergeLiveHistory([b(86400,5)],[b(86340,4),b(86400,6)],86400,86400)).toEqual([b(86400,6)]);
});
