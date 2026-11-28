// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
it('routes the existing examples, excludes separate chart fixtures, and preserves the live sidecar output', () => {
 const root = mkdtempSync(join(tmpdir(), 'apps-sync-'));
 try {
  mkdirSync(join(root,'examples/episode3/assets'),{recursive:true});
  writeFileSync(join(root,'examples/episode3/assets/bdobb-logo.svg'),'<svg/>');
  execFileSync(process.execPath,['scripts/apps-sync.mjs'],{env:{...process.env,OPENBQ_DOCKER_DIR:root},stdio:'pipe'});
  const combined = JSON.parse(readFileSync(join(root,'examples/bdobb/apps.json'),'utf8'));
  const live = JSON.parse(readFileSync('docs/examples/v10.0.0-live-grid.apps.json','utf8'));
  expect(JSON.parse(readFileSync(join(root,'live-grid/apps.json'),'utf8'))).toEqual(live);
  expect(combined.map(app=>app.name)).toEqual(expect.arrayContaining(live.map(app=>app.name)));
  const fixtures = JSON.parse(readFileSync('docs/examples/v9-chart-expansion.apps.json','utf8'));
  expect(combined.map(app=>app.name)).not.toEqual(expect.arrayContaining(fixtures.map(app=>app.name)));
 } finally {rmSync(root,{recursive:true,force:true});}
});
