// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mcpRpc,
  DEFAULT_MCP_TIMEOUT_MS,
  discoverMcpTools,
  resetMcpCache,
  normalizeMcpUrl,
  assembleTools,
  TOOL_PAYLOAD_BUDGET_CHARS,
  callMcpTool,
} from "./mcp";
import { McpError } from "./mcpError";
import type { McpServerConfig } from "./types";
import { streamOf, toolsListSse, MCP_201, listToolsFrom } from "../../test/fixtures/mcp-fixtures";

vi.mock("../logger", () => ({
  logError: vi.fn(() => Promise.resolve()),
  logOnce: vi.fn(() => Promise.resolve()),
  logInfo: vi.fn(() => Promise.resolve()),
}));

/** A Response whose body replays `sse` as a stream. */
function sseResponse(
  sse: string,
  init: { status?: number; sessionId?: string } = {},
): Response {
  const headers = new Headers();
  if (init.sessionId) headers.set("mcp-session-id", init.sessionId);
  return new Response(streamOf(sse, sse.length || 1), {
    status: init.status ?? 200,
    headers,
  });
}

describe("mcpRpc", () => {
  // Streamable HTTP lets a server answer one request with plain JSON instead of
  // an event stream; such a reply used to fail with "no response carrying id".
  it("accepts JSON responses and rejects JSON-RPC errors or mismatched IDs", async () => {
    const json = (payload: unknown) => vi.fn(async () => new Response(JSON.stringify(payload),
      { headers: { "content-type": "application/json", "mcp-session-id": "json-session" } }));
    expect(await mcpRpc("http://x/mcp", "ping", {}, 1, null,
      json({ jsonrpc: "2.0", id: 1, result: { ok: true } }) as never))
      .toEqual({ result: { ok: true }, sessionId: "json-session" });
    await expect(mcpRpc("http://x/mcp", "ping", {}, 1, null,
      json({ id: 2, result: {} }) as never)).rejects.toThrow("no response carrying id");
    await expect(mcpRpc("http://x/mcp", "ping", {}, 1, null,
      json({ id: 1, error: { code: -32602 } }) as never)).rejects.toThrow("-32602");
  });

  it("sends both Accept types, the protocol version, and follows redirects", async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse('data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n'),
    );
    await mcpRpc("http://x/mcp", "ping", {}, 1, null, fetchImpl as never);
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers.Accept).toBe("application/json, text/event-stream");
    expect(headers["MCP-Protocol-Version"]).toBe("2025-06-18");
    expect(opts.redirect).toBe("follow");
    expect(opts.method).toBe("POST");
  });

  it("returns the session id issued by initialize", async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse('data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n', {
        sessionId: "sess-1",
      }),
    );
    const out = await mcpRpc(
      "http://x/mcp",
      "initialize",
      {},
      1,
      null,
      fetchImpl as never,
    );
    expect(out.sessionId).toBe("sess-1");
  });

  it("echoes a known session id back on later calls", async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse('data: {"jsonrpc":"2.0","id":2,"result":{}}\n\n'),
    );
    await mcpRpc("http://x/mcp", "tools/list", {}, 2, "sess-1", fetchImpl as never);
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((opts.headers as Record<string, string>)["Mcp-Session-Id"]).toBe(
      "sess-1",
    );
  });

  it("omits id for a notification and still resolves", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 202 }));
    const out = await mcpRpc(
      "http://x/mcp",
      "notifications/initialized",
      undefined,
      null,
      "sess-1",
      fetchImpl as never,
    );
    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).not.toHaveProperty("id");
    expect(out.result).toBeNull();
  });

  it("matches the reply by JSON-RPC id, ignoring a progress event first", async () => {
    // The decoy carries its own id and a result, so an implementation that
    // merely took "the first payload with a result" would also pass — only
    // genuine id-matching rejects it and picks the id: 9 reply.
    const sse =
      'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"decoy"}]}}\n\n' +
      'data: {"jsonrpc":"2.0","id":9,"result":{"tools":[{"name":"real"}]}}\n\n';
    const fetchImpl = vi.fn(async () => sseResponse(sse));
    const out = await mcpRpc("http://x/mcp", "tools/list", {}, 9, null, fetchImpl as never);
    const names = (out.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toEqual(["real"]);
    expect(names).not.toContain("decoy");
  });

  it("previews the error body into the thrown error", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("Bad Request: Missing session ID", { status: 400 }),
    );
    await expect(
      mcpRpc("http://x/mcp", "tools/list", {}, 1, null, fetchImpl as never),
    ).rejects.toThrow(/Missing session ID/);
  });

  it("truncates the error body preview to 500 characters", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("x".repeat(2000), { status: 500 }),
    );
    const error = (await mcpRpc(
      "http://x/mcp",
      "tools/list",
      {},
      1,
      null,
      fetchImpl as never,
    ).catch((e: unknown) => e as Error)) as Error;
    expect(error).toBeInstanceOf(Error);
    const run = /x+/.exec(error.message)?.[0] ?? "";
    expect(run.length).toBe(500);
  });

  it("throws on a JSON-RPC error payload", async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse(
        'data: {"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"nope"}}\n\n',
      ),
    );
    await expect(
      mcpRpc("http://x/mcp", "tools/list", {}, 1, null, fetchImpl as never),
    ).rejects.toThrow(/nope/);
  });

  it("aborts on its own timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string, opts: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          opts.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    await expect(
      mcpRpc("http://x/mcp", "tools/list", {}, 1, null, fetchImpl as never, 10),
    ).rejects.toThrow();
  });

  it("defaults the timeout to ten seconds", () => {
    expect(DEFAULT_MCP_TIMEOUT_MS).toBe(10_000);
  });

  it("mcpRpc sends extra headers, never over the protocol's own", async () => {
    const fetchImpl = vi.fn(async () => sseResponse('data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n'));
    await mcpRpc("http://x/mcp", "ping", {}, 1, null, fetchImpl as never, undefined, { Authorization: "Bearer t", Accept: "text/html" });
    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer t");
    expect(headers.Accept).toBe("application/json, text/event-stream");
  });

  // final review T8a: header names are case-insensitive, and Headers merges
  // "accept" with "Accept" into "text/html, application/json, …".
  it("drops an extra header that names a protocol header in any case", async () => {
    const fetchImpl = vi.fn(async () => sseResponse('data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n'));
    await mcpRpc("http://x/mcp", "ping", {}, 1, "sid", fetchImpl as never, undefined, {
      Authorization: "Bearer t",
      accept: "text/html",
      "content-type": "text/plain",
      "mcp-protocol-version": "1999-01-01",
      "MCP-SESSION-ID": "evil",
    });
    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers).toEqual({
      Authorization: "Bearer t",
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
      "Mcp-Session-Id": "sid",
    });
  });
});

