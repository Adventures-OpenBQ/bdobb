// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { Readable } from 'node:stream';
/** Exactly one UTF-8 JSON message, length prefixed by unsigned 32-bit big-endian bytes. */
export async function readFrame(input:Readable,maxBytes:number):Promise<string> {
  const chunks:Buffer[]=[];let size=0;let expected:number|undefined;
  for await(const chunk of input) {
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size+=bytes.length;if(size>maxBytes+4)throw new Error('Invalid frame');
    chunks.push(bytes);
    if(size>=4 && expected===undefined) {expected=Buffer.concat(chunks,4).readUInt32BE(0);if(expected<1||expected>maxBytes)throw new Error('Invalid frame');}
    if(expected!==undefined && size>expected+4)throw new Error('Invalid frame');
  }
  if(expected===undefined||size!==expected+4)throw new Error('Invalid frame');
  return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size).subarray(4));
}
export function frame(json:string,maxBytes:number):Buffer {
  const bytes=Buffer.from(json);if(bytes.length<1||bytes.length>maxBytes||bytes.length>0xffffffff)throw new Error('Invalid frame');
  const head=Buffer.alloc(4);head.writeUInt32BE(bytes.length);return Buffer.concat([head,bytes]);
}
