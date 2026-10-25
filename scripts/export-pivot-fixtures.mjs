// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Deliberately opt-in. Parity tests read committed expected results and never call this script.
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.argv.length !== 3 || process.argv[2] !== '--write') {
  throw new Error('Fixture regeneration requires explicit review: node scripts/export-pivot-fixtures.mjs --write');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'pivot-oracle-'));
try {
  const bundle = await build({ entryPoints: [resolve(root, 'src/lib/tableExecution/rust/oracle.ts')], bundle: true, platform: 'node', format: 'esm', write: false });
  const modulePath = join(temporary, 'oracle.mjs');
  await writeFile(modulePath, bundle.outputFiles[0].contents);
  const { oracleCases, captureBaseline, encodeOracleValue } = await import(pathToFileURL(modulePath).href);
  // Evaluate every case successfully before replacing any reviewed artifact.
  const captured = oracleCases.map(c => ({ case: c, result: captureBaseline(c) }));
  const destination = resolve(root, 'src/test/fixtures/rust-pivot');
  await mkdir(destination, { recursive: true });
  for (const fixture of captured) {
    await writeFile(join(destination, `${fixture.case.name}.json`), `${JSON.stringify(encodeOracleValue({formatVersion:1,baselineRevision:'74cc3f6c4c718cd76044722b954a7bc0761c8866',...fixture}))}\n`);
    console.log(`${fixture.case.name}: ${fixture.result.error ? `refused (${fixture.result.error.message})` : `${fixture.result.ready.topLevelCount} root rows, ${fixture.result.operations.length} operations`}`);
  }
  console.log(`Exported ${captured.length} fixtures. Review semantic assertions and the diff before committing.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
