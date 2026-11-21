// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const sha = value => assert.match(value ?? '', /^[a-f0-9]{64}$/, 'Missing or invalid checksum');
async function manifest(value) { return typeof value === 'string' ? JSON.parse(await readFile(value, 'utf8')) : value; }
function identity(w) {
  sha(w.sha256); sha(w.modelHash); sha(w.reference?.sha256);
  assert.equal(w.reference.independent, true, 'An independent reference is required');
  assert.ok(Number.isSafeInteger(w.rows) && w.rows > 0, 'Invalid row count');
  return { inputChecksum: w.sha256, modelHash: w.modelHash, referenceChecksum: w.reference.sha256, sampledRows: w.rows };
}
/** Resolve sanitized matched-work descriptors. Paths name external adapter JSON, never financial payloads. */
export async function resolvePerformanceWorkloads({ tickManifest, secManifest, baselineCommit, candidateCommit }) {
  for (const commit of [baselineCommit,candidateCommit]) assert.match(commit ?? '', /^[a-f0-9]{40}$/, 'Pin full source commit');
  const ticks = await manifest(tickManifest), sec = await manifest(secManifest);
  assert.equal(ticks.inputMode, 'raw-mixed-runtime-filter', 'Require raw-mixed runtime filtering; prefiltered inputs are a different workload');
  assert.deepEqual(ticks.venueFilter, { operator:'exact', key:'Q' }, 'Require exact venue Q');
  assert.equal(ticks.ordering, 'timestamp-sequence-original-index');
  if (ticks.fullDayRows !== undefined) {
    assert.ok(Number.isSafeInteger(ticks.fullDayRows) && ticks.fullDayRows > 300000, 'Invalid full-day row count');
    assert.equal(ticks.fullDaySource?.rows, ticks.fullDayRows, 'Require matching full-day source row evidence');
    sha(ticks.fullDaySource.sha256);
    const fullDay = ticks.samples.find(s=>s.rows===ticks.fullDayRows);
    assert.equal(fullDay?.sha256, ticks.fullDaySource.sha256, 'Require matching full-day source checksum');
  }
  assert.equal(new Set(ticks.samples.map(s=>s.rows)).size, ticks.samples.length, 'Require one sample per size');
  assert.deepEqual(ticks.samples.map(s=>s.rows).filter(n=>n!==ticks.fullDayRows).sort((a,b)=>a-b), [60000,300000], 'Require matched 60k/300k ladder');
  const result = [];
  for (const sample of ticks.samples) {
    const ids = identity(sample);
    sha(sample.countModelHash);
    assert.equal(sample.policy, 'ordered-prefix');
    assert.ok(sample.observedVenues?.includes('Q'), 'Sample must observe Q');
    const alternative = sample.observedVenues.filter(v=>v!=='Q' && ticks.observedVenues.includes(v)).sort()[0];
    assert.ok(alternative, 'Sample needs an observed alternative venue');
    for (const measures of [['count'],['open','high','low','close','volume','count']]) {
      const modelHash = measures.length===1 ? sample.countModelHash : sample.modelHash;
      const actions = [
        { type:'newProcess' }, { type:'register', inputMode:ticks.inputMode },
        { type:'apply', granularity:'second', venue:{ operator:'exact', key:'Q' } },
        { type:'apply', granularity:'minute' }, { type:'apply', granularity:'second' },
        { type:'selectVenue', operator:'exact', key:alternative }, { type:'selectVenue', operator:'exact', key:'Q' },
        { type:'identicalApply' }, { type:'sort', field:'time', direction:'descending' },
        { type:'linkedRead', consumers:['table','chart'] },
      ];
      result.push({ id:`ticks-${sample.rows}-${measures.length===1?'count':'ohlcv'}`, ...ids, modelHash,
        baselineCommit,candidateCommit, classification:'real', kind:'ticks', samplePolicy:sample.policy,
        inputMode:ticks.inputMode, venueKey:'Q', alternativeVenueKey:alternative, granularity:'second', measures,
        fullDayAdmission: sample.rows===ticks.fullDayRows ? 'conditional-current-limits' : 'not-requested',
        enabled:['selection','inspection','facets','export','errors'], actions,
        sessionPolicy:'new process through first apply; remaining actions same session' });
    }
  }
  for (const w of sec.workloads) {
    assert.ok(typeof w.id === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(w.id), 'Invalid SEC workload ID');
    const ids = identity(w);
    assert.ok(['bulkAnalytical','certifiedStatement','syntheticStatement'].includes(w.kind));
    if (w.kind==='certifiedStatement') assert.ok(w.rows===98 && w.expectedCells===110 && w.classification==='real', 'Certified control requires 98 facts/110 cells; bulk facts are not certified Statements');
    else if (w.kind==='syntheticStatement') {
      assert.equal(w.classification, 'synthetic');
      assert.equal(w.invariantsVerified, true, 'Synthetic company/unit/period invariants must be verified');
    } else assert.equal(w.classification,'real');
    result.push({ id:w.id, ...ids, baselineCommit,candidateCommit, kind:w.kind, classification:w.classification,
      samplePolicy:w.kind==='bulkAnalytical'?'qualification-task7':'complete-control', venueKey:null, granularity:null,
      measures:['financial-control'], expectedCells:w.expectedCells ?? null,
      actions:[{type:'newProcess'},{type:'register'},{type:'apply'},{type:'identicalApply'},{type:'linkedRead',consumers:['table','chart']}] });
  }
  assert.deepEqual(sec.workloads.filter(w=>w.kind==='bulkAnalytical').map(w=>w.rows).sort((a,b)=>a-b), [100000,1000000,3658551]);
  assert.equal(sec.workloads.filter(w=>w.kind==='certifiedStatement').length, 1);
  assert.equal(new Set(result.map(w=>w.id)).size,result.length,'Duplicate workload ID');
  return result;
}
