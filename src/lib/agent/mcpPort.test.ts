// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The port the stack serves MCP on, pinned where it is actually seeded.
 *
 * There is no MCP-port constant in this app: an MCP server is whatever URL the
 * user types into AI Library ▸ MCP Servers, and the one place the app itself
 * names a port is the example that seeds `OPENBB_MCP_URLS` in `.env.example`
 * (the live-endpoint suite reads that variable; see
 * src/test/integration/real-endpoints.test.ts). So this is the default's only
 * home, and this is the test that holds it.
 *
 * 6901, not 8443. The stack's openbb-mcp listens on 6901 and that is the port
 * it is published on; 8443 is the funnel GATEWAY's port and fronts something
 * else entirely. An example that said 8443 sent every reader — and the live
 * suite — at the wrong service.
 *
 * process.cwd(), not import.meta.url: under jsdom the latter is an http:// URL
 * that readFileSync refuses (same reason as agents-json.test.ts).
 */
describe("the MCP port the app seeds", () => {
  const envExample = readFileSync(".env.example", "utf8");

  it("is 6901 in the OPENBB_MCP_URLS example", () => {
    const line = envExample.split("\n").find((l) => l.includes("OPENBB_MCP_URLS=openbb="));
    expect(line).toBeDefined();
    expect(line).toContain(":6901/mcp");
  });

  it("names 8443 nowhere: that port is the gateway's, not MCP's", () => {
    expect(envExample).not.toContain("8443");
  });
});
