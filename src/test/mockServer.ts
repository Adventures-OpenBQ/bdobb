// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A route value that is called with the request URL and returns the route
 * value to serve. Routing itself is by pathname only, so an endpoint whose
 * ANSWER depends on its query string — a templated options endpoint replying
 * per `?chamber=` — can only be expressed this way. It also receives the
 * request's method and body, so one route can answer a GET and a PUT
 * differently (a settings section's read and save).
 */
type MockRouteFn = (url: URL, request: { method: string; body: string }) => unknown;

type MockRoutes = Record<string, unknown>;

export type MockServer = {
  url: string;
  close: () => Promise<void>;
  requests: Array<{
    path: string;
    search: string;
    headers: Record<string, string>;
    method: string;
    body: string;
  }>;
};

// Every response carries `access-control-allow-origin: *` and OPTIONS is
// answered with 204, so a page served by Vite (a different origin) can call
// this server directly -- that is what `vite --mode browser` relies on.
// Node-side callers never send a preflight, so nothing changes for them.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, PUT, POST, OPTIONS",
  "access-control-allow-headers": "*",
} as const;

/**
 * Serves canned JSON keyed by pathname. A route value of { __status: n }
 * responds with status n; add __body to control the body (a string is sent
 * verbatim, anything else is JSON-encoded) and __contentType to serve it as
 * something other than application/json. { __status: 204 } sends no body.
 * Adding __delayMs holds the answer open that many milliseconds first, and
 * { __hang: true } never answers at all.
 * __headers is an escape hatch applied LAST, so a route can override a
 * header this server would otherwise set, or DROP one by giving it `null`.
 * A caller that READS a header (fetchAppsJson sizes apps.json from
 * content-length) cannot otherwise be tested against anything but an honest
 * server, and an honest server is the one case that needs no guard. Note
 * that content-length cannot be made to LIE here: it is the response's
 * framing, and a client rejects the response outright (undici: "Invalid
 * character in Content-Length") or waits forever for bytes that never come.
 * Dropping it -- what a re-chunking proxy does -- is the reachable case.
 * `port` defaults to 0 (OS-assigned; the returned `url` carries the bound
 * port) and is fixed only by `scripts/browser.mjs`.
 */
export async function startMockServer(routes: MockRoutes, port = 0): Promise<MockServer> {
  const requests: MockServer["requests"] = [];

  const server = createServer((req, res) => {
    if (req.method === "OPTIONS") {
      // A preflight is browser plumbing, not something under test: not
      // recorded, so request-count assertions see only the app's own calls.
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    const path = requestUrl.pathname;
    // Set from the matched route below, read by sendBody. A `let` at this
    // level because sendBody is shared with the 404 branch.
    let extraHeaders: Record<string, string | null> = {};
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({
        path,
        // Routing below matches on pathname only, but a caller can still
        // assert on the query string a request actually carried — otherwise
        // params silently dropped before the request would be indistinguishable
        // from params forwarded correctly.
        search: requestUrl.search,
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : (v ?? "")]),
        ),
        method: req.method ?? "GET",
        // A caller submitting a secret in the request body (e.g. a PUT'd
        // API key) can assert here that it landed in the body and nowhere
        // else — never the path or search string recorded above.
        body,
      });

      const entry = routes[path];
      // A function route answers per query string (see MockRouteFn). Its
      // return value is treated exactly like a static one, __status envelope
      // included; returning undefined means "not found", as an absent key does.
      const route =
        typeof entry === "function"
          ? (entry as MockRouteFn)(requestUrl, { method: req.method ?? "GET", body })
          : entry;
      const declared = (route as { __headers?: unknown })?.__headers;
      if (declared !== null && typeof declared === "object") {
        // `null` DELETES a header rather than sending the string "null" --
        // which is the only way to express the case a proxy creates, a
        // response with no content-length at all.
        extraHeaders = Object.fromEntries(
          Object.entries(declared as Record<string, unknown>).map(([k, v]) => [
            k,
            v === null ? null : String(v),
          ]),
        );
      }
      if (route === undefined) {
        sendBody(404, "application/json", JSON.stringify({ error: "not found" }));
        return;
      }

      // A route can refuse to answer AT ALL: { __hang: true }. Distinct from
      // __delayMs, which still schedules a write (and so keeps a timer, and a
      // response, alive after the client has given up): this one accepts the
      // connection, records the request and then does nothing, which is the
      // only way to express the host a deadline exists for -- one that is
      // reachable, so no connect timeout ever fires, and simply never
      // replies. The socket is released when the caller aborts.
      if ((route as { __hang?: unknown })?.__hang === true) return;

      // A route can hold its answer open: { __delayMs: n, __status: 200,
      // __body: … }. Nothing else can express "this request is STILL in
      // flight while the user does the next thing", which is the state a
      // cascade has to survive.
      const delayMs = (route as { __delayMs?: number })?.__delayMs;
      if (typeof delayMs === "number") {
        setTimeout(() => send(route), delayMs);
      } else {
        send(route);
      }
    });

    /**
     * One body, one write, with its length declared. A real backend
     * (uvicorn, and every proxy in front of one) answers a JSON document
     * with a Content-Length; Node would otherwise chunk this and declare
     * nothing, and a caller that reads the header — fetchAppsJson sizes the
     * document from it — would be tested against a server no deployment
     * resembles.
     */
    function sendBody(status: number, contentType: string, body: string) {
      // Applied LAST so a route can override, or drop, even content-length.
      // Dropping it is what a proxy that re-chunks a response does, and it
      // is the case a caller which READS that header has to survive.
      const headers: Record<string, string | number> = {
        ...CORS,
        "content-type": contentType,
        "content-length": Buffer.byteLength(body),
      };
      for (const [name, value] of Object.entries(extraHeaders)) {
        if (value === null) delete headers[name];
        else headers[name] = value;
      }
      // Without a content-length Node frames the response as chunked, which
      // is exactly the shape being asked for.
      res.writeHead(status, headers);
      res.end(body);
    }

    function send(route: unknown) {
      const status = (route as { __status?: number })?.__status;
      if (typeof status === "number") {
        // 204 must carry no body — that is the case under test.
        if (status === 204) {
          res.writeHead(204, CORS);
          res.end();
          return;
        }
        const body = (route as { __body?: unknown }).__body;
        // A route that is not JSON has to say so. e2e/iframe.spec.ts needs a
        // real HTML document at an origin of its own, and a browser never
        // parses or scripts a page served as application/json.
        const contentType = (route as { __contentType?: unknown }).__contentType;
        sendBody(
          status,
          typeof contentType === "string" ? contentType : "application/json",
          body === undefined
            ? JSON.stringify({ error: `status ${status}` })
            : typeof body === "string"
              ? body
              : JSON.stringify(body),
        );
        return;
      }

      sendBody(200, "application/json", JSON.stringify(route));
    }
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: boundPort } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${boundPort}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        // Destroyed, not waited out: a __hang route is still holding a
        // request open by design, and a caller that has given up on it (a
        // deadline fired) has no way to close that socket from its end under
        // jsdom — see the fetch note in src/test/setup.ts. Without this, this
        // helper's own teardown would be the thing that hangs.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
