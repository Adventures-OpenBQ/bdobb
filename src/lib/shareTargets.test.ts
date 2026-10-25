// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { join } from "@tauri-apps/api/path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fillTemplate,
  formatHeaderLines,
  isJsonObjectText,
  isShareTarget,
  parseHeaderLines,
  type ShareTarget,
} from "./shareTargets";
import { sendToTarget } from "./shareSend";
import { __read, __reset } from "../test/memfs";

const httpFetch = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...a: unknown[]) => httpFetch(...a) }));
vi.mock("@tauri-apps/api/path", () => ({ join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))) }));
vi.mock("./agent/mcp", () => ({ callMcpTool: vi.fn(async () => ({ ok: true })) }));

const vars = { markdown: "# hi", title: "hi", filename: "hi.md", exportedAt: "2026-09-03T10:00:00.000Z" };

const http: ShareTarget = {
  id: "t1",
  name: "Notes",
  kind: "http",
  url: "https://notes.example/in",
  template: '{"title":"{{title}}"}',
};

describe("isShareTarget", () => {
  it("accepts an http target with only the required fields", () => {
    expect(isShareTarget(http)).toBe(true);
  });

  it("accepts optional headers as a string record", () => {
    expect(isShareTarget({ ...http, headers: { Authorization: "Bearer x" } })).toBe(true);
  });

  it("requires a non-empty tool for mcp", () => {
    expect(isShareTarget({ ...http, kind: "mcp" })).toBe(false);
    expect(isShareTarget({ ...http, kind: "mcp", tool: "" })).toBe(false);
    expect(isShareTarget({ ...http, kind: "mcp", tool: "save_note" })).toBe(true);
  });

  it("takes a folder path, not a URL, for file", () => {
    expect(isShareTarget({ ...http, kind: "file", url: "/Users/me/Notes" })).toBe(true); // scrub-allow: a made-up folder, not a real home
    expect(isShareTarget({ ...http, kind: "file", url: "" })).toBe(false);
  });

  it.each([
    ["an empty id", { ...http, id: "" }],
    ["an empty name", { ...http, name: "" }],
    ["an unknown kind", { ...http, kind: "email" }],
    ["a non-http url", { ...http, url: "ftp://x.example" }],
    ["a template that is not JSON", { ...http, template: "{" }],
    ["a template that is a JSON array", { ...http, template: "[]" }],
    ["a header with a non-string value", { ...http, headers: { a: 1 } }],
    ["a tool that is not a string", { ...http, tool: 3 }],
    ["a non-object", "t1"],
  ])("rejects %s", (_label, value) => {
    expect(isShareTarget(value)).toBe(false);
  });
});

describe("isJsonObjectText", () => {
  it.each([
    ["{}", true],
    ['{"a":1}', true],
    ["[]", false],
    ["1", false],
    ["null", false],
    ["{", false],
  ])("%s -> %s", (text, ok) => {
    expect(isJsonObjectText(text)).toBe(ok);
  });
});

describe("header lines", () => {
  it("parses Key: value per line, trimming and skipping blanks", () => {
    expect(parseHeaderLines("Authorization: Bearer x\n\n X-Id : 7 \n")).toEqual({
      Authorization: "Bearer x",
      "X-Id": "7",
    });
  });

  it("keeps colons inside the value", () => {
    expect(parseHeaderLines("Link: https://a.example/b")).toEqual({ Link: "https://a.example/b" });
  });

  it("rejects a line with no colon or an empty key", () => {
    expect(parseHeaderLines("nope")).toBeNull();
    expect(parseHeaderLines(": v")).toBeNull();
  });

  it("round-trips through formatHeaderLines", () => {
    const headers = { A: "1", B: "two" };
    expect(parseHeaderLines(formatHeaderLines(headers))).toEqual(headers);
    expect(formatHeaderLines(undefined)).toBe("");
  });
});