/**
 * A fetch that answers initialize, the notification, then scripted pages —
 * and, like a real server, answers 400 "Missing session ID" to anything past
 * initialize that doesn't echo the session it issued. That makes the session
 * load-bearing for every test built on this helper: an implementation that
 * passed null instead of the real session would fail here, not pass silently.
 */
function scriptedServer(pages: string[]) {
  let call = 0;
  return vi.fn(async (_url: string, opts: RequestInit) => {
    const body = JSON.parse(opts.body as string) as {
      method: string;
      id?: number;
    };
    if (body.method === "initialize") {
      return sseResponse(
        `data: {"jsonrpc":"2.0","id":${body.id},"result":{"protocolVersion":"2025-06-18"}}\n\n`,
        { sessionId: "sess-1" },
      );
    }
    const session = (opts.headers as Record<string, string>)["Mcp-Session-Id"];
    if (session !== "sess-1") {
      return new Response("Bad Request: Missing session ID", { status: 400 });
    }
    if (body.method === "notifications/initialized") {
      return new Response("", { status: 202 });
    }
    const page = pages[call++] ?? '{"tools":[]}';
    return sseResponse(
      `data: {"jsonrpc":"2.0","id":${body.id},"result":${page}}\n\n`,
    );
  });
}

describe("normalizeMcpUrl", () => {
  it("trims whitespace and strips trailing slashes", () => {
    expect(normalizeMcpUrl("  http://x/mcp/  ")).toBe("http://x/mcp");
    expect(normalizeMcpUrl("http://x/mcp///")).toBe("http://x/mcp");
    expect(normalizeMcpUrl("http://x/mcp")).toBe("http://x/mcp");
  });
});

