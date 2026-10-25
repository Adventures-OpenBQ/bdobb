// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
test('emitted web Wasm initializes and negotiates protocol 1 without shared memory', async () => {
 const artifact=new URL('../src/lib/tableExecution/rust/generated/pivot_wasm.js',import.meta.url);
 const {default:init,protocol_version}=await import(artifact.href);
 const bytes=await readFile(new URL('./pivot_wasm_bg.wasm',artifact));
 const exports=await init({module_or_path:bytes});
 assert.equal(protocol_version(),1);
 assert.ok(exports.memory.buffer instanceof ArrayBuffer);
 assert.equal(exports.memory.buffer instanceof SharedArrayBuffer,false);
});
