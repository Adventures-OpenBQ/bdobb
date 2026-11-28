// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('permits the exact shipped player controller without allowing arbitrary inline scripts',()=>{
 const source=readFileSync('src-tauri/src/video_wrapper.rs','utf8');
 const csp=source.match(/const CSP: &str = "([^"]+)";/)![1];
 const script=readFileSync('src-tauri/src/video_player.js','utf8').replace(/\r\n/g,'\n');
 const scriptPolicy=csp.split(';').find(s=>s.trim().startsWith('script-src'))!;
 expect(scriptPolicy).toContain(`'sha256-${createHash('sha256').update(script).digest('base64')}'`);
 expect(scriptPolicy).not.toContain("'unsafe-inline'");expect(scriptPolicy).not.toContain('*');
});