describe("discoverMcpTools", () => {
  beforeEach(() => resetMcpCache());

  it("handshakes then lists, mapping tools to AgentTool", async () => {
    const fetchImpl = scriptedServer([
      '{"tools":[{"name":"t1","description":"d","inputSchema":{"type":"object"}}]}',
    ]);
    const tools = await discoverMcpTools("s1", "http://x/mcp", fetchImpl as never);
    expect(tools).toEqual([
      {
        server_id: "s1",
        name: "t1",
        url: "http://x/mcp",
        endpoint: "",
        description: "d",
        input_schema: { type: "object" },
      },
    ]);
    const methods = fetchImpl.mock.calls.map(
      ([, o]) => JSON.parse((o as RequestInit).body as string).method,
    );
    expect(methods).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
    ]);
    // Both calls after initialize echo the session it issued — the server
    // above 400s otherwise, but assert the header directly too.
    const [, initedOpts] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    const [, listOpts] = fetchImpl.mock.calls[2] as unknown as [string, RequestInit];
    expect((initedOpts.headers as Record<string, string>)["Mcp-Session-Id"]).toBe(
      "sess-1",
    );
    expect((listOpts.headers as Record<string, string>)["Mcp-Session-Id"]).toBe(
      "sess-1",
    );
  });

  it("follows nextCursor rather than assuming page one is everything", async () => {
    const fetchImpl = scriptedServer([
      '{"tools":[{"name":"a"}],"nextCursor":"c2"}',
      '{"tools":[{"name":"b"}]}',
    ]);
    const tools = await discoverMcpTools("s1", "http://x/mcp", fetchImpl as never);
    expect(tools.map((t) => t.name)).toEqual(["a", "b"]);
  });

  it(
    "rejects rather than looping forever on a nextCursor that repeats",
    async () => {
      // A server that echoes the same cursor back would otherwise spin: each
      // page has its own timeout, so no individual call ever times out.
      const fetchImpl = vi.fn(async (_url: string, opts: RequestInit) => {
        const body = JSON.parse(opts.body as string) as {
          method: string;
          id?: number;
        };
        if (body.method === "initialize")
          return sseResponse(
            `data: {"jsonrpc":"2.0","id":${body.id},"result":{}}\n\n`,
            { sessionId: "s" },
          );
        if (body.method === "notifications/initialized")
          return new Response("", { status: 202 });
        return sseResponse(
          `data: {"jsonrpc":"2.0","id":${body.id},"result":{"tools":[{"name":"a"}],"nextCursor":"stuck"}}\n\n`,
        );
      });
      await expect(
        discoverMcpTools("s1", "http://x/mcp", fetchImpl as never),
      ).rejects.toThrow(/repeating nextCursor/);
      // Caught the repeat on the very next page, not after many more.
      expect(fetchImpl).toHaveBeenCalledTimes(4);
    },
    2000,
  );

  it(
    "rejects at a page cap against an endless sequence of distinct cursors",
    async () => {
      let page = 0;
      const fetchImpl = vi.fn(async (_url: string, opts: RequestInit) => {
        const body = JSON.parse(opts.body as string) as {
          method: string;
          id?: number;
        };
        if (body.method === "initialize")
          return sseResponse(
            `data: {"jsonrpc":"2.0","id":${body.id},"result":{}}\n\n`,
            { sessionId: "s" },
          );
        if (body.method === "notifications/initialized")
          return new Response("", { status: 202 });
        page += 1;
        return sseResponse(
          `data: {"jsonrpc":"2.0","id":${body.id},"result":{"tools":[{"name":"t${page}"}],"nextCursor":"c${page}"}}\n\n`,
        );
      });
      await expect(
        discoverMcpTools("s1", "http://x/mcp", fetchImpl as never),
      ).rejects.toThrow(/more than 50 pages/);
    },
    5000,
  );

  it("caches per URL and returns a deep copy the caller cannot poison", async () => {
    const fetchImpl = scriptedServer([
      '{"tools":[{"name":"a","inputSchema":{"type":"object","properties":{"x":{"type":"string"}}}}]}',
    ]);
    const first = await discoverMcpTools("s1", "http://x/mcp", fetchImpl as never);
    first[0].name = "mutated";
    (first[0].input_schema.properties as Record<string, unknown>).x = "MUTATED";
    const second = await discoverMcpTools("s1", "http://x/mcp", fetchImpl as never);
    expect(second[0].name).toBe("a");
    expect(
      (second[0].input_schema.properties as Record<string, unknown>).x,
    ).toEqual({ type: "string" });
    // Second call served from cache: no further requests.
    expect(
      fetchImpl.mock.calls.filter(
        ([, o]) =>
          JSON.parse((o as RequestInit).body as string).method === "initialize",
      ),
    ).toHaveLength(1);
  });

  it("never caches a failure, so a booting server stays retryable", async () => {
    let attempt = 0;
    const fetchImpl = vi.fn(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string) as { method: string; id?: number };
      attempt += 1;
      if (attempt === 1) return new Response("still booting", { status: 503 });
      if (body.method === "initialize")
        return sseResponse(
          `data: {"jsonrpc":"2.0","id":${body.id},"result":{}}\n\n`,
          { sessionId: "s" },
        );
      if (body.method === "notifications/initialized")
        return new Response("", { status: 202 });
      return sseResponse(
        `data: {"jsonrpc":"2.0","id":${body.id},"result":{"tools":[{"name":"late"}]}}\n\n`,
      );
    });
    await expect(
      discoverMcpTools("s1", "http://x/mcp", fetchImpl as never),
    ).rejects.toThrow();
    const tools = await discoverMcpTools("s1", "http://x/mcp", fetchImpl as never);
    expect(tools.map((t) => t.name)).toEqual(["late"]);
  });

  it("discovers the six tools of the captured stores server", async () => {
    const fetchImpl = vi.fn(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string) as { method: string; id?: number };
      if (body.method === "initialize")
        return sseResponse(
          `data: {"jsonrpc":"2.0","id":${body.id},"result":{}}\n\n`,
          { sessionId: "s" },
        );
      if (body.method === "notifications/initialized")
        return new Response("", { status: 202 });
      // The real capture, replayed verbatim. Its id is 2, which is the id
      // discovery uses for its first tools/list.
      return sseResponse(toolsListSse);
    });
    const tools = await discoverMcpTools("stores", "http://x/mcp", fetchImpl as never);
    expect(tools).toHaveLength(6);
    expect(tools[0].server_id).toBe("stores");
    expect(tools[2].name).toBe("arctic_read");
    expect(tools[2].input_schema).toHaveProperty("properties");
  });
});

