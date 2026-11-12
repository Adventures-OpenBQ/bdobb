// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateProbe} from './profile.mjs';
import {sliceProbe} from './profile-slice.mjs';

function snapshots() {
 const before={accounting:'inclusive-do-not-sum',events:[{id:'0',name:'compile',startMs:0,endMs:2}],counters:[{name:'aggregate-evaluations',unit:'calls',scope:'aggregate',value:2}]};
 const after={accounting:'inclusive-do-not-sum',events:[{id:'0',name:'compile',startMs:0,endMs:2},{id:'1',name:'calculate-view',startMs:3,endMs:8},{id:'2',name:'facets',startMs:4,endMs:6,parentId:'1'}],counters:[{name:'aggregate-evaluations',unit:'calls',scope:'aggregate',value:5},{name:'aggregate-evaluations',unit:'calls',scope:'facets',value:4}]};
 validateProbe(before);validateProbe(after);return {before,after};
}
test('slice preserves event IDs and parent',()=>{
 const {before,after}=snapshots(),original=structuredClone({before,after});
 const slice=sliceProbe(before,after);
 assert.deepEqual(slice,{accounting:'inclusive-do-not-sum',events:[{id:'1',name:'calculate-view',startMs:3,endMs:8},{id:'2',name:'facets',startMs:4,endMs:6,parentId:'1'}],counters:[{name:'aggregate-evaluations',unit:'calls',scope:'aggregate',value:3},{name:'aggregate-evaluations',unit:'calls',scope:'facets',value:4}]});
 assert.deepEqual(slice.events.map(e=>e.endMs-e.startMs),[5,2]);
 assert.deepEqual({before,after},original);
});
test('cross-boundary parent is rejected',()=>{
 const {before,after}=snapshots();after.events=[...before.events,{id:'1',name:'facets',startMs:1,endMs:2,parentId:'0'}];
 validateProbe(after);assert.throws(()=>sliceProbe(before,after),/parent/i);
});
test('counter tuple collision stays separate',()=>{
 const {before,after}=snapshots();
 before.counters.push({name:'aggregate-evaluations',unit:'rows',scope:'aggregate',value:8});
 after.counters.push({name:'aggregate-evaluations',unit:'rows',scope:'aggregate',value:10});
 assert.deepEqual(sliceProbe(before,after).counters,[{name:'aggregate-evaluations',unit:'calls',scope:'aggregate',value:3},{name:'aggregate-evaluations',unit:'calls',scope:'facets',value:4},{name:'aggregate-evaluations',unit:'rows',scope:'aggregate',value:2}]);
});
test('counter reset is rejected',()=>{
 const {before,after}=snapshots();after.counters[0].value=1;
 assert.throws(()=>sliceProbe(before,after),/counter/i);
 after.counters.shift();assert.throws(()=>sliceProbe(before,after),/counter/i);
});
test('empty delta remains empty',()=>{
 const empty={accounting:'inclusive-do-not-sum',events:[],counters:[]};
 assert.deepEqual(sliceProbe(empty,empty),empty);
 const {before}=snapshots();assert.deepEqual(sliceProbe(before,before),{accounting:'inclusive-do-not-sum',events:[],counters:[{name:'aggregate-evaluations',unit:'calls',scope:'aggregate',value:0}]});
});
test('invalid prefixes and changed completed events are rejected',()=>{
 const {before,after}=snapshots();
 for(const change of [p=>p.events.shift(),p=>p.events[0].endMs=1,p=>p.events[0].id='9',p=>p.events[0].name='facets']){
  const changed=structuredClone(after);change(changed);assert.throws(()=>sliceProbe(before,changed));
 }
 assert.throws(()=>sliceProbe(after,before),/prefix/i);
});
test('duplicate event IDs and counter tuples are rejected',()=>{
 const {before,after}=snapshots();after.events.push({...after.events[2]});
 assert.throws(()=>sliceProbe(before,after),/event/i);
 for(const side of ['before','after']){const pair=snapshots();pair[side].counters.push({...pair[side].counters[0]});assert.throws(()=>sliceProbe(pair.before,pair.after),/counter/i);}
});
test('both input snapshots are validated',()=>{
 const {before,after}=snapshots();
 assert.throws(()=>sliceProbe({...before,accounting:'exclusive'},after),/Malformed/i);
 assert.throws(()=>sliceProbe(before,{...after,events:[{id:'3',name:'unknown',startMs:0,endMs:1}]}),/event/i);
});
