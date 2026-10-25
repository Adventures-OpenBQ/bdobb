// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// plugin-http's fetch is a drop-in for the platform fetch; the real one here
// exercises the mock server over genuine HTTP, as useWidgetData.test.tsx does.
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));

import { __reset } from "../test/memfs";
import { __resetLoggerForTests } from "../lib/logger";
import { paramsKey } from "../lib/params";
import { startMockServer, type MockServer } from "../test/mockServer";
import type { BackendConfig, ParamOption, WidgetDef } from "../lib/types";
import { backend, widget as makeWidget } from "../test/fixtures";
import { __resetParamOptionsCacheForTests, useParamOptions } from "./useParamOptions";

const CHAMBERS: ParamOption[] = [
  { label: "House", value: "house" },
  { label: "Senate", value: "senate" },
];
const HOUSE: ParamOption[] = [{ label: "Ways and Means", value: "wm" }];
const SENATE: ParamOption[] = [{ label: "Finance", value: "fin" }];

/**
 * One path answering per query string — that is the whole point of the
 * cascade. A switch, not a lookup object: an index lookup would also answer
 * for inherited Object.prototype keys.
 */
function committeesFor(url: URL): ParamOption[] {
  switch (url.searchParams.get("chamber")) {
    case "house":
      return HOUSE;
    case "senate":
      return SENATE;
    default:
      return [];
  }
}

const widget: WidgetDef = makeWidget({
  id: "congress",
  name: "Congress",
  category: "",
  endpoint: "congress",
  params: [
    { paramName: "chamber", label: "Chamber", type: "endpoint", optionsEndpoint: "chambers" },
    {
      paramName: "committee",
      label: "Committee",
      type: "endpoint",
      optionsEndpoint: "committees",
      optionsParams: { chamber: "$chamber" },
    },
    // No optionsEndpoint: gets no entry at all, and nothing is fetched for it.
    { paramName: "symbol", label: "Symbol", type: "text" },
  ],
});

const servers: MockServer[] = [];

async function serve(over: Record<string, unknown> = {}) {
  const s = await startMockServer({
    "/chambers": CHAMBERS,
    "/committees": (url: URL) => committeesFor(url),
    ...over,
  });
  servers.push(s);
  return s;
}

function backendFor(server: MockServer): BackendConfig {
  return backend({ baseUrl: server.url });
}

/**
 * The string every state carries, and the one the module cache is keyed by.
 * Spelled out from the same paramsKey the hook uses rather than matched
 * loosely: which key a list belongs to is what the strip's cascade turns on.
 * The backend contributes its id AND its base URL, never its credential.
 */
const key = (
  backend: BackendConfig | undefined,
  endpoint: string,
  params: Record<string, string> = {},
) => `${backend ? `${backend.id}\n${backend.baseUrl}` : ""}|${endpoint}?${paramsKey(params)}`;

const houseKey = (b: BackendConfig) => key(b, "committees", { chamber: "house" });
const senateKey = (b: BackendConfig) => key(b, "committees", { chamber: "senate" });

const searches = (server: MockServer, path: string) =>
  server.requests.filter((r) => r.path === path).map((r) => r.search);