/** A server that answers with `count` tools, each padded to `pad` characters. */
function toolServer(count: number, pad = 0) {
  return vi.fn(async (_url: string, opts: RequestInit) => {
    const body = JSON.parse(opts.body as string) as { method: string; id?: number };
    if (body.method === "initialize")
      return sseResponse(
        `data: {"jsonrpc":"2.0","id":${body.id},"result":{}}\n\n`,
        { sessionId: "s" },
      );
    if (body.method === "notifications/initialized")
      return new Response("", { status: 202 });
    const tools = Array.from({ length: count }, (_v, i) => ({
      name: `t${i}`,
      description: "d".repeat(pad),
    }));
    return sseResponse(
      `data: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools } })}\n\n`,
    );
  });
}

const server = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: "s1",
  url: "http://a/mcp",
  enabled: true,
  ...over,
});

describe("assembleTools", () => {
  /** Plain discovery, as chatStore's discover does it without the auth wrapper. */
  const via = (fetchImpl: unknown) => ({ discover: (t: { serverId: string; url: string }) => discoverMcpTools(t.serverId, t.url, fetchImpl as never) });
  beforeEach(() => resetMcpCache());

  it("uses the spec's budget as amended by the design doc", () => {
    expect(TOOL_PAYLOAD_BUDGET_CHARS).toBe(128_000);
  });

  it("skips servers that are not enabled", async () => {
    const fetchImpl = toolServer(1);
    const out = await assembleTools(
      [server({ enabled: false })],
      [],
      via(fetchImpl),
    );
    expect(out.tools).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("unions dashboard mcpUrls with Settings, deduped by normalized URL", async () => {
    const fetchImpl = toolServer(1);
    const out = await assembleTools(
      [server({ id: "settings", url: "http://a/mcp" })],
      ["http://a/mcp/"], // same server, trailing slash
      via(fetchImpl),
    );
    expect(out.tools).toHaveLength(1);
    // Settings is inserted first, so it wins the server_id label.
    expect(out.tools?.[0].server_id).toBe("settings");
  });

  it("returns a failed server in unreachable[] with a named message", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    const out = await assembleTools(
      [server({ id: "dead", url: "http://dead/mcp" })],
      [],
      via(fetchImpl),
    );
    expect(out.tools).toBeNull();
    expect(out.unreachable).toHaveLength(1);
    expect(out.unreachable[0].serverId).toBe("dead");
    expect(out.unreachable[0].message).toContain("dead");
    expect(out.unreachable[0].message).toContain("http://dead/mcp");
  });

  it("one hanging server does not block the others", async () => {
    const slow = "http://slow/mcp";
    const fetchImpl = vi.fn((url: string, opts: RequestInit) => {
      if (url.startsWith(slow)) {
        // Stands in for mcpRpc's own timeout firing.
        return new Promise<Response>((_res, rej) => setTimeout(() => rej(new Error("timed out")), 20));
      }
      return toolServer(1)(url, opts);
    });
    const out = await assembleTools(
      [server({ id: "slow", url: slow }), server({ id: "fast", url: "http://fast/mcp" })],
      [],
      via(fetchImpl),
    );
    expect(out.tools?.map((t) => t.server_id)).toEqual(["fast"]);
    expect(out.unreachable.map((u) => u.serverId)).toEqual(["slow"]);
  });

  it("discovers servers concurrently, not one after another", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = vi.fn(async (url: string, opts: RequestInit) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Yield to the event loop so a sequential implementation cannot
      // finish one server before the next one starts.
      await new Promise((resolve) => setTimeout(resolve, 0));
      try {
        return await toolServer(1)(url, opts);
      } finally {
        inFlight -= 1;
      }
    });
    const out = await assembleTools(
      [
        server({ id: "one", url: "http://one/mcp" }),
        server({ id: "two", url: "http://two/mcp" }),
      ],
      [],
      via(fetchImpl),
    );
    expect(out.tools?.length).toBe(2);
    expect(maxInFlight).toBeGreaterThanOrEqual(2);
  });

  it("drops an oversized server whole and keeps a later small one", async () => {
    // ~2,000 chars per tool * 100 tools overflows 128,000 on its own.
    const fetchImpl = vi.fn((url: string, opts: RequestInit) =>
      url.startsWith("http://big")
        ? toolServer(100, 2000)(url, opts)
        : toolServer(1)(url, opts),
    );
    const out = await assembleTools(
      [
        server({ id: "big", url: "http://big/mcp" }),
        server({ id: "small", url: "http://small/mcp" }),
      ],
      [],
      via(fetchImpl),
    );
    expect(out.budgetExceeded).toHaveLength(1);
    expect(out.budgetExceeded[0].serverId).toBe("big");
    expect(out.budgetExceeded[0].toolCount).toBe(100);
    expect(out.budgetExceeded[0].message).toContain("--tool-discovery");
    // Never truncated mid-list, and the later smaller server still gets in.
    expect(out.tools?.every((t) => t.server_id === "small")).toBe(true);
    expect(out.tools).toHaveLength(1);
  });

  it("enforces the budget on a running total, not per server", async () => {
    // Two servers, each comfortably under the ceiling alone, over it together.
    const fetchImpl = vi.fn((url: string, opts: RequestInit) =>
      toolServer(40, 2000)(url, opts),
    );
    const out = await assembleTools(
      [
        server({ id: "one", url: "http://one/mcp" }),
        server({ id: "two", url: "http://two/mcp" }),
      ],
      [],
      via(fetchImpl),
    );
    expect(out.tools?.every((t) => t.server_id === "one")).toBe(true);
    expect(out.budgetExceeded.map((b) => b.serverId)).toEqual(["two"]);
  });

  /** A server with one ~130,000-character tool and one small one. */
  function heavyServerFetch() {
    return vi.fn(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string) as { method: string; id?: number };
      if (body.method === "initialize")
        return sseResponse(`data: {"jsonrpc":"2.0","id":${body.id},"result":{}}\n\n`, {
          sessionId: "s",
        });
      if (body.method === "notifications/initialized") return new Response("", { status: 202 });
      const tools = [{ name: "heavy", description: "x".repeat(130_000) }, { name: "light" }];
      return sseResponse(
        `data: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools } })}\n\n`,
      );
    });
  }

  it("drops disabled tools before the budget, so they cost nothing and a heavy server can be re-admitted", async () => {
    const heavyServer = server({ id: "heavy", url: "http://heavy/mcp" });
    const fetchImpl = heavyServerFetch();

    const withAll = await assembleTools([heavyServer], [], via(fetchImpl));
    expect(withAll.tools).toBeNull();
    expect(withAll.budgetExceeded[0].message).toContain(
      "or turn off some of its tools in AI Library → MCP Servers",
    );

    resetMcpCache();
    const trimmed = await assembleTools([heavyServer], [], {
      ...via(fetchImpl),
      disabledTools: { [normalizeMcpUrl(heavyServer.url)]: ["heavy"] },
    });
    expect(trimmed.tools?.map((t) => t.name)).toEqual(["light"]);
    expect(trimmed.budgetExceeded).toEqual([]);
  });

  it("offers a tool that is not in the disabled list, so new tools arrive enabled", async () => {
    const heavyServer = server({ id: "heavy", url: "http://heavy/mcp" });
    const fetchImpl = heavyServerFetch();
    const out = await assembleTools([heavyServer], [], {
      ...via(fetchImpl),
      disabledTools: { [normalizeMcpUrl(heavyServer.url)]: ["heavy", "some-old-tool"] },
    });
    expect(out.tools?.map((t) => t.name)).toEqual(["light"]);
  });

  it("uses opts.discover when given, with the Settings entry", async () => {
    const discover = vi.fn(async () => []);
    const s = { id: "s1", url: "https://m.example/mcp", enabled: true, authType: "token" as const };
    await assembleTools([s], ["https://w.example/mcp"], { discover });
    expect(discover).toHaveBeenCalledWith({ serverId: "s1", url: "https://m.example/mcp", server: s });
    expect(discover).toHaveBeenCalledWith({ serverId: "https://w.example/mcp", url: "https://w.example/mcp", server: undefined });
  });
});

