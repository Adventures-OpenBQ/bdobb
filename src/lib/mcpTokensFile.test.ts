// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";
import { __list, __read, __reset, __seed } from "../test/memfs";
import { __resetJsonStoreForTests } from "./jsonStore";
import { __resetLoggerForTests } from "./logger";
import { loadMcpTokens, saveMcpTokens } from "./mcpTokensFile";

beforeEach(() => {
  __reset();
  __resetJsonStoreForTests();
  __resetLoggerForTests();
});

describe("mcpTokens.json", () => {
  it("is {} when absent, and is not written by a read", async () => {
    expect(await loadMcpTokens()).toEqual({});
    expect(__list()).not.toContain("mcpTokens.json");
  });

  it("round-trips, keeping only well-formed entries", async () => {
    __seed("mcpTokens.json", JSON.stringify({ "https://a.example/mcp": { token: "t1" }, bad: { token: 3 }, worse: "x" }));
    expect(await loadMcpTokens()).toEqual({ "https://a.example/mcp": { token: "t1" } });
    await saveMcpTokens({ "https://b.example/mcp": { token: "t2" } });
    expect(JSON.parse(__read("mcpTokens.json") ?? "{}")).toEqual({ "https://b.example/mcp": { token: "t2" } });
  });

  it("quarantines a corrupt file rather than clobbering it", async () => {
    __seed("mcpTokens.json", "{not json");
    expect(await loadMcpTokens()).toEqual({});
    expect(__list().some((p) => p.startsWith("mcpTokens.json") && p !== "mcpTokens.json")).toBe(true);
  });
});
