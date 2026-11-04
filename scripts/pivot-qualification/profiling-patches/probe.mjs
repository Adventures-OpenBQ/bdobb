// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Isolated build companion; never imported by the product.
let events=[],stack=[],counters=new Map(),enabled=false;
export function __pivot_profile_reset(){events=[];stack=[];counters=new Map();enabled=true;}
export function __pivot_profile_read(){if(stack.length)throw Error('Open profiling stage');return {accounting:'inclusive-do-not-sum',events,counters:[...counters.values()]};}
export function stage(name){if(!enabled)return ()=>{};const event={id:String(events.length),name,startMs:performance.now(),endMs:0,...(stack.length?{parentId:stack.at(-1).id}:{})};events.push(event);stack.push(event);return ()=>{event.endMs=performance.now();if(stack.pop()!==event)throw Error('Unbalanced stage');};}
export function count(name,value,unit,scope){if(!enabled)return;const key=JSON.stringify([name,unit,scope]);const old=counters.get(key);counters.set(key,{name,value:(old?.value??0)+value,unit,scope});}
