// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __read, __reset, __seed, __writes } from "../test/memfs";
import { __resetLoggerForTests } from "./logger";
import { __resetJsonStoreForTests } from "./jsonStore";
import { loadBackends, makeDefaultBackend, saveBackends } from "./backendsFile";

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
});

const valid = [
  {
    id: "a",
    name: "Local",
    baseUrl: "http://localhost:6900",
    authLocation: "header" as const,
    validateWidgets: false,
  },
];

describe("loadBackends", () => {
  it("seeds one default backend pointing at the local openbb-docker stack when absent", async () => {
    const loaded = await loadBackends();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("Local");
    expect(loaded[0].baseUrl).toBe("http://localhost:6900");
    expect(loaded[0].headerName).toBeUndefined();
    expect(loaded[0].validateWidgets).toBe(true);
    expect(JSON.parse(__read("backends.json") ?? "")).toEqual(loaded);
  });

  it("does not reseed once backends.json exists, even as an empty array", async () => {
    // The seed-once contract: a user who deletes the seeded backend (leaving
    // the file present as `[]`) must not have it resurrected on next launch.
    __seed("backends.json", JSON.stringify([]));
    expect(await loadBackends()).toEqual([]);
  });

  it("loads a valid list", async () => {
    __seed("backends.json", JSON.stringify(valid));
    expect(await loadBackends()).toEqual(valid);
  });

  it("keeps Ask for credentials on startup, and quarantines a non-boolean one", async () => {
    const flagged = [{ ...valid[0], headerName: "username", askOnStartup: true }];
    __seed("backends.json", JSON.stringify(flagged));
    expect(await loadBackends()).toEqual(flagged);
    __seed("backends.json", JSON.stringify([{ ...valid[0], askOnStartup: "yes" }]));
    await loadBackends();
    expect(__read("backends.json.corrupt")).not.toBeUndefined();
  });

  it("accepts an optional auth header pair", async () => {
    const withAuth = [{ ...valid[0], headerName: "X-Key", headerValue: "secret" }];
    __seed("backends.json", JSON.stringify(withAuth));
    expect(await loadBackends()).toEqual(withAuth);
  });

  it.each([
    ["a null entry", [null]],
    ["an empty entry", [{}]],
    ["an entry missing name and baseUrl", [{ id: "nas" }]],
    ["a non-string baseUrl", [{ id: "a", name: "n", baseUrl: 7 }]],
    ["a non-string headerValue", [{ ...valid[0], headerName: "X", headerValue: 7 }]],
    ["a non-boolean validateWidgets", [{ ...valid[0], validateWidgets: "yes" }]],
    ["a non-array container", { id: "a" }],
  ])("quarantines the whole file for %s", async (_label, content) => {
    __seed("backends.json", JSON.stringify(content));
    // Quarantine renames the bad file away, so the path is ABSENT again —
    // same contract as any other absent file, so this reseeds the default
    // backend rather than resurrecting an empty list.
    const loaded = await loadBackends();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("Local");
    expect(__read("backends.json.corrupt")).toBe(JSON.stringify(content));
  });
});

describe("saveBackends", () => {
  it("round-trips", async () => {
    await saveBackends(valid);
    expect(JSON.parse(__read("backends.json") ?? "")).toEqual(valid);
  });
});

