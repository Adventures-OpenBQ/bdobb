// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The two MCP captures, taken from the live `stores` server on 2026-09-01 and
 * byte-exact to the sizes the v6.0.0 spec records (347 and 3,606).
 *
 * `initializeResult` and `rawTools` are parsed from the capture's own `data:`
 * line HERE, deliberately not through `mcp.ts`. Test expectations must come
 * from the captured payload rather than a hand-transcribed copy of it —
 * otherwise a bug in the parser and a matching bug in the expectation cancel
 * out and the suite reports green.
 */
import initializeSseRaw from "./mcp/initialize.sse?raw";
import toolsListSseRaw from "./mcp/tools-list.sse?raw";
import initialize201Raw from "./mcp/v2.0.1-initialize.sse?raw";
import toolsList201Raw from "./mcp/v2.0.1-tools-list.sse?raw";

export const initializeSse = initializeSseRaw;
export const toolsListSse = toolsListSseRaw;

/** Pull the first `data:` line out of a capture without framing logic. */
function firstDataPayload(sse: string): Record<string, unknown> {
  const line = sse
    .split(/\r?\n/)
    .find((l) => l.startsWith("data:"));
  if (!line) throw new Error("fixture has no data: line");
  return JSON.parse(line.slice("data:".length).trim()) as Record<
    string,
    unknown
  >;
}

type RawTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export const initializeResult = (
  firstDataPayload(initializeSse).result as {
    protocolVersion: string;
    serverInfo: { name: string; version: string };
  }
);

export const rawTools = (
  (firstDataPayload(toolsListSse).result as { tools: RawTool[] }).tools
);

/**
 * Replay a capture as a byte stream in fixed-size slices.
 *
 * Slicing BYTES, not characters, is the whole point: a real socket splits
 * multi-byte UTF-8 sequences, and a parser that decodes per chunk without a
 * streaming decoder corrupts them.
 */
export function streamOf(
  text: string,
  chunkSize: number,
): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let pos = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pos >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(pos, pos + chunkSize));
      pos += chunkSize;
    },
  });
}

/**
 * The MCP 2.0.1 captures (adaptation 7), host and session id sanitized.
 * "2.0.1" is the bdobb-v2 adaptation label; the capture's own serverInfo
 * reports OpenBB MCP 4.0.11.
 */
export const MCP_201 = { initialize: initialize201Raw, toolsList: toolsList201Raw };

/**
 * Drive the real `discoverMcpTools` against a capture pair: initialize reply
 * (issuing a session id), a 202 for the notification, then the tools/list reply.
 */
export async function listToolsFrom(fixture: { initialize: string; toolsList: string }) {
  const { discoverMcpTools, resetMcpCache } = await import("../../lib/agent/mcp");
  resetMcpCache();
  const sse = (body: string, headers: Record<string, string> = {}) =>
    new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream", ...headers } });
  const fetchImpl = async (_url: string, opts: RequestInit) => {
    const { method } = JSON.parse(opts.body as string) as { method: string };
    if (method === "initialize") return sse(fixture.initialize, { "mcp-session-id": "example" });
    if (method === "notifications/initialized") return new Response("", { status: 202 });
    return sse(fixture.toolsList);
  };
  return discoverMcpTools("example", "http://example/mcp", fetchImpl as never);
}
