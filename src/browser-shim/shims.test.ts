// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These shims replace the Tauri plugin modules under `vite --mode browser`.
// The tests pin (a) that each shim exports exactly the names the app imports
// from the real module, and (b) the small behaviors the design specifies.
// Module state (memfs, the window.__bdobb registry) is per-import, so every
// test re-imports after resetModules.

// Window.__bdobbSeed / Window.__bdobb are declared globally by
// src/browser-shim/registry.ts (part of this program via fs.ts), so no
// separate `declare global` is needed here -- a second, differently-typed
// one would conflict with it (TS2717).

beforeEach(() => {
  vi.resetModules();
  delete window.__bdobbSeed;
  delete window.__bdobbFail;
  delete window.__bdobb;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fs shim", () => {
  it("exports the plugin-fs surface the app uses", async () => {
    const fs = await import("./fs");
    for (const name of ["exists", "readTextFile", "writeTextFile", "readFile", "writeFile", "rename", "remove", "mkdir", "readDir", "stat"]) {
      expect(typeof (fs as Record<string, unknown>)[name]).toBe("function");
    }
    expect(fs.BaseDirectory.AppData).toBeTypeOf("number");
  });

  it("seeds memfs from window.__bdobbSeed at import and exposes the registry", async () => {
    window.__bdobbSeed = { "settings.json": '{"theme":"light"}', "dashboards/d1.json": "{}" };
    const fs = await import("./fs");
    expect(await fs.readTextFile("settings.json")).toBe('{"theme":"light"}');
    expect(window.__bdobb?.read?.("dashboards/d1.json")).toBe("{}");
    expect(window.__bdobb?.list?.()).toEqual(["dashboards/d1.json", "settings.json"]);
  });

  it("makes every path in window.__bdobbFail unreadable, which no seed can express", async () => {
    // The `chmod 000` shape: the file is still THERE (exists succeeds, and it
    // could still be renamed), reading its content is what fails. That is the
    // only failure that reaches jsonStore's read, and jsonStore must turn it
    // into a rejection rather than a quarantine -- which is the whole reason
    // the startup banner has anything to report.
    window.__bdobbSeed = { "settings.json": "{}" };
    window.__bdobbFail = ["settings.json"];
    const fs = await import("./fs");
    expect(await fs.exists("settings.json")).toBe(true);
    await expect(fs.readTextFile("settings.json")).rejects.toThrow();
  });

  it("starts empty when there is no seed", async () => {
    const fs = await import("./fs");
    expect(await fs.exists("settings.json")).toBe(false);
  });
});

