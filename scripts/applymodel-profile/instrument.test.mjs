// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {insertOnce, summarizeSpans, spanFunction} from './instrument.mjs';
test('instrumentation refuses drift or ambiguous anchors',()=>{
 assert.equal(insertOnce('a b','b','c'),'a c');
 assert.throws(()=>insertOnce('a','b','c'),/anchor/);
 assert.throws(()=>insertOnce('b b','b','c'),/anchor/);
});
test('nested time is inclusive and exclusive without double counting',()=>{
 const rows=summarizeSpans([{name:'dispatch',inclusiveMs:10,exclusiveMs:3,calls:1},{name:'sort',inclusiveMs:7,exclusiveMs:7,calls:1},{name:'sort',inclusiveMs:2,exclusiveMs:2,calls:1}]);
 assert.deepEqual(rows.sort,{inclusiveMs:9,exclusiveMs:9,calls:2});
 assert.equal(rows.dispatch.exclusiveMs,3);
});

test('function probes preserve body and reject missing or overloaded symbols',()=>{
 assert.equal(spanFunction('fn hello() -> i32 { 7 }','hello','test'),'fn hello() -> i32 {\n    let _profile_span = crate::timing_probe::span("test"); 7 }');
 assert.throws(()=>spanFunction('fn other() {}','hello','test'),/anchor/);
 assert.throws(()=>spanFunction('fn hello() {} fn hello() {}','hello','test'),/anchor/);
});
