// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));

import { __failPath, __reset } from "../test/memfs";
import { startMockServer, type MockServer } from "../test/mockServer";
import { __resetLoggerForTests } from "./logger";
import type { BackendConfig } from "./types";
import { backend } from "../test/fixtures";
import { WIDGETS_TIMEOUT_MS } from "./dataClient";
import { discoverAll, discoverBackend } from "./discovery";
import { APPS_TIMEOUT_MS, OPENBB_PLATFORM_SERVICE } from "./dataClient";
import { IMPORT_MAX_BYTES } from "./importLimits";

const servers: MockServer[] = [];

async function serve(
  routes: Record<string, unknown>,
  id: string,
  // Defaults to the id, which is what most tests want; a test about what the
  // user is TOLD passes a display name distinct from it on purpose.
  name: string = id,
): Promise<BackendConfig> {
  const s = await startMockServer(routes);
  servers.push(s);
  return backend({ id, name, baseUrl: s.url });
}

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe("discoverBackend", () => {
  it("returns normalized widgets and online status", async () => {
    const b = await serve({ "/widgets.json": { w1: { endpoint: "e", name: "One" } } }, "b1");
    const result = await discoverBackend(b);
    expect(result.status).toBe("online");
    expect(result.backendId).toBe("b1");
    expect(result.widgets).toHaveLength(1);
    expect(result.widgets[0].backendId).toBe("b1");
    expect(result.widgets[0].name).toBe("One");
    expect(result.issues).toEqual([]);
  });

  it("surfaces widgetsJson issues for a malformed widgets.json payload", async () => {
    const b = await serve(
      { "/widgets.json": { w1: { endpoint: "e" }, w2: "not an object" } },
      "b1",
    );
    const result = await discoverBackend(b);
    expect(result.status).toBe("online");
    expect(result.widgets).toHaveLength(1);
    expect(result.issues).toEqual([{ id: "w2", reason: "entry is not a JSON object" }]);
  });

  it("reports offline with no widgets when the backend errors", async () => {
    const b = await serve({ "/widgets.json": { __status: 500 } }, "b1");
    const result = await discoverBackend(b);
    expect(result.status).toBe("offline");
    expect(result.widgets).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.error).toContain("500");
  });

  it("reports offline when the host is unreachable", async () => {
    const result = await discoverBackend(backend({ name: "gone", baseUrl: "http://127.0.0.1:1" }));
    expect(result.status).toBe("offline");
    expect(result.widgets).toEqual([]);
  });

  it("still resolves to a well-formed offline result when logging the failure also fails", async () => {
    // The backend fetch fails as usual; the logger's own mkdir also fails.
    // discoverBackend's contract is that it never rejects, so a logging
    // failure must not escape either.
    const b = await serve({ "/widgets.json": { __status: 500 } }, "b1");
    __failPath("logs");

    const result = await discoverBackend(b);
    expect(result.status).toBe("offline");
    expect(result.backendId).toBe("b1");
    expect(result.widgets).toEqual([]);
    expect(result.error).toContain("500");
  });
});

