// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { backend } from "../../test/fixtures";
import { mcpAuthFor, withMcpAuth } from "./mcpAuth";
import { McpError } from "./mcpError";
import type { McpServerConfig } from "./types";

const url = "https://mcp.example/mcp";
const token = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({ id: "s", url, enabled: true, authType: "token", ...over });
// Same hostname as `url` -- these fixtures exist to exercise the credential
// SHAPE (header/query/cookie), not the cross-host block, so the backend and
// the MCP server agree on host unless a test says otherwise.
const b1 = backend({ id: "b1", name: "NAS", baseUrl: "https://mcp.example", headerName: "Authorization", headerValue: "Basic abc", authLocation: "header" });

describe("mcpAuthFor", () => {
  it("sends nothing for oauth, unset, manual or widget-derived servers", () => {
    expect(mcpAuthFor(undefined, [b1], {})).toEqual({ kind: "none" });
    expect(mcpAuthFor(token({ authType: "oauth" }), [b1], {})).toEqual({ kind: "none" });
    expect(mcpAuthFor({ id: "s", url, enabled: true }, [b1], {})).toEqual({ kind: "none" });
  });

  it("forwards the source backend's credential where it lives", () => {
    const src = { kind: "backend" as const, backendId: "b1" };
    expect(mcpAuthFor(token({ source: src }), [b1], {})).toEqual({ kind: "header", name: "Authorization", value: "Basic abc", backendName: "NAS" });
    expect(mcpAuthFor(token({ source: src }), [{ ...b1, authLocation: "query" }], {})).toMatchObject({ kind: "query", name: "Authorization" });
    expect(mcpAuthFor(token({ source: src }), [{ ...b1, authLocation: "cookie" }], {})).toEqual({
      kind: "refused",
      message: "cookie credentials can't be forwarded to an MCP server",
    });
    expect(mcpAuthFor(token({ source: src }), [{ ...b1, headerName: undefined, headerValue: undefined }], {})).toEqual({ kind: "none" });
  });

  it("uses a stored token for a file import, or a backend that is gone, and otherwise needs one", () => {
    expect(mcpAuthFor(token({ source: { kind: "file" } }), [b1], {})).toEqual({ kind: "needs-token" });
    expect(mcpAuthFor(token({ source: { kind: "backend", backendId: "gone" } }), [b1], { [url]: { token: "t" } })).toEqual({ kind: "bearer", token: "t" });
  });

  // Change A: a "token" server on a different host from its source backend
  // no longer gets that backend's credential by default -- it must be
  // allowed per server.
  describe("cross-host: a server on a different host than its source backend", () => {
    const nas = backend({ id: "b1", name: "NAS", baseUrl: "https://nas.example", headerName: "Authorization", headerValue: "Basic abc", authLocation: "header" });
    const src = { kind: "backend" as const, backendId: "b1" };

    it("still sends the credential when only the port differs (ports are ignored)", () => {
      const same = token({ url: "https://nas.example:8443/mcp", source: src });
      expect(mcpAuthFor(same, [nas], {})).toEqual({ kind: "header", name: "Authorization", value: "Basic abc", backendName: "NAS" });
    });

    it("refuses a different hostname with an exact message, unless allowed", () => {
      const away = token({ url: "https://other.example/mcp", source: src });
      expect(mcpAuthFor(away, [nas], {})).toEqual({
        kind: "refused",
        message: "won't send NAS's credential to other.example — allow it in AI Library → MCP Servers",
      });
      expect(mcpAuthFor({ ...away, allowCrossHost: true }, [nas], {})).toEqual({
        kind: "header",
        name: "Authorization",
        value: "Basic abc",
        backendName: "NAS",
      });
    });

    it("compares hostnames case-insensitively", () => {
      const away = token({ url: "https://NAS.EXAMPLE/mcp", source: src });
      expect(mcpAuthFor(away, [nas], {})).toMatchObject({ kind: "header" });
    });

    it("refuses a URL with userinfo that tricks the hostname (userinfo@evil)", () => {
      const trick = token({ url: "https://nas.example@evil.example/mcp", source: src });
      expect(mcpAuthFor(trick, [nas], {})).toEqual({
        kind: "refused",
        message: "won't send NAS's credential to evil.example — allow it in AI Library → MCP Servers",
      });
    });

    it("refuses an unparseable MCP URL", () => {
      const bad = token({ url: "not a url", source: src });
      expect(mcpAuthFor(bad, [nas], {})).toEqual({
        kind: "refused",
        message: "won't send NAS's credential to not a url — allow it in AI Library → MCP Servers",
      });
    });
  });
});

