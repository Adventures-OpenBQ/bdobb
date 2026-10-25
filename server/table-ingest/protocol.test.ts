// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { readFrame, frame } from './protocol';
it('accepts a split frame and refuses truncated, extra and oversized frames',async()=>{
  const wire=frame('hello',100);
  expect(await readFrame(Readable.from([wire.subarray(0,2),wire.subarray(2,5),wire.subarray(5)]),100)).toBe('hello');
  for(const wire of [Buffer.from([0,0,0]),Buffer.from([0,0,0,10,65]),Buffer.from([255,255,255,255]),Buffer.from([0,0,0,1,65,66])]) await expect(readFrame(Readable.from([wire]),100)).rejects.toThrow();
  expect(()=>frame('hello',4)).toThrow();
});
