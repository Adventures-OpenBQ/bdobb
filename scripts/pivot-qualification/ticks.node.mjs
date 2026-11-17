// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';import assert from 'node:assert/strict';
import {tickModel,tickDataset,checkTickBars,TICK_REFERENCE_POLICY} from './ticks.mjs';
const csv='ts,seq,mkt,price,shares\n1001,2,Q,10.1,2\n1001,1,24EQ,999,99\n1001,1,Q,20.2,3\n';
test('raw mixed input retains identity and timestamp/sequence/original order',()=>{const d=tickDataset(csv,3);assert.deepEqual(d.rows.map(r=>r.id),['tick-1','tick-2','tick-0']);assert.deepEqual(d.rows.map(r=>r.values.exchange),['24EQ','Q','Q']);assert.equal(d.rows[0].values.price,999);});
test('model uses exact typed Q runtime member and distinct second/minute bucket',()=>{for(const granularity of ['1s','1m'])for(const countOnly of [true,false]){const m=tickModel({granularity,countOnly,venue:'Q'});assert.deepEqual(m.runtimeParams['pivot:filter:cat_exchange'].memberKeys,['["string","Q"]']);assert.equal(m.definition.analytical.categories[0].sourceFieldId,granularity==='1s'?'second':'minute');assert.equal(m.definition.analytical.layout.values.length,countOnly?1:6);}});
test('checks every independent bar and rejects wrong prices/counts/missing bars',()=>{const spec={granularity:'1s',venue:'Q',countOnly:false};const ref=[{bucket:1,bucketMilliseconds:1000,venue:'Q',open:20.2,high:20.2,low:10.1,close:10.1,volume:5,ticks:2},{bucket:1,bucketMilliseconds:1000,venue:'24EQ',open:999,high:999,low:999,close:999,volume:99,ticks:1}];const rows=[{groupPath:[{value:1}],values:{open:20.2,high:20.2,low:10.1,close:10.1,volume:5,ticks:2}}];assert.equal(checkTickBars(rows,ref,spec,TICK_REFERENCE_POLICY),1);for(const key of ['open','volume','ticks']){const changed=structuredClone(rows);changed[0].values[key]++;assert.throws(()=>checkTickBars(changed,ref,spec,TICK_REFERENCE_POLICY));}assert.throws(()=>checkTickBars([],ref,spec,TICK_REFERENCE_POLICY));});
test('refuses malformed/unsafe quantities instead of silently converting',()=>{assert.throws(()=>tickDataset(csv,4));assert.throws(()=>tickDataset(csv.replace(',2\n',',9007199254740992\n'),3));});
const indexedPolicy={version:'tick-bucket-index/1',bucketEncoding:'interval-index',outputBucketUnit:'epoch-seconds'};
test('independent P1 minute index maps to epoch seconds without changing OHLCV',()=>{
 // Hand calculated: timestamps 60001/119999ms occupy minute index1, starting at60s.
 const reference=[{bucket:1,bucketMilliseconds:60000,venue:'Q',open:10.5,high:12.5,low:10.5,close:12.5,volume:7,ticks:2}];
 const untouched=structuredClone(reference);const rows=[{groupPath:[{value:60}],values:{open:10.5,high:12.5,low:10.5,close:12.5,volume:7,ticks:2}}];
 assert.equal(checkTickBars(rows,reference,{granularity:'1m',venue:'Q'},indexedPolicy),1);assert.deepEqual(reference,untouched);
 assert.equal(checkTickBars(rows,reference,{granularity:'1m',venue:'Q',countOnly:true},indexedPolicy),1);
});
test('unknown or absent reference bucket units are rejected rather than guessed',()=>{
 const reference=[{bucket:1,bucketMilliseconds:1000,venue:'Q',ticks:1}];const rows=[{groupPath:[{value:1}],values:{ticks:1}}];
 for(const policy of [undefined,{...indexedPolicy,bucketEncoding:'epoch-seconds'},{...indexedPolicy,version:'unknown'}])assert.throws(()=>checkTickBars(rows,reference,{granularity:'1s',venue:'Q',countOnly:true},policy));
});
