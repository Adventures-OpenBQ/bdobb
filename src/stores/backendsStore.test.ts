// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));

/**
 * A gate on the one thing every writer awaits. memfs has no way to hold a
 * write open, and holding one open is the only way to put a task genuinely
 * in flight while another is queued behind it. Null by default, so every
 * test but the one that arms it gets the real saveBackends unchanged.
 */
const saveGate = vi.hoisted(() => ({ block: null as Promise<void> | null }));

vi.mock("../lib/backendsFile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/backendsFile")>();
  return {
    ...actual,
    saveBackends: async (backends: Parameters<typeof actual.saveBackends>[0]) => {
      if (saveGate.block !== null) await saveGate.block;
      return actual.saveBackends(backends);
    },
  };
});

import { __failPath, __read, __reset, __seed, __writes } from "../test/memfs";
import { startMockServer, type MockServer } from "../test/mockServer";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import { useBackendsStore } from "./backendsStore";
import { useWidgetRegistryStore } from "./widgetRegistryStore";

const servers: MockServer[] = [];

async function serve(routes: Record<string, unknown>): Promise<string> {
  const s = await startMockServer(routes);
  servers.push(s);
  return s.url;
}

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useBackendsStore.setState({ backends: [], statuses: {}, issues: {}, services: {}, runtimeCredentials: [] });
  useWidgetRegistryStore.setState({ widgets: [] });
  saveGate.block = null;
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe("load", () => {
  it("seeds the default local backend on a fresh install", async () => {
    await useBackendsStore.getState().load();
    const backends = useBackendsStore.getState().backends;
    expect(backends).toHaveLength(1);
    expect(backends[0]).toMatchObject({ name: "Local", baseUrl: "http://localhost:6900" });
  });

  it("restores persisted backends", async () => {
    __seed(
      "backends.json",
      JSON.stringify([{ id: "b1", name: "Local", baseUrl: "http://host:6900" }]),
    );
    await useBackendsStore.getState().load();
    expect(useBackendsStore.getState().backends).toHaveLength(1);
  });

  it("reads the file a queued write has already produced, not the one before it", async () => {
    __seed(
      "backends.json",
      JSON.stringify([{ id: "b1", name: "One", baseUrl: "http://127.0.0.1:1" }]),
    );
    await useBackendsStore.getState().load();

    // addBackend is held genuinely mid-write here: that is the state a
    // load() fired from anywhere else can catch a Connections edit in.
    let release = () => {};
    saveGate.block = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adding = useBackendsStore
      .getState()
      .addBackend({ name: "Added", baseUrl: "http://127.0.0.1:1", authLocation: "header", validateWidgets: false });

    // What load() published, captured the instant it resolved -- not the
    // state some later task left behind. Off the chain, load() resolves
    // while the write is still blocked and publishes the pre-write file.
    let loaded: string[] = [];
    const loading = useBackendsStore
      .getState()
      .load()
      .then(() => {
        loaded = useBackendsStore.getState().backends.map((b) => b.name);
      });

    release();
    await Promise.all([adding, loading]);

    expect(loaded).toEqual(["One", "Added"]);
  });
});

describe("addBackend", () => {
  it("assigns an id, persists, and populates the registry", async () => {
    const url = await serve({ "/widgets.json": { w1: { endpoint: "e", name: "One" } } });

    const id = await useBackendsStore.getState().addBackend({ name: "Local", baseUrl: url, authLocation: "header", validateWidgets: false });

    expect(id).toMatch(/[0-9a-f-]{36}/);
    expect(JSON.parse(__read("backends.json") ?? "")).toHaveLength(1);
    // addBackend no longer awaits refresh() (discovery must not block Save),
    // so discovery-derived state settles after addBackend resolves.
    await vi.waitFor(() => {
      expect(useBackendsStore.getState().statuses[id]).toBe("online");
      expect(useWidgetRegistryStore.getState().widgets).toHaveLength(1);
    });
  });

  it("marks an unreachable backend offline without throwing", async () => {
    const id = await useBackendsStore
      .getState()
      .addBackend({ name: "gone", baseUrl: "http://127.0.0.1:1", authLocation: "header", validateWidgets: false });
    await vi.waitFor(() => {
      expect(useBackendsStore.getState().statuses[id]).toBe("offline");
    });
    expect(useWidgetRegistryStore.getState().widgets).toEqual([]);
  });

  it("rejects without adding the backend when the write fails", async () => {
    __failPath("backends.json");

    await expect(
      useBackendsStore.getState().addBackend({ name: "Local", baseUrl: "http://host:6900", authLocation: "header", validateWidgets: false }),
    ).rejects.toThrow();

    expect(useBackendsStore.getState().backends).toEqual([]);
    expect(useBackendsStore.getState().statuses).toEqual({});
    expect(useWidgetRegistryStore.getState().widgets).toEqual([]);
  });
});

