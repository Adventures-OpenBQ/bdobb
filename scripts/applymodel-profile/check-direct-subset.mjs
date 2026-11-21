// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const report=JSON.parse(await readFile(process.argv[2],'utf8'));
assert.equal(report.instrumentedRust,true);
const raw=report.cases.find(c=>c.name==='largeRaw');
assert(raw,'Missing raw export fixture');
let count=0;
for(const o of raw.observations)for(const q of o.commands){
 if(q.kind!=='nextSubset')continue;
 assert.equal(q.rustSpans.find(s=>s.name==='wire.subset_direct')?.calls,1,'Missing direct serializer span');
 for(const name of ['wire.payload_tree','wire.envelope_encode'])assert.equal(q.rustSpans.find(s=>s.name===name)?.calls??0,0,'Plain continuation must not build legacy payload/envelope Values');
 count++;
}
assert(count>0);
console.log(`${count} plain continuation dispatches bypassed legacy response trees`);
