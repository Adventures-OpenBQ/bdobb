// Copyright 2026 SecretoftheUniverse.com LLC.
// SPDX-License-Identifier: AGPL-3.0-only
import type {UdfBar} from './udf';
/** Display history is separate from accepted state and its cursor. */
export function mergeLiveHistory(history:UdfBar[],accepted:UdfBar[],liveFrom:number|null,viewFloor=-Infinity):UdfBar[]{
 const byTime=new Map(history.map(b=>[b.time,b]));
 for(const b of accepted)if(liveFrom===null||b.time>=liveFrom||!byTime.has(b.time))byTime.set(b.time,b);
 return [...byTime.values()].filter(b=>b.time>=viewFloor).sort((a,b)=>a.time-b.time);
}