describe("updateBackend", () => {
  it("persists the change and re-runs discovery", async () => {
    const dead = await serve({ "/widgets.json": { __status: 500 } });
    const live = await serve({ "/widgets.json": { w1: { endpoint: "e" } } });

    const id = await useBackendsStore.getState().addBackend({ name: "Local", baseUrl: dead, authLocation: "header", validateWidgets: false });
    await vi.waitFor(() => expect(useBackendsStore.getState().statuses[id]).toBe("offline"));

    await useBackendsStore.getState().updateBackend(id, { baseUrl: live });

    await vi.waitFor(() => {
      expect(useBackendsStore.getState().statuses[id]).toBe("online");
      expect(useWidgetRegistryStore.getState().widgets).toHaveLength(1);
    });
  });

  it("does not let a slow probe of the old URL mark the fixed backend offline", async () => {
    const slow = await serve({ "/widgets.json": { __status: 500, __delayMs: 300 } });
    const live = await serve({ "/widgets.json": { w1: { endpoint: "e" } } });
    __seed("backends.json", JSON.stringify([{ id: "b1", name: "Local", baseUrl: slow }]));
    await useBackendsStore.getState().load();

    // A refresh still probing the old URL when the user saves the fix: it
    // resolves AFTER the fixed backend's own discovery, and must not win.
    const stale = useBackendsStore.getState().refresh();
    await useBackendsStore.getState().updateBackend("b1", { baseUrl: live });
    await vi.waitFor(() => expect(useBackendsStore.getState().statuses.b1).toBe("online"));
    await stale;

    expect(useBackendsStore.getState().statuses.b1).toBe("online");
    expect(useWidgetRegistryStore.getState().widgets).toHaveLength(1);
  });

  // load() re-reads the file into fresh objects with the same content (the
  // StrictMode double bootstrap does exactly this); a refresh in flight across
  // it still describes the current config and must still land.
  it("still applies a refresh that a reload of the same config overlapped", async () => {
    const live = await serve({ "/widgets.json": { w1: { endpoint: "e" } } });
    __seed("backends.json", JSON.stringify([{ id: "b1", name: "Local", baseUrl: live }]));
    await useBackendsStore.getState().load();

    const pending = useBackendsStore.getState().refresh();
    await useBackendsStore.getState().load();
    await pending;

    expect(useBackendsStore.getState().statuses.b1).toBe("online");
  });

  it("writes nothing and probes nothing for an id that is not a backend", async () => {
    __seed("backends.json", JSON.stringify([{ id: "b1", name: "Local", baseUrl: "http://127.0.0.1:1" }]));
    await useBackendsStore.getState().load();
    const writesBefore = __writes().length;

    await useBackendsStore.getState().updateBackend("missing", { name: "Renamed" });

    expect(__writes()).toHaveLength(writesBefore);
    expect(useBackendsStore.getState().statuses).toEqual({ b1: "unknown" });
  });

  it("rejects without applying the patch when the write fails", async () => {
    const url = await serve({ "/widgets.json": { w1: { endpoint: "e" } } });
    const id = await useBackendsStore.getState().addBackend({ name: "Local", baseUrl: url, authLocation: "header", validateWidgets: false });
    // Let the addBackend-triggered discovery settle first, so it cannot
    // land in between the two snapshots below and make them differ for a
    // reason unrelated to what this test is proving.
    await vi.waitFor(() => expect(useBackendsStore.getState().statuses[id]).toBe("online"));

    const backendsBefore = useBackendsStore.getState().backends;
    const statusesBefore = useBackendsStore.getState().statuses;

    __failPath("backends.json");
    await expect(
      useBackendsStore.getState().updateBackend(id, { name: "Renamed" }),
    ).rejects.toThrow();

    expect(useBackendsStore.getState().backends).toEqual(backendsBefore);
    expect(useBackendsStore.getState().statuses).toEqual(statusesBefore);
  });
});