describe("reading a backends.json written before the new fields existed", () => {
  it("defaults authLocation to header", async () => {
    __seed(
      "backends.json",
      JSON.stringify([{ id: "b1", name: "Old", baseUrl: "http://a", headerName: "K", headerValue: "V" }]),
    );
    const [backend] = await loadBackends();
    expect(backend.authLocation).toBe("header");
    expect(backend.headerName).toBe("K");
  });

  // v3.0.0 to this release stored a per-backend code-language allowance; the
  // backend's server now decides which languages run. An old file still
  // loads -- even with a malformed list -- and the field is gone on write.
  it("loads a backend that still carries allowedCodeLanguages and drops the field on the next write", async () => {
    __seed(
      "backends.json",
      JSON.stringify([
        { id: "b1", name: "Old", baseUrl: "http://a", allowedCodeLanguages: ["sql"] },
        { id: "b2", name: "Odd", baseUrl: "http://b", allowedCodeLanguages: "sql" },
      ]),
    );
    const loaded = await loadBackends();
    expect(loaded.map((b) => b.id)).toEqual(["b1", "b2"]);
    for (const b of loaded) expect(b).not.toHaveProperty("allowedCodeLanguages");
    await saveBackends(loaded);
    expect(__read("backends.json")).not.toContain("allowedCodeLanguages");
  });

  it("seeds no code-language allowance on any build", () => {
    vi.stubEnv("VITE_DEFAULT_BACKEND_URL", "https://reference.workspace.example");
    expect(makeDefaultBackend()).not.toHaveProperty("allowedCodeLanguages");
    vi.unstubAllEnvs();
    expect(makeDefaultBackend()).not.toHaveProperty("allowedCodeLanguages");
  });

  it("defaults validateWidgets to true", async () => {
    __seed("backends.json", JSON.stringify([{ id: "b1", name: "Old", baseUrl: "http://a" }]));
    const [backend] = await loadBackends();
    expect(backend.validateWidgets).toBe(true);
  });

  it("keeps a stored value rather than overwriting it with the default", async () => {
    __seed(
      "backends.json",
      JSON.stringify([
        { id: "b1", name: "New", baseUrl: "http://a", authLocation: "query", validateWidgets: true },
      ]),
    );
    const [backend] = await loadBackends();
    expect(backend.authLocation).toBe("query");
    expect(backend.validateWidgets).toBe(true);
  });

  it("coerces an unrecognized authLocation to header without quarantining the file or its siblings", async () => {
    const original = JSON.stringify([
      { id: "b1", name: "Bad", baseUrl: "http://a", authLocation: "banner" },
      {
        id: "b2",
        name: "Good",
        baseUrl: "http://b",
        authLocation: "query",
        headerName: "X-Key",
        headerValue: "secret",
      },
    ]);
    __seed("backends.json", original);

    const backends = await loadBackends();

    expect(backends).toHaveLength(2);
    const [bad, good] = backends;
    expect(bad.name).toBe("Bad");
    expect(bad.authLocation).toBe("header");
    expect(good.name).toBe("Good");
    expect(good.authLocation).toBe("query");
    expect(good.headerName).toBe("X-Key");
    expect(good.headerValue).toBe("secret");
    // Coercion happens only in memory on read (withDefaults); the file on
    // disk is untouched — no quarantine, no rewrite.
    expect(__writes()).toEqual([]);
    expect(__read("backends.json")).toBe(original);
    expect(__read("backends.json.corrupt")).toBeUndefined();
  });

  it("does not write backends.json merely by loading an old-shape file", async () => {
    // withDefaults fills in authLocation/validateWidgets in memory on every
    // read; loadBackends must not persist that back to disk. If it did, this
    // would be the only test to notice.
    const oldShape = JSON.stringify([
      { id: "b1", name: "Old", baseUrl: "http://a", headerName: "K", headerValue: "V" },
    ]);
    __seed("backends.json", oldShape);
    await loadBackends();
    expect(__writes()).toEqual([]);
    expect(__read("backends.json")).toBe(oldShape);
  });
});

describe("makeDefaultBackend", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to the local openbb-docker stack with no credential", () => {
    const b = makeDefaultBackend();
    expect(b.baseUrl).toBe("http://localhost:6900");
    expect(b.name).toBe("Local");
    // Not merely empty -- absent. An empty headerValue would put a bare
    // `Authorization:` on every request.
    expect("headerName" in b).toBe(false);
    expect("headerValue" in b).toBe(false);
  });

  it("takes the build's seed when one is supplied", () => {
    vi.stubEnv("VITE_DEFAULT_BACKEND_URL", "https://demo.example.ts.net");
    vi.stubEnv("VITE_DEFAULT_BACKEND_AUTH", "Basic cmV2aWV3ZXI6cHc=");
    const b = makeDefaultBackend();
    expect(b.baseUrl).toBe("https://demo.example.ts.net");
    expect(b.name).toBe("Reference");
    expect(b.headerName).toBe("Authorization");
    expect(b.headerValue).toBe("Basic cmV2aWV3ZXI6cHc=");
  });

  it("seeds a URL without auth when the build gives no credential", () => {
    vi.stubEnv("VITE_DEFAULT_BACKEND_URL", "https://demo.example.ts.net");
    const b = makeDefaultBackend();
    expect(b.baseUrl).toBe("https://demo.example.ts.net");
    expect("headerValue" in b).toBe(false);
  });
});