describe("fs shim persistence (web preview)", () => {
  // The preview's bootstrap sets __bdobbPersist only when it READ the user's saved
  // state (web/server.mjs savedState); the shim then mirrors the app's JSON stores to
  // /state. Without the flag -- e2e, help:shots, a local backend -- memory is all there is.
  const calls: { method: string; url: string; body?: string }[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal("location", { origin: "https://preview.example.com", href: "https://preview.example.com/", assign: vi.fn() });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ method: init.method ?? "GET", url, body: init.body as string | undefined });
      return new Response(null, { status: 204 });
    }));
    window.__bdobbSeed = { "settings.json": "{}", "dashboards/preview.json": '{"id":"preview"}', "files/a.csv": "x" };
  });
  afterEach(() => {
    vi.useRealTimers();
    delete window.__bdobbPersist;
  });

  it("stays in memory unless the preview says it may save", async () => {
    const fs = await import("./fs");
    await fs.writeTextFile("settings.json", '{"theme":"dark"}');
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toEqual([]);
  });

  it("mirrors the whole store on the first save, then only what changed", async () => {
    window.__bdobbPersist = true;
    const fs = await import("./fs");
    // The app's atomic writer: a temp beside the file, then a rename over it.
    await fs.writeTextFile("settings.json.tmp.abc.1", '{"theme":"dark"}');
    await fs.rename("settings.json.tmp.abc.1", "settings.json");
    await fs.writeTextFile("files/b.csv", "not ours");
    await vi.advanceTimersByTimeAsync(1000);
    // First save: everything the allow-list names, so the store mirrors the page -- the
    // seeded dashboard included, or it would vanish the first time saved state is loaded.
    expect(calls).toEqual([
      { method: "PUT", url: "/state/dashboards/preview.json", body: '{"id":"preview"}' },
      { method: "PUT", url: "/state/settings.json", body: '{"theme":"dark"}' },
    ]);
    calls.length = 0;
    await fs.writeTextFile("dashboards/mine.json", '{"id":"mine"}');
    await fs.writeTextFile("dashboards/mine.json", '{"id":"mine","name":"Mine"}'); // coalesced
    await fs.remove("dashboards/preview.json");
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual([
      { method: "PUT", url: "/state/dashboards/mine.json", body: '{"id":"mine","name":"Mine"}' },
      { method: "DELETE", url: "/state/dashboards/preview.json", body: undefined },
    ]);
  });

  it("a save that fails is retried with the next one", async () => {
    window.__bdobbPersist = true;
    const fs = await import("./fs");
    await fs.writeTextFile("folders.json", "[]");
    await vi.advanceTimersByTimeAsync(1000);
    calls.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ method: init.method ?? "GET", url });
      return new Response(null, { status: calls.length === 1 ? 502 : 204 });
    }));
    await fs.writeTextFile("folders.json", '["a"]');
    await vi.advanceTimersByTimeAsync(1000);
    await fs.writeTextFile("chat.json", "{}");
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.map(c => c.url).sort()).toEqual(["/state/chat.json", "/state/folders.json", "/state/folders.json"]);
  });

  describe("a page that goes away within the debounce", () => {
    // 2026-10-19: a tab renamed and then reloaded at once was lost -- the 500 ms debounce
    // never ran, so nothing was sent. Hidden or unloading, pending saves go out at once,
    // as keepalive requests, which the browser finishes after the page is gone.
    const sent: { url: string; keepalive?: boolean; body?: string }[] = [];
    beforeEach(() => {
      sent.length = 0;
      window.__bdobbPersist = true;
      vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
        sent.push({ url, keepalive: init.keepalive, body: init.body as string | undefined });
        return new Response(null, { status: 204 });
      }));
    });

    it("sends what is pending at once on pagehide, with keepalive, and not again after", async () => {
      const fs = await import("./fs");
      await fs.writeTextFile("settings.json", '{"theme":"dark"}');
      window.dispatchEvent(new Event("pagehide"));
      expect(sent).toEqual([
        { url: "/state/dashboards/preview.json", keepalive: true, body: '{"id":"preview"}' },
        { url: "/state/settings.json", keepalive: true, body: '{"theme":"dark"}' },
      ]);
      await vi.advanceTimersByTimeAsync(2000);
      expect(sent).toHaveLength(2);
    });

    it("does the same when the page is hidden (an iPad sent to the background)", async () => {
      const fs = await import("./fs");
      await fs.writeTextFile("settings.json", '{"theme":"dark"}');
      const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      hidden.mockRestore();
      expect(sent.map(s => [s.url, s.keepalive])).toEqual([
        ["/state/dashboards/preview.json", true], ["/state/settings.json", true]]);
    });

    it("a hide during a running flush sends what that flush has not finished", async () => {
      // Review 2026-10-19: flush() took its whole batch out of `dirty`, so a page unloaded
      // while it awaited the first PUT lost the rest -- and the in-flight one is an
      // ordinary request the unload cancels.
      let release = (_: Response) => {};
      vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => {
        sent.push({ url, keepalive: init.keepalive });
        return init.keepalive ? Promise.resolve(new Response(null, { status: 204 })) : new Promise<Response>(r => { release = r; });
      }));
      const fs = await import("./fs");
      await fs.writeTextFile("settings.json", '{"theme":"dark"}');
      await vi.advanceTimersByTimeAsync(600); // the debounced flush is now stuck on its first PUT
      expect(sent).toEqual([{ url: "/state/dashboards/preview.json", keepalive: false }]);
      window.dispatchEvent(new Event("pagehide"));
      expect(sent.slice(1)).toEqual([
        { url: "/state/dashboards/preview.json", keepalive: true },
        { url: "/state/settings.json", keepalive: true },
      ]);
      // Settle the stuck flush: every test's module keeps its listeners on the shared window.
      release(new Response(null, { status: 204 }));
      await vi.advanceTimersByTimeAsync(0);
    });

    it("a hide during a first save too big for keepalive sends none of it with keepalive", async () => {
      // Re-review 2026-10-19: the budget check keyed on `mirrored`, which the first flush
      // sets before it sends, so a hide mid-mirror skipped it and could land part of a store.
      let stuck = true, release = (_: Response) => {};
      vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => {
        sent.push({ url, keepalive: init.keepalive });
        return init.keepalive || !stuck ? Promise.resolve(new Response(null, { status: 204 })) : new Promise<Response>(r => { release = r; });
      }));
      window.__bdobbSeed = { ...window.__bdobbSeed, "dashboards/big.json": JSON.stringify({ id: "big", pad: "x".repeat(70000) }) };
      const fs = await import("./fs");
      await fs.writeTextFile("settings.json", '{"theme":"dark"}');
      await vi.advanceTimersByTimeAsync(600); // the first mirror is stuck on its first PUT
      // A reload: hidden first, then pagehide. Neither may send part of an empty store.
      const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      hidden.mockRestore();
      window.dispatchEvent(new Event("pagehide"));
      expect(sent.filter(s => s.keepalive)).toEqual([]);
      stuck = false; // then let the mirror finish, so this module's listeners stay quiet later
      release(new Response(null, { status: 204 }));
      await vi.advanceTimersByTimeAsync(0);
    });

    it("once part of the first mirror has landed, a hide sends all the rest, however big", async () => {
      // Re-review 2026-10-19: the store is already partial then, and only finishing it
      // keeps the next load from replacing the seed with part of it.
      let plain = 0, release = (_: Response) => {};
      vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => {
        sent.push({ url, keepalive: init.keepalive });
        // The second ordinary PUT (zbig.json) stalls: preview.json has landed by then.
        return init.keepalive || ++plain !== 2 ? Promise.resolve(new Response(null, { status: 204 })) : new Promise<Response>(r => { release = r; });
      }));
      window.__bdobbSeed = { ...window.__bdobbSeed, "dashboards/zbig.json": JSON.stringify({ id: "zbig", pad: "x".repeat(70000) }) };
      const fs = await import("./fs");
      await fs.writeTextFile("settings.json", '{"theme":"dark"}');
      await vi.advanceTimersByTimeAsync(600);
      expect(sent.map(s => s.url)).toEqual(["/state/dashboards/preview.json", "/state/dashboards/zbig.json"]);
      window.dispatchEvent(new Event("pagehide"));
      expect(sent.filter(s => s.keepalive).map(s => s.url)).toEqual(["/state/dashboards/zbig.json", "/state/settings.json"]);
      release(new Response(null, { status: 204 }));
      await vi.advanceTimersByTimeAsync(0);
    });

    it("on hide, a first save too big for keepalive sends nothing rather than part of the store", async () => {
      // A partial store would replace the seed on the next load; nothing sent keeps the seed.
      window.__bdobbSeed = { ...window.__bdobbSeed, "dashboards/big.json": JSON.stringify({ id: "big", pad: "x".repeat(70000) }) };
      const fs = await import("./fs");
      await fs.writeTextFile("settings.json", '{"theme":"dark"}');
      window.dispatchEvent(new Event("pagehide"));
      expect(sent).toEqual([]);
    });

    it("still sends, without keepalive, a body the browser refuses keepalive for", async () => {
      vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
        if (init.keepalive) throw new TypeError("keepalive request body is too large");
        sent.push({ url, keepalive: init.keepalive });
        return new Response(null, { status: 204 });
      }));
      const fs = await import("./fs");
      await fs.writeTextFile("settings.json", '{"theme":"dark"}');
      window.dispatchEvent(new Event("pagehide"));
      await vi.advanceTimersByTimeAsync(0);
      expect(sent.map(s => s.url)).toEqual(["/state/dashboards/preview.json", "/state/settings.json"]);
    });
  });

  describe("a reload that reads the store before the hide-time save lands", () => {
    // 2026-10-19, live: the keepalive PUT reached the NAS, but the reloaded page's own state
    // read got there first, so the page showed the old copy (and would save it back). What
    // a hide sends is kept for this tab in sessionStorage and laid over the seed on load.
    const KEY = "bdobb-unsaved";
    beforeEach(() => { sessionStorage.clear(); window.__bdobbPersist = true; });
    afterEach(() => sessionStorage.clear());

    it("keeps what a hide sends for this tab", async () => {
      const fs = await import("./fs");
      await fs.writeTextFile("settings.json", '{"theme":"dark"}');
      window.dispatchEvent(new Event("pagehide"));
      const kept = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
      expect(kept.files["settings.json"]).toBe('{"theme":"dark"}');
    });

    it("a reload's hidden-then-pagehide pair keeps every file in the copy", async () => {
      // Review 2026-10-19: with a flush stuck on one file, pagehide's second flushNow saw only
      // that file and kept just it, dropping what visibilitychange had kept a moment before.
      let stuck = true, release = (_: Response) => {};
      vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit = {}) =>
        init.keepalive || !stuck ? Promise.resolve(new Response(null, { status: 204 })) : new Promise<Response>(r => { release = r; })));
      const fs = await import("./fs");
      await fs.writeTextFile("settings.json", '{"theme":"dark"}');
      await vi.advanceTimersByTimeAsync(600); // stuck on dashboards/preview.json
      const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      hidden.mockRestore();
      window.dispatchEvent(new Event("pagehide"));
      const kept = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
      expect(Object.keys(kept.files).sort()).toEqual(["dashboards/preview.json", "settings.json"]);
      stuck = false; // settle the stuck flush so this module's listeners stay quiet later
      release(new Response(null, { status: 204 }));
      await vi.advanceTimersByTimeAsync(0);
    });

    it("after a lapsed session sends the page to sign-in, a hide neither sends nor keeps", async () => {
      // CI 2026-10-19 (web/browser-smoke.mjs): an edit made once the session had lapsed was
      // kept on the hide that the redirect to sign-in caused, laid back over the seed after
      // signing in, and saved -- an edit the server refused came back.
      const fs = await import("./fs");
      const http = await import("./http");
      await fs.writeTextFile("settings.json", '{"theme":"dark"}');
      vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ method: init.method ?? "GET", url });
        return new Response(null, { status: 401 });
      }));
      await http.fetch("/api/v1/equity/price/quote"); // the widget refetch meets the lapsed session
      expect(location.assign).toHaveBeenCalledWith("/auth/signin");
      calls.length = 0;
      window.dispatchEvent(new Event("pagehide"));
      expect(calls).toEqual([]);
      expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    it("lays a recent copy over a stale seed and saves it again", async () => {
      sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), files: { "settings.json": '{"theme":"dark"}' } }));
      const fs = await import("./fs");
      expect(await fs.readTextFile("settings.json")).toBe('{"theme":"dark"}');
      expect(sessionStorage.getItem(KEY)).toBeNull();
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls.find(c => c.url === "/state/settings.json")?.body).toBe('{"theme":"dark"}');
    });

    it("ignores a copy older than a minute, or one the preview may not save", async () => {
      sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now() - 61_000, files: { "settings.json": '{"old":true}' } }));
      let fs = await import("./fs");
      expect(await fs.readTextFile("settings.json")).toBe("{}");
      vi.resetModules();
      delete window.__bdobbPersist;
      sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), files: { "settings.json": '{"old":true}' } }));
      fs = await import("./fs");
      expect(await fs.readTextFile("settings.json")).toBe("{}");
    });

    it("forgets the copy once the page is back, or a later save has gone through", async () => {
      const fs = await import("./fs");
      await fs.writeTextFile("settings.json", '{"theme":"dark"}');
      window.dispatchEvent(new Event("pagehide"));
      expect(sessionStorage.getItem(KEY)).not.toBeNull();
      const shown = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      shown.mockRestore();
      expect(sessionStorage.getItem(KEY)).toBeNull();
      window.dispatchEvent(new Event("pagehide")); // nothing pending: nothing kept
      await fs.writeTextFile("settings.json", '{"theme":"light"}');
      window.dispatchEvent(new Event("pagehide"));
      expect(sessionStorage.getItem(KEY)).not.toBeNull();
      await fs.writeTextFile("folders.json", "[]");
      await vi.advanceTimersByTimeAsync(1000); // an ordinary save that goes through
      expect(sessionStorage.getItem(KEY)).toBeNull();
    });
  });

  it("says so on the page when something could not be saved, and takes it back when it is", async () => {
    // Review 2026-09-20: a refused save (a file over the store's 256 KiB, a store that is
    // down) was silent, and the bar went on saying "Changes are saved to your account".
    window.__bdobbPersist = true;
    const bar = document.createElement("div");
    bar.className = "web-preview-notice";
    bar.append("Private web preview · Changes are saved to your account · ");
    document.body.append(bar);
    let status = 413;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status })));
    const fs = await import("./fs");
    await fs.writeTextFile("chat.json", "{}");
    await vi.advanceTimersByTimeAsync(1000);
    expect(bar.textContent).toContain("Some changes could NOT be saved");
    status = 204;
    await fs.writeTextFile("folders.json", "[]");
    await vi.advanceTimersByTimeAsync(1000);
    expect(bar.textContent).toContain("Changes are saved to your account");
    bar.remove();
  });
});

