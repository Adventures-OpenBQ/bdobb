// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";

vi.mock("../logger", () => ({ logOnce: vi.fn(() => Promise.resolve()), logError: vi.fn(() => Promise.resolve()) }));

import { addImportedMcpServers, mcpImportNotice, parseMcpServers } from "./importedMcp";

describe("parseMcpServers", () => {
  it("reads name, description, url and authType, defaulting authType to oauth", () => {
    expect(
      parseMcpServers(
        [
          { name: "Docs", description: "d", url: "https://docs.example/mcp", authType: "token" },
          { name: "Other", description: "", url: "https://o.example/mcp" },
          { name: "Odd", description: "", url: "https://odd.example/mcp", authType: "basic" },
        ],
        "App",
      ),
    ).toEqual([
      { name: "Docs", description: "d", url: "https://docs.example/mcp", authType: "token" },
      { name: "Other", description: "", url: "https://o.example/mcp", authType: "oauth" },
      { name: "Odd", description: "", url: "https://odd.example/mcp", authType: "oauth" },
    ]);
  });

  it("skips entries without a string name/description or an http(s) url, and a non-list", () => {
    expect(
      parseMcpServers(
        [{ name: "x", description: "d", url: "javascript:1" }, { description: "d", url: "https://a.example" }, "nope"],
        "App",
      ),
    ).toEqual([]);
    expect(parseMcpServers(undefined, "App")).toEqual([]);
    expect(parseMcpServers({ name: "x" }, "App")).toEqual([]);
  });
});

describe("addImportedMcpServers", () => {
  const existing = [{ id: "s1", url: "https://docs.example/mcp/", enabled: true }];

  it("adds new servers disabled, with their source, and leaves an existing URL alone", () => {
    const { next, added } = addImportedMcpServers(
      existing,
      [
        { name: "Docs", description: "d", url: "https://docs.example/mcp", authType: "token" },
        { name: "News", description: "n", url: "https://news.example/mcp", authType: "token" },
        { name: "News again", description: "n", url: "https://news.example/mcp/", authType: "oauth" },
      ],
      { kind: "backend", backendId: "b1" },
    );
    expect(added).toBe(1);
    expect(next[0]).toEqual(existing[0]);
    expect(next[1]).toMatchObject({
      url: "https://news.example/mcp",
      enabled: false,
      name: "News",
      description: "n",
      authType: "token",
      source: { kind: "backend", backendId: "b1" },
    });
    expect(next).toHaveLength(2);
  });
});

describe("mcpImportNotice", () => {
  it("is empty for none and names the count and the place to turn them on", () => {
    expect(mcpImportNotice(0, "App")).toBe("");
    expect(mcpImportNotice(1, "App")).toBe(" Added 1 MCP server from App. Turn it on in AI Library → MCP Servers.");
    expect(mcpImportNotice(2, "App")).toBe(" Added 2 MCP servers from App. Turn them on in AI Library → MCP Servers.");
  });
});

// main ac2d3475's warning, ported down the chain (user ruling): an apps.json
// server on this computer or a private network is still added (switched off,
// like every other) and the notice names it; a public one is not named.
describe("apps.json MCP servers on a private network", () => {
  it("adds a LAN server and names it in the import notice", () => {
    const { next, added, local } = addImportedMcpServers(
      [],
      [
        { name: "LAN", description: "l", url: "http://10.0.0.7/mcp", authType: "oauth" },
        { name: "Public", description: "p", url: "https://public.example/mcp", authType: "oauth" },
      ],
      { kind: "file" },
    );
    expect(added).toBe(2);
    expect(next.map((s) => [s.url, s.enabled])).toEqual([
      ["http://10.0.0.7/mcp", false],
      ["https://public.example/mcp", false],
    ]);
    expect(local).toEqual(["http://10.0.0.7/mcp"]);
    expect(mcpImportNotice(added, "the imported file", local)).toBe(
      " Added 2 MCP servers from the imported file. Turn them on in AI Library → MCP Servers." +
        " Warning: on this computer or a private network: http://10.0.0.7/mcp.",
    );
  });
});
