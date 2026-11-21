// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePerformanceWorkloads } from './performance-workloads.mjs';
const hash = 'a'.repeat(64), commit = 'b'.repeat(40);
function inputs() {
  const reference = { sha256: hash, independent: true };
  return { baselineCommit: commit, candidateCommit: commit,
    tickManifest: { inputMode: 'raw-mixed-runtime-filter', venueFilter: { operator: 'exact', key: 'Q' }, observedVenues: ['Q','D'], ordering: 'timestamp-sequence-original-index', samples: [60000,300000].map(rows => ({ rows, sha256: hash, modelHash: hash, countModelHash: hash, reference, policy: 'ordered-prefix', observedVenues: ['Q','D'] })) },
    secManifest: { workloads: [{ id:'certified-small', kind:'certifiedStatement', classification:'real', rows:98, expectedCells:110, sha256:hash, modelHash:hash, reference }, ...[100000,1000000,3658551].map(rows => ({ id:`bulk-${rows}`, kind:'bulkAnalytical', classification:'real', rows, sha256:hash, modelHash:hash, reference }))] } };
}
test('freezes cold and same-session actions without raw rows', async () => {
  const workloads = await resolvePerformanceWorkloads(inputs());
  assert.equal(workloads.filter(w => w.id.startsWith('ticks')).length, 4);
  const w = workloads[0];
  assert.deepEqual(w.actions.filter(a=>a.type==='selectVenue').map(a=>a.key), ['D','Q']);
  assert.ok(w.actions.some(a=>a.type==='linkedRead'));
  assert.equal(w.fullDayAdmission, 'not-requested');
  assert.equal(JSON.stringify(workloads).includes('dataset'), false);
});
for (const [name, mutate, error] of [
  ['missing checksum', x=>delete x.tickManifest.samples[0].sha256, /checksum/],
  ['substring is not exact', x=>x.tickManifest.venueFilter.operator='contains', /exact/],
  ['ambiguous input', x=>delete x.tickManifest.inputMode, /raw-mixed/],
  ['bulk masquerading as certified', x=>x.secManifest.workloads[1].kind='certifiedStatement', /98 facts/],
  ['sample lacks alternative venue', x=>x.tickManifest.samples[0].observedVenues=['Q'], /alternative venue/],
  ['self reference', x=>x.tickManifest.samples[0].reference.independent=false, /independent/],
]) test(name, async()=> { const x=inputs(); mutate(x); await assert.rejects(resolvePerformanceWorkloads(x), error); });
export { inputs };
test('full day remains conditional and does not replace required prefixes', async()=> {
  const x=inputs(); x.tickManifest.fullDayRows=2474435;
  x.tickManifest.fullDaySource={rows:2474435,sha256:hash};
  x.tickManifest.samples.push({...x.tickManifest.samples[0],rows:2474435});
  const w=await resolvePerformanceWorkloads(x);
  assert.equal(w.filter(x=>x.fullDayAdmission==='conditional-current-limits').length,2);
  x.tickManifest.samples.shift();
  await assert.rejects(resolvePerformanceWorkloads(x), /ladder/);
});
test('synthetic controls cannot claim real provenance', async()=> {
  const x=inputs(); x.secManifest.workloads.push({...x.secManifest.workloads[0],id:'synthetic',kind:'syntheticStatement',invariantsVerified:true});
  await assert.rejects(resolvePerformanceWorkloads(x), /synthetic/);
});
for (const rows of [1,300000,300001.5,Number.MAX_SAFE_INTEGER+1]) test(`reject invalid full-day count ${rows}`, async()=> {
  const x=inputs(); x.tickManifest.fullDayRows=rows;
  x.tickManifest.samples.push({...x.tickManifest.samples[0],rows});
  await assert.rejects(resolvePerformanceWorkloads(x), /full-day/);
});
test('full-day sample must match declared complete-source evidence', async()=> {
  const x=inputs(); x.tickManifest.fullDayRows=2474435;
  x.tickManifest.samples.push({...x.tickManifest.samples[0],rows:2474435});
  await assert.rejects(resolvePerformanceWorkloads(x), /full-day source/);
  x.tickManifest.fullDaySource={rows:2474434,sha256:hash};
  await assert.rejects(resolvePerformanceWorkloads(x), /full-day source/);
  x.tickManifest.fullDaySource={rows:2474435,sha256:'c'.repeat(64)};
  await assert.rejects(resolvePerformanceWorkloads(x), /full-day source/);
});
test('duplicate full-day samples cannot masquerade as the optional ladder step', async()=> {
  const x=inputs(); x.tickManifest.fullDayRows=2474435;
  x.tickManifest.fullDaySource={rows:2474435,sha256:hash};
  const sample={...x.tickManifest.samples[0],rows:2474435};
  x.tickManifest.samples.push(sample,{...sample});
  await assert.rejects(resolvePerformanceWorkloads(x), /sample per size/);
});
for (const id of [undefined,'','has spaces',{financialRows:[{amount:123}]},()=>123]) test(`reject unsafe SEC ID ${typeof id}`, async()=> {
  const x=inputs(); x.secManifest.workloads[0].id=id;
  await assert.rejects(resolvePerformanceWorkloads(x), /workload ID/);
});
