// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Test fixture: an xlsx-shaped zip whose one sheet inflates to `bytes` spaces from ~bytes/1000 on disk.
// Shared by server/table-ingest/files.test.ts and crates/table-service/tests/ingest.rs
// (`node zipBomb.fixture.mjs <bytes> <out>`).
import { createDeflateRaw, crc32 } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import process from 'node:process';

export async function zipBomb(bytes) {
  const chunk = Buffer.alloc(1 << 20, 0x20);
  const deflate = createDeflateRaw({ level: 9 });
  const parts = [];
  deflate.on('data', part => parts.push(part));
  const done = new Promise((resolve, reject) => { deflate.on('end', resolve); deflate.on('error', reject); });
  let crc = 0;
  for (let left = bytes; left > 0; left -= chunk.length) {
    const piece = left < chunk.length ? chunk.subarray(0, left) : chunk;
    crc = crc32(piece, crc);
    if (!deflate.write(piece)) await new Promise(resolve => deflate.once('drain', resolve));
  }
  deflate.end();
  await done;
  const data = Buffer.concat(parts);
  const name = Buffer.from('xl/worksheets/sheet1.xml');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(bytes, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(bytes, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  writeFileSync(process.argv[3], await zipBomb(Number(process.argv[2])));
}