describe("http shim", () => {
  describe("an expired web session", () => {
    // The web preview's session is a hard one-hour deadline. Once it lapses every
    // request to the app's OWN origin answers 401, and the app used to read that as
    // "Backend is offline" on every card (2026-09-20). web/server.mjs answers 401
    // only from its session gate -- an upstream failure is relayed as 502 -- so a
    // same-origin 401 can only mean "signed out".
    const assign = vi.fn();
    beforeEach(() => {
      vi.resetModules();
      assign.mockClear();
      vi.stubGlobal("location", { origin: "https://preview.example.com", href: "https://preview.example.com/", assign });
    });
    afterEach(() => vi.unstubAllGlobals());
    const answer = (status: number) => vi.fn().mockResolvedValue(new Response("x", { status }));

    it("goes to the sign-in page on a same-origin 401, once", async () => {
      vi.stubGlobal("fetch", answer(401));
      const { fetch } = await import("./http");
      const first = await fetch("https://preview.example.com/api/widgets.json");
      await fetch("/grid/widgets.json");
      expect(first.status).toBe(401); // the caller still gets its response
      expect(assign).toHaveBeenCalledTimes(1);
      expect(assign).toHaveBeenCalledWith("/auth/signin");
    });

    it("leaves another origin's 401 alone -- that is a backend refusing a credential", async () => {
      vi.stubGlobal("fetch", answer(401));
      const { fetch } = await import("./http");
      await fetch("https://backend.example.net/widgets.json");
      expect(assign).not.toHaveBeenCalled();
    });

    it("does nothing on any other same-origin status", async () => {
      for (const status of [200, 403, 404, 502]) {
        vi.stubGlobal("fetch", answer(status));
        const { fetch } = await import("./http");
        await fetch("/api/widgets.json");
      }
      expect(assign).not.toHaveBeenCalled();
    });
  });

  it("forwards to window.fetch with connectTimeout stripped", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", spy);
    const { fetch } = await import("./http");
    await fetch("http://x/y", { method: "GET", headers: { a: "b" }, connectTimeout: 10_000 });
    expect(spy).toHaveBeenCalledWith("http://x/y", { method: "GET", headers: { a: "b" } });
  });

  // connectTimeout is the ONLY thing this shim drops. `signal` is how a caller
  // expresses a real deadline in browser mode (dataClient's apps.json fetch),
  // and dropping it there would leave discovery with no deadline at all on the
  // one runtime that cannot honour connectTimeout either.
  it("forwards an AbortSignal untouched", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", spy);
    const { fetch } = await import("./http");
    const signal = AbortSignal.timeout(10_000);
    await fetch("http://x/y", { signal, connectTimeout: 10_000 });
    expect(spy).toHaveBeenCalledWith("http://x/y", { signal });
  });
});

