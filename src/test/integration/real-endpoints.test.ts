// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment node
//
// The automated form of the deployment smoke test: this client against the
// real servers, not a mock of them.
//
//   OPENBB_LIVE=1 pnpm test:run src/test/integration
//
// OPT-IN, NOT SKIP-IF-UNREACHABLE. Without OPENBB_LIVE the file skips. WITH
// it and nothing configured, the first check FAILS rather than passing an
// empty suite — a live run that proves nothing is worse than a red one that
// names what is missing. CI must never need a live backend.
//
// The Rita check cannot pass while the GPU host is unreachable. That is not a
// bug in the check: it is the check doing its job.
import { describe, it, expect, beforeAll } from "vitest";
import { assembleTools, discoverMcpTools, resetMcpCache } from "../../lib/agent/mcp";
import type { McpServerConfig } from "../../lib/agent/types";

const enabled = process.env.OPENBB_LIVE === "1";
const NAS = process.env.OPENBB_NAS_URL ?? "";
const NAS_AUTH = process.env.OPENBB_NAS_AUTH ?? "";
const RITA = process.env.OPENBB_RITA_URL ?? "";
const MCP_URLS = process.env.OPENBB_MCP_URLS ?? "";

/**
 * The data backend challenges every request, so the check needs credentials
 * or it only ever proves that 401 is reachable. The MCP servers take none —
 * for them, tailnet reachability is the credential.
 */
function nasHeaders(): Record<string, string> {
  if (NAS_AUTH === "") return {};
  return { Authorization: `Basic ${Buffer.from(NAS_AUTH).toString("base64")}` };
}

/** `id=url,id=url` → the Settings shape assembleTools consumes. */
function parseMcpServers(spec: string): McpServerConfig[] {
  return spec
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const eq = entry.indexOf("=");
      if (eq === -1) throw new Error(`OPENBB_MCP_URLS entry is not id=url: ${entry}`);
      return {
        id: entry.slice(0, eq).trim(),
        url: entry.slice(eq + 1).trim(),
        enabled: true,
      };
    });
}

describe.skipIf(!enabled)("live endpoints", () => {
  const servers = enabled ? parseMcpServers(MCP_URLS) : [];

  beforeAll(() => {
    resetMcpCache();
  });

  it("has endpoints configured at all", () => {
    // Failing loudly rather than passing an empty suite.
    expect(NAS, "OPENBB_NAS_URL is not set").not.toBe("");
    expect(NAS_AUTH, "OPENBB_NAS_AUTH is not set").not.toBe("");
    expect(RITA, "OPENBB_RITA_URL is not set").not.toBe("");
    expect(servers.length, "OPENBB_MCP_URLS is not set").toBeGreaterThan(0);
  });

  it("the NAS serves a well-formed widgets.json", async () => {
    const res = await fetch(`${NAS.replace(/\/+$/, "")}/widgets.json`, {
      headers: nasHeaders(),
    });
    expect(res.ok, `HTTP ${res.status} from ${NAS}/widgets.json`).toBe(true);
    const body: unknown = await res.json();
    expect(typeof body).toBe("object");
    expect(body).not.toBeNull();
    expect(Object.keys(body as Record<string, unknown>).length).toBeGreaterThan(0);
  });

  it("Rita serves a non-empty agents.json", async () => {
    const res = await fetch(`${RITA.replace(/\/+$/, "")}/agents.json`);
    expect(res.ok, `HTTP ${res.status} from ${RITA}/agents.json`).toBe(true);
    const body: unknown = await res.json();
    expect(typeof body).toBe("object");
    expect(body).not.toBeNull();
    expect(Object.keys(body as Record<string, unknown>).length).toBeGreaterThan(0);
  });

  it("each MCP server yields well-formed tools", async () => {
    // The check that exercises the real transport end to end: dual Accept,
    // session capture and replay, notifications/initialized, SSE-framed
    // parsing. A client that gets any of them wrong fails here with a 406 or
    // an unparseable body.
    for (const server of servers) {
      const tools = await discoverMcpTools(server.id, server.url);
      expect(tools.length, `${server.id} returned no tools`).toBeGreaterThan(0);
      for (const tool of tools) {
        expect(tool.server_id).toBe(server.id);
        expect(tool.url).toBe(server.url.trim().replace(/\/+$/, ""));
        expect(tool.name).not.toBe("");
        expect(typeof tool.input_schema).toBe("object");
        expect(tool.input_schema).not.toBeNull();
      }
    }
  });

  it("assembleTools returns tools from every configured server, none unreachable", async () => {
    resetMcpCache();
    const out = await assembleTools(servers, [], { discover: (t) => discoverMcpTools(t.serverId, t.url) });
    expect(out.unreachable, JSON.stringify(out.unreachable)).toEqual([]);
    expect(out.tools).not.toBeNull();
    const contributing = new Set(out.tools?.map((t) => t.server_id));
    for (const server of servers) {
      expect(contributing.has(server.id), `${server.id} contributed nothing`).toBe(true);
    }
  });
});
