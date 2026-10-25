// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// plugin-http's fetch is a drop-in for the platform fetch; in tests we use
// the real one so the mock server is exercised over genuine HTTP. Wrapped in
// vi.fn so a single test can override it (mockRejectedValueOnce) to produce
// the runtime's actual reqwest-shaped error message, then fall straight back
// to delegating to the real fetch for every other test.
// globalThis.fetch here is Node's native fetch, not something this file
// provides — it leaks through because this test file runs on the project's
// default jsdom environment (nothing here overrides it per file), and jsdom
// does not shadow Node's fetch global. Note that spelling vitest's per-file
// environment directive out in a comment — even a prose one like this — is
// itself enough to switch the whole file to that environment: vitest scans
// the source for the bare directive, not for a docblock, so it must not be
// written here.
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn((...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args)),
}));

import { fetch as pluginFetch } from "@tauri-apps/plugin-http";
import { startMockServer, type MockServer } from "../test/mockServer";
import { useSettingsStore } from "../stores/settingsStore";
import { DEFAULT_SETTINGS } from "./settingsFile";
import type { AuthLocation, BackendConfig, WidgetDef } from "./types";
import { backend as makeBackend, widget as makeWidget } from "../test/fixtures";
import { stubMatchMedia } from "../test/matchMedia";
import {
  authHeaders,
  buildWidgetUrl,
  buildWidgetWsUrl,
  describeHttpError,
  extractData,
  fetchEndpoint,
  fetchParamOptions,
  fetchWidgetData,
  obbjectWarnings,
  fetchAppsJson,
  DOCUMENT_MAX_BYTES,
  fetchDocumentBytes,
  fetchWidgetDocuments,
  fetchWidgetsJson,
  HttpError,
  postForm,
  putProviderKey,
  putSettings,
  testProviderKey,
} from "./dataClient";

const backend: BackendConfig = makeBackend({ baseUrl: "http://host:6900" });

const widget = (over: Partial<WidgetDef> = {}): WidgetDef =>
  makeWidget({ category: "C", endpoint: "equity/price", ...over });

beforeEach(() => {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
});

// The comment at the top of this file once named vitest's per-file
// environment directive, which silently ran the whole file under node. This
// is the assertion that keeps it on the configured jsdom environment.
it("runs on the configured jsdom environment", () => {
  expect(typeof window).toBe("object");
  expect(window.document.createElement("div")).toBeInstanceOf(window.HTMLElement);
});

describe("buildWidgetUrl", () => {
  it("joins the base URL and the endpoint", () => {
    expect(buildWidgetUrl(backend, widget(), {})).toBe("http://host:6900/equity/price");
  });

  it("tolerates a trailing slash on the base and a leading slash on the endpoint", () => {
    const b = { ...backend, baseUrl: "http://host:6900/" };
    expect(buildWidgetUrl(b, widget({ endpoint: "/equity/price" }), {})).toBe(
      "http://host:6900/equity/price",
    );
  });

  it("keeps a hostile endpoint on the backend's own origin", () => {
    // widgets.json is untrusted remote JSON, so an `endpoint` is attacker-
    // controlled. It is concatenated, never resolved as a URL against the
    // base -- an absolute or protocol-relative one must not steer the
    // request, and must not carry the backend's credential off-site with it.
    // The conformance suite asserts this property against the live backend,
    // which publishes only relative endpoints; this is where it has teeth.
    for (const endpoint of ["https://evil.example/x", "//evil.example/x"]) {
      const url = new URL(buildWidgetUrl(backend, widget({ endpoint }), {}));
      expect(url.origin).toBe("http://host:6900");
    }
  });

  it("appends parameters as a query string", () => {
    const url = new URL(buildWidgetUrl(backend, widget(), { symbol: "AAPL", limit: "5" }));
    expect(url.searchParams.get("symbol")).toBe("AAPL");
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("omits empty parameter values", () => {
    const url = new URL(buildWidgetUrl(backend, widget(), { symbol: "" }));
    expect(url.searchParams.has("symbol")).toBe(false);
  });

  it("sends a date_range as two query params, labelled under the given year end", () => {
    const w = widget({
      endpoint: "periods",
      params: [
        { paramName: "start_date", type: "date_range", rangeEnd: "end_date" },
        { paramName: "quarter", type: "quarter" },
      ],
    });
    const url = new URL(
      buildWidgetUrl(
        backend,
        w,
        { start_date: "2026-01-01/2026-03-31", quarter: "T" },
        { now: new Date(2026, 8, 14), fiscalYearEnd: { quarter: 9 } },
      ),
    );
    expect(url.searchParams.get("start_date")).toBe("2026-01-01");
    expect(url.searchParams.get("end_date")).toBe("2026-03-31");
    expect(url.searchParams.get("quarter")).toBe("2026-Q4");
  });

  it("appends theme=dark for chart widgets", () => {
    const url = new URL(buildWidgetUrl(backend, widget({ type: "chart" }), {}));
    expect(url.searchParams.get("theme")).toBe("dark");
  });

  it("appends theme=dark for html widgets", () => {
    const url = new URL(buildWidgetUrl(backend, widget({ type: "html" }), {}));
    expect(url.searchParams.get("theme")).toBe("dark");
  });

  it("appends the current theme setting, not a hardcoded value", () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, theme: "light" },
    });
    const url = buildWidgetUrl(backend, widget({ type: "chart" }), {});
    expect(new URL(url).searchParams.get("theme")).toBe("light");
  });

  it("resolves theme: system at request time, so the backend never sees \"system\"", () => {
    const media = stubMatchMedia(false);
    try {
      useSettingsStore.setState({
        settings: { ...useSettingsStore.getState().settings, theme: "system" },
      });
      expect(
        new URL(buildWidgetUrl(backend, widget({ type: "chart" }), {})).searchParams.get("theme"),
      ).toBe("light");

      // Read at call time, not captured once: a request made after the OS
      // flipped carries the new theme with nothing having re-rendered.
      media.set(true);
      expect(
        new URL(buildWidgetUrl(backend, widget({ type: "chart" }), {})).searchParams.get("theme"),
      ).toBe("dark");
    } finally {
      media.restore();
    }
  });

  it.each(["table", "iframe", "metric", "markdown"])(
    "does not append theme for %s widgets",
    (type) => {
      const url = new URL(buildWidgetUrl(backend, widget({ type }), {}));
      expect(url.searchParams.has("theme")).toBe(false);
    },
  );
});

