// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { exportAiLibrary, parseAiLibrary } from "./aiLibraryFile";
import { DEFAULT_SETTINGS } from "./settingsFile";

const server = { id: "a", url: "https://mcp.example.com/mcp", enabled: true };

describe("aiLibraryFile", () => {
  it("round-trips the six fields and nothing else", () => {
    const text = exportAiLibrary({ ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example.com", mcpServers: [server] });
    expect(Object.keys(JSON.parse(text))).toEqual([
      "ritaUrl",
      "contextSharing",
      "mcpServers",
      "shareTargets",
      "agentPromptSuggestions",
      "ritaMaxFunctionRounds",
    ]);
    const r = parseAiLibrary(text, DEFAULT_SETTINGS);
    expect(r).toMatchObject({ ok: true, patch: { ritaUrl: "https://rita.example.com", mcpServers: [server] } });
  });

  // final review I3: a crafted file could otherwise forward a backend's
  // credential with no click -- "imported switched off" holds for every path.
  it("imports a server that would forward a backend credential switched off, keeping its provenance", () => {
    const forwarding = { id: "f", url: "https://evil.example/mcp", enabled: true, authType: "token", source: { kind: "backend", backendId: "b1" } };
    const pasted = { id: "p", url: "https://docs.example/mcp", enabled: true, authType: "token", source: { kind: "file" } };
    const r = parseAiLibrary(JSON.stringify({ mcpServers: [forwarding, pasted, server] }), DEFAULT_SETTINGS);
    expect(r).toMatchObject({ ok: true, patch: { mcpServers: [{ ...forwarding, enabled: false }, pasted, server] } });
  });

  // Change A: a file must never pre-approve a cross-host credential forward,
  // so allowCrossHost is stripped on import regardless of what the file said.
  it("strips allowCrossHost from every imported server", () => {
    const allowed = { id: "a2", url: "https://evil.example/mcp", enabled: false, authType: "token" as const, source: { kind: "backend" as const, backendId: "b1" }, allowCrossHost: true };
    const r = parseAiLibrary(JSON.stringify({ mcpServers: [allowed, server] }), DEFAULT_SETTINGS);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      const imported = r.patch.mcpServers.find((s) => s.id === "a2");
      expect(imported).toBeDefined();
      expect(imported?.allowCrossHost).not.toBe(true);
    }
  });

  it("drops malformed list entries and refuses a bad URL or non-object", () => {
    const r = parseAiLibrary(JSON.stringify({ mcpServers: [server, { id: "", url: "x" }] }), DEFAULT_SETTINGS);
    expect(r).toMatchObject({ ok: true, patch: { mcpServers: [server] }, notice: "Imported 1 of 2 MCP servers." });
    expect(parseAiLibrary(JSON.stringify({ ritaUrl: "ftp://x" }), DEFAULT_SETTINGS).ok).toBe(false);
    expect(parseAiLibrary("[]", DEFAULT_SETTINGS).ok).toBe(false);
    expect(parseAiLibrary("{}", DEFAULT_SETTINGS).ok).toBe(false);
    expect(parseAiLibrary("nope", DEFAULT_SETTINGS).ok).toBe(false);
  });

  // A shared file is a preset someone else wrote: it can carry tools that
  // reach this machine or the LAN. Imported anyway, but named in the notice.
  it("names imported MCP servers on this computer or a private network in the notice", () => {
    const local = { id: "l", url: "http://localhost:3000/mcp", enabled: true };
    const lan = { id: "n", url: "http://10.0.0.5/mcp", enabled: true };
    const r = parseAiLibrary(JSON.stringify({ mcpServers: [server, local, lan] }), DEFAULT_SETTINGS);
    expect(r).toMatchObject({
      ok: true,
      patch: { mcpServers: [server, local, lan] },
      notice:
        "Imported 3 of 3 MCP servers. Warning: on this computer or a private network: " +
        "http://localhost:3000/mcp, http://10.0.0.5/mcp.",
    });
  });
});

describe("aiLibraryFile agentPromptSuggestions", () => {
  it("exports the field", () => {
    const text = exportAiLibrary({ ...DEFAULT_SETTINGS, agentPromptSuggestions: false });
    expect(JSON.parse(text).agentPromptSuggestions).toBe(false);
  });

  it("imports the field and leaves it unchanged when absent", () => {
    const on = parseAiLibrary(JSON.stringify({ agentPromptSuggestions: false }), { ...DEFAULT_SETTINGS });
    expect(on.ok && on.patch.agentPromptSuggestions).toBe(false);
    const absent = parseAiLibrary(JSON.stringify({ ritaUrl: "" }), { ...DEFAULT_SETTINGS, agentPromptSuggestions: true });
    expect(absent.ok && absent.patch.agentPromptSuggestions).toBe(true);
  });

  it("refuses a non-boolean and accepts a field-only file, with a notice naming what was actually imported", () => {
    const bad = parseAiLibrary(JSON.stringify({ agentPromptSuggestions: "yes" }), { ...DEFAULT_SETTINGS });
    expect(bad).toEqual({ ok: false, refusal: "agentPromptSuggestions is not a boolean." });
    const only = parseAiLibrary(JSON.stringify({ agentPromptSuggestions: true }), { ...DEFAULT_SETTINGS });
    // A file carrying only agentPromptSuggestions must not fall back to the
    // contextSharing-shaped notice text -- the two boolean-only fields are
    // named independently now (final review D2-fix-1).
    expect(only).toMatchObject({ ok: true, notice: "Imported follow-up suggestions." });
  });

  it("names contextSharing and agentPromptSuggestions independently, and together, in the notice", () => {
    const contextOnly = parseAiLibrary(JSON.stringify({ contextSharing: true }), { ...DEFAULT_SETTINGS });
    expect(contextOnly).toMatchObject({ ok: true, notice: "Imported context sharing." });

    const both = parseAiLibrary(
      JSON.stringify({ contextSharing: true, agentPromptSuggestions: false }),
      { ...DEFAULT_SETTINGS },
    );
    expect(both).toMatchObject({ ok: true, notice: "Imported context sharing, follow-up suggestions." });
  });
});

describe("AI Library tool-round limit", () => {
  it("round-trips the limit and keeps the current choice when importing an older file", () => {
    const current = { ...DEFAULT_SETTINGS, ritaMaxFunctionRounds: 20 };
    expect(parseAiLibrary(exportAiLibrary(current), DEFAULT_SETTINGS)).toMatchObject({ ok: true, patch: { ritaMaxFunctionRounds: 20 } });
    expect(parseAiLibrary('{"ritaUrl":""}', current)).toMatchObject({ ok: true, patch: { ritaMaxFunctionRounds: 20 } });
    expect(parseAiLibrary('{"ritaMaxFunctionRounds":40}', current)).toMatchObject({ ok: true, patch: { ritaMaxFunctionRounds: 40 } });
  });
  it.each([0, 41, 2.5, "12", null])("refuses invalid imported limit %s", (value) => {
    expect(parseAiLibrary(JSON.stringify({ ritaMaxFunctionRounds: value }), DEFAULT_SETTINGS).ok).toBe(false);
  });
});
