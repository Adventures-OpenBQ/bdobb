// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from "vitest";
import { startMockServer, type MockServer } from "./mockServer";

let server: MockServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

describe("startMockServer", () => {
  it("answers a CORS preflight with 204 and allow headers, without recording it as a request", async () => {
    server = await startMockServer({ "/x": { ok: true } });
    const res = await fetch(`${server.url}/x`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:4173", "access-control-request-method": "PUT" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("PUT");
    expect(server.requests).toEqual([]);
  });

  it("adds access-control-allow-origin to every ordinary response, including 404 and 204", async () => {
    server = await startMockServer({ "/x": { ok: true }, "/empty": { __status: 204 } });
    for (const path of ["/x", "/empty", "/missing"]) {
      const res = await fetch(`${server.url}${path}`);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("listens on a fixed port when one is given", async () => {
    server = await startMockServer({}, 4179);
    expect(server.url).toBe("http://127.0.0.1:4179");
  });

  it("calls a function route with the request URL, so one path can answer per query string", async () => {
    // Routing is by pathname only, so a templated options endpoint — the same
    // path answering differently per `?chamber=` — has no other expression.
    server = await startMockServer({
      "/committees": (url: URL) => {
        switch (url.searchParams.get("chamber")) {
          case "house":
            return [{ label: "Ways and Means", value: "wm" }];
          case "senate":
            return [{ label: "Finance", value: "fin" }];
          default:
            return undefined;
        }
      },
    });

    expect(await (await fetch(`${server.url}/committees?chamber=house`)).json()).toEqual([
      { label: "Ways and Means", value: "wm" },
    ]);
    expect(await (await fetch(`${server.url}/committees?chamber=senate`)).json()).toEqual([
      { label: "Finance", value: "fin" },
    ]);
    // Returning undefined means "not found", exactly as an absent key does.
    expect((await fetch(`${server.url}/committees`)).status).toBe(404);
    // The requests are still recorded, query string and all.
    expect(server.requests.map((r) => r.search)).toEqual([
      "?chamber=house",
      "?chamber=senate",
      "",
    ]);
  });

  it("serves a body verbatim under the content-type the route names", async () => {
    // What the RSS fixture in scripts/browser-fixtures.mjs relies on: an XML
    // body, sent byte for byte, under a feed content type rather than JSON.
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel/></rss>`;
    server = await startMockServer({
      "/feed.xml": { __status: 200, __contentType: "application/rss+xml", __body: xml },
    });
    const res = await fetch(`${server.url}/feed.xml`);
    expect(res.headers.get("content-type")).toBe("application/rss+xml");
    expect(await res.text()).toBe(xml);
  });

  it("still defaults to application/json when a route names no content type", async () => {
    server = await startMockServer({ "/x": { __status: 500 } });
    const res = await fetch(`${server.url}/x`);
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("still serves a __status envelope returned from a function route", async () => {
    server = await startMockServer({
      "/committees": () => ({ __status: 422, __body: { detail: "int_parsing" } }),
    });
    const res = await fetch(`${server.url}/committees`);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ detail: "int_parsing" });
  });
});

describe("mock server content types", () => {
  it("serves a route's body under its own content type", async () => {
    const server = await startMockServer({
      "/page": { __status: 200, __contentType: "text/html; charset=utf-8", __body: "<p>hi</p>" },
    });
    try {
      const res = await fetch(`${server.url}/page`);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await res.text()).toBe("<p>hi</p>");
    } finally {
      await server.close();
    }
  });

  it("hands a function route the request's method and body, so one route can answer GET and PUT", async () => {
    const server = await startMockServer({
      "/s": (_url: URL, req: { method: string; body: string }) => ({ method: req.method, body: req.body }),
    });
    try {
      const res = await fetch(`${server.url}/s`, { method: "PUT", body: '{"a":1}' });
      expect(await res.json()).toEqual({ method: "PUT", body: '{"a":1}' });
    } finally {
      await server.close();
    }
  });
});