describe("buildWidgetUrl token resolution", () => {
  it("resolves $currentDate at request time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 23, 12, 0, 0));
    try {
      const url = buildWidgetUrl(
        makeBackend({ name: "B", validateWidgets: true }),
        makeWidget({ category: "", gridData: { w: 1, h: 1 } }),
        { date: "$currentDate" },
      );
      expect(url).toContain("date=2026-08-23");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("extractData", () => {
  it("returns the payload unchanged when no dataKey is declared", () => {
    expect(extractData([{ a: 1 }], undefined)).toEqual([{ a: 1 }]);
  });

  it("extracts a top-level key", () => {
    expect(extractData({ results: [1, 2] }, "results")).toEqual([1, 2]);
  });

  it("walks a dotted path", () => {
    expect(extractData({ a: { b: [3] } }, "a.b")).toEqual([3]);
  });

  it("returns the whole payload when the dataKey does not resolve", () => {
    const payload = { other: 1 };
    expect(extractData(payload, "results")).toBe(payload);
  });
});

describe("authHeaders", () => {
  it("is empty when no header pair is configured", () => {
    expect(authHeaders(backend)).toEqual({});
  });

  it("attaches the configured pair", () => {
    expect(authHeaders({ ...backend, headerName: "X-Key", headerValue: "s3cret" })).toEqual({
      "X-Key": "s3cret",
    });
  });

  it("ignores a half-configured pair", () => {
    expect(authHeaders({ ...backend, headerName: "X-Key" })).toEqual({});
  });
});

describe("describeHttpError", () => {
  it("appends a string detail", () => {
    expect(describeHttpError(400, JSON.stringify({ detail: "Symbol not found" }))).toBe(
      "HTTP 400: Symbol not found",
    );
  });

  it("flattens FastAPI's validation array, dropping the leading query/body segment", () => {
    const body = JSON.stringify({
      detail: [
        { loc: ["query", "symbol"], msg: "Field required", type: "missing" },
        { loc: ["query", "limit"], msg: "Input should be a valid integer", type: "int_parsing" },
      ],
    });
    expect(describeHttpError(422, body)).toBe(
      "HTTP 422: symbol — Field required; limit — Input should be a valid integer",
    );
  });

  it("keeps plain-string items in a detail array", () => {
    const body = JSON.stringify({
      detail: ["Out of range float values are not JSON compliant: nan"],
    });
    expect(describeHttpError(422, body)).toBe(
      "HTTP 422: Out of range float values are not JSON compliant: nan",
    );
  });

  it("joins a nested loc with dots and tolerates items without msg", () => {
    const body = JSON.stringify({
      detail: [{ loc: ["body", "filters", 0, "op"], msg: "bad op" }, { loc: ["query", "x"] }],
    });
    expect(describeHttpError(422, body)).toBe("HTTP 422: filters.0.op — bad op");
  });

  it("falls back to the bare status for a non-JSON body", () => {
    expect(describeHttpError(500, "Internal Server Error")).toBe("HTTP 500");
  });

  it("falls back to the bare status when there is no usable detail", () => {
    expect(describeHttpError(502, JSON.stringify({ error: "nope" }))).toBe("HTTP 502");
    expect(describeHttpError(502, JSON.stringify({ detail: { nested: true } }))).toBe("HTTP 502");
    expect(describeHttpError(502, JSON.stringify({ detail: [] }))).toBe("HTTP 502");
    expect(describeHttpError(502, "")).toBe("HTTP 502");
  });

  it("truncates to 200 characters with an ellipsis", () => {
    const msg = describeHttpError(500, JSON.stringify({ detail: "x".repeat(500) }));
    expect(msg).toHaveLength(200);
    expect(msg.endsWith("…")).toBe(true);
    expect(msg.startsWith("HTTP 500: xxx")).toBe(true);
  });
});

describe("fetchWidgetData over real HTTP", () => {
  let server: MockServer;
  afterEach(async () => {
    await server?.close();
  });

  it("fetches and extracts by dataKey", async () => {
    server = await startMockServer({ "/equity/price": { results: [{ close: 1 }] } });
    const b = { ...backend, baseUrl: server.url };
    expect(await fetchWidgetData(b, widget({ dataKey: "results" }), {})).toEqual([{ close: 1 }]);
  });

  it("hands a keys-type widget the whole envelope even when it declares a dataKey", async () => {
    // key-maint's widgets.json declares data.dataKey: "rows" on the keys
    // panel; the renderer needs `tier` from the envelope, so unwrapping it
    // would leave it with a bare array and no way to tell tiers apart.
    const envelope = { tier: 2, rows: [{ provider: "FMP", env_var: "FMP_API_KEY", status: "set" }] };
    server = await startMockServer({ "/equity/price": envelope });
    const b = { ...backend, baseUrl: server.url };
    expect(await fetchWidgetData(b, widget({ type: "keys", dataKey: "rows" }), {})).toEqual(envelope);
  });

  it("sends the auth header on every request for that backend", async () => {
    server = await startMockServer({ "/equity/price": { results: [] } });
    const b = { ...backend, baseUrl: server.url, headerName: "X-Key", headerValue: "s3cret" };
    await fetchWidgetData(b, widget({ dataKey: "results" }), {});
    expect(server.requests[0].headers["x-key"]).toBe("s3cret");
  });

  it("throws a message naming the status on a non-2xx response", async () => {
    server = await startMockServer({ "/equity/price": { __status: 503 } });
    const b = { ...backend, baseUrl: server.url };
    await expect(fetchWidgetData(b, widget(), {})).rejects.toThrow("HTTP 503");
  });

  it("fetches widgets.json from the backend root", async () => {
    server = await startMockServer({ "/widgets.json": { w1: { endpoint: "e" } } });
    expect(await fetchWidgetsJson({ ...backend, baseUrl: server.url })).toEqual({
      w1: { endpoint: "e" },
    });
  });

  it("resolves null on 204 No Content instead of failing to parse an empty body", async () => {
    server = await startMockServer({ "/equity/price": { __status: 204 } });
    const b = { ...backend, baseUrl: server.url };
    expect(await fetchWidgetData(b, widget({ dataKey: "results" }), {})).toBeNull();
  });

  // A structured-syntax suffix (RFC 6839) is still JSON: an endpoint that
  // answers application/problem+json or a vendor +json type must reach the
  // renderer parsed, not as a string.
  it("parses a +json content type as JSON", async () => {
    server = await startMockServer({
      "/equity/price": { __status: 200, __contentType: "application/vnd.api+json; charset=utf-8", __body: '[{"a":1}]' },
    });
    const b = { ...backend, baseUrl: server.url };
    expect(await fetchWidgetData(b, widget(), {})).toEqual([{ a: 1 }]);
  });

  it("surfaces the backend's detail on a non-2xx response", async () => {
    server = await startMockServer({
      "/equity/price": {
        __status: 422,
        __body: { detail: [{ loc: ["query", "symbol"], msg: "Field required" }] },
      },
    });
    const b = { ...backend, baseUrl: server.url };
    await expect(fetchWidgetData(b, widget(), {})).rejects.toThrow(
      "HTTP 422: symbol — Field required",
    );
  });

  it("still names only the status when the error body is not JSON", async () => {
    server = await startMockServer({
      "/equity/price": { __status: 500, __body: "<html>boom</html>" },
    });
    const b = { ...backend, baseUrl: server.url };
    await expect(fetchWidgetData(b, widget(), {})).rejects.toThrow(/^HTTP 500$/);
  });

  it("fetchWidgetsJson honors query placement", async () => {
    server = await startMockServer({ "/widgets.json": { w1: { endpoint: "e" } } });
    const b: BackendConfig = {
      ...backend,
      baseUrl: server.url,
      authLocation: "query",
      headerName: "token",
      headerValue: "secret",
    };
    await fetchWidgetsJson(b);
    expect(server.requests[0].search).toContain("token=secret");
  });

  it("fetchWidgetsJson honors cookie placement", async () => {
    server = await startMockServer({ "/widgets.json": { w1: { endpoint: "e" } } });
    const b: BackendConfig = {
      ...backend,
      baseUrl: server.url,
      authLocation: "cookie",
      headerName: "token",
      headerValue: "secret",
    };
    await fetchWidgetsJson(b);
    expect(server.requests[0].headers.cookie).toBe("token=secret");
  });

  it("applies the same error description to widgets.json", async () => {
    server = await startMockServer({
      "/widgets.json": { __status: 401, __body: { detail: "Not authenticated" } },
    });
    await expect(fetchWidgetsJson({ ...backend, baseUrl: server.url })).rejects.toThrow(
      "HTTP 401: Not authenticated",
    );
  });
});

describe("fetchAppsJson", () => {
  const app = { name: "Macro", tabs: {} };
  let server: MockServer;
  afterEach(async () => {
    await server?.close();
  });

  it("fetches apps.json from the backend root", async () => {
    server = await startMockServer({ "/apps.json": [app] });
    expect((await fetchAppsJson({ ...backend, baseUrl: server.url })).raw).toEqual([app]);
    expect(server.requests[0].path).toBe("/apps.json");
  });

  it("honors header placement", async () => {
    server = await startMockServer({ "/apps.json": [app] });
    const b: BackendConfig = { ...backend, baseUrl: server.url, headerName: "X-Key", headerValue: "secret" };
    await fetchAppsJson(b);
    expect(server.requests[0].headers["x-key"]).toBe("secret");
    expect(server.requests[0].search).toBe("");
  });

  it("honors query placement", async () => {
    server = await startMockServer({ "/apps.json": [app] });
    const b: BackendConfig = {
      ...backend,
      baseUrl: server.url,
      authLocation: "query",
      headerName: "token",
      headerValue: "secret",
    };
    await fetchAppsJson(b);
    expect(server.requests[0].search).toContain("token=secret");
  });

  it("honors cookie placement", async () => {
    server = await startMockServer({ "/apps.json": [app] });
    const b: BackendConfig = {
      ...backend,
      baseUrl: server.url,
      authLocation: "cookie",
      headerName: "token",
      headerValue: "secret",
    };
    await fetchAppsJson(b);
    expect(server.requests[0].headers.cookie).toBe("token=secret");
  });

  // A backend that serves no apps.json at all is the common case, not a
  // failure: it answers 404 and this resolves to null so discovery can call
  // it "no apps" without an error.
  it("resolves null when the backend serves no apps.json", async () => {
    server = await startMockServer({ "/widgets.json": { w1: { endpoint: "e" } } });
    expect((await fetchAppsJson({ ...backend, baseUrl: server.url })).raw).toBeNull();
  });

  // The size the ceiling is applied to, taken from the response rather than
  // re-derived by serializing the parsed document (appsJson.parseAppsJson).
  it("reports the size the backend declared for the document", async () => {
    server = await startMockServer({ "/apps.json": [app] });
    const { bytes } = await fetchAppsJson({ ...backend, baseUrl: server.url });
    expect(bytes).toBe(JSON.stringify([app]).length);
  });

  // A proxy that re-chunks a response strips its content-length, and then
  // there is no declared size at all. The document is still fine; the ceiling
  // simply falls back to measuring it (appsJson.parseAppsJson).
  it("reports no size when the response declares no Content-Length", async () => {
    server = await startMockServer({
      "/apps.json": { __status: 200, __body: JSON.stringify([app]), __headers: { "content-length": null } },
    });
    const { raw, bytes } = await fetchAppsJson({ ...backend, baseUrl: server.url });
    expect(bytes).toBeUndefined();
    expect(raw).toEqual([app]);
  });

  // The other half of the guard: a header that is present but not a number.
  // This one cannot come off the mock server — content-length IS the
  // response's framing, so undici rejects such a response before any of this
  // code sees it ("Invalid character in Content-Length"). Overriding the
  // plugin's fetch for one call is how the Response reaches `request()` at
  // all, which is what the vi.mock at the top of this file exists for.
  it("reports no size when the response's Content-Length is not a number", async () => {
    vi.mocked(pluginFetch).mockResolvedValueOnce(
      new Response(JSON.stringify([app]), {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "abc" },
      }),
    );
    const { raw, bytes } = await fetchAppsJson({ ...backend, baseUrl: "http://host:6900" });
    expect(bytes).toBeUndefined();
    expect(raw).toEqual([app]);
  });

  it("still throws on any other non-2xx", async () => {
    server = await startMockServer({ "/apps.json": { __status: 500 } });
    await expect(fetchAppsJson({ ...backend, baseUrl: server.url })).rejects.toThrow("HTTP 500");
  });

  // 404 is tolerated for apps.json only; widgets.json is what decides
  // online/offline and must still fail loudly.
  it("does not tolerate a 404 on widgets.json", async () => {
    server = await startMockServer({});
    await expect(fetchWidgetsJson({ ...backend, baseUrl: server.url })).rejects.toThrow("HTTP 404");
  });
});

describe("network-layer failures", () => {
  // A connection-refused error never reaches describeHttpError -- it has no
  // HTTP status. At runtime (tauri-plugin-http wrapping reqwest) that
  // error's message carries the full request URL, credential included when
  // authLocation is "query". A closed port on loopback produces a genuine
  // connection-refused error rather than a mocked-up one.
  it("does not leak a query-placement credential from fetchWidgetData, but still names host and path", async () => {
    const closed = await startMockServer({});
    await closed.close();
    const b: BackendConfig = {
      ...backend,
      baseUrl: closed.url,
      authLocation: "query",
      headerName: "token",
      headerValue: "s3cret-value",
    };

    let message = "";
    try {
      await fetchWidgetData(b, widget(), {});
      throw new Error("expected fetchWidgetData to reject");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).not.toContain("s3cret-value");
    expect(message).toContain(new URL(closed.url).host);
    expect(message).toContain("equity/price");
  });

  it("does not leak a query-placement credential from fetchWidgetsJson, but still names host and path", async () => {
    const closed = await startMockServer({});
    await closed.close();
    const b: BackendConfig = {
      ...backend,
      baseUrl: closed.url,
      authLocation: "query",
      headerName: "token",
      headerValue: "s3cret-value",
    };

    let message = "";
    try {
      await fetchWidgetsJson(b);
      throw new Error("expected fetchWidgetsJson to reject");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).not.toContain("s3cret-value");
    expect(message).toContain(new URL(closed.url).host);
    expect(message).toContain("widgets.json");
  });

  // A baseUrl can carry userinfo; the query was stripped from an error's URL
  // but the user:pass@ ahead of the host went through to the log.
  it("does not leak userinfo from the backend URL into a network error", async () => {
    const b: BackendConfig = { ...backend, baseUrl: "http://alice:s3cret-pass@host:6900" };
    const requestUrl = buildWidgetUrl(b, widget(), {});
    vi.mocked(pluginFetch).mockRejectedValueOnce(
      new Error(`error sending request for url (${requestUrl})`),
    );

    const message = await fetchWidgetData(b, widget(), {}).then(
      () => "resolved",
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );

    expect(message).not.toContain("s3cret-pass");
    expect(message).not.toContain("alice");
    expect(message).toContain("host:6900");
  });

  // A connection-refused error from Node's own fetch is a bare "fetch
  // failed" -- it never embeds a URL, so the two tests above only exercise
  // the append branch of safeNetworkErrorMessage. At runtime,
  // tauri-plugin-http wraps reqwest, whose Display appends
  // " for url (...)" to its error message, query-placement credential and
  // all. This test reproduces that exact shape by overriding the mocked
  // plugin-http fetch for one call, to exercise the redact branch: the
  // `raw.replace(/https?:\/\/\S+/gi, ...)` line that strips the query from
  // a URL already embedded in the underlying error.
  it("redacts a query-placement credential embedded in reqwest's own error message, preserving trailing punctuation", async () => {
    const b: BackendConfig = {
      ...backend,
      authLocation: "query",
      headerName: "token",
      headerValue: "s3cret-value",
    };
    const requestUrl = buildWidgetUrl(b, widget(), {});
    vi.mocked(pluginFetch).mockRejectedValueOnce(
      new Error(`error sending request for url (${requestUrl})`),
    );

    let message = "";
    try {
      await fetchWidgetData(b, widget(), {});
      throw new Error("expected fetchWidgetData to reject");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).not.toContain("s3cret-value");
    expect(message).toContain("host:6900");
    expect(message).toContain("equity/price");
    // The reqwest message wraps the URL in "(...)"; the closing paren is
    // trailing punctuation the URL regex must not swallow along with the
    // stripped query.
    expect(message).toBe("error sending request for url (http://host:6900/equity/price)");
  });
});

const withAuth = (authLocation: AuthLocation): BackendConfig =>
  makeBackend({
    name: "B",
    baseUrl: "http://h:6900",
    headerName: "token",
    headerValue: "secret",
    authLocation,
  });

describe("credential placement", () => {
  it("header placement sends the pair as a header", () => {
    expect(authHeaders(withAuth("header"))).toEqual({ token: "secret" });
  });

  it("query placement sends no header", () => {
    expect(authHeaders(withAuth("query"))).toEqual({});
  });

  it("cookie placement sends a Cookie header", () => {
    expect(authHeaders(withAuth("cookie"))).toEqual({ Cookie: "token=secret" });
  });

  it("cookie placement sends a base64-shaped Basic credential verbatim", () => {
    // Synthetic, not a real credential — short enough to dodge scrub-check's
    // Basic-token heuristic, but exercises every character standard base64
    // relies on (+, /, =) plus the space after "Basic".
    const b = { ...withAuth("cookie"), headerValue: "Basic ab+c/d==" };
    const cookie = authHeaders(b).Cookie;
    expect(cookie).toBe("token=Basic ab+c/d==");
    expect(cookie).not.toContain("%3D");
    expect(cookie).not.toContain("%20");
    expect(cookie).not.toContain("%2B");
  });

  it("the credential overrides a themed widget's theme param when the header name is theme", () => {
    const b = { ...withAuth("query"), headerName: "theme", headerValue: "s3cret" };
    const url = buildWidgetUrl(b, widget({ type: "chart" }), {});
    expect(new URL(url).searchParams.get("theme")).toBe("s3cret");
  });

  it("query placement appends the credential to the url", () => {
    const url = buildWidgetUrl(withAuth("query"), widget(), {});
    expect(new URL(url).searchParams.get("token")).toBe("secret");
  });

  it("a widget param cannot shadow the credential", () => {
    const url = buildWidgetUrl(withAuth("query"), widget(), { token: "forged" });
    expect(new URL(url).searchParams.get("token")).toBe("secret");
  });

  it("adds nothing when the pair is incomplete", () => {
    const partial = { ...withAuth("query"), headerValue: undefined };
    expect(new URL(buildWidgetUrl(partial, widget(), {})).searchParams.get("token")).toBeNull();
  });
});

describe("testProviderKey", () => {
  let server: MockServer;
  afterEach(async () => {
    await server?.close();
  });

  it("GETs {endpoint}/{env_var}/test and returns the parsed body", async () => {
    server = await startMockServer({ "/keys/FMP_API_KEY/test": { result: "ok", detail: "HTTP 200" } });
    const b = { ...backend, baseUrl: server.url };

    const result = await testProviderKey(b, widget({ endpoint: "keys" }), "FMP_API_KEY");

    expect(result).toEqual({ result: "ok", detail: "HTTP 200" });
    expect(server.requests[0].path).toBe("/keys/FMP_API_KEY/test");
    expect(server.requests[0].method).toBe("GET");
  });

  it("attaches the backend's auth header", async () => {
    server = await startMockServer({ "/keys/FMP_API_KEY/test": { result: "ok", detail: "" } });
    const b = { ...backend, baseUrl: server.url, headerName: "X-Key", headerValue: "s3cret" };

    await testProviderKey(b, widget({ endpoint: "keys" }), "FMP_API_KEY");

    expect(server.requests[0].headers["x-key"]).toBe("s3cret");
  });

  it("surfaces the same {detail} error shape as any other GET", async () => {
    server = await startMockServer({
      "/keys/FMP_API_KEY/test": { __status: 403, __body: { detail: "below tier 2" } },
    });
    const b = { ...backend, baseUrl: server.url };

    await expect(testProviderKey(b, widget({ endpoint: "keys" }), "FMP_API_KEY")).rejects.toThrow(
      "HTTP 403: below tier 2",
    );
  });
});

describe("putProviderKey", () => {
  let server: MockServer;
  afterEach(async () => {
    await server?.close();
  });

  it("PUTs {endpoint}/{env_var} with the value in the JSON body, never the URL", async () => {
    server = await startMockServer({
      "/keys/FMP_API_KEY": { status: "set", restart_required: true },
    });
    const b = { ...backend, baseUrl: server.url };

    const result = await putProviderKey(b, widget({ endpoint: "keys" }), "FMP_API_KEY", "sk-SECRET-abc");

    expect(result).toEqual({ status: "set", restart_required: true });
    const req = server.requests[0];
    expect(req.method).toBe("PUT");
    expect(req.path).toBe("/keys/FMP_API_KEY");
    expect(req.search).toBe("");
    expect(req.search).not.toContain("sk-SECRET-abc");
    expect(JSON.parse(req.body)).toEqual({ value: "sk-SECRET-abc" });
  });

  it("attaches the backend's auth header, distinct from the submitted value", async () => {
    server = await startMockServer({ "/keys/FMP_API_KEY": { status: "set", restart_required: true } });
    const b = { ...backend, baseUrl: server.url, headerName: "X-Key", headerValue: "backend-secret" };

    await putProviderKey(b, widget({ endpoint: "keys" }), "FMP_API_KEY", "sk-SECRET-abc");

    expect(server.requests[0].headers["x-key"]).toBe("backend-secret");
  });

  it("never leaks the submitted value into a thrown error message", async () => {
    const closed = await startMockServer({});
    await closed.close();
    const b = { ...backend, baseUrl: closed.url };

    let message = "";
    try {
      await putProviderKey(b, widget({ endpoint: "keys" }), "FMP_API_KEY", "sk-SECRET-abc");
      throw new Error("expected putProviderKey to reject");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).not.toContain("sk-SECRET-abc");
  });

  it("surfaces the same {detail} error shape as any other request", async () => {
    server = await startMockServer({
      "/keys/FMP_API_KEY": { __status: 400, __body: { detail: "value must not be empty" } },
    });
    const b = { ...backend, baseUrl: server.url };

    await expect(
      putProviderKey(b, widget({ endpoint: "keys" }), "FMP_API_KEY", ""),
    ).rejects.toThrow("HTTP 400: value must not be empty");
  });
});

describe("fetchParamOptions over real HTTP", () => {
  let server: MockServer;
  afterEach(async () => {
    await server?.close();
  });

  it("resolves the endpoint against the base URL and sends the request params as a query string", async () => {
    server = await startMockServer({
      "/congress/committees": [{ label: "Ways and Means", value: "wm" }],
    });
    const b = { ...backend, baseUrl: server.url };

    expect(await fetchParamOptions(b, "congress/committees", { chamber: "house" })).toEqual([
      { label: "Ways and Means", value: "wm" },
    ]);
    expect(server.requests[0].path).toBe("/congress/committees");
    expect(server.requests[0].search).toBe("?chamber=house");
  });

  it("tolerates a trailing slash on the base and a leading slash on the endpoint", async () => {
    server = await startMockServer({ "/chambers": [{ label: "House", value: "house" }] });
    const b = { ...backend, baseUrl: `${server.url}/` };

    await fetchParamOptions(b, "/chambers", {});

    expect(server.requests[0].path).toBe("/chambers");
  });

  it("sends the auth header", async () => {
    server = await startMockServer({ "/chambers": [{ label: "House", value: "house" }] });
    const b = { ...backend, baseUrl: server.url, headerName: "X-Key", headerValue: "s3cret" };

    await fetchParamOptions(b, "chambers", {});

    expect(server.requests[0].headers["x-key"]).toBe("s3cret");
  });

  it("places a query credential last, so an options param cannot shadow it", async () => {
    server = await startMockServer({ "/chambers": [{ label: "House", value: "house" }] });
    const b: BackendConfig = {
      ...backend,
      baseUrl: server.url,
      authLocation: "query",
      headerName: "token",
      headerValue: "secret",
    };

    await fetchParamOptions(b, "chambers", { token: "forged" });

    expect(new URL(`http://x${server.requests[0].search}`).searchParams.get("token")).toBe("secret");
  });

  it("stringifies a numeric option value and keeps a label-only option as \"\"", async () => {
    server = await startMockServer({
      "/years": [{ label: "2026", value: 2026 }, { label: "All Years" }],
    });
    const b = { ...backend, baseUrl: server.url };

    expect(await fetchParamOptions(b, "years", {})).toEqual([
      { label: "2026", value: "2026" },
      { label: "All Years", value: "" },
    ]);
  });

  it("returns an empty list for an empty array — a legitimate 'no choices'", async () => {
    server = await startMockServer({ "/chambers": [] });
    const b = { ...backend, baseUrl: server.url };

    expect(await fetchParamOptions(b, "chambers", {})).toEqual([]);
  });

  it("throws with the backend's own detail on a non-2xx response", async () => {
    server = await startMockServer({
      "/committees": {
        __status: 422,
        __body: { detail: [{ loc: ["query", "chamber"], msg: "Field required" }] },
      },
    });
    const b = { ...backend, baseUrl: server.url };

    await expect(fetchParamOptions(b, "committees", {})).rejects.toThrow(
      "HTTP 422: chamber — Field required",
    );
  });

  it("throws when the body is not a list", async () => {
    server = await startMockServer({ "/chambers": { choices: ["house", "senate"] } });
    const b = { ...backend, baseUrl: server.url };

    await expect(fetchParamOptions(b, "chambers", {})).rejects.toThrow(
      "options endpoint returned no list",
    );
  });

  it("does not leak a query-placement credential when the connection fails", async () => {
    const closed = await startMockServer({});
    await closed.close();
    const b: BackendConfig = {
      ...backend,
      baseUrl: closed.url,
      authLocation: "query",
      headerName: "token",
      headerValue: "s3cret-value",
    };

    let message = "";
    try {
      await fetchParamOptions(b, "chambers", {});
      throw new Error("expected fetchParamOptions to reject");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).not.toContain("s3cret-value");
    expect(message).toContain("chambers");
  });
});

describe("fetchEndpoint over real HTTP", () => {
  it("GETs the endpoint with the templated params and the credential, and returns the raw body", async () => {
    const server = await startMockServer({ "/fiscal_year_end": "September" });
    try {
      const b: BackendConfig = { ...backend, baseUrl: server.url, headerName: "X-Key", headerValue: "k" };
      const payload = await fetchEndpoint(b, "fiscal_year_end", { symbol: "AAPL", empty: "" });
      expect(payload).toBe("September");
      const req = server.requests.at(-1)!;
      expect(req.path).toBe("/fiscal_year_end");
      expect(req.search).toBe("?symbol=AAPL");
      expect(req.headers["x-key"]).toBe("k");
    } finally {
      await server.close();
    }
  });
});

describe("fetchWidgetDocuments over real HTTP", () => {
  let server: MockServer;
  afterEach(async () => {
    await server?.close();
  });

  const docWidget = () => widget({ type: "multi_file_viewer", endpoint: "docs" });
  const ONE_DOC = [{ content: "aGk=", data_format: { data_type: "pdf", filename: "a.pdf" } }];

  it("POSTs the selector's URLs as a JSON body, with the other params still on the query string", async () => {
    server = await startMockServer({ "/docs": ONE_DOC });
    const b = { ...backend, baseUrl: server.url };

    const payload = await fetchWidgetDocuments(b, docWidget(), { chamber: "house" }, {
      files: ["https://files.example/a.pdf", "https://files.example/b.pdf"],
    });

    expect(payload).toEqual(ONE_DOC);
    const req = server.requests[0];
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/docs");
    // The document URLs are long and there may be many: the body is the only
    // place they belong, and a query string lands in access logs.
    expect(req.search).toBe("?chamber=house");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(req.body)).toEqual({
      files: ["https://files.example/a.pdf", "https://files.example/b.pdf"],
    });
  });

  it("sends the backend's auth header", async () => {
    server = await startMockServer({ "/docs": ONE_DOC });
    const b = { ...backend, baseUrl: server.url, headerName: "X-Key", headerValue: "s3cret" };

    await fetchWidgetDocuments(b, docWidget(), {}, { files: ["u"] });

    expect(server.requests[0].headers["x-key"]).toBe("s3cret");
  });

  it("places a query credential last, so a widget param cannot shadow it", async () => {
    server = await startMockServer({ "/docs": ONE_DOC });
    const b: BackendConfig = {
      ...backend,
      baseUrl: server.url,
      authLocation: "query",
      headerName: "token",
      headerValue: "secret",
    };

    await fetchWidgetDocuments(b, docWidget(), { token: "forged" }, { files: ["u"] });

    expect(new URL(`http://x${server.requests[0].search}`).searchParams.get("token")).toBe("secret");
  });

  it("surfaces the backend's own detail on a 405, which is what these endpoints answer a GET with", async () => {
    server = await startMockServer({
      "/docs": { __status: 405, __body: { detail: "Method Not Allowed" } },
    });
    const b = { ...backend, baseUrl: server.url };

    await expect(fetchWidgetDocuments(b, docWidget(), {}, { files: ["u"] })).rejects.toThrow(
      "HTTP 405: Method Not Allowed",
    );
  });

  it("resolves null on 204 rather than failing to parse an empty body", async () => {
    server = await startMockServer({ "/docs": { __status: 204 } });
    const b = { ...backend, baseUrl: server.url };

    expect(await fetchWidgetDocuments(b, docWidget(), {}, { files: ["u"] })).toBeNull();
  });

  it("does not leak a query-placement credential when the connection fails, but still names the path", async () => {
    const closed = await startMockServer({});
    await closed.close();
    const b: BackendConfig = {
      ...backend,
      baseUrl: closed.url,
      authLocation: "query",
      headerName: "token",
      headerValue: "s3cret-value",
    };

    let message = "";
    try {
      await fetchWidgetDocuments(b, docWidget(), {}, { files: ["u"] });
      throw new Error("expected fetchWidgetDocuments to reject");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).not.toContain("s3cret-value");
    expect(message).toContain("docs");
  });
});

describe("postForm over real HTTP", () => {
  let server: MockServer;
  afterEach(async () => {
    await server?.close();
  });

  const form = { endpoint: "orders/submit", inputs: [] };

  it("POSTs the values as a JSON body to the FORM's endpoint, with the card's params on the query string", async () => {
    server = await startMockServer({ "/orders/submit": { __status: 200, __body: "" } });
    const b = { ...backend, baseUrl: server.url };

    await postForm(b, form, { symbol: "AAPL", empty: "" }, { qty: 25, side: "buy" });

    const [req] = server.requests;
    expect(req.method).toBe("POST");
    // The form's endpoint, never the widget's.
    expect(req.path).toBe("/orders/submit");
    // An empty param is dropped from the query string, as every GET does.
    expect(req.search).toBe("?symbol=AAPL");
    expect(JSON.parse(req.body)).toEqual({ qty: 25, side: "buy" });
    expect(req.headers["content-type"]).toContain("application/json");
  });

  it("resolves on a 200 whose body is empty -- the contract is the status", async () => {
    // The reference says Workspace checks only that the response was OK, so a
    // form endpoint is free to answer with nothing. Parsing that body would
    // throw and turn a submit that worked into an error line on the card.
    server = await startMockServer({ "/orders/submit": { __status: 200, __body: "" } });
    await expect(
      postForm({ ...backend, baseUrl: server.url }, form, {}, {}),
    ).resolves.toBeUndefined();
  });

  // An unread body holds the connection, as the error branch's own read
  // implies: a status-only caller still reads the 2xx body to its end.
  it("reads a 200 body it does not parse, so the connection is released", async () => {
    const res = new Response("submitted", { status: 200 });
    vi.mocked(pluginFetch).mockResolvedValueOnce(res);
    await postForm(backend, form, {}, {});
    expect(res.bodyUsed).toBe(true);
  });

  it("resolves on a 204", async () => {
    server = await startMockServer({ "/orders/submit": { __status: 204 } });
    await expect(
      postForm({ ...backend, baseUrl: server.url }, form, {}, {}),
    ).resolves.toBeUndefined();
  });

  it("throws the status and the endpoint's own detail on a 422", async () => {
    server = await startMockServer({
      "/orders/submit": {
        __status: 422,
        __body: { detail: [{ loc: ["body", "qty"], msg: "must be positive" }] },
      },
    });
    await expect(
      postForm({ ...backend, baseUrl: server.url }, form, {}, { qty: -1 }),
    ).rejects.toThrow("HTTP 422: qty — must be positive");
  });

  it("sends the credential as a header, and never in the body or the query string", async () => {
    server = await startMockServer({ "/orders/submit": { __status: 200, __body: "" } });
    const b = { ...backend, baseUrl: server.url, headerName: "X-Key", headerValue: "sekrit" };

    await postForm(b, form, { symbol: "AAPL" }, { qty: 1 });

    const [req] = server.requests;
    expect(req.headers["x-key"]).toBe("sekrit");
    expect(req.search).not.toContain("sekrit");
    expect(req.body).not.toContain("sekrit");
  });

  it("places a query-location credential LAST, so a card param cannot shadow it", async () => {
    server = await startMockServer({ "/orders/submit": { __status: 200, __body: "" } });
    const b = {
      ...backend,
      baseUrl: server.url,
      authLocation: "query" as AuthLocation,
      headerName: "token",
      headerValue: "sekrit",
    };

    await postForm(b, form, { token: "forged" }, {});

    expect(new URLSearchParams(server.requests[0].search).get("token")).toBe("sekrit");
  });

  it("wires the URL query through the widget's types when the widget is given", async () => {
    server = await startMockServer({ "/orders/submit": { __status: 200, __body: "" } });
    const b = { ...backend, baseUrl: server.url };
    const w = widget({ params: [{ paramName: "start_date", type: "date_range", rangeEnd: "end_date" }] });
    await postForm(b, form, { start_date: "2026-01-01/2026-03-31" }, { qty: 1 }, { widget: w });
    expect(server.requests[0].search).toBe("?start_date=2026-01-01&end_date=2026-03-31");
  });
});

describe("buildWidgetWsUrl", () => {
  const wsWidget = { ...makeWidget({}), wsEndpoint: "grid_ws" };
  it("turns an http base into a ws URL joined to wsEndpoint", () => {
    expect(buildWidgetWsUrl(makeBackend({ baseUrl: "http://127.0.0.1:7779" }), wsWidget)).toBe(
      "ws://127.0.0.1:7779/grid_ws",
    );
  });
  it("turns an https base into a wss URL", () => {
    expect(buildWidgetWsUrl(makeBackend({ baseUrl: "https://example.com" }), wsWidget)).toBe(
      "wss://example.com/grid_ws",
    );
  });
  it("carries a query-placed credential onto the socket URL", () => {
    const url = buildWidgetWsUrl(
      makeBackend({ baseUrl: "http://h:1/", authLocation: "query", headerName: "key", headerValue: "abc" }),
      wsWidget,
    );
    expect(url).toContain("key=abc");
  });
  it("returns null when the widget has no wsEndpoint", () => {
    expect(buildWidgetWsUrl(makeBackend({ baseUrl: "http://h" }), makeWidget({}))).toBeNull();
  });
});

describe("putSettings", () => {
  let server: MockServer;
  afterEach(async () => {
    await server?.close();
  });
  const settingsWidget = () => widget({ type: "settings", endpoint: "settings" });

  it("PUTs { values } to the widget's endpoint and returns the section it answers with", async () => {
    server = await startMockServer({ "/settings": { version: 1, title: "T", fields: [], notice: "Saved." } });
    const result = await putSettings({ ...backend, baseUrl: server.url }, settingsWidget(), { poll_seconds: 120 });
    expect(result).toEqual({ ok: true, body: { version: 1, title: "T", fields: [], notice: "Saved." } });
    expect(server.requests[0].method).toBe("PUT");
    expect(JSON.parse(server.requests[0].body)).toEqual({ values: { poll_seconds: 120 } });
  });

  it("answers a 422 with its errors map, field by field", async () => {
    server = await startMockServer({
      "/settings": { __status: 422, __body: { errors: { poll_seconds: "At least 10 seconds.", bad: 3 } } },
    });
    const result = await putSettings({ ...backend, baseUrl: server.url }, settingsWidget(), { poll_seconds: 5 });
    expect(result).toEqual({ ok: false, errors: { poll_seconds: "At least 10 seconds." } });
  });

  it("keeps a 422 error whose field id is __proto__", async () => {
    // A string body: an object literal would set the prototype, not an own key.
    server = await startMockServer({ "/settings": { __status: 422, __body: '{"errors":{"__proto__":"x"}}' } });
    const result = await putSettings({ ...backend, baseUrl: server.url }, settingsWidget(), {});
    expect(result.ok).toBe(false);
    expect(Object.hasOwn((result as { errors: object }).errors, "__proto__")).toBe(true);
  });

  it("throws a 422 that carries no errors map (e.g. FastAPI's detail), as any other failure", async () => {
    server = await startMockServer({
      "/settings": { __status: 422, __body: { detail: [{ loc: ["body", "values"], msg: "field required" }] } },
    });
    await expect(putSettings({ ...backend, baseUrl: server.url }, settingsWidget(), {})).rejects.toThrow(
      "HTTP 422: values — field required",
    );
  });

  it("throws an HttpError carrying the status for any other failure", async () => {
    server = await startMockServer({ "/settings": { __status: 500 } });
    const err = await putSettings({ ...backend, baseUrl: server.url }, settingsWidget(), { a: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(500);
    expect(err.message).toBe("HTTP 500");
  });
});

describe("fetchDocumentBytes", () => {
  // A document a backend sends as { url } lives on some other host (the
  // reference backend's is on S3). The bytes feed the same pdf.js viewer a
  // base64 document does.
  it("returns the response body as bytes", async () => {
    vi.mocked(pluginFetch).mockResolvedValueOnce(new Response(new Uint8Array([37, 80, 68, 70])));
    const bytes = await fetchDocumentBytes("https://docs.example.com/a.pdf");
    expect(Array.from(bytes)).toEqual([37, 80, 68, 70]);
  });

  it("sends no backend credentials to the document's host", async () => {
    vi.mocked(pluginFetch).mockResolvedValueOnce(new Response(new Uint8Array([1])));
    await fetchDocumentBytes("https://docs.example.com/a.pdf");
    const init = vi.mocked(pluginFetch).mock.calls.at(-1)?.[1] as RequestInit | undefined;
    expect(init?.headers).toBeUndefined();
  });

  it("passes the caller's abort signal to the request", async () => {
    vi.mocked(pluginFetch).mockResolvedValueOnce(new Response(new Uint8Array([1])));
    const controller = new AbortController();
    await fetchDocumentBytes("https://docs.example.com/a.pdf", controller.signal);
    const init = vi.mocked(pluginFetch).mock.calls.at(-1)?.[1] as RequestInit | undefined;
    expect(init?.signal).toBe(controller.signal);
  });

  // The body used to be read whole, whatever its size, straight into the
  // webview.
  it("refuses a document whose declared size is over the cap, without reading it", async () => {
    const res = new Response(new Uint8Array([1]), { headers: { "content-length": String(DOCUMENT_MAX_BYTES + 1) } });
    vi.mocked(pluginFetch).mockResolvedValueOnce(res);
    await expect(fetchDocumentBytes("https://docs.example.com/a.pdf")).rejects.toThrow(/larger than 50 MB/);
  });

  it("stops reading a document that streams past the cap with no declared size", async () => {
    // A stand-in stream whose chunks only claim their size: 50 MB of real
    // bytes would cost this test more than the code under it. The reader is
    // cancelled the moment the running total passes the cap.
    const cancel = vi.fn(async () => {});
    const read = vi.fn(async () => ({ done: false, value: { byteLength: DOCUMENT_MAX_BYTES / 2 + 1 } }));
    const res = { ok: true, status: 200, headers: new Headers(), body: { getReader: () => ({ read, cancel }) } };
    vi.mocked(pluginFetch).mockResolvedValueOnce(res as unknown as Response);
    await expect(fetchDocumentBytes("https://docs.example.com/a.pdf")).rejects.toThrow(/larger than 50 MB/);
    expect(read).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalled();
  });

  it("throws the HTTP status for a refused document", async () => {
    vi.mocked(pluginFetch).mockResolvedValueOnce(new Response("<Error/>", { status: 403 }));
    await expect(fetchDocumentBytes("https://docs.example.com/a.pdf")).rejects.toThrow("HTTP 403");
  });
});

describe("obbjectWarnings", () => {
  it("reads OBBject warnings as text and ignores anything malformed", () => {
    expect(obbjectWarnings({ results: [], warnings: [{ category: "UserWarning", message: "MBS truncated" }, "plain", { message: 3 }, null, { message: "" }] })).toEqual(["MBS truncated", "plain"]);
    expect(obbjectWarnings({ results: [] })).toEqual([]);
    expect(obbjectWarnings([1, 2])).toEqual([]);
    expect(obbjectWarnings(null)).toEqual([]);
  });
});