describe("removeBackend", () => {
  it("drops the backend, its status, and its widgets", async () => {
    const url = await serve({ "/widgets.json": { w1: { endpoint: "e" } } });
    const id = await useBackendsStore.getState().addBackend({ name: "Local", baseUrl: url, authLocation: "header", validateWidgets: false });
    // Let the addBackend-triggered discovery land first, so its results
    // can't arrive after removeBackend and reintroduce the widget it just
    // dropped.
    await vi.waitFor(() => expect(useWidgetRegistryStore.getState().widgets).toHaveLength(1));

    await useBackendsStore.getState().removeBackend(id);

    expect(useBackendsStore.getState().backends).toEqual([]);
    expect(useBackendsStore.getState().statuses[id]).toBeUndefined();
    expect(useWidgetRegistryStore.getState().widgets).toEqual([]);
    expect(JSON.parse(__read("backends.json") ?? "")).toEqual([]);
  });

  it("rejects without dropping the backend, its status, or its widgets when the write fails", async () => {
    const url = await serve({ "/widgets.json": { w1: { endpoint: "e" } } });
    const id = await useBackendsStore.getState().addBackend({ name: "Local", baseUrl: url, authLocation: "header", validateWidgets: false });
    await vi.waitFor(() => expect(useWidgetRegistryStore.getState().widgets).toHaveLength(1));

    __failPath("backends.json");
    await expect(useBackendsStore.getState().removeBackend(id)).rejects.toThrow();

    expect(useBackendsStore.getState().backends).toHaveLength(1);
    expect(useBackendsStore.getState().statuses[id]).toBe("online");
    expect(useWidgetRegistryStore.getState().widgets).toHaveLength(1);
  });

  it("drops a removed backend's issues", async () => {
    const url = await serve({ "/widgets.json": { bad: "not an object" } });
    const id = await useBackendsStore.getState().addBackend({
      name: "b",
      baseUrl: url,
      authLocation: "header",
      validateWidgets: true,
    });
    await useBackendsStore.getState().refresh();
    await useBackendsStore.getState().removeBackend(id);

    expect(useBackendsStore.getState().issues[id]).toBeUndefined();
  });
});

describe("refresh", () => {
  it("leaves one backend's widgets in place when another fails", async () => {
    const good = await serve({ "/widgets.json": { a: { endpoint: "e" } } });
    const bad = await serve({ "/widgets.json": { __status: 500 } });

    await useBackendsStore.getState().addBackend({ name: "good", baseUrl: good, authLocation: "header", validateWidgets: false });
    await useBackendsStore.getState().addBackend({ name: "bad", baseUrl: bad, authLocation: "header", validateWidgets: false });
    await useBackendsStore.getState().refresh();

    expect(useWidgetRegistryStore.getState().widgets).toHaveLength(1);
    expect(Object.values(useBackendsStore.getState().statuses).sort()).toEqual([
      "offline",
      "online",
    ]);
  });

  it("records each backend's issues from discovery", async () => {
    const url = await serve({ "/widgets.json": { good: { endpoint: "e" }, bad: "not an object" } });
    const id = await useBackendsStore.getState().addBackend({
      name: "b",
      baseUrl: url,
      authLocation: "header",
      validateWidgets: true,
    });
    await useBackendsStore.getState().refresh();

    expect(useBackendsStore.getState().issues[id]).toEqual([
      { id: "bad", reason: "entry is not a JSON object" },
    ]);
  });

  it("does not let an in-flight refresh reinstate a backend removed before it resolves", async () => {
    const url = await serve({ "/widgets.json": { w1: { endpoint: "e" } } });
    const id = await useBackendsStore.getState().addBackend({ name: "Local", baseUrl: url, authLocation: "header", validateWidgets: false });
    await vi.waitFor(() => expect(useWidgetRegistryStore.getState().widgets).toHaveLength(1));

    // addBackend/updateBackend fire `void get().refresh()` without awaiting
    // it, so the backend can be removed before that discovery lands.
    // Reproduce the race directly: start a refresh, then remove the backend
    // before awaiting it -- the same ordering addBackend's fire-and-forget
    // call creates in production.
    const pending = useBackendsStore.getState().refresh();
    await useBackendsStore.getState().removeBackend(id);
    await pending;

    expect(useWidgetRegistryStore.getState().widgets).toEqual([]);
    expect(useBackendsStore.getState().statuses[id]).toBeUndefined();
    expect(useBackendsStore.getState().issues[id]).toBeUndefined();
  });
});

