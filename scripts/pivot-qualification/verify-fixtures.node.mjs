// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyFixtures } from './verify-fixtures.mjs';
const root = fileURLToPath(new URL('../../src/test/fixtures/sec-statements/', import.meta.url));
test('unchanged_corpus_has_98_facts_and_110_expected_cells', async () => {
  assert.deepEqual(await verifyFixtures(root), { files: 3, rows: 98, expectedCells: 110 });
});
test('rejects_corrupted_payload_and_unknown_mapping_version', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'pivot-fixtures-'));
  try {
    await cp(root, temp, { recursive: true });
    const reference = join(temp, 'reference.json');
    const original = await readFile(reference, 'utf8');
    await writeFile(reference, original + ' ');
    await assert.rejects(verifyFixtures(temp), /Checksum/);
    await writeFile(reference, original);
    const manifestPath = join(temp, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.mappingVersion = 'unknown/2';
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(verifyFixtures(temp), /Unknown mapping version/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