describe("fillTemplate", () => {
  it("substitutes every placeholder in every string leaf", () => {
    const filled = fillTemplate('{"text":"{{title}}: {{markdown}}","meta":{"file":"{{filename}}","at":"{{exportedAt}}","n":1}}', vars);
    expect(filled).toEqual({ text: "hi: # hi", meta: { file: "hi.md", at: "2026-09-03T10:00:00.000Z", n: 1 } });
  });

  it("rejects non-object templates", () => {
    expect(() => fillTemplate("[1]", vars)).toThrow("Template must be a JSON object");
    expect(() => fillTemplate("null", vars)).toThrow("Template must be a JSON object");
    expect(() => fillTemplate("nope", vars)).toThrow();
  });
});

describe("sendToTarget", () => {
  beforeEach(() => {
    __reset();
    httpFetch.mockReset();
  });

  it("mcp: calls the tool with the filled template", async () => {
    const { callMcpTool } = await import("./agent/mcp");
    await sendToTarget(
      { id: "1", name: "Notes", kind: "mcp", url: "https://mcp.example/mcp", tool: "add_note", template: '{"body":"{{markdown}}"}' },
      vars,
    );
    expect(callMcpTool).toHaveBeenCalledWith("https://mcp.example/mcp", "add_note", { body: "# hi" });
  });

  it("http: POSTs JSON with the configured headers and surfaces HTTP errors", async () => {
    // Response forbids a non-null body on a null-body status (204); null is
    // the faithful "204 No Content" stand-in.
    httpFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const target = {
      id: "2",
      name: "Hook",
      kind: "http" as const,
      url: "https://notes.example/in",
      template: '{"t":"{{title}}"}',
      headers: { "X-Key": "k" },
    };
    await sendToTarget(target, vars);
    expect(httpFetch).toHaveBeenCalledWith("https://notes.example/in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Key": "k" },
      body: '{"t":"hi"}',
    });
    httpFetch.mockResolvedValue(new Response("denied", { status: 403 }));
    await expect(sendToTarget(target, vars)).rejects.toThrow(/^HTTP 403/);
  });

  it("file: writes the markdown under the folder, honouring a template path", async () => {
    await sendToTarget({ id: "3", name: "Vault", kind: "file", url: "/vault/inbox", template: '{"path":"rita/{{filename}}"}' }, vars);
    expect(__read("/vault/inbox/rita/hi.md")).toBe("# hi");
    await sendToTarget({ id: "4", name: "Vault", kind: "file", url: "/vault/inbox", template: "{}" }, vars);
    expect(__read("/vault/inbox/hi.md")).toBe("# hi");
  });

  it("file: rejects a template path that escapes the folder", async () => {
    await expect(
      sendToTarget({ id: "5", name: "Vault", kind: "file", url: "/vault/inbox", template: '{"path":"../escape.md"}' }, vars),
    ).rejects.toThrow("invalid path in template");
    await expect(
      sendToTarget({ id: "6", name: "Vault", kind: "file", url: "/vault/inbox", template: '{"path":"sub/../../escape.md"}' }, vars),
    ).rejects.toThrow("invalid path in template");
    await expect(
      sendToTarget({ id: "7", name: "Vault", kind: "file", url: "/vault/inbox", template: '{"path":"/etc/passwd"}' }, vars),
    ).rejects.toThrow("invalid path in template");
    // a normal nested path is unaffected
    await sendToTarget({ id: "8", name: "Vault", kind: "file", url: "/vault/inbox", template: '{"path":"sub/name.md"}' }, vars);
    expect(__read("/vault/inbox/sub/name.md")).toBe("# hi");
  });

  it("file: slices the directory correctly when join returns a Windows path", async () => {
    vi.mocked(join).mockResolvedValueOnce("C:\\vault\\inbox\\hi.md");
    await sendToTarget({ id: "9", name: "Vault", kind: "file", url: "C:\\vault\\inbox", template: "{}" }, vars);
    expect(__read("C:\\vault\\inbox\\hi.md")).toBe("# hi");
  });
});
