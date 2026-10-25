// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startNativeHarness} from './ssrm-native-harness.mjs';

const containers = () => execFileSync('docker', ['ps', '-a', '--format', '{{.Names}}'], {encoding: 'utf8'}).trim().split('\n').filter(n => n.startsWith('ssrm-native-'));
const privateDirs = async () => (await readdir(tmpdir())).filter(n => n.startsWith('ssrm-native-'));
const difference = (after, before) => after.filter(value => !before.includes(value));

for (const failure of ['mkdir', 'write', 'startup']) {
  test(`evidence ${failure} failure still releases native container and private configuration`, {skip: !process.env.TABLE_QUAL_LINUX_ROOT}, async () => {
    const evidence = await mkdtemp(join(tmpdir(), 'ssrm-evidence-failure-'));
    const beforeContainers = containers();
    const beforeDirs = await privateDirs();
    const savedEvidence = process.env.TABLE_QUAL_EVIDENCE_DIR;
    const savedGateway = process.env.TABLE_QUAL_GATEWAY;
    process.env.TABLE_QUAL_EVIDENCE_DIR = evidence;
    try {
      if (failure === 'startup') {
        process.env.TABLE_QUAL_GATEWAY = join(evidence, 'missing-gateway.mjs');
      }
      if (failure !== 'write') {
        await rm(evidence, {recursive: true});
        await writeFile(evidence, 'evidence path is a file');
      }
      if (failure === 'startup') {
        // Cleanup errors must not replace the cause of startup failure.
        await assert.rejects(startNativeHarness(), error => error.code === 'ERR_MODULE_NOT_FOUND');
      } else {
        const harness = await startNativeHarness();
        if (failure === 'write') {
          const [name] = difference(containers(), beforeContainers);
          assert.ok(name, 'native container started');
          await mkdir(join(evidence, name + '.json'));
        }
        await assert.rejects(harness.close(), error => ['EEXIST', 'EISDIR'].includes(error.code));
      }
      assert.deepEqual(difference(containers(), beforeContainers), [], 'container stopped despite failed evidence');
      assert.deepEqual(difference(await privateDirs(), beforeDirs), [], 'private config removed despite failed evidence');
    } finally {
      // Also contain the deliberate RED run: only remove resources created by this test.
      for (const name of difference(containers(), beforeContainers)) execFileSync('docker', ['stop', '-t', '2', name], {stdio: 'ignore'});
      for (const dir of difference(await privateDirs(), beforeDirs)) await rm(join(tmpdir(), dir), {recursive: true, force: true});
      await rm(evidence, {recursive: true, force: true});
      if (savedEvidence === undefined) delete process.env.TABLE_QUAL_EVIDENCE_DIR;
      else process.env.TABLE_QUAL_EVIDENCE_DIR = savedEvidence;
      process.env.TABLE_QUAL_GATEWAY = savedGateway;
    }
  });
}
