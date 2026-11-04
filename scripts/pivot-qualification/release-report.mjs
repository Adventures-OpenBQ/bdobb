// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hashBytes, validateRun, summarizeRun } from './report.mjs';
const digest = /^[a-f0-9]{64}$/;
const statuses = ['passed', 'failed', 'not-run', 'unsupported'];
function validateIdentity(identity, candidate) {
  assert.equal(identity?.commit, candidate.commit, 'Candidate commit mismatch');
  assert.equal(identity.source, candidate.source, 'Candidate source mismatch');
  for (const [key, list] of [
    ['artifact', 'artifacts'],
    ['dataset', 'datasets'],
    ['environment', 'environments'],
  ]) {
    assert.match(identity[key] ?? '', digest, `Missing ${key}`);
    assert.ok(candidate[list].includes(identity[key]), `Unapproved ${key} identity`);
  }
}
async function checkProof(proof, base) {
  assert.ok(proof?.path, 'Missing attributable proof');
  assert.match(proof.sha256 ?? '', digest);
  const bytes = await readFile(resolve(base, proof.path));
  assert.equal(hashBytes(bytes), proof.sha256, 'Evidence checksum mismatch');
  return bytes;
}
/** Correctness evidence is an explicit attestation with immutable proof bytes, never inferred from test counts. */
export async function releaseReport(bundle, inventory, base = process.cwd()) {
  assert.equal(bundle.version, 1);
  assert.equal(inventory.version, 1);
  const c = bundle.candidate;
  assert.match(c?.commit ?? '', /^[a-f0-9]{40}$/);
  assert.match(c.source ?? '', digest);
  for (const k of ['artifacts', 'datasets', 'environments']) {
    assert.ok(Array.isArray(c[k]) && c[k].length);
    for (const v of c[k]) assert.match(v, digest);
  }
  const ids = new Map(inventory.requirements.map((r) => [r.id, r]));
  assert.equal(ids.size, inventory.requirements.length, 'Duplicate requirement ID');
  const records = new Map();
  for (const e of bundle.evidence ?? []) {
    const requirement = ids.get(e.requirementId);
    assert.ok(requirement, 'Unknown requirement ID');
    assert.ok(statuses.includes(e.status));
    if (e.status === 'not-run') {
      assert.ok(e.reason, 'Unrun evidence needs reason');
    } else {
      validateIdentity(e.identity, c);
      assert.ok(e.platform && e.assertion, 'Missing platform/assertion');
      if (requirement.scope === 'native')
        assert.equal(e.platform, inventory.targetPlatform, 'Wrong native platform');
      await checkProof(e.proof, base);
    }
    const entries = records.get(e.requirementId) ?? [];
    entries.push(e);
    records.set(e.requirementId, entries);
  }
  const requirements = inventory.requirements.map((r) => {
    const entries = records.get(r.id) ?? [];
    const status = entries.some((e) => e.status === 'failed')
      ? 'failed'
      : entries.some((e) =>
            r.negativeCapability
              ? ['passed', 'unsupported'].includes(e.status) && e.refusalAssertion === true
              : e.status === 'passed',
          )
        ? 'passed'
        : entries.some((e) => e.status === 'unsupported')
          ? 'unsupported'
          : 'not-run';
    return {
      ...r,
      status,
      evidence: entries,
      reason: entries.length ? undefined : 'No attributable evidence supplied',
    };
  });
  const performance = [];
  for (const entry of bundle.performance ?? []) {
    const run = JSON.parse(await checkProof(entry, base));
    validateRun(run);
    validateIdentity(run.identity, c);
    performance.push({
      identity: run.identity,
      status: run.status,
      summary: summarizeRun(run),
      limitations: run.limitations,
    });
  }
  const required = requirements.filter((r) => r.required);
  const decision = required.some((r) => r.status === 'failed')
    ? 'FAILED'
    : required.some((r) => r.status !== 'passed')
      ? 'INCOMPLETE'
      : 'QUALIFIED';
  return {
    version: 1,
    targetPlatform: inventory.targetPlatform,
    candidate: c,
    decision,
    requirements,
    performance,
    advisories: bundle.advisories ?? [],
    otherPlatforms: 'unqualified until independently evidenced',
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const input = resolve(process.argv[2] ?? '');
    assert.ok(process.argv[2], 'Usage: node release-report.mjs evidence.json');
    const inventory = JSON.parse(
      await readFile(
        new URL('../../docs/testing/pivot-requirements.json', import.meta.url),
        'utf8',
      ),
    );
    const report = await releaseReport(
      JSON.parse(await readFile(input, 'utf8')),
      inventory,
      dirname(input),
    );
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.decision === 'QUALIFIED' ? 0 : report.decision === 'FAILED' ? 1 : 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
