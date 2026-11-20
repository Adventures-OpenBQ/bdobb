// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {readFile} from 'node:fs/promises';
const report=JSON.parse(await readFile(process.argv[2],'utf8'));
if(!report.instrumentedRust)throw Error('Expected instrumented Rust export observations');
const median=values=>{const a=values.sort((a,b)=>a-b),n=a.length;return n%2?a[n>>1]:(a[n/2-1]+a[n/2])/2;};
const phases=['dispatchMs','decodeMs','export.next','rows.project','budget.wire_size','wire.serialize','wire.payload_tree','wire.envelope_encode'];
console.log('# Export phase diagnostics\n');
console.log(`Measured ${report.measuredAt}; ${report.samples} observations per workload. Node ${report.node}; ${report.cpu}.\n`);
console.log('All numbers are median milliseconds per complete export, summing batches within each observation before taking the median. Instrumented emitted-WASM in Node includes probe overhead; these are attribution measurements, not browser speedup claims.\n');
console.log('| Workload | Batches | '+phases.join(' | ')+' |');
console.log('|---|---:|'+phases.map(()=>'---:').join('|')+'|');
for(const c of report.cases){
 const observations=c.observations.map(o=>{
  const commands=o.commands.filter(q=>['presented','nextSubset'].includes(q.kind)),totals={};
  for(const q of commands){for(const k of ['dispatchMs','decodeMs'])totals[k]=(totals[k]??0)+q[k];for(const s of q.rustSpans)totals[s.name]=(totals[s.name]??0)+s.inclusiveMs;}
  return {batches:commands.length,totals};
 });
 for(const p of phases)if(observations.some(o=>!Number.isFinite(o.totals[p])))throw Error(`Missing phase ${p} in ${c.name}`);
 console.log(`| ${c.name} | ${observations[0].batches} | ${phases.map(p=>median(observations.map(o=>o.totals[p])).toFixed(3)).join(' | ')} |`);
}
console.log('\n`rows.project` and `budget.wire_size` are nested inside `export.next`; payload-tree and envelope-encoding spans are nested inside `wire.serialize`. Do not add nested columns. Envelope encoding includes final transport-wrapper serialization; legacy artifacts also construct a copied json! wrapper tree in that span. Other batch construction work remains unattributed.\n');
console.log('The preflight checks exact request bytes and deep decoded response parity against the uninstrumented JS codec. It does not independently compare instrumented Rust output against a stock Rust session. The temporary source transformation adds timing probes only; product artifacts and resource checks are unchanged.\n');
console.log(`WASM SHA256: ${report.wasmSha256}\nProtocol SHA256: ${report.protocolSha256}`);