describe("discoverBackend apps.json", () => {
  const app = { name: "Macro", tabs: { t1: { id: "t1", name: "Main", layout: [] } } };

  it("returns the backend's apps alongside its widgets", async () => {
    const b = await serve(
      { "/widgets.json": { w1: { endpoint: "e" } }, "/apps.json": [app] },
      "b1",
    );
    const result = await discoverBackend(b);
    expect(result.status).toBe("online");
    expect(result.apps).toEqual([app]);
    expect(result.issues).toEqual([]);
  });

  // The common case: a backend that serves widgets and no apps at all. Its
  // 404 is not a failure and must neither mark it offline nor report an issue.
  it("reports no apps and no issue when the backend serves no apps.json", async () => {
    const b = await serve({ "/widgets.json": { w1: { endpoint: "e" } } }, "b1");
    const result = await discoverBackend(b);
    expect(result.status).toBe("online");
    expect(result.apps).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it("reports one issue and stays online when apps.json is not JSON", async () => {
    const b = await serve(
      {
        "/widgets.json": { w1: { endpoint: "e" } },
        "/apps.json": { __status: 200, __body: "not json at all" },
      },
      "b1",
    );
    const result = await discoverBackend(b);
    expect(result.status).toBe("online");
    expect(result.widgets).toHaveLength(1);
    expect(result.apps).toEqual([]);
    expect(result.issues).toHaveLength(1);
    // The parse error quotes the body verbatim; the issue must not.
    expect(JSON.stringify(result.issues)).not.toContain("not json at all");
    expect(result.issues[0].reason).toContain("b1");
  });

  it("reports one issue and stays online when apps.json errors", async () => {
    const b = await serve(
      {
        "/widgets.json": { w1: { endpoint: "e" } },
        "/apps.json": { __status: 500, __body: { detail: "boom in the backend" } },
      },
      "b1",
    );
    const result = await discoverBackend(b);
    expect(result.status).toBe("online");
    expect(result.apps).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(JSON.stringify(result.issues)).not.toContain("boom in the backend");
  });

  it("reports one issue when apps.json is the wrong shape", async () => {
    const b = await serve(
      { "/widgets.json": { w1: { endpoint: "e" } }, "/apps.json": { not: "a list" } },
      "b1",
    );
    const result = await discoverBackend(b);
    expect(result.apps).toEqual([]);
    expect(result.issues).toHaveLength(1);
  });

  it("keeps an apps issue alongside the widgets.json issues", async () => {
    const b = await serve(
      {
        "/widgets.json": { w1: { endpoint: "e" }, w2: "not an object" },
        "/apps.json": { not: "a list" },
      },
      "b1",
    );
    const result = await discoverBackend(b);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toEqual({ id: "w2", reason: "entry is not a JSON object" });
  });

  // Every other test in this file gives a backend the same string for both,
  // so "names the backend" and "names its id" are indistinguishable there.
  // An issue is read by a person, and the id is a uuid at runtime.
  it("names the backend's display name, not its id, when apps.json is the wrong shape", async () => {
    const b = await serve(
      { "/widgets.json": { w1: { endpoint: "e" } }, "/apps.json": { not: "a list" } },
      "3f8c-id",
      "Prod",
    );
    const result = await discoverBackend(b);
    expect(result.issues[0].reason).toContain("Prod");
    expect(result.issues[0].reason).not.toContain("3f8c-id");
  });

  it("names the backend's display name, not its id, when apps.json errors", async () => {
    const b = await serve(
      { "/widgets.json": { w1: { endpoint: "e" } }, "/apps.json": { __status: 500 } },
      "3f8c-id",
      "Prod",
    );
    const result = await discoverBackend(b);
    expect(result.issues[0].reason).toContain("Prod");
    expect(result.issues[0].reason).not.toContain("3f8c-id");
  });

  // The declared size actually reaching parseAppsJson, end to end. The body
  // is padded with insignificant whitespace, so it is over the ceiling ON
  // THE WIRE while the parsed document measures 28 characters: only the
  // Content-Length can refuse this, so if `bytes` were not wired through,
  // the app would sail in.
  it("refuses an apps.json that is over the byte limit on the wire", async () => {
    const padded = `[{"name":"Macro","tabs":{}}${" ".repeat(IMPORT_MAX_BYTES)}]`;
    const b = await serve(
      {
        "/widgets.json": { w1: { endpoint: "e" } },
        "/apps.json": { __status: 200, __body: padded },
      },
      "b1",
    );
    const result = await discoverBackend(b);
    expect(result.status).toBe("online");
    expect(result.apps).toEqual([]);
    expect(result.issues[0].reason).toContain("MB");
  });

  // And the other direction: with no Content-Length to read (a re-chunking
  // proxy strips it), the measured size is still the ceiling's authority.
  it("refuses an oversized apps.json even when no Content-Length is declared", async () => {
    const huge = [{ name: "Macro", tabs: {}, description: "x".repeat(IMPORT_MAX_BYTES + 1) }];
    const b = await serve(
      {
        "/widgets.json": { w1: { endpoint: "e" } },
        "/apps.json": {
          __status: 200,
          __body: JSON.stringify(huge),
          __headers: { "content-length": null },
        },
      },
      "b1",
    );
    const result = await discoverBackend(b);
    expect(result.status).toBe("online");
    expect(result.apps).toEqual([]);
    expect(result.issues[0].reason).toContain("MB");
  });

  it("reports no apps when widgets.json itself fails", async () => {
    const b = await serve({ "/widgets.json": { __status: 500 }, "/apps.json": [app] }, "b1");
    const result = await discoverBackend(b);
    expect(result.status).toBe("offline");
    expect(result.apps).toEqual([]);
    expect(result.issues).toEqual([]);
  });
});

/**
 * apps.json's own end-to-end deadline. CONNECT_TIMEOUT_MS is connect-phase
 * only, so a host that accepts the connection and then never answers would
 * otherwise hold discoverBackend open forever -- and, because discoverAll is
 * a Promise.all, hold every OTHER backend's widgets out of the registry with
 * it. That is the whole registry emptied by one stalled optional document.
 *
 * The deadline is APPS_TIMEOUT_MS, which no test should sit through: the real
 * AbortSignal.timeout is stubbed to a short one here, and the value the code
 * ASKED for is asserted separately so the constant itself is still pinned.
 */
describe("apps.json that never answers", () => {
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  let asked: number[] = [];

  beforeEach(() => {
    asked = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      asked.push(ms);
      return realTimeout(250);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves online with no apps and one issue, inside the deadline", async () => {
    const b = await serve(
      { "/widgets.json": { w1: { endpoint: "e" } }, "/apps.json": { __hang: true } },
      "b1",
    );

    const result = await discoverBackend(b);

    expect(result.status).toBe("online");
    expect(result.widgets).toHaveLength(1);
    expect(result.apps).toEqual([]);
    expect(result.issues).toHaveLength(1);
    // The constant the deadline is really set from, not the stub's value.
    // One deadline per discovery request: this line fetches apps.json,
    // widgets.json and the GET / service probe together; the probe shares
    // apps.json's constant.
    expect([...asked].sort()).toEqual([APPS_TIMEOUT_MS, APPS_TIMEOUT_MS, WIDGETS_TIMEOUT_MS].sort());
  });

  it("does not keep another backend's widgets out of the registry", async () => {
    const stalled = await serve(
      { "/widgets.json": { s1: { endpoint: "e" } }, "/apps.json": { __hang: true } },
      "stalled",
    );
    const good = await serve({ "/widgets.json": { g1: { endpoint: "e" } } }, "good");

    const results = await discoverAll([stalled, good]);

    const byId = Object.fromEntries(results.map((r) => [r.backendId, r]));
    expect(byId.good.status).toBe("online");
    expect(byId.good.widgets).toHaveLength(1);
    expect(byId.stalled.status).toBe("online");
    expect(byId.stalled.widgets).toHaveLength(1);
    expect(byId.stalled.apps).toEqual([]);
  });
});

/**
 * The two documents share no state, so awaiting widgets.json before even
 * asking for apps.json made the two latencies additive -- on every backend,
 * inside a Promise.all, so the whole registry waited for the sum.
 */
describe("discoverBackend fetches both documents concurrently", () => {
  it("takes about one delay, not two", async () => {
    const delayed = { __delayMs: 300, __status: 200 };
    const b = await serve(
      {
        "/widgets.json": { ...delayed, __body: { w1: { endpoint: "e" } } },
        "/apps.json": { ...delayed, __body: [] },
      },
      "b1",
    );

    const started = Date.now();
    const result = await discoverBackend(b);
    const elapsed = Date.now() - started;

    expect(result.status).toBe("online");
    expect(result.widgets).toHaveLength(1);
    // Sequential is ~600ms; concurrent is ~300ms. The margin is wide enough
    // that only the ORDER of the two fetches can decide it.
    expect(elapsed).toBeLessThan(500);
  });
});

describe("discoverAll", () => {
  it("keeps one backend's failure from emptying the others", async () => {
    const good = await serve({ "/widgets.json": { a: { endpoint: "e" } } }, "good");
    const bad = await serve({ "/widgets.json": { __status: 500 } }, "bad");

    const results = await discoverAll([bad, good]);

    expect(results).toHaveLength(2);
    const byId = Object.fromEntries(results.map((r) => [r.backendId, r]));
    expect(byId.good.status).toBe("online");
    expect(byId.good.widgets).toHaveLength(1);
    expect(byId.bad.status).toBe("offline");
    expect(byId.bad.widgets).toEqual([]);
  });

  it("returns an empty array for no backends", async () => {
    expect(await discoverAll([])).toEqual([]);
  });

  it("still returns a full-length array when a backend's own logError rejects", async () => {
    // A logging failure on the bad backend must not shrink the result array
    // or take down the good backend's result alongside it.
    const good = await serve({ "/widgets.json": { a: { endpoint: "e" } } }, "good");
    const bad = await serve({ "/widgets.json": { __status: 500 } }, "bad");
    __failPath("logs");

    const results = await discoverAll([bad, good]);

    expect(results).toHaveLength(2);
    const byId = Object.fromEntries(results.map((r) => [r.backendId, r]));
    expect(byId.good.status).toBe("online");
    expect(byId.bad.status).toBe("offline");
    expect(byId.bad.widgets).toEqual([]);
  });
});

/**
 * widgets.json gets an end-to-end deadline. Without it a host that accepts
 * the connection and never answers held discoverBackend open forever -- and,
 * inside discoverAll's Promise.all, every OTHER backend's widgets with it:
 * every card on every backend "unresolved". AbortSignal.timeout is stubbed
 * short, so the case finishes in well under a second.
 */
describe("widgets.json that never answers", () => {
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  let asked: number[] = [];

  beforeEach(() => {
    asked = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      asked.push(ms);
      return realTimeout(250);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves offline inside the deadline", async () => {
    const b = await serve({ "/widgets.json": { __hang: true } }, "b1");

    const result = await discoverBackend(b);

    expect(result.status).toBe("offline");
    expect(result.widgets).toEqual([]);
    // The constant the deadline is really set from, not the stub's value.
    // One deadline per discovery request: this line fetches apps.json,
    // widgets.json and the GET / service probe together; the probe shares
    // apps.json's constant.
    expect([...asked].sort()).toEqual([APPS_TIMEOUT_MS, APPS_TIMEOUT_MS, WIDGETS_TIMEOUT_MS].sort());
  }, 3000);

  it("does not keep another backend's widgets out of the registry", async () => {
    const stalled = await serve({ "/widgets.json": { __hang: true } }, "stalled");
    const good = await serve({ "/widgets.json": { g1: { endpoint: "e" } } }, "good");

    const results = await discoverAll([stalled, good]);

    const byId = Object.fromEntries(results.map((r) => [r.backendId, r]));
    expect(byId.good.status).toBe("online");
    expect(byId.good.widgets).toHaveLength(1);
    expect(byId.stalled.status).toBe("offline");
  }, 3000);
});

describe("discoverBackend service probe", () => {
  it("reads the service name from GET /", async () => {
    const b = await serve({ "/widgets.json": {}, "/": { service: "rss-ticker", version: "8.3.0" } }, "rss");
    expect((await discoverBackend(b)).service).toBe("rss-ticker");
  });

  it("recognises the OpenBB Platform API by its HTML landing page", async () => {
    const page = "<!doctype html><html><head><title>OpenBB Platform</title></head></html>";
    const other = "<!doctype html><html><head><title>Something else</title></head></html>";
    const obb = await serve({ "/widgets.json": {}, "/": { __status: 200, __body: page, __contentType: "text/html" } }, "obb");
    const html = await serve({ "/widgets.json": {}, "/": { __status: 200, __body: other, __contentType: "text/html" } }, "html");
    expect((await discoverBackend(obb)).service).toBe(OPENBB_PLATFORM_SERVICE);
    expect((await discoverBackend(html)).service).toBeUndefined();
  });

  it("a / that 404s or is not JSON leaves the backend online with no service", async () => {
    // The probe is advisory: online/offline is widgets.json's call alone.
    const b = await serve({ "/widgets.json": {} }, "plain");
    const result = await discoverBackend(b);
    expect(result.status).toBe("online");
    expect(result.service).toBeUndefined();
  });
});
