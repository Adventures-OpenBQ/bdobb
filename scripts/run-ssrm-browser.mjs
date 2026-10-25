// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {spawnSync} from 'node:child_process';
// Playwright enables FORCE_COLOR itself; don't inherit a contradictory NO_COLOR.
const env={...process.env};delete env.NO_COLOR;
const result=spawnSync('pnpm',['exec','playwright','test','--config','playwright.ssrm.config.ts',...process.argv.slice(2)],{env,stdio:'inherit',shell:process.platform==='win32'});
process.exit(result.status??1);