describe("callMcpTool", () => {
  beforeEach(() => resetMcpCache());

  it("performs its own handshake rather than reusing the discovery cache", async () => {
    const fetchImpl = vi.fn(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string) as { method: string; id?: number };
      if (body.method === "initialize")
        return sseResponse(
          `data: {"jsonrpc":"2.0","id":${body.id},"result":{}}\n\n`,
          { sessionId: "fresh" },
        );
      if (body.method === "notifications/initialized")
        return new Response("", { status: 202 });
      return sseResponse(
        `data: {"jsonrpc":"2.0","id":${body.id},"result":{"content":[{"type":"text","text":"ok"}]}}\n\n`,
      );
    });
    // Discover first, so a cache-reusing implementation would skip the handshake.
    await discoverMcpTools("s", "http://x/mcp", fetchImpl as never).catch(
      () => undefined,
    );
    fetchImpl.mockClear();
    await callMcpTool("http://x/mcp", "t1", { a: 1 }, fetchImpl as never);
    const methods = fetchImpl.mock.calls.map(
      ([, o]) => JSON.parse((o as RequestInit).body as string).method,
    );
    expect(methods).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/call",
    ]);
  });

  it("carries the session issued by its own initialize, not an earlier one", async () => {
    // Discovery's handshake issues "stale"; callMcpTool's own handshake
    // issues "fresh". If callMcpTool reused the discovery session (or passed
    // null) instead of threading its own, tools/call would carry the wrong
    // value and this assertion would catch it.
    let initCount = 0;
    const fetchImpl = vi.fn(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string) as { method: string; id?: number };
      const headers = opts.headers as Record<string, string>;
      if (body.method === "initialize") {
        initCount += 1;
        return sseResponse(
          `data: {"jsonrpc":"2.0","id":${body.id},"result":{}}\n\n`,
          { sessionId: initCount === 1 ? "stale" : "fresh" },
        );
      }
      const wantSession = initCount === 1 ? "stale" : "fresh";
      if (headers["Mcp-Session-Id"] !== wantSession) {
        return new Response("Bad Request: Missing session ID", { status: 400 });
      }
      if (body.method === "notifications/initialized") {
        return new Response("", { status: 202 });
      }
      if (body.method === "tools/call") {
        expect(headers["Mcp-Session-Id"]).toBe("fresh");
      }
      return sseResponse(
        `data: {"jsonrpc":"2.0","id":${body.id},"result":{"tools":[],"ok":1}}\n\n`,
      );
    });
    await discoverMcpTools("s", "http://x/mcp", fetchImpl as never);
    await callMcpTool("http://x/mcp", "t1", {}, fetchImpl as never);
  });

  it("sends the tool name and arguments", async () => {
    const fetchImpl = vi.fn(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string) as { method: string; id?: number };
      if (body.method === "initialize")
        return sseResponse(
          `data: {"jsonrpc":"2.0","id":${body.id},"result":{}}\n\n`,
          { sessionId: "s" },
        );
      if (body.method === "notifications/initialized")
        return new Response("", { status: 202 });
      return sseResponse(
        `data: {"jsonrpc":"2.0","id":${body.id},"result":{"ok":1}}\n\n`,
      );
    });
    await callMcpTool("http://x/mcp", "kdb_select", { table: "trade" }, fetchImpl as never);
    const call = fetchImpl.mock.calls.find(
      ([, o]) => JSON.parse((o as RequestInit).body as string).method === "tools/call",
    );
    expect(JSON.parse((call?.[1] as RequestInit).body as string).params).toEqual({
      name: "kdb_select",
      arguments: { table: "trade" },
    });
  });

  it("throws on isError even though the JSON-RPC call succeeded", async () => {
    const fetchImpl = vi.fn(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string) as { method: string; id?: number };
      if (body.method === "initialize")
        return sseResponse(
          `data: {"jsonrpc":"2.0","id":${body.id},"result":{}}\n\n`,
          { sessionId: "s" },
        );
      if (body.method === "notifications/initialized")
        return new Response("", { status: 202 });
      return sseResponse(
        `data: {"jsonrpc":"2.0","id":${body.id},"result":{"isError":true,"content":[{"type":"text","text":"library not found"},{"type":"text","text":"try arctic_list_libraries"}]}}\n\n`,
      );
    });
    await expect(
      callMcpTool("http://x/mcp", "arctic_read", {}, fetchImpl as never),
    ).rejects.toThrow(/library not found\ntry arctic_list_libraries/);
  });
});