describe("concurrent writes", () => {
  /** Two persisted backends, loaded, with no discovery pending. */
  async function loadTwo(): Promise<void> {
    __seed(
      "backends.json",
      JSON.stringify([
        { id: "b1", name: "One", baseUrl: "http://127.0.0.1:1" },
        { id: "b2", name: "Two", baseUrl: "http://127.0.0.1:1" },
      ]),
    );
    await useBackendsStore.getState().load();
  }

  function savedNames(): string[] {
    const raw = __read("backends.json") ?? "[]";
    return (JSON.parse(raw) as Array<{ name: string }>).map((b) => b.name);
  }

  it("lands both of two overlapping updates, on disk and in memory", async () => {
    await loadTwo();

    // Started together and awaited together, the way two un-awaited UI
    // handlers overlap. Before the chain, both computed their next array
    // from the same stale snapshot and the second write dropped the first.
    const first = useBackendsStore.getState().updateBackend("b1", { name: "Renamed One" });
    const second = useBackendsStore.getState().updateBackend("b2", { name: "Renamed Two" });
    await Promise.all([first, second]);

    expect(savedNames()).toEqual(["Renamed One", "Renamed Two"]);
    expect(useBackendsStore.getState().backends.map((b) => b.name)).toEqual([
      "Renamed One",
      "Renamed Two",
    ]);
  });

  it("still returns each added backend's own id when two adds overlap", async () => {
    const one = useBackendsStore
      .getState()
      .addBackend({ name: "One", baseUrl: "http://127.0.0.1:1", authLocation: "header", validateWidgets: false });
    const two = useBackendsStore
      .getState()
      .addBackend({ name: "Two", baseUrl: "http://127.0.0.1:1", authLocation: "header", validateWidgets: false });
    const [idOne, idTwo] = await Promise.all([one, two]);

    expect(idOne).toMatch(/[0-9a-f-]{36}/);
    expect(idTwo).not.toBe(idOne);
    // Neither add overwrote the other: the fresh-install seed plus both.
    const saved = JSON.parse(__read("backends.json") ?? "[]") as Array<{ id: string }>;
    expect(saved.map((b) => b.id)).toContain(idOne);
    expect(saved.map((b) => b.id)).toContain(idTwo);
  });

  it("does not wedge the chain when a write fails", async () => {
    await loadTwo();
    __failPath("backends.json");

    await expect(useBackendsStore.getState().updateBackend("b1", { name: "Nope" })).rejects.toThrow();

    // memfs has no un-fail short of a reset, and the store's chain outlives
    // one -- which is exactly what this asserts: the next enqueued task still
    // runs after a rejected predecessor.
    __reset();
    __resetJsonStoreForTests();
    await useBackendsStore.getState().updateBackend("b2", { name: "Renamed Two" });

    expect(savedNames()).toEqual(["One", "Renamed Two"]);
  });
});

describe("services", () => {
  it("records the service name discovery found, and forgets it on remove", async () => {
    const url = await serve({ "/widgets.json": {}, "/": { service: "rss-ticker" } });
    const id = await useBackendsStore.getState().addBackend({ name: "Feeds", baseUrl: url, authLocation: "header", validateWidgets: false });
    await vi.waitFor(() => expect(useBackendsStore.getState().services[id]).toBe("rss-ticker"));
    await useBackendsStore.getState().removeBackend(id);
    expect(useBackendsStore.getState().services).not.toHaveProperty(id);
  });
});

