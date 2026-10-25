// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * An MCP Streamable HTTP client, verified against servers reporting
 * protocolVersion 2025-06-18.
 *
 * Four things a naive JSON-RPC-over-POST client gets wrong, all load-bearing:
 *
 *  1. Accept must list BOTH application/json and text/event-stream. With JSON
 *     alone the server answers 406 and discovery returns nothing.
 *  2. Replies can be JSON or text/event-stream, including for one JSON-RPC
 *     response. Select the parser using the response Content-Type.
 *  3. initialize issues an Mcp-Session-Id that every later request must echo.
 *  4. /mcp/ answers 307 to /mcp, so the fetch needs redirect: "follow".
 */
import { isRecord } from "../isRecord";
import { McpError } from "./mcpError";
import { sseEvents } from "./sse";
import type {
  AgentTool,
  AssembledTools,
  McpBudgetExceeded,
  McpServerConfig,
  McpUnreachable,
} from "./types";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** The same order as the app's other network timeouts. */
export const DEFAULT_MCP_TIMEOUT_MS = 10_000;

export type McpRpcResult = { result: unknown; sessionId: string | null };

/** The headers mcpRpc sets itself, lowercased; no extra header may share a name with one. */
const PROTOCOL_HEADERS = new Set(["accept", "content-type", "mcp-protocol-version", "mcp-session-id"]);