describe("MCP errors carry a code", () => {
  it("a non-OK response is http_<status>, keeping the body preview", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom from proxy", { status: 502 }));
    const err = await mcpRpc("http://x/mcp", "tools/call", {}, 2, null, fetchImpl as never).catch((e) => e);
    expect(err).toBeInstanceOf(McpError);
    expect(err).toMatchObject({ code: "http_502", status: 502 });
    expect(err.message).toContain("HTTP 502 boom from proxy");
  });

  it("our own timer firing is timeout, not a bare abort", async () => {
    const fetchImpl = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_r, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    const err = await mcpRpc("http://x/mcp", "tools/call", {}, 2, null, fetchImpl as never, 5).catch((e) => e);
    expect(err).toMatchObject({ code: "timeout" });
    expect(err.message).toBe("MCP tools/call timed out after 5 ms");
  });

  it("a tool's isError flag is tool_error", async () => {
    const replies = [
      sseResponse('data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n', { sessionId: "s" }),
      new Response(null, { status: 202 }),
      sseResponse('data: {"jsonrpc":"2.0","id":2,"result":{"isError":true,"content":[{"type":"text","text":"bad ticker"}]}}\n\n'),
    ];
    const fetchImpl = vi.fn(async () => replies.shift()!);
    // callMcpTool resolves `unknown`, unlike mcpRpc above: an explicit cast on
    // the caught error keeps this the same identity-catch as the other two
    // cases (TS otherwise leaves `unknown | unknown` uncollapsed here).
    const err = (await callMcpTool("http://x/mcp", "quote", {}, fetchImpl as never).catch((e) => e)) as McpError;
    expect(err).toMatchObject({ code: "tool_error" });
    expect(err.message).toContain("bad ticker");
  });
});

