// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {validateProbe} from './profile.mjs';

const counterKey=c=>JSON.stringify([c.name,c.unit,c.scope]);
function indexCounters(counters) {
 const indexed=new Map();
 for(const counter of counters){const key=counterKey(counter);if(indexed.has(key))throw Error('Duplicate counter tuple');indexed.set(key,counter);}
 return indexed;
}
/** Bound cumulative completed probes; inclusive intervals are never subtracted. */
export function sliceProbe(before,after) {
 validateProbe(before);validateProbe(after);
 if(after.events.length<before.events.length)throw Error('Invalid event prefix');
 for(let i=0;i<before.events.length;i++){
  const previous=before.events[i],current=after.events[i];
  if(['id','name','startMs','endMs','parentId'].some(key=>!Object.is(previous[key],current[key])))throw Error('Changed completed event prefix');
 }
 const previous=indexCounters(before.counters),current=indexCounters(after.counters);
 for(const [key,counter] of previous)if(!current.has(key)||current.get(key).value<counter.value)throw Error('Counter decreased or disappeared');
 const events=after.events.slice(before.events.length).map(e=>({...e}));
 const ids=new Set(events.map(e=>e.id));
 for(const event of events)if(event.parentId!==undefined&&!ids.has(event.parentId))throw Error('Stage parent outside slice');
 const counters=after.counters.map(c=>({...c,value:c.value-(previous.get(counterKey(c))?.value??0)}));
 return validateProbe({accounting:'inclusive-do-not-sum',events,counters});
}