describe("socket shim (web preview tickets)", () => {
  // A socket through a Vercel Function bills function time while it is open, so the
  // preview's sockets open on the gateway: the shim asks this origin for a ticketed
  // URL first (web/server.mjs /socket-ticket) and only then constructs the real socket.
  const assign = vi.fn();
  const gatewayUrl = "wss://gateway.example.com/news/ws/news?ticket=1.n.s";
  let FakeSocket: typeof import("../test/fakeSocket").FakeSocket;
  beforeEach(async () => {
    assign.mockClear();
    ({ FakeSocket } = await import("../test/fakeSocket"));
    FakeSocket.last = null;
    FakeSocket.all = [];
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("location", { origin: "https://preview.example.com", host: "preview.example.com", href: "https://preview.example.com/", assign });
  });
  afterEach(() => {
    delete window.__bdobbSocketTickets;
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const ticketed = () =>
    vi.fn().mockImplementation(async () => new Response(JSON.stringify({ url: gatewayUrl }), { status: 200 }));

  it("does nothing unless the preview says tickets are on", async () => {
    await import("./socket");
    expect(globalThis.WebSocket).toBe(FakeSocket);
  });

  it("is carried into the bundle by the http shim, the module the app always loads", async () => {
    window.__bdobbSocketTickets = true;
    await import("./http");
    expect(globalThis.WebSocket).not.toBe(FakeSocket);
  });

  it("opens a same-origin socket on the ticketed gateway URL and relays it", async () => {
    window.__bdobbSocketTickets = true;
    const fetchSpy = ticketed();
    vi.stubGlobal("fetch", fetchSpy);
    await import("./socket");
    const ws = new globalThis.WebSocket("wss://preview.example.com/news/ws/news");
    const opened = vi.fn(),
      messages: unknown[] = [];
    ws.onopen = opened;
    ws.onmessage = (e) => messages.push(e.data);
    expect(ws.readyState).toBe(0);
    await settle();
    expect(fetchSpy.mock.calls[0][0]).toBe("/socket-ticket?for=" + encodeURIComponent("/news/ws/news"));
    expect(fetchSpy.mock.calls[0][1]).toEqual({ cache: "no-store", signal: expect.any(AbortSignal) });
    const real = FakeSocket.last!;
    expect(real.url).toBe(gatewayUrl);
    real.open();
    real.emit({ type: "tick" });
    expect(opened).toHaveBeenCalledTimes(1);
    expect(ws.readyState).toBe(1);
    expect(messages).toEqual(['{"type":"tick"}']);
    ws.send("hello");
    expect(real.sent).toEqual(["hello"]);
    const closed = vi.fn();
    ws.onclose = closed;
    ws.close();
    expect(real.closed).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
    // A caller that compares against the constructor's constant still can.
    expect(globalThis.WebSocket.OPEN).toBe(1);
  });

  // Ep. 10: the live grid's socket, on the seeded preview-grid backend
  // (<origin>/grid + wsEndpoint live_grid_ws), asks for its own ticket the same
  // way; the vendored policy decides whether one is issued.
  it("asks for a ticket over the live grid's /grid/live_grid_ws as for any same-origin socket", async () => {
    window.__bdobbSocketTickets = true;
    const fetchSpy = ticketed();
    vi.stubGlobal("fetch", fetchSpy);
    await import("./socket");
    new globalThis.WebSocket("wss://preview.example.com/grid/live_grid_ws");
    await settle();
    expect(fetchSpy.mock.calls[0][0]).toBe("/socket-ticket?for=" + encodeURIComponent("/grid/live_grid_ws"));
  });

  it("closes, so the caller retries, when the ticket request never answers", async () => {
    window.__bdobbSocketTickets = true;
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("timeout")))),
      ),
    );
    await import("./socket");
    const ws = new globalThis.WebSocket("wss://preview.example.com/grid/live_grid_ws");
    const closed = vi.fn();
    ws.onclose = closed;
    expect(timeout).toHaveBeenCalledWith(10_000);
    deadline.abort();
    await settle();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(ws.readyState).toBe(3);
    timeout.mockRestore();
  });

  it("asks for a fresh ticket for every socket: a ticket is single use", async () => {
    window.__bdobbSocketTickets = true;
    const fetchSpy = ticketed();
    vi.stubGlobal("fetch", fetchSpy);
    await import("./socket");
    new globalThis.WebSocket("wss://preview.example.com/news/ws/news");
    new globalThis.WebSocket("wss://preview.example.com/news/ws/news");
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("leaves another origin's socket to the real constructor", async () => {
    window.__bdobbSocketTickets = true;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await import("./socket");
    const ws = new globalThis.WebSocket("wss://elsewhere.example.com/ws");
    expect(ws).toBe(FakeSocket.last);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a refused ticket is a drop the hook retries; a lapsed session goes to sign-in", async () => {
    window.__bdobbSocketTickets = true;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", { status: 401 })));
    await import("./socket");
    const ws = new globalThis.WebSocket("wss://preview.example.com/news/ws/news");
    const closed = vi.fn();
    ws.onclose = closed;
    await settle();
    expect(FakeSocket.last).toBeNull(); // no real socket was ever constructed
    expect(closed).toHaveBeenCalledTimes(1);
    expect(ws.readyState).toBe(3);
    expect(assign).toHaveBeenCalledWith("/auth/signin");
  });

  it("a ticket the preview will not issue (404, 503) is a drop, with no sign-in", async () => {
    window.__bdobbSocketTickets = true;
    for (const status of [404, 503]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", { status })));
      await import("./socket");
      const ws = new globalThis.WebSocket("wss://preview.example.com/news/ws/news");
      const closed = vi.fn();
      ws.onclose = closed;
      await settle();
      expect(closed).toHaveBeenCalledTimes(1);
    }
    expect(FakeSocket.last).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it("closed while the ticket is in flight never opens the real socket", async () => {
    window.__bdobbSocketTickets = true;
    vi.stubGlobal("fetch", ticketed());
    await import("./socket");
    const ws = new globalThis.WebSocket("wss://preview.example.com/news/ws/news");
    ws.close();
    await settle();
    expect(FakeSocket.last).toBeNull();
  });
});

describe("opener shim", () => {
  it("opens a new tab and records the url on window.__bdobb.opened", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { openUrl } = await import("./opener");
    await openUrl("https://example.test/a");
    expect(open).toHaveBeenCalledWith("https://example.test/a", "_blank");
    expect(window.__bdobb?.opened).toEqual(["https://example.test/a"]);
  });
});

describe("path shim", () => {
  it("returns a fixed app data dir and joins with /", async () => {
    const { appDataDir, join } = await import("./path");
    expect(await appDataDir()).toBe("/appdata");
    expect(await join("/appdata", "logs/bdobb.log")).toBe("/appdata/logs/bdobb.log");
  });
});

describe("dialog shim", () => {
  it("answers the plugin's confirm with the browser's own, ignoring the native-only options", async () => {
    const nativeConfirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", nativeConfirm);
    const { confirm } = await import("./dialog");
    await expect(confirm('Delete tab "Second"?', { title: "Delete tab" })).resolves.toBe(true);
    expect(nativeConfirm).toHaveBeenCalledWith('Delete tab "Second"?');
  });

  it("answers open() with the one fixed path an e2e spec seeds", async () => {
    const { open } = await import("./dialog");
    await expect(open({ multiple: false })).resolves.toBe("/imports/apps.json");
  });
});

describe("webviewWindow shim", () => {
  it("opens the viewer route in a named browser window and records the url", async () => {
    const nativeOpen = vi.fn();
    vi.stubGlobal("open", nativeOpen);
    const { WebviewWindow } = await import("./webviewWindow");

    const w = new WebviewWindow("dash-d1", { url: "/?viewer=d1" });

    expect(w.label).toBe("dash-d1");
    expect(nativeOpen).toHaveBeenCalledWith("/?viewer=d1", "dash-d1");
    expect(window.__bdobb?.opened).toEqual(["/?viewer=d1"]);
  });

  // LeftRail subscribes to tauri://error on the window it just created; the
  // shim has no such event, but a missing once() threw after the tab opened
  // and the rail then logged a false "failed to open" on every open.
  it("accepts a once() subscription and hands back an unlisten", async () => {
    vi.stubGlobal("open", vi.fn());
    const { WebviewWindow } = await import("./webviewWindow");
    const w = new WebviewWindow("dash-d1", { url: "/?viewer=d1" });

    const unlisten = await w.once("tauri://error", () => {});

    expect(unlisten).toBeTypeOf("function");
  });

  it("reports no existing window, so the caller always creates one", async () => {
    const { WebviewWindow } = await import("./webviewWindow");
    await expect(WebviewWindow.getByLabel("dash-d1")).resolves.toBeNull();
  });
});

describe("window shim", () => {
  it("answers setTheme, so the theme effect is a no-op outside Tauri", async () => {
    const { getCurrentWindow } = await import("./window");
    await expect(getCurrentWindow().setTheme("dark")).resolves.toBeUndefined();
    await expect(getCurrentWindow().setTheme(null)).resolves.toBeUndefined();
  });

  // screenFit.ts imports these by name; a missing export fails the whole
  // browser build at module load, not just the launch read.
  it("knows no monitors, so screenFit falls back to window.screen", async () => {
    const win = await import("./window");
    await expect(win.currentMonitor()).resolves.toBeNull();
    await expect(win.primaryMonitor()).resolves.toBeNull();
    await expect(win.availableMonitors()).resolves.toEqual([]);
  });

  it("answers the move and scale listeners with a no-op unlisten", async () => {
    const { getCurrentWindow } = await import("./window");
    const off = await getCurrentWindow().onMoved(() => {});
    expect(off()).toBeUndefined();
    const offScale = await getCurrentWindow().onScaleChanged(() => {});
    expect(offScale()).toBeUndefined();
  });
});

describe("core shim", () => {
  it("reports that it is not the native app, so native-only paths stay off", async () => {
    const { isTauri } = await import("./core");
    expect(isTauri()).toBe(false);
  });

  it("rejects every command by name, so a new native call cannot silently no-op", async () => {
    const { invoke } = await import("./core");
    await expect(invoke("something_else")).rejects.toThrow(/something_else/);
  });
});

describe("event shim", () => {
  it("delivers an emit to listeners in the same context and stops after unlisten", async () => {
    // Tauri's emit reaches the emitting window too. BroadcastChannel does not
    // deliver to its own sender, so the shim carries that half itself -- and
    // this is the assertion that keeps the two in agreement.
    const { emit, listen } = await import("./event");
    const seen: string[] = [];
    const off = await listen<string>("t", (e) => seen.push(e.payload));
    await emit("t", "one");
    expect(seen).toEqual(["one"]);
    off();
    await emit("t", "two");
    expect(seen).toEqual(["one"]);
  });
});