describe("MCP 2.0.1 (adaptation 7)", () => {
  it("lists the ten 2.0.1 tools including the search_tools/call_tool proxies", async () => {
    const tools = await listToolsFrom(MCP_201);
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["search_tools", "call_tool"]));
    expect(tools).toHaveLength(10);
  });

  it("pins the proxy schemas: call_tool requires name, run_pipeline steps require tool", async () => {
    type Schema = { required: string[]; properties: { steps: { items: { required: string[] } } } };
    const byName = Object.fromEntries((await listToolsFrom(MCP_201)).map((t) => [t.name, t.input_schema as Schema]));
    expect(byName.call_tool.required).toEqual(["name"]);
    expect(byName.run_pipeline.required).toEqual(["steps"]);
    expect(byName.run_pipeline.properties.steps.items.required).toEqual(["tool"]);
  });

  it("carries no host name in the sanitized captures", () => {
    expect(MCP_201.initialize + MCP_201.toolsList).not.toMatch(/ts\.net|https?:\/\/(?!example)/);
  });

  it("never names the 1.4.1 activation tools in client code", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [join(dir, e.name)] : [],
      );
    const offenders = walk("src").filter((f) => /activate_(category|tools)/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

// Back-port of dev 5c05aa5 (#91): Stop cancels an MCP tool call already in
// flight. The caller's signal is linked to each request's own timeout
// controller (by hand: AbortSignal.any is above the iOS 16.4 floor).
describe("callMcpTool and the caller's signal", () => {
  /**
   * Answers the handshake, then parks tools/call until the signal it was
   * handed aborts -- the shape of a slow tool on a real server. Every signal
   * fetch saw is kept, so a test can check which of them were aborted.
   */
  function slowToolServer() {
    const seen: AbortSignal[] = [];
    const fetchImpl = vi.fn(async (_url: string, opts: RequestInit) => {
      const signal = opts.signal as AbortSignal;
      seen.push(signal);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const body = JSON.parse(opts.body as string) as { method: string; id?: number };
      if (body.method === "initialize") return sseResponse(`data: {"jsonrpc":"2.0","id":${body.id},"result":{}}\n\n`, { sessionId: "s" });
      if (body.method === "notifications/initialized") return new Response("", { status: 202 });
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    return { fetchImpl, seen };
  }

  /** What a promise has settled to after a short wait, or "pending". */
  const settledWithin = (p: Promise<unknown>, ms = 50) =>
    Promise.race([
      p.then(
        () => "resolved",
        (e: unknown) => (e as { name?: string }).name,
      ),
      new Promise((r) => setTimeout(() => r("pending"), ms)),
    ]);

  it("an already-aborted signal rejects at once, without waiting for the timeout", async () => {
    const { fetchImpl } = slowToolServer();
    const stop = new AbortController();
    stop.abort();
    const call = callMcpTool("http://x/mcp", "t1", {}, fetchImpl as never, {}, stop.signal);
    expect(await settledWithin(call)).toBe("AbortError");
    // The handshake's first request is where it stops; tools/call never goes out.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborting mid-call aborts the tools/call fetch", async () => {
    const { fetchImpl, seen } = slowToolServer();
    const stop = new AbortController();
    const call = callMcpTool("http://x/mcp", "t1", {}, fetchImpl as never, {}, stop.signal);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    stop.abort();
    expect(await settledWithin(call)).toBe("AbortError");
    expect(seen[2].aborted).toBe(true);
  });

  it("removes its abort listener once a call completes, so a later abort does nothing", async () => {
    const fetchImpl = vi.fn(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string) as { method: string; id?: number };
      if (body.method === "initialize") return sseResponse(`data: {"jsonrpc":"2.0","id":${body.id},"result":{}}\n\n`, { sessionId: "s" });
      if (body.method === "notifications/initialized") return new Response("", { status: 202 });
      return sseResponse(`data: {"jsonrpc":"2.0","id":${body.id},"result":{"ok":1}}\n\n`);
    });
    const stop = new AbortController();
    const added = vi.spyOn(stop.signal, "addEventListener");
    const removed = vi.spyOn(stop.signal, "removeEventListener");
    await callMcpTool("http://x/mcp", "t1", {}, fetchImpl as never, {}, stop.signal);
    const count = (spy: typeof added) => spy.mock.calls.filter(([type]) => type === "abort").length;
    // One listener per request (initialize, the notification, tools/call),
    // each taken off again when its request finished.
    expect(count(added)).toBe(3);
    expect(count(removed)).toBe(3);
    stop.abort();
    for (const [, opts] of fetchImpl.mock.calls) expect((opts as RequestInit).signal?.aborted).toBe(false);
  });
});