export async function mcpRpc(
  url: string,
  method: string,
  params: Record<string, unknown> | undefined,
  id: number | null,
  sessionId: string | null,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_MCP_TIMEOUT_MS,
  extraHeaders: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<McpRpcResult> {
  const isNotification = id === null;

  const body: Record<string, unknown> = { jsonrpc: "2.0", method };
  if (params !== undefined) body.params = params;
  if (!isNotification) body.id = id;

  // extraHeaders (a credential, typically) can never displace one of the
  // protocol's own headers. Spreading them first and the protocol's after was
  // not enough on its own (final review T8a): that only overwrites an
  // exact-case duplicate, while HTTP header names are case-insensitive and
  // Headers MERGES "accept" with "Accept" into "text/html, application/json,
  // …". So any extra header whose lowercased name is a protocol header's is
  // dropped outright, whatever its case.
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(extraHeaders)) {
    if (!PROTOCOL_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }
  headers.Accept = "application/json, text/event-stream";
  headers["Content-Type"] = "application/json";
  headers["MCP-Protocol-Version"] = MCP_PROTOCOL_VERSION;
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  // Every call carries its own abort-based timeout, and it must cover reading
  // the body too — a server that accepts the POST and then stalls mid-stream
  // would otherwise hang forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // A caller's signal (Rita's Stop) aborts the same controller, so Stop
  // cancels a request already in flight instead of leaving it to run out its
  // timeout with nobody reading the result. Linked by hand because
  // AbortSignal.any is Safari 17.4, above the iOS 16.4 floor. The listener
  // comes off in finally: one turn's signal outlives every request it rides
  // on, and a leftover listener would abort a controller long since done.
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "follow",
      signal: controller.signal,
    });

    const newSession = res.headers.get("mcp-session-id");

    if (!res.ok) {
      // MCP servers name the exact rejected field in the body
      // ("Missing session ID", "Bad Request: invalid protocol version"),
      // which a bare status code throws away.
      const text = await res.text().catch(() => "");
      throw new McpError(
        `http_${res.status}`,
        `MCP ${method} failed: HTTP ${res.status} ${text.slice(0, 500)}`,
        res.status,
      );
    }

    // A notification has no reply, and 202 is a success with no content — but
    // the body still has to be drained, because even an empty one holds a
    // connection handle open.
    if (isNotification || res.status === 202) {
      await res.text().catch(() => undefined);
      return { result: null, sessionId: newSession };
    }

    if (res.headers.get("content-type")?.split(";")[0].trim() === "application/json") {
      const payload: unknown = await res.json();
      if (!isRecord(payload) || payload.id !== id) {
        throw new Error(`MCP ${method} failed: no response carrying id ${id}`);
      }
      if (isRecord(payload.error)) {
        throw new Error(`MCP ${method} failed: ${JSON.stringify(payload.error).slice(0, 500)}`);
      }
      return { result: payload.result, sessionId: newSession };
    }

    if (!res.body) {
      throw new Error(`MCP ${method} failed: response had no body`);
    }

    for await (const ev of sseEvents(res.body)) {
      let payload: unknown;
      try {
        payload = JSON.parse(ev.data);
      } catch {
        continue;
      }
      if (!isRecord(payload)) continue;
      // Match by JSON-RPC id. A progress or ping event carrying an object
      // payload would otherwise be accepted as the response, yielding
      // {result: null} that then caches as a valid empty tool list.
      if (payload.id !== id) continue;
      if (isRecord(payload.error)) {
        throw new Error(
          `MCP ${method} failed: ${JSON.stringify(payload.error).slice(0, 500)}`,
        );
      }
      return { result: payload.result, sessionId: newSession };
    }

    throw new Error(`MCP ${method} failed: no response carrying id ${id}`);
  } catch (err) {
    // Our own timer aborted the request (or the body read): say so, rather
    // than surfacing a bare AbortError the user cannot tell from Stop.
    if (controller.signal.aborted && !signal?.aborted && !(err instanceof McpError)) {
      throw new McpError("timeout", `MCP ${method} timed out after ${timeoutMs} ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Trimmed, trailing slashes stripped. Two entries differing only by a
 * trailing slash are the same server, and discovering both would bill the
 * budget twice for one catalogue.
 */
export function normalizeMcpUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * A page cap and a repeat check, because nextCursor is the server's to
 * choose: a repeating or endless cursor would otherwise spin forever
 * inside a call that never times out (each page carries its own timeout),
 * hanging the turn with no unreachable[] entry to explain it.
 */
const MAX_TOOL_PAGES = 50;

/** Per-URL, for the app session. */
const toolCache = new Map<string, AgentTool[]>();

/** Tests only: the cache outlives a single test otherwise. */
export function resetMcpCache(): void {
  toolCache.clear();
}

/** initialize, then notifications/initialized; returns the session id the server issued. */
async function handshake(
  key: string,
  fetchImpl: typeof fetch,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<string | null> {
  const init = await mcpRpc(
    key,
    "initialize",
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "bdobb", version: "1.0" },
    },
    1,
    null,
    fetchImpl,
    undefined,
    headers,
    signal,
  );
  // Required by the spec; servers may reject tools/list without it.
  await mcpRpc(key, "notifications/initialized", undefined, null, init.sessionId, fetchImpl, undefined, headers, signal);
  return init.sessionId;
}

export async function discoverMcpTools(
  serverId: string,
  url: string,
  fetchImpl: typeof fetch = fetch,
  headers: Record<string, string> = {},
): Promise<AgentTool[]> {
  const key = normalizeMcpUrl(url);

  const cached = toolCache.get(key);
  // A deep copy: one caller's mutation must not reach every other caller.
  // structuredClone (not a shallow spread) because input_schema is an
  // object that callers may transform in place.
  if (cached) return cached.map((t) => structuredClone(t));

  const session = await handshake(key, fetchImpl, headers);

  const tools: AgentTool[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  let id = 2;
  let pages = 0;
  do {
    if (pages >= MAX_TOOL_PAGES) {
      throw new Error(
        `MCP tools/list failed: ${key} returned more than ${MAX_TOOL_PAGES} ` +
          `pages of nextCursor without finishing`,
      );
    }
    pages += 1;
    const page = await mcpRpc(
      key,
      "tools/list",
      cursor === undefined ? {} : { cursor },
      id,
      session,
      fetchImpl,
      undefined,
      headers,
    );
    id += 1;
    const result = isRecord(page.result) ? page.result : {};
    const list = Array.isArray(result.tools) ? result.tools : [];
    for (const raw of list) {
      if (!isRecord(raw) || typeof raw.name !== "string") continue;
      tools.push({
        server_id: serverId,
        name: raw.name,
        url: key,
        endpoint: "",
        description: typeof raw.description === "string" ? raw.description : "",
        input_schema: isRecord(raw.inputSchema) ? raw.inputSchema : {},
      });
    }
    // Page one is not necessarily everything.
    cursor = typeof result.nextCursor === "string" ? result.nextCursor : undefined;
    if (cursor !== undefined) {
      if (seenCursors.has(cursor)) {
        throw new Error(
          `MCP tools/list failed: ${key} returned a repeating nextCursor ` +
            `("${cursor}"), which would otherwise page forever`,
        );
      }
      seenCursors.add(cursor);
    }
  } while (cursor !== undefined);

  // Only a success is cached. A server that was still booting stays
  // retryable rather than being memoized as permanently empty.
  toolCache.set(key, tools);
  return tools.map((t) => structuredClone(t));
}

/**
 * The serialized size of the tool descriptors handed to the agent, in
 * CHARACTERS (JSON.stringify(tools).length), not bytes.
 *
 * The spec derives 64,000 from a llama.cpp deployment running
 * `-c 131072 --parallel 2`: context divided by parallel slots gives a
 * 65,536-token per-request slot, and 64,000 characters is about a quarter of
 * it. That derivation no longer describes the deployment, which now runs vLLM
 * — continuous batching over a shared KV cache, with no division by
 * parallelism, so the per-request ceiling is --max-model-len directly.
 *
 * 128,000 is the same 25% ratio against a 131,072-token slot: right on the
 * spec's own reasoning if max_model_len is 131,072, merely conservative if it
 * is the 262,144 the deploy/spark runbook records. The asymmetry is why we
 * hedge low — a budget too small drops a server with a visible named message,
 * while one too large overflows the prompt and hard-errors EVERY chat turn.
 *
 * MEASURED 2026-09-02: max_model_len is 262,144 on the live vLLM (nemotron-
 * 3.5-lightning). The spec's 25% ratio would therefore support 256,000, and
 * the constant is deliberately LEFT at 128,000 — the measurement resolved the
 * uncertainty the hedge existed for, and the conservative value was kept by
 * decision, not by omission. Raising it is a considered change, not a cleanup.
 */
export const TOOL_PAYLOAD_BUDGET_CHARS = 128_000;

/** `server` is set for a Settings target (its own entry); absent for a widget-derived one. */
type Target = { serverId: string; url: string; server?: McpServerConfig };

/** Per-server tools the user turned off, keyed by normalizeMcpUrl(url). */
export type AssembleOptions = {
  disabledTools?: Record<string, string[]>;
  /** chatStore routes a token server's discovery through withMcpAuth here. */
  discover: (t: { serverId: string; url: string; server?: McpServerConfig }) => Promise<AgentTool[]>;
};

export async function assembleTools(
  mcpServers: McpServerConfig[],
  dashboardMcp: string[],
  opts: AssembleOptions,
): Promise<AssembledTools> {
  // The union rule. Settings first, so it wins the server_id on a collision.
  const targets: Target[] = [];
  const seen = new Set<string>();
  for (const s of mcpServers) {
    if (!s.enabled) continue;
    const url = normalizeMcpUrl(s.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    targets.push({ serverId: s.id, url, server: s });
  }
  for (const raw of dashboardMcp) {
    const url = normalizeMcpUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    targets.push({ serverId: url, url });
  }

  // Concurrent and individually settled: N servers cost one timeout budget
  // rather than N, and one hanging server cannot block the others.
  const settled = await Promise.all(
    targets.map(async (t) => {
      try {
        return {
          t,
          tools: await opts.discover({ serverId: t.serverId, url: t.url, server: t.server }),
        };
      } catch (error) {
        return {
          t,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  const tools: AgentTool[] = [];
  const budgetExceeded: McpBudgetExceeded[] = [];
  const unreachable: McpUnreachable[] = [];
  let used = 0;

  for (const outcome of settled) {
    if ("error" in outcome) {
      // A visible skip, not a fatal error: without a structural signal a dead
      // server is indistinguishable in the UI from "none configured".
      unreachable.push({
        serverId: outcome.t.serverId,
        url: outcome.t.url,
        message:
          `MCP server "${outcome.t.serverId}" (${outcome.t.url}) could not be ` +
          `reached, so its tools are missing from this answer: ${outcome.error}`,
      });
      continue;
    }

    // Disabled tools leave BEFORE the budget: a turned-off tool costs zero
    // characters, which is what makes turning one expensive tool off the
    // escape valve for a server that would otherwise be dropped whole.
    const off = new Set(opts.disabledTools?.[outcome.t.url] ?? []);
    const offered = outcome.tools.filter((t) => !off.has(t.name));

    const payloadChars = JSON.stringify(offered).length;
    if (used + payloadChars > TOOL_PAYLOAD_BUDGET_CHARS) {
      // Dropped ENTIRELY, never truncated mid-list: a partial tool set is
      // exactly the silently-invisible-tool failure the budget prevents.
      budgetExceeded.push({
        serverId: outcome.t.serverId,
        url: outcome.t.url,
        toolCount: offered.length,
        payloadChars,
        message:
          `MCP server "${outcome.t.serverId}" (${outcome.t.url}) was left out ` +
          `of this answer: its ${offered.length} tools need ` +
          `${payloadChars} characters, and ${used} of the ` +
          `${TOOL_PAYLOAD_BUDGET_CHARS}-character budget is already used. ` +
          `Restart it with \`--tool-discovery\` so it advertises a small ` +
          `catalogue instead of its whole one, or turn off some of its ` +
          `tools in AI Library → MCP Servers.`,
      });
      // Later, smaller servers are still considered.
      continue;
    }

    used += payloadChars;
    tools.push(...offered);
  }

  return {
    tools: tools.length > 0 ? tools : null,
    budgetExceeded,
    unreachable,
  };
}

export async function callMcpTool(
  url: string,
  toolName: string,
  args: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<unknown> {
  const key = normalizeMcpUrl(url);

  // Its OWN handshake, not the discovery cache: the session id issued at
  // initialize belongs to that exchange, and discovery may have happened long
  // enough ago that the server has dropped it.
  const session = await handshake(key, fetchImpl, headers, signal);

  const res = await mcpRpc(
    key,
    "tools/call",
    { name: toolName, arguments: args },
    2,
    session,
    fetchImpl,
    undefined,
    headers,
    signal,
  );

  const result = isRecord(res.result) ? res.result : {};
  // A tool can fail without a JSON-RPC error: the protocol's isError flag
  // rides on an otherwise-successful response.
  if (result.isError === true) {
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .map((item) =>
        isRecord(item) && typeof item.text === "string" ? item.text : "",
      )
      .filter((t) => t !== "")
      .join("\n");
    throw new McpError(
      "tool_error",
      `MCP tool "${toolName}" failed: ${text === "" ? "no detail given" : text}`,
    );
  }
  return res.result;
}
