// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, it, vi } from "vitest";
import { fetch } from "@tauri-apps/plugin-http";
import { fetchDayLogo } from "./dayLogo";
import type { BackendConfig } from "./types";
vi.mock("@tauri-apps/plugin-http",()=>({fetch:vi.fn()}));
const backend={id:"b",name:"b",baseUrl:"https://host/backend",headerName:"X-Key",headerValue:"secret"} as BackendConfig;
const png=new Uint8Array([137,80,78,71,13,10,26,10]);
beforeEach(()=>{vi.mocked(fetch).mockReset();});
it("fetches only the fixed auth-aware relay and returns bounded raster bytes",async()=>{
  vi.mocked(fetch).mockResolvedValue(new Response(png,{headers:{"Content-Type":"image/png"}}));
  const blob=await fetchDayLogo(backend,"AAPL",new AbortController().signal);
  expect(blob.type).toBe("image/png");expect(blob.size).toBe(8);
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://host/backend/symbol_logo?symbol=AAPL");
  expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toEqual({"X-Key":"secret"});
});
it("rejects non-raster, MIME/signature mismatch, oversized content, and redirects",async()=>{
  for(const response of [new Response("<svg/>",{headers:{"Content-Type":"image/svg+xml"}}),new Response(png,{headers:{"Content-Type":"image/jpeg"}}),new Response(png,{headers:{"Content-Type":"image/png","Content-Length":"262145"}}),new Response(null,{status:302,headers:{Location:"https://external"}})]){
    vi.mocked(fetch).mockResolvedValueOnce(response);
    await expect(fetchDayLogo(backend,"AAPL",new AbortController().signal)).rejects.toThrow();
  }
});
