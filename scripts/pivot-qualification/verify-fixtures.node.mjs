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

// Rehash deliberate invalid conversions so this tests numeric policy, not the
// checksum gate. Neither input may be certified merely because Number accepts it.
test('flags_unsafe_integer_and_lossy_decimal_conversion_before_certification', async () => {
  const { createHash } = await import('node:crypto');
  for (const [decimal, refusal] of [
    ['9007199254740993', /Unsafe integer/],
    ['1.0000000000000001', /Decimal conversion loses precision/],
  ]) {
    const temp = await mkdtemp(join(tmpdir(), 'pivot-numeric-'));
    try {
      await cp(root, temp, { recursive: true });
      const manifest = JSON.parse(await readFile(join(temp, 'manifest.json'), 'utf8'));
      const reference = JSON.parse(await readFile(join(temp, 'reference.json'), 'utf8'));
      const row = reference.companies.NVDA.dataset.rows[0];
      row.values.value = Number(decimal);
      row.values.source_decimal = `decimal:${decimal}`;
      const trace = JSON.parse(await readFile(join(temp, 'trace.json'), 'utf8'));
      const fact = trace.NVDA.find(t => t.row_id === row.id);
      fact.value_decimal = decimal;
      for (const [name, payload] of [['reference.json', reference], ['trace.json', trace]]) {
        const bytes = JSON.stringify(payload);
        await writeFile(join(temp, name), bytes);
        manifest.files.find(f => f.path === name).sha256 = createHash('sha256').update(bytes).digest('hex');
      }
      await writeFile(join(temp, 'manifest.json'), JSON.stringify(manifest));
      await assert.rejects(verifyFixtures(temp), refusal);
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
});
