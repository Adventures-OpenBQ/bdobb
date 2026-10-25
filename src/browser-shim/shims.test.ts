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

describe("core shim", () => {
  it("rejects every command by name, so a new native call cannot silently no-op", async () => {
    const { invoke } = await import("./core");
    await expect(invoke("something_else")).rejects.toThrow(/something_else/);
  });
});