describe("Ask for credentials on startup", () => {
  const flagged = (baseUrl: string) => ({ name: "Gateway", baseUrl, headerName: "username", authLocation: "header" as const, validateWidgets: false, askOnStartup: true });

  it("never writes an unremembered value, through any later write", async () => {
    const url = await serve({ "/widgets.json": {} });
    const id = await useBackendsStore.getState().addBackend(flagged(url));
    await useBackendsStore.getState().setCredential(id, "username", "admin@workspace.example", false);
    expect(useBackendsStore.getState().backends[0].headerValue).toBe("admin@workspace.example");
    expect(useBackendsStore.getState().runtimeCredentials).toEqual([id]);
    await useBackendsStore.getState().updateBackend(id, { name: "Renamed" });
    expect(__read("backends.json")).not.toContain("admin@workspace.example");
    expect(JSON.parse(__read("backends.json") ?? "")[0]).toMatchObject({ name: "Renamed", headerName: "username", askOnStartup: true });
  });

  it("Remember me stores the value; unticking it removes the stored value again", async () => {
    const url = await serve({ "/widgets.json": {} });
    const id = await useBackendsStore.getState().addBackend(flagged(url));
    await useBackendsStore.getState().setCredential(id, "username", "admin@workspace.example", true);
    expect(JSON.parse(__read("backends.json") ?? "")[0].headerValue).toBe("admin@workspace.example");
    await useBackendsStore.getState().setCredential(id, "username", "admin@workspace.example", false);
    expect(__read("backends.json")).not.toContain("admin@workspace.example");
  });

  it("refresh() leaves a flagged backend without a value waiting; refresh([id]) discovers it", async () => {
    const url = await serve({ "/widgets.json": {} });
    useBackendsStore.setState({ backends: [{ id: "g", ...flagged(url) }], statuses: { g: "unknown" } });
    await useBackendsStore.getState().refresh();
    expect(useBackendsStore.getState().statuses.g).toBe("unknown");
    await useBackendsStore.getState().refresh(["g"]);
    expect(useBackendsStore.getState().statuses.g).toBe("online");
  });

  it("discovers a backend added flagged at once, without waiting for a relaunch", async () => {
    const url = await serve({ "/widgets.json": {} });
    const id = await useBackendsStore.getState().addBackend(flagged(url));
    await vi.waitFor(() => expect(useBackendsStore.getState().statuses[id]).toBe("online"));
  });

  it("editing a flagged backend's Key keeps its in-memory value", async () => {
    const url = await serve({ "/widgets.json": {} });
    const id = await useBackendsStore.getState().addBackend(flagged(url));
    await useBackendsStore.getState().setCredential(id, "username", "admin@workspace.example", false);
    await useBackendsStore.getState().updateBackend(id, { askOnStartup: true, headerName: "user", headerValue: undefined });
    expect(useBackendsStore.getState().backends[0]).toMatchObject({ headerName: "user", headerValue: "admin@workspace.example" });
    expect(useBackendsStore.getState().runtimeCredentials).toEqual([id]);
    expect(__read("backends.json")).not.toContain("admin@workspace.example");
  });

  it("ticking Ask for credentials on startup keeps the value in memory for this run", async () => {
    const url = await serve({ "/widgets.json": {} });
    const id = await useBackendsStore.getState().addBackend({ name: "Gateway", baseUrl: url, headerName: "K", headerValue: "V", authLocation: "header", validateWidgets: false });
    await useBackendsStore.getState().updateBackend(id, { askOnStartup: true, headerName: "K", headerValue: undefined });
    expect(useBackendsStore.getState().backends[0].headerValue).toBe("V");
    expect(JSON.parse(__read("backends.json") ?? "")[0]).not.toHaveProperty("headerValue");
    // Unticking makes what the form saved the stored value again.
    await useBackendsStore.getState().updateBackend(id, { askOnStartup: undefined, headerName: "K", headerValue: "V" });
    expect(JSON.parse(__read("backends.json") ?? "")[0].headerValue).toBe("V");
    expect(useBackendsStore.getState().runtimeCredentials).toEqual([]);
  });
});