describe("withMcpAuth", () => {
  const deps = (over = {}) => ({ backends: [b1], tokens: {}, onTokenRejected: vi.fn(), webFetch: vi.fn() as never, appFetch: vi.fn() as never, ...over });

  it("makes no request at all before a token exists", async () => {
    const run = vi.fn();
    await expect(withMcpAuth(token({ source: { kind: "file" } }), url, deps(), run)).rejects.toMatchObject({
      code: "needs_token",
      message: "Token required — add it in AI Library → MCP Servers",
    });
    expect(run).not.toHaveBeenCalled();
  });

  // Change A: a refused cross-host credential must not reach the server
  // either -- same "no request at all" discipline as needs-token above.
  it("makes no request at all for a refused cross-host credential", async () => {
    const nas = backend({ id: "b1", name: "NAS", baseUrl: "https://nas.example", headerName: "Authorization", headerValue: "Basic abc", authLocation: "header" });
    const run = vi.fn();
    const away = token({ url: "https://other.example/mcp", source: { kind: "backend", backendId: "b1" } });
    await expect(withMcpAuth(away, "https://other.example/mcp", deps({ backends: [nas] }), run)).rejects.toMatchObject({
      code: "auth",
      message: "won't send NAS's credential to other.example — allow it in AI Library → MCP Servers",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("sends a bearer token through the app's fetch", async () => {
    const d = deps({ tokens: { [url]: { token: "t" } } });
    const run = vi.fn(async (t: { headers: Record<string, string>; fetchImpl: unknown; url: string }) => t);
    const t = await withMcpAuth(token({ source: { kind: "file" } }), url, d, run);
    expect(t.headers).toEqual({ Authorization: "Bearer t" });
    expect(t.fetchImpl).toBe(d.appFetch);
  });

  it("keeps a query credential off transport.url, appending it only inside fetchImpl at fetch time", async () => {
    const appFetchImpl = vi.fn(async () => new Response("ok"));
    const run = vi.fn(async (t: { url: string; headers: Record<string, string>; fetchImpl: typeof fetch }) => t);
    const t = await withMcpAuth(
      token({ source: { kind: "backend", backendId: "b1" } }),
      url,
      deps({ backends: [{ ...b1, authLocation: "query", headerName: "api_token", headerValue: "s3cr3t" }], appFetch: appFetchImpl as never }),
      run,
    );
    // C1: transport.url is what discoverMcpTools/callMcpTool key their cache
    // by and stamp onto tools[].url -- it must stay the plain URL.
    expect(t.url).toBe(url);
    expect(t.headers).toEqual({});

    await t.fetchImpl(t.url, { method: "POST" });
    expect(appFetchImpl).toHaveBeenCalledWith("https://mcp.example/mcp?api_token=s3cr3t", { method: "POST" });
  });

  it("redacts a query credential from a network error's own message, keeping the error's name", async () => {
    const appFetchImpl = vi.fn(async () => {
      throw new TypeError("error sending request for url (https://mcp.example/mcp?api_token=s3cr3t)");
    });
    const run = vi.fn(async (t: { url: string; fetchImpl: typeof fetch }) => t.fetchImpl(t.url, {}));
    const d = deps({ backends: [{ ...b1, authLocation: "query", headerName: "api_token", headerValue: "s3cr3t" }], appFetch: appFetchImpl as never });
    let caught: unknown;
    try {
      await withMcpAuth(token({ source: { kind: "backend", backendId: "b1" } }), url, d, run);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe("TypeError");
    expect((caught as Error).message).not.toContain("s3cr3t");
  });

  // final review I2: mcpRpc keeps up to 500 characters of a failed response's
  // body, and a server that echoes the credential ("invalid api key …") put it
  // into the tool-error artifact, chat.json, the ledger, the trail, the Check
  // text and the agent's tool result. Only a 401 was rewritten before.
  describe("redacts a credential echoed in a non-401 error, keeping code and status", () => {
    const echoing = (secret: string) => async () => {
      throw new McpError("http_403", `MCP initialize failed: HTTP 403 {"detail":"invalid api key ${secret}"} (${encodeURIComponent(secret)})`, 403);
    };
    async function caught(p: Promise<unknown>): Promise<McpError> {
      try {
        await p;
      } catch (err) {
        return err as McpError;
      }
      throw new Error("expected a rejection");
    }

    it("a bearer token", async () => {
      const d = deps({ tokens: { [url]: { token: "t0k/en+XYZ" } } });
      const err = await caught(withMcpAuth(token({ source: { kind: "file" } }), url, d, echoing("t0k/en+XYZ")));
      expect(err).toBeInstanceOf(McpError);
      expect(err).toMatchObject({ code: "http_403", status: 403 });
      expect(err.message).not.toContain("t0k/en+XYZ");
      expect(err.message).not.toContain(encodeURIComponent("t0k/en+XYZ"));
      expect(err.message).toContain("[redacted]");
    });

    it("a header credential, whole and without its scheme", async () => {
      const b = { ...b1, headerValue: "Basic abc123secret" };
      const src = token({ source: { kind: "backend", backendId: "b1" } });
      const whole = await caught(withMcpAuth(src, url, deps({ backends: [b] }), echoing("Basic abc123secret")));
      expect(whole).toMatchObject({ code: "http_403", status: 403 });
      expect(whole.message).not.toContain("abc123secret");
      const bare = await caught(withMcpAuth(src, url, deps({ backends: [b] }), echoing("abc123secret")));
      expect(bare.message).not.toContain("abc123secret");
    });

    it("a query credential", async () => {
      const b = { ...b1, authLocation: "query" as const, headerName: "api_token", headerValue: "s3cr3t=" };
      const err = await caught(withMcpAuth(token({ source: { kind: "backend", backendId: "b1" } }), url, deps({ backends: [b] }), echoing("s3cr3t=")));
      expect(err).toBeInstanceOf(McpError);
      expect(err).toMatchObject({ code: "http_403", status: 403 });
      expect(err.message).not.toContain("s3cr3t");
    });

    it("an error raised while reading the body, keeping its name", async () => {
      const d = deps({ tokens: { [url]: { token: "t0ken" } } });
      const err = await caught(
        withMcpAuth(token({ source: { kind: "file" } }), url, d, async () => {
          throw new TypeError("stream failed near t0ken");
        }),
      );
      expect(err.name).toBe("TypeError");
      expect(err.message).toBe("stream failed near [redacted]");
    });
  });

  it("leaves an uncredentialed server on the webview fetch", async () => {
    const d = deps();
    const t = await withMcpAuth(undefined, url, d, async (x) => x);
    expect(t).toEqual({ url, headers: {}, fetchImpl: d.webFetch });
  });

  it("maps a 401 by credential: rejected token is forgotten; backend credential named; oauth explained; unset untouched", async () => {
    const unauthorized = async () => {
      throw new McpError("http_401", "MCP initialize failed: HTTP 401 ", 401);
    };
    const d = deps({ tokens: { [url]: { token: "t" } } });
    await expect(withMcpAuth(token({ source: { kind: "file" } }), url, d, unauthorized)).rejects.toMatchObject({
      code: "auth",
      message: "Token rejected — enter it again in AI Library → MCP Servers",
    });
    expect(d.onTokenRejected).toHaveBeenCalledWith(url);
    await expect(withMcpAuth(token({ source: { kind: "backend", backendId: "b1" } }), url, deps(), unauthorized)).rejects.toMatchObject({
      code: "auth",
      message: "The MCP server rejected NAS's credentials",
    });
    await expect(withMcpAuth(token({ authType: "oauth" }), url, deps(), unauthorized)).rejects.toMatchObject({
      code: "auth",
      message: "Needs OAuth sign-in, which BDOBB doesn't support",
    });
    await expect(withMcpAuth({ id: "s", url, enabled: true }, url, deps(), unauthorized)).rejects.toMatchObject({ code: "http_401" });
  });
});
