// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { fetch } from "@tauri-apps/plugin-http";
import { applyAuthQuery, authHeaders, joinUrl } from "./dataClient";
import type { BackendConfig } from "./types";
const LIMIT=256*1024;
/** A symbol is the only caller-controlled input; no metadata URL is fetched by the browser. */
export async function fetchDayLogo(backend:BackendConfig,symbol:string,signal:AbortSignal):Promise<Blob>{
  const url=new URL(joinUrl(backend.baseUrl,"symbol_logo"));
  url.searchParams.set("symbol",symbol);
  const response=await fetch(applyAuthQuery(url,backend).toString(),{headers:authHeaders(backend),signal,connectTimeout:10000,redirect:"error"});
  const mime=(response.headers.get("content-type")??"").split(";")[0].trim().toLowerCase();
  if(!response.ok || response.redirected || !["image/png","image/jpeg","image/webp","image/gif"].includes(mime) || Number(response.headers.get("content-length"))>LIMIT) throw new Error("Logo unavailable");
  // Read incrementally in browsers; older native HTTP implementations may expose no stream.
  const reader=response.body?.getReader();
  let bytes:Uint8Array;
  if(reader){
    const chunks:Uint8Array[]=[];let size=0;
    try {for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>LIMIT)throw new Error("Logo unavailable");chunks.push(part.value);}}
    catch(error){await reader.cancel().catch(()=>{});throw error;}
    bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  } else {bytes=new Uint8Array(await response.arrayBuffer());}
  if(signal.aborted || bytes.length>LIMIT)throw new Error("Logo unavailable");
  const ascii=(start:number,end:number)=>String.fromCharCode(...bytes.slice(start,end));
  const valid=mime==="image/png" ? [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)
    : mime==="image/jpeg" ? bytes[0]===255&&bytes[1]===216&&bytes[2]===255
    : mime==="image/gif" ? ["GIF87a","GIF89a"].includes(ascii(0,6))
    : ascii(0,4)==="RIFF"&&ascii(8,12)==="WEBP";
  if(!valid)throw new Error("Logo unavailable");
  return new Blob([bytes as Uint8Array<ArrayBuffer>],{type:mime});
}
