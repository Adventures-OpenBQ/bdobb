// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {afterEach,describe,expect,it,vi} from 'vitest';
vi.mock('@tauri-apps/plugin-http',()=>({fetch:vi.fn()}));
import {fetch as pluginFetch} from '@tauri-apps/plugin-http';
import {fetchParamOptions,fetchWidgetData} from './dataClient';
import {backend as makeBackend,backend,widget} from '../test/fixtures';
import {withRequestSlot} from './requestQueue';
afterEach(()=>{ vi.resetAllMocks(); vi.useRealTimers(); });
it('loads a dashboard burst through a shared gateway without exhausting its upstream slots',async()=>{
 let active=0,peak=0;
 vi.mocked(pluginFetch).mockImplementation(async(input)=>{
  active++;peak=Math.max(peak,active);const overflow=active>8;
  await new Promise(resolve=>setTimeout(resolve,5));active--;
  return new Response(JSON.stringify(overflow?{error:'busy'}:[new URL(String(input)).searchParams.get('n')]),{status:overflow?429:200,headers:{'Content-Type':'application/json'}});
 });
 const results=await Promise.allSettled(Array.from({length:14},(_,n)=>fetchWidgetData(backend({baseUrl:`https://gateway.example/${n%2?'api':'ref'}`}),widget({endpoint:'data'}),{n:String(n)})));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(14);
 expect(peak).toBeLessThanOrEqual(8);
 expect(results.map(r=>r.status==='fulfilled'?r.value:null)).toEqual(Array.from({length:14},(_,n)=>[String(n)]));
});

describe("ordinary request lifetime", () => {
  it.each(["queued", "running", "reading body"] as const)(
    "releases a %s widget request when the caller aborts",
    async (phase) => {
      const source = makeBackend({ baseUrl: "https://cancel-widget.test" });
      const controller = new AbortController();
      const transport = vi.mocked(pluginFetch);
      let finish!: () => void;
      const stalled = new Promise<void>((resolve) => { finish = resolve; });
      const bodyRead = vi.fn(async () => { await stalled; return []; });
      const body = new Response("[]", { headers: { "content-type": "application/json" } });
      vi.spyOn(body, "json").mockImplementation(bodyRead);
      transport.mockClear().mockImplementation(async (input) => {
        if (!new URL(String(input)).searchParams.has("stalled")) return new Response("fresh");
        if (phase === "running") {
          await stalled;
          return new Response("old");
        }
        return body;
      });
      const held = phase === "queued"
        ? Array.from({ length: 4 }, () => withRequestSlot(source.baseUrl, undefined, () => stalled))
        : [];
      const outcomes: unknown[] = [];
      const request = fetchWidgetData(source, widget(), { stalled: "true" }, undefined, controller.signal).then((value) => outcomes.push(value), (err: unknown) => outcomes.push(err));

      try {
        if (phase === "running") await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
        if (phase === "reading body") await vi.waitFor(() => expect(bodyRead).toHaveBeenCalledTimes(1));
        controller.abort();
        await vi.waitFor(() => expect(outcomes).toEqual([expect.objectContaining({ name: "AbortError" })]));
        if (phase === "queued") expect(transport).not.toHaveBeenCalled();
        else expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
      } finally {
        finish();
        await Promise.all([...held, request]);
        transport.mockImplementation((...args) => globalThis.fetch(...args));
      }
      if (phase === "queued") expect(transport).not.toHaveBeenCalled();
    },
  );

  it.each(["queued", "running", "reading body"] as const)(
    "enforces an end-to-end deadline on a %s option request",
    async (phase) => {
      vi.useFakeTimers();
      const source = makeBackend({ baseUrl: "https://deadline-options.test" });
      const transport = vi.mocked(pluginFetch);
      let finish!: () => void;
      const stalled = new Promise<void>((resolve) => { finish = resolve; });
      const bodyRead = vi.fn(async () => { await stalled; return []; });
      const body = new Response("[]", { headers: { "content-type": "application/json" } });
      vi.spyOn(body, "json").mockImplementation(bodyRead);
      transport.mockClear().mockImplementation(async () => {
        if (phase === "running") await stalled;
        return body;
      });
      const held = phase === "queued"
        ? Array.from({ length: 4 }, () => withRequestSlot(source.baseUrl, undefined, () => stalled))
        : [];
      const outcomes: unknown[] = [];
      const request = fetchParamOptions(source, "options", {}).then(
        (value) => outcomes.push(value), (err: unknown) => outcomes.push(err),
      );
      try {
        await vi.advanceTimersByTimeAsync(170_000);
        expect(outcomes).toEqual([]);
        if (phase === "reading body") expect(bodyRead).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(outcomes).toEqual([expect.objectContaining({ name: "TimeoutError" })]);
        if (phase === "queued") expect(transport).not.toHaveBeenCalled();
        else expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
      } finally {
        finish();
        await Promise.all([...held, request]);
        transport.mockImplementation((...args) => globalThis.fetch(...args));
        vi.useRealTimers();
      }
      if (phase === "queued") expect(transport).not.toHaveBeenCalled();
    },
  );
});
