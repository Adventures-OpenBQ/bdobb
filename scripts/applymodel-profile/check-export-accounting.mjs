// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const report=JSON.parse(await readFile(process.argv[2],'utf8'));
assert.equal(report.instrumentedRust,true,'Expected traced Rust diagnostics');
let exports=0;
for(const c of report.cases)for(const o of c.observations)for(const q of o.commands){
 if(!['presented','nextSubset'].includes(q.kind))continue;
 exports++;
 assert(q.rustSpans.some(s=>s.name==='export.next'&&s.calls>0),'Missing export instrumentation');
 for(const name of ['budget.wire_size','budget.retained_bytes'])assert.equal(q.rustSpans.find(s=>s.name===name)?.calls??0,0,`${c.name} ${q.kind}: unset export ceilings must not perform ${name}`);
}
assert(exports>0,'No export observations');
console.log(`${exports} unbounded export dispatches avoided optional byte accounting`);