/** Long enough for a request that must NOT happen to have happened. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetParamOptionsCacheForTests();
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe("useParamOptions", () => {
  it("issues one request per endpoint param on mount, and none for a param without one", async () => {
    const server = await serve();
    const { result } = renderHook(() =>
      useParamOptions(backendFor(server), widget, { chamber: "house" }),
    );

    await waitFor(() => expect(result.current.committee?.status).toBe("ready"));
    const b = backendFor(server);
    expect(result.current.chamber).toEqual({
      status: "ready",
      options: CHAMBERS,
      key: key(b, "chambers"),
    });
    expect(result.current.committee).toEqual({
      status: "ready",
      options: HOUSE,
      key: houseKey(b),
    });
    expect(result.current.symbol).toBeUndefined();

    expect(searches(server, "/chambers")).toEqual([""]);
    expect(searches(server, "/committees")).toEqual(["?chamber=house"]);
  });

  it("omits an unresolved template entry from the request rather than sending it empty", async () => {
    const server = await serve();
    const { result } = renderHook(() => useParamOptions(backendFor(server), widget, {}));

    await waitFor(() => expect(result.current.committee?.status).toBe("ready"));
    // Not "?chamber=" — the backend answers that with a 422, not a list.
    expect(searches(server, "/committees")).toEqual([""]);
  });

  it("serves a second hook with the same key from the module cache, synchronously and with no second request", async () => {
    const server = await serve();
    const b = backendFor(server);

    const first = renderHook(() => useParamOptions(b, widget, { chamber: "house" }));
    await waitFor(() => expect(first.result.current.committee?.status).toBe("ready"));
    const before = server.requests.length;

    const second = renderHook(() => useParamOptions(b, widget, { chamber: "house" }));
    // A cache hit is committed with the first state, so there is no loading
    // flash for a second card to wait through.
    expect(second.result.current.committee).toEqual({
      status: "ready",
      options: HOUSE,
      key: houseKey(b),
    });

    await settle();
    expect(server.requests).toHaveLength(before);
  });

  it("issues one request, not two, when two hooks mount on the same key at once", async () => {
    const server = await serve();
    const b = backendFor(server);

    const a = renderHook(() => useParamOptions(b, widget, { chamber: "house" }));
    const c = renderHook(() => useParamOptions(b, widget, { chamber: "house" }));

    await waitFor(() => expect(a.result.current.committee?.status).toBe("ready"));
    await waitFor(() => expect(c.result.current.committee?.status).toBe("ready"));
    expect(searches(server, "/committees")).toEqual(["?chamber=house"]);
  });

  it("refetches when a referenced value changes, and the shown list follows the new key", async () => {
    const server = await serve();
    const b = backendFor(server);

    const { result, rerender } = renderHook(
      ({ values }: { values: Record<string, string> }) => useParamOptions(b, widget, values),
      { initialProps: { values: { chamber: "house" } } },
    );
    await waitFor(() =>
      expect(result.current.committee).toEqual({
        status: "ready",
        options: HOUSE,
        key: houseKey(b),
      }),
    );

    rerender({ values: { chamber: "senate" } });

    await waitFor(() =>
      expect(result.current.committee).toEqual({
        status: "ready",
        options: SENATE,
        key: senateKey(b),
      }),
    );
    expect(searches(server, "/committees")).toEqual(["?chamber=house", "?chamber=senate"]);
    // chamber's own key never moved, so it was never refetched.
    expect(searches(server, "/chambers")).toEqual([""]);
  });

  it("does not refetch when values is a new object with the same content, or an unrelated param changes", async () => {
    const server = await serve();
    const b = backendFor(server);

    const { result, rerender } = renderHook(
      ({ values }: { values: Record<string, string> }) => useParamOptions(b, widget, values),
      // Widened: a later rerender below adds a key, which an inferred
      // `{ chamber: string }` props type would reject.
      { initialProps: { values: { chamber: "house" } as Record<string, string> } },
    );
    await waitFor(() => expect(result.current.committee?.status).toBe("ready"));

    rerender({ values: { chamber: "house" } });
    rerender({ values: { chamber: "house", symbol: "AAPL" } });

    await settle();
    expect(searches(server, "/committees")).toEqual(["?chamber=house"]);
  });

  it("drops a response whose key the param has already moved past", async () => {
    const server = await serve();
    const b = backendFor(server);

    // Warm the cache for the senate key so it resolves synchronously below.
    const warm = renderHook(() => useParamOptions(b, widget, { chamber: "senate" }));
    await waitFor(() => expect(warm.result.current.committee?.status).toBe("ready"));
    warm.unmount();

    // The house key is NOT cached: this request goes to the network and
    // cannot possibly have landed by the synchronous rerender below.
    const { result, rerender } = renderHook(
      ({ values }: { values: Record<string, string> }) => useParamOptions(b, widget, values),
      { initialProps: { values: { chamber: "house" } } },
    );
    rerender({ values: { chamber: "senate" } });
    expect(result.current.committee).toEqual({
      status: "ready",
      options: SENATE,
      key: senateKey(b),
    });

    // The house response now arrives for a key this param no longer shows.
    // Without the drop guard it would overwrite the senate list.
    //
    // Waited for rather than slept on: measured here, a second request over a
    // fresh connection lands 100-300ms after it is issued, so a fixed delay
    // races it (1 in 3 runs saw only the senate request). This asserts the
    // same two requests, then still sleeps a full settle afterwards so a
    // response that DID get through would have overwritten the list below.
    await waitFor(() =>
      expect(searches(server, "/committees")).toEqual(["?chamber=senate", "?chamber=house"]),
    );
    await settle();
    expect(result.current.committee).toEqual({
      status: "ready",
      options: SENATE,
      key: senateKey(b),
    });
  });

  it("reports every endpoint param as an error when there is no backend", () => {
    const { result } = renderHook(() => useParamOptions(undefined, widget, { chamber: "house" }));

    // No backend, so the key names no backend either — but it is still the
    // key this state belongs to.
    expect(result.current.chamber).toEqual({
      status: "error",
      error: "Backend not configured",
      key: key(undefined, "chambers"),
    });
    expect(result.current.committee).toEqual({
      status: "error",
      error: "Backend not configured",
      key: key(undefined, "committees", { chamber: "house" }),
    });
    expect(result.current.symbol).toBeUndefined();
  });

  it("reports a failed fetch as an error state carrying the backend's message", async () => {
    const server = await serve({
      "/chambers": { __status: 500, __body: { detail: "choices unavailable" } },
    });
    const { result } = renderHook(() =>
      useParamOptions(backendFor(server), widget, { chamber: "house" }),
    );

    await waitFor(() =>
      expect(result.current.chamber).toEqual({
        status: "error",
        error: "HTTP 500: choices unavailable",
        key: key(backendFor(server), "chambers"),
      }),
    );
    // One param failing leaves the others alone.
    expect(result.current.committee).toEqual({
      status: "ready",
      options: HOUSE,
      key: houseKey(backendFor(server)),
    });
  });

  it("keeps the previous list visible while a cascade refetch is in flight", async () => {
    const server = await serve();
    const b = backendFor(server);

    const { result, rerender } = renderHook(
      ({ values }: { values: Record<string, string> }) => useParamOptions(b, widget, values),
      { initialProps: { values: { chamber: "house" } } },
    );
    await waitFor(() => expect(result.current.committee?.status).toBe("ready"));

    rerender({ values: { chamber: "senate" } });

    // The moment after the key moves, the state is loading — but it still
    // carries the old list, so the control does not blank out.
    // Carrying the OLD list under the NEW key: that pairing is what tells a
    // consumer the list on screen is not the one its key asks for.
    expect(result.current.committee).toEqual({
      status: "loading",
      options: HOUSE,
      key: senateKey(b),
    });
    await waitFor(() => expect(result.current.committee?.status).toBe("ready"));
  });

  it("scopes the cache to the backend, so two backends answering the same endpoint never share a list", async () => {
    const ONE: ParamOption[] = [{ label: "One", value: "1" }];
    const TWO: ParamOption[] = [{ label: "Two", value: "2" }];
    const s1 = await serve({ "/chambers": ONE });
    const s2 = await serve({ "/chambers": TWO });
    // Same endpoint NAME on both, which is the collision: only the backend
    // the request is addressed to distinguishes the two answers.
    const b1: BackendConfig = { ...backendFor(s1), id: "one" };
    const b2: BackendConfig = { ...backendFor(s2), id: "two" };

    const first = renderHook(() => useParamOptions(b1, widget, { chamber: "house" }));
    await waitFor(() => expect(first.result.current.committee?.status).toBe("ready"));
    expect(first.result.current.chamber).toEqual({
      status: "ready",
      options: ONE,
      key: key(b1, "chambers"),
    });

    const second = renderHook(() => useParamOptions(b2, widget, { chamber: "house" }));
    await waitFor(() => expect(second.result.current.committee?.status).toBe("ready"));
    expect(second.result.current.chamber).toEqual({
      status: "ready",
      options: TWO,
      key: key(b2, "chambers"),
    });
    // The first hook's list is untouched by the second backend's answer.
    expect(first.result.current.chamber).toEqual({
      status: "ready",
      options: ONE,
      key: key(b1, "chambers"),
    });

    // Each backend was asked once, and neither was asked on the other's behalf.
    expect(searches(s1, "/chambers")).toEqual([""]);
    expect(searches(s2, "/chambers")).toEqual([""]);
    expect(searches(s1, "/committees")).toEqual(["?chamber=house"]);
    expect(searches(s2, "/committees")).toEqual(["?chamber=house"]);
  });

  it("issues nothing at all for a widget with no endpoint params", async () => {
    const server = await serve();
    const plain: WidgetDef = { ...widget, params: [{ paramName: "symbol", type: "text" }] };

    const { result } = renderHook(() => useParamOptions(backendFor(server), plain, {}));

    await settle();
    expect(result.current).toEqual({});
    expect(server.requests).toHaveLength(0);
  });
});
